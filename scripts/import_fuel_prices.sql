-- Run this in the Supabase SQL Editor to import fuel price data from CSV.
--
-- Step 1: Upload the CSV to Supabase Storage or use the Table Editor CSV import
--         to load data into the staging table below.
-- Step 2: Run the UPDATE to merge prices into the existing fuel_api_fuelstation table.

-- 1. Create staging table for the CSV import
CREATE TABLE IF NOT EXISTS fuel_price_import (
  vendor        TEXT,
  store         TEXT,
  address       TEXT,
  city          TEXT,
  state         TEXT,
  retail_price  NUMERIC(6,3),
  our_price     NUMERIC(6,3),
  savings       NUMERIC(6,3),
  fee           NUMERIC(6,3),
  your_price    NUMERIC(6,3),
  your_savings  NUMERIC(6,3),
  insufficient_discount TEXT
);

-- 2. Clear any previous import data
TRUNCATE fuel_price_import;

-- 3. Import the CSV
--    Option A: If using psql CLI:
--      \copy fuel_price_import FROM 'Loves, PFJ, RR, Sapp, TA-Petro-Table 1.csv' WITH (FORMAT csv, HEADER true);
--
--    Option B: In Supabase Dashboard, use Table Editor > Import CSV to load into fuel_price_import.

-- 4. Verify the import
-- SELECT count(*) FROM fuel_price_import;
-- SELECT * FROM fuel_price_import LIMIT 10;

-- 5. Update retail prices in the main fuel station table by matching on city, state, and address
UPDATE fuel_api_fuelstation fs
SET retail_price = imp.retail_price
FROM fuel_price_import imp
WHERE UPPER(TRIM(fs.city)) = UPPER(TRIM(imp.city))
  AND UPPER(TRIM(fs.state)) = UPPER(TRIM(imp.state))
  AND UPPER(TRIM(fs.name)) = UPPER(TRIM(imp.store));

-- 6. Check for unmatched import rows (stations in CSV but not in the main table)
-- SELECT imp.*
-- FROM fuel_price_import imp
-- LEFT JOIN fuel_api_fuelstation fs
--   ON UPPER(TRIM(fs.city)) = UPPER(TRIM(imp.city))
--   AND UPPER(TRIM(fs.state)) = UPPER(TRIM(imp.state))
--   AND UPPER(TRIM(fs.name)) = UPPER(TRIM(imp.store))
-- WHERE fs.id IS NULL;

-- 7. Optionally insert new stations (without lat/lon — they'll need geocoding later)
-- INSERT INTO fuel_api_fuelstation (name, address, city, state, retail_price, latitude, longitude, location)
-- SELECT
--   imp.store,
--   imp.address,
--   imp.city,
--   imp.state,
--   imp.retail_price,
--   0,  -- placeholder latitude
--   0,  -- placeholder longitude
--   ST_SetSRID(ST_MakePoint(0, 0), 4326)  -- placeholder geometry
-- FROM fuel_price_import imp
-- LEFT JOIN fuel_api_fuelstation fs
--   ON UPPER(TRIM(fs.city)) = UPPER(TRIM(imp.city))
--   AND UPPER(TRIM(fs.state)) = UPPER(TRIM(imp.state))
--   AND UPPER(TRIM(fs.name)) = UPPER(TRIM(imp.store))
-- WHERE fs.id IS NULL;

-- 8. Clean up staging table when done
-- DROP TABLE fuel_price_import;
