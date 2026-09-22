/**
 * Geocode fuel stations from the staging table (fuel_price_import) using
 * NextBillion.ai Discover API and insert them into fuel_api_fuelstation.
 *
 * Usage:  node scripts/geocode_stations.js
 */
require('dotenv').config();

const crypto = require('crypto');
const axios = require('axios');
const db = require('../src/config/db');

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
  let rows;
  try {
    ({ rows } = await db.query('SELECT name, city, state FROM fuel_api_fuelstation'));
  } catch (err) {
    console.error('Warning: could not fetch existing stations:', err.message);
    return keys;
  }

  for (const row of rows) {
    const key = `${(row.name || '').toUpperCase().trim()}|${(row.city || '').toUpperCase().trim()}|${(row.state || '').toUpperCase().trim()}`;
    keys.add(key);
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

  const { rows: allRows } = await db.query('SELECT * FROM fuel_price_import');

  const rows = (allRows || []).filter((row) => {
    const key = `${(row.store || '').toUpperCase().trim()}|${(row.city || '').toUpperCase().trim()}|${(row.state || '').toUpperCase().trim()}`;
    return !existing.has(key);
  });

  console.log(`Filtered out ${(allRows || []).length - rows.length} already-existing stations.`);
  return rows;
}

/**
 * Insert a geocoded station into fuel_api_fuelstation.
 * Builds the PostGIS location geometry from the geocoded coordinates.
 */
async function insertStation(row, coords) {
  try {
    await db.query(
      `INSERT INTO fuel_api_fuelstation
         (opis_id, name, address, city, state, rack_id, retail_price, latitude, longitude, location)
       VALUES ($1, $2, $3, $4, $5, 0, $6, $7, $8, ST_SetSRID(ST_MakePoint($8, $7), 4326))`,
      [generateOpisId(row), row.store, row.address, row.city, row.state, row.retail_price, coords.lat, coords.lon]
    );
  } catch (err) {
    console.error(`  Insert error for "${row.store}" in ${row.city}, ${row.state}: ${err.message}`);
    return false;
  }
  return true;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function printSchema() {
  const { rows } = await db.query(
    `SELECT column_name, data_type, is_nullable
       FROM information_schema.columns
      WHERE table_name = 'fuel_api_fuelstation'
      ORDER BY ordinal_position`
  );
  console.log('Table schema:');
  for (const col of rows) {
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

main()
  .catch((err) => {
    console.error('Fatal error:', err);
    process.exitCode = 1;
  })
  .finally(() => db.end());
