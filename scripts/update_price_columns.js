/**
 * Read the vendor fuel-price CSV and update the new discount-pricing columns
 * in fuel_api_fuelstation by matching CSV "Store" → DB "name".
 *
 * Prerequisites:
 *   1. Run scripts/add_price_columns.sql in Supabase SQL Editor first.
 *   2. Ensure .env has SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
 *
 * Usage:  node scripts/update_price_columns.js <csv-file>
 *         node scripts/update_price_columns.js "Speedway-Table 1.csv"
 */
require('dotenv').config();

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const supabase = require('../src/config/db');

const csvArg = process.argv[2];
if (!csvArg) {
  console.error('Usage: node scripts/update_price_columns.js <csv-file>');
  process.exit(1);
}
const CSV_PATH = path.resolve(csvArg);

/**
 * Generate a deterministic numeric opis_id for imported stations.
 * Uses first 7 hex chars of an MD5 hash, parsed as a positive integer.
 * Offset by 9_000_000 to avoid collisions with real OPIS IDs.
 */
function generateOpisId(store, city, state) {
  const key = `${store}|${city}|${state}`.toUpperCase();
  const hash = crypto.createHash('md5').update(key).digest('hex').slice(0, 7);
  return 9_000_000 + parseInt(hash, 16);
}

/**
 * Parse a CSV line respecting quoted fields (handles commas inside quotes).
 */
function parseLine(line) {
  const fields = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      fields.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current.trim());
  return fields;
}

/**
 * Normalize a header name to a canonical key.
 * e.g. "Retail Price" and "Retail" both → "retail_price"
 */
function normalizeHeader(h) {
  const s = h.toLowerCase().trim();
  if (s === 'retail' || s === 'retail price') return 'retail_price';
  if (s === 'our price') return 'our_price';
  if (s === 'your price') return 'your_price';
  if (s === 'your savings') return 'your_savings';
  // pass through simple names: vendor, store, address, city, state, savings, fee
  return s.replace(/\s+/g, '_');
}

/** Read the CSV and return an array of row objects, mapping columns by header name. */
function readCsv() {
  const raw = fs.readFileSync(CSV_PATH, 'utf-8');
  const lines = raw.split('\n').filter((l) => l.trim());
  const headers = parseLine(lines[0]).map(normalizeHeader);
  console.log(`  CSV columns: ${headers.join(', ')}`);

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseLine(lines[i]);
    const obj = {};
    headers.forEach((h, idx) => { obj[h] = cols[idx]; });
    if (!obj.store) continue; // skip blank rows
    rows.push({
      store: obj.store,
      address: obj.address || '',
      city: obj.city,
      state: obj.state,
      retail_price: parseFloat(obj.retail_price) || null,
      our_price: parseFloat(obj.our_price) || null,
      savings: parseFloat(obj.savings) || null,
      fee: parseFloat(obj.fee) || null,
      your_price: parseFloat(obj.your_price) || null,
      your_savings: parseFloat(obj.your_savings) || null,
    });
  }
  return rows;
}

/**
 * Fetch all fuel stations from the DB to build a lookup map.
 * Key: "NAME|CITY|STATE" (upper-cased, trimmed).
 */
async function buildStationMap() {
  const map = new Map();
  let from = 0;
  const pageSize = 1000;

  while (true) {
    const { data, error } = await supabase
      .from('fuel_api_fuelstation')
      .select('id, name, city, state')
      .range(from, from + pageSize - 1);

    if (error) throw new Error(`Supabase select error: ${error.message}`);
    if (!data || data.length === 0) break;

    for (const row of data) {
      const key = `${(row.name || '').toUpperCase().trim()}|${(row.city || '').toUpperCase().trim()}|${(row.state || '').toUpperCase().trim()}`;
      map.set(key, row.id);
    }

    from += pageSize;
    if (data.length < pageSize) break;
  }

  return map;
}

async function main() {
  console.log('Reading CSV …');
  const csvRows = readCsv();
  console.log(`  ${csvRows.length} rows parsed from CSV`);

  console.log('Fetching stations from DB …');
  const stationMap = await buildStationMap();
  console.log(`  ${stationMap.size} stations in DB`);

  // Match CSV rows to DB records
  const updates = [];
  const inserts = [];

  for (const row of csvRows) {
    const key = `${row.store.toUpperCase().trim()}|${row.city.toUpperCase().trim()}|${row.state.toUpperCase().trim()}`;
    const id = stationMap.get(key);
    if (id != null) {
      updates.push({
        id,
        retail_price: row.retail_price,
        our_price: row.our_price,
        savings: row.savings,
        fee: row.fee,
        your_price: row.your_price,
        your_savings: row.your_savings,
      });
    } else {
      inserts.push(row);
    }
  }

  console.log(`  ${updates.length} matched, ${inserts.length} new`);

  // Update each matched station by id
  let updated = 0;
  let updateFailed = 0;
  for (const { id, ...fields } of updates) {
    const { error } = await supabase
      .from('fuel_api_fuelstation')
      .update(fields)
      .eq('id', id);

    if (error) {
      console.error(`  Update failed id ${id}: ${error.message}`);
      updateFailed++;
    } else {
      updated++;
    }
  }

  // Insert unmatched rows as new stations (placeholder coords — geocode later)
  let inserted = 0;
  let insertFailed = 0;
  for (const row of inserts) {
    const { error } = await supabase.from('fuel_api_fuelstation').insert({
      opis_id: generateOpisId(row.store, row.city, row.state),
      name: row.store,
      address: row.address,
      city: row.city,
      state: row.state,
      rack_id: 0,
      retail_price: row.retail_price,
      our_price: row.our_price,
      savings: row.savings,
      fee: row.fee,
      your_price: row.your_price,
      your_savings: row.your_savings,
      latitude: 0,
      longitude: 0,
      location: JSON.stringify({ type: 'Point', coordinates: [0, 0] }),
    });

    if (error) {
      console.error(`  Insert failed "${row.store}" ${row.city}, ${row.state}: ${error.message}`);
      insertFailed++;
    } else {
      inserted++;
    }
  }

  console.log(`\nDone — ${updated} updated, ${inserted} inserted.`);
  if (updateFailed) console.log(`  ${updateFailed} update failures`);
  if (insertFailed) console.log(`  ${insertFailed} insert failures`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
