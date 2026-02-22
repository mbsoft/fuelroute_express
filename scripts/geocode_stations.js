/**
 * Geocode fuel stations from the staging table (fuel_price_import) using
 * NextBillion.ai Discover API and insert them into fuel_api_fuelstation.
 *
 * Usage:  node scripts/geocode_stations.js
 */
require('dotenv').config();

const crypto = require('crypto');
const axios = require('axios');
const supabase = require('../src/config/db');

const NB_API_KEY = process.env.NEXTBILLION_API_KEY;
if (!NB_API_KEY) {
  console.error('NEXTBILLION_API_KEY is not set in environment');
  process.exit(1);
}

const DISCOVER_URL = 'https://api.nextbillion.io/discover';
const BATCH_SIZE = 20;       // rows per batch
const DELAY_MS = 600;        // ms between requests (~1.6 req/s, well under 40/s limit)

/**
 * Generate a deterministic numeric opis_id for imported stations.
 * Uses first 8 hex chars of an MD5 hash, parsed as a positive integer.
 * Offset by 9_000_000 to avoid collisions with real OPIS IDs.
 */
function generateOpisId(row) {
  const key = `${row.store}|${row.city}|${row.state}`.toUpperCase();
  const hash = crypto.createHash('md5').update(key).digest('hex').slice(0, 7);
  return 9_000_000 + parseInt(hash, 16);
}

/**
 * Build a search query from the staging row fields:
 *   store name, address (interstate/exit), city, state
 */
function buildQuery(row) {
  const parts = [row.store, row.address, row.city, row.state].filter(Boolean);
  return parts.join(', ');
}

/**
 * Call NextBillion.ai Discover endpoint to geocode a query string.
 * Returns { lat, lon } or null if no result.
 */
async function geocode(query) {
  try {
    const response = await axios.get(DISCOVER_URL, {
      params: {
        q: query,
        key: NB_API_KEY,
        fallback: true,
        scoring: 0.6,
      },
      timeout: 10000,
    });

    const items = response.data && response.data.items;
    if (items && items.length > 0) {
      const pos = items[0].position || items[0].access?.[0] || {};
      const lat = pos.lat ?? pos.latitude;
      const lon = pos.lng ?? pos.lon ?? pos.longitude;
      if (lat != null && lon != null) {
        return { lat: parseFloat(lat), lon: parseFloat(lon) };
      }
    }
  } catch (err) {
    console.error(`  Geocode error for "${query}": ${err.message}`);
  }
  return null;
}

/**
 * Build a lookup set of existing stations keyed by UPPER(name|city|state).
 */
async function fetchExistingStationKeys() {
  const keys = new Set();
  let offset = 0;
  const pageSize = 1000;

  while (true) {
    const { data, error } = await supabase
      .from('fuel_api_fuelstation')
      .select('name, city, state')
      .range(offset, offset + pageSize - 1);

    if (error) {
      console.error('Warning: could not fetch existing stations:', error.message);
      return keys;
    }
    if (!data || data.length === 0) break;

    for (const row of data) {
      const key = `${(row.name || '').toUpperCase().trim()}|${(row.city || '').toUpperCase().trim()}|${(row.state || '').toUpperCase().trim()}`;
      keys.add(key);
    }

    offset += pageSize;
    if (data.length < pageSize) break;
  }

  return keys;
}

/**
 * Fetch all rows from the staging table, filtered against existing stations.
 */
async function fetchStagingRows() {
  console.log('Loading existing stations for dedup...');
  const existing = await fetchExistingStationKeys();
  console.log(`Found ${existing.size} existing stations.`);

  const { data: allRows, error: fetchErr } = await supabase
    .from('fuel_price_import')
    .select('*');

  if (fetchErr) {
    throw new Error(`Failed to fetch staging rows: ${fetchErr.message}`);
  }

  const rows = (allRows || []).filter((row) => {
    const key = `${(row.store || '').toUpperCase().trim()}|${(row.city || '').toUpperCase().trim()}|${(row.state || '').toUpperCase().trim()}`;
    return !existing.has(key);
  });

  console.log(`Filtered out ${(allRows || []).length - rows.length} already-existing stations.`);
  return rows;
}

/**
 * Insert a geocoded station into fuel_api_fuelstation.
 * Uses Supabase PostGIS via an RPC or direct insert with raw SQL for the
 * geography column.
 */
async function insertStation(row, coords) {
  const { error } = await supabase.from('fuel_api_fuelstation').insert({
    opis_id: generateOpisId(row),
    name: row.store,
    address: row.address,
    city: row.city,
    state: row.state,
    rack_id: 0,
    retail_price: row.retail_price,
    latitude: coords.lat,
    longitude: coords.lon,
    location: JSON.stringify({ type: 'Point', coordinates: [coords.lon, coords.lat] }),
  });

  if (error) {
    console.error(`  Insert error for "${row.store}" in ${row.city}, ${row.state}: ${error.message}`);
    return false;
  }
  return true;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function printSchema() {
  const { data, error } = await supabase.rpc('get_table_columns', {
    table_name_param: 'fuel_api_fuelstation',
  });
  if (error) {
    // Fallback: try to read one row to see column names
    console.log('RPC not available, fetching a sample row instead...');
    const { data: sample, error: sampleErr } = await supabase
      .from('fuel_api_fuelstation')
      .select('*')
      .limit(1);
    if (sampleErr) {
      console.error('Error fetching sample:', sampleErr.message);
    } else if (sample && sample.length > 0) {
      console.log('Columns (from sample row):');
      for (const [col, val] of Object.entries(sample[0])) {
        console.log(`  ${col}: ${JSON.stringify(val)} (${typeof val})`);
      }
    } else {
      console.log('Table is empty, cannot determine columns from sample.');
    }
    return;
  }
  console.log('Table schema:');
  for (const col of data) {
    console.log(`  ${col.column_name} (${col.data_type}) ${col.is_nullable === 'NO' ? 'NOT NULL' : 'nullable'}`);
  }
}

async function main() {
  if (process.argv.includes('--schema')) {
    await printSchema();
    return;
  }

  console.log('Fetching staging rows...');
  const rows = await fetchStagingRows();
  console.log(`Found ${rows.length} rows to process.\n`);

  if (rows.length === 0) {
    console.log('Nothing to geocode.');
    return;
  }

  let geocoded = 0;
  let failed = 0;
  let inserted = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const query = buildQuery(row);
    process.stdout.write(`[${i + 1}/${rows.length}] Geocoding: ${query} ... `);

    const coords = await geocode(query);

    if (!coords) {
      console.log('FAILED (no result)');
      failed++;
      await sleep(DELAY_MS);
      continue;
    }

    console.log(`OK (${coords.lat}, ${coords.lon})`);
    geocoded++;

    const ok = await insertStation(row, coords);
    if (ok) inserted++;

    // Rate-limit delay
    await sleep(DELAY_MS);
  }

  console.log('\n--- Summary ---');
  console.log(`Total rows:  ${rows.length}`);
  console.log(`Geocoded:    ${geocoded}`);
  console.log(`Inserted:    ${inserted}`);
  console.log(`Failed:      ${failed}`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
