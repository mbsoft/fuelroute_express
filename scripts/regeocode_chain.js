/**
 * Re-geocode all fuel_api_fuelstation rows whose name starts with a given
 * chain prefix using the NextBillion.ai Discover API.
 *
 * Query format: "{displayName} {address} {city} {state}"
 *
 * Updates latitude, longitude, and location (PostGIS geometry) in place.
 *
 * Usage:
 *   node scripts/regeocode_chain.js --chain "CASEYS" --display "Casey's" [--dry-run]
 *   node scripts/regeocode_chain.js --chain "KWIK TRIP" --display "Kwik Trip" [--dry-run]
 *   node scripts/regeocode_chain.js --chain "LOVES" --display "Loves" [--dry-run]
 *   node scripts/regeocode_chain.js --missing [--dry-run]
 *
 * Options:
 *   --chain     DB name prefix to match (case-insensitive ilike)
 *   --display   Brand name to use in the Discover query (defaults to --chain value)
 *   --missing   Geocode all stations with latitude = 0 (uses station name in query)
 *   --dry-run   Geocode without writing any updates
 */
require('dotenv').config();

const axios = require('axios');
const supabase = require('../src/config/db');

const NB_API_KEY = process.env.NEXTBILLION_API_KEY;
if (!NB_API_KEY) {
  console.error('NEXTBILLION_API_KEY is not set in environment');
  process.exit(1);
}

const DISCOVER_URL = 'https://api.nextbillion.io/discover';
const DELAY_MS = 600; // ~1.6 req/s, well under the 40/s limit

// --- Parse CLI args ---
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');

function getArg(flag) {
  const idx = args.indexOf(flag);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : null;
}

const MISSING_MODE = args.includes('--missing');
const CHAIN_PREFIX = getArg('--chain');
const DISPLAY_NAME = getArg('--display') ?? CHAIN_PREFIX;

if (!CHAIN_PREFIX && !MISSING_MODE) {
  console.error('Usage: node scripts/regeocode_chain.js --chain <prefix> [--display <name>] [--dry-run]');
  console.error('       node scripts/regeocode_chain.js --missing [--dry-run]');
  console.error('Examples:');
  console.error('  node scripts/regeocode_chain.js --chain "CASEYS" --display "Casey\'s"');
  console.error('  node scripts/regeocode_chain.js --chain "KWIK TRIP" --display "Kwik Trip"');
  console.error('  node scripts/regeocode_chain.js --missing');
  process.exit(1);
}

/**
 * Build the Discover query: "{displayName} {address} {city} {state}"
 * In --missing mode, uses the station's own name instead of the display name.
 */
function buildQuery(row) {
  const label = MISSING_MODE ? row.name : DISPLAY_NAME;
  const parts = [label, row.address, row.city, row.state].filter(Boolean);
  return parts.join(' ');
}

/**
 * Call NextBillion.ai Discover API.
 * Returns { lat, lon } or null if no usable result.
 */
async function geocode(query) {
  const params = {
    q: query,
    key: NB_API_KEY,
    fallback: true,
    score: 0.6,
  };
  const requestUrl = `${DISCOVER_URL}?${new URLSearchParams(params).toString()}`;
  console.log(`  → GET ${requestUrl}`);

  try {
    const response = await axios.get(DISCOVER_URL, {
      params,
      timeout: 10000,
    });

    const items = response.data?.items;
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
 * Fetch stations to re-geocode.
 * --missing mode: all stations with latitude = 0
 * --chain mode: all stations whose name starts with CHAIN_PREFIX
 */
async function fetchStations() {
  const rows = [];
  let offset = 0;
  const pageSize = 1000;

  while (true) {
    let query = supabase
      .from('fuel_api_fuelstation')
      .select('id, name, address, city, state, latitude, longitude');

    if (MISSING_MODE) {
      query = query.eq('latitude', 0);
    } else {
      query = query.ilike('name', `${CHAIN_PREFIX}%`);
    }

    const { data, error } = await query.range(offset, offset + pageSize - 1);

    if (error) throw new Error(`Failed to fetch stations: ${error.message}`);
    if (!data || data.length === 0) break;

    rows.push(...data);
    offset += pageSize;
    if (data.length < pageSize) break;
  }

  return rows;
}

/**
 * Update a station's coordinates and PostGIS location geometry.
 */
async function updateStation(id, coords) {
  const { error } = await supabase
    .from('fuel_api_fuelstation')
    .update({
      latitude: coords.lat,
      longitude: coords.lon,
      location: JSON.stringify({ type: 'Point', coordinates: [coords.lon, coords.lat] }),
    })
    .eq('id', id);

  if (error) {
    console.error(`  Update error for id=${id}: ${error.message}`);
    return false;
  }
  return true;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  if (MISSING_MODE) {
    console.log('Mode: --missing (all stations with latitude = 0)');
  } else {
    console.log(`Chain prefix: "${CHAIN_PREFIX}"  Display name: "${DISPLAY_NAME}"`);
  }
  if (DRY_RUN) console.log('[DRY RUN] No updates will be written.');
  console.log('');

  console.log(MISSING_MODE
    ? 'Fetching stations with latitude = 0...'
    : `Fetching stations matching "${CHAIN_PREFIX}%"...`);
  const stations = await fetchStations();
  console.log(`Found ${stations.length} stations to re-geocode.\n`);

  if (stations.length === 0) {
    console.log('Nothing to process.');
    return;
  }

  let geocoded = 0;
  let updated = 0;
  let failed = 0;

  for (let i = 0; i < stations.length; i++) {
    const row = stations[i];
    const query = buildQuery(row);
    process.stdout.write(`[${i + 1}/${stations.length}] ${query} ... `);

    const coords = await geocode(query);

    if (!coords) {
      console.log('FAILED (no result)');
      failed++;
      await sleep(DELAY_MS);
      continue;
    }

    const latDiff = Math.abs(coords.lat - parseFloat(row.latitude || 0));
    const lonDiff = Math.abs(coords.lon - parseFloat(row.longitude || 0));
    console.log(`OK (${coords.lat}, ${coords.lon}) Δlat=${latDiff.toFixed(5)} Δlon=${lonDiff.toFixed(5)}`);
    geocoded++;

    if (!DRY_RUN) {
      const ok = await updateStation(row.id, coords);
      if (ok) updated++;
    }

    await sleep(DELAY_MS);
  }

  console.log('\n--- Summary ---');
  console.log(`Total:    ${stations.length}`);
  console.log(`Geocoded: ${geocoded}`);
  if (!DRY_RUN) console.log(`Updated:  ${updated}`);
  console.log(`Failed:   ${failed}`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
