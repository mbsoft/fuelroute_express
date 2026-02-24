/**
 * Transform Casey's CSV into the standard format expected by update_price_columns.js.
 * - Combines Vendor + Store into a name (e.g. "Casey's 4388")
 * - Uses that same value as the Address
 * - Adds the missing columns to match the standard header
 *
 * Usage: node scripts/transform_caseys_csv.js
 * Output: Casey's-Table 1.csv is overwritten in place.
 */
const fs = require('fs');
const path = require('path');

const CSV_PATH = path.join(__dirname, '..', "Casey's-Table 1.csv");

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

const raw = fs.readFileSync(CSV_PATH, 'utf-8');
const lines = raw.split('\n').filter((l) => l.trim());

// Original: Vendor,Store,City,State,Retail,Our Price,Savings,Fee,Your Price,Your Savings
// Target:   Vendor,Store,Address,City,State,Retail Price,Our Price,Savings,Fee,Your Price,Your Savings,Insufficient Discount at this Location

const output = [];
output.push('Vendor,Store,Address,City,State,Retail Price,Our Price,Savings,Fee,Your Price,Your Savings,Insufficient Discount at this Location');

for (let i = 1; i < lines.length; i++) {
  const cols = parseLine(lines[i]);
  if (!cols[0]) continue;
  // cols: Vendor(0), Store(1), City(2), State(3), Retail(4),
  //       Our Price(5), Savings(6), Fee(7), Your Price(8), Your Savings(9)
  const vendor = cols[0];
  const storeNum = cols[1];
  const name = `${vendor} ${storeNum}`;
  const city = cols[2];
  const state = cols[3];
  const retail = cols[4];
  const ourPrice = cols[5];
  const savings = cols[6];
  const fee = cols[7];
  const yourPrice = cols[8];
  const yourSavings = cols[9];

  output.push(`${vendor},${name},${name},${city},${state},${retail},${ourPrice},${savings},${fee},${yourPrice},${yourSavings},`);
}

fs.writeFileSync(CSV_PATH, output.join('\n') + '\n', 'utf-8');
console.log(`Transformed ${output.length - 1} rows → ${CSV_PATH}`);
