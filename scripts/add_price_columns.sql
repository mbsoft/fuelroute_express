-- Add discount-pricing columns to the main fuel station table.
-- Run this against the database (e.g. via psql) before updating data.

ALTER TABLE fuel_api_fuelstation
  ADD COLUMN IF NOT EXISTS our_price    NUMERIC(6,3),
  ADD COLUMN IF NOT EXISTS savings      NUMERIC(6,3),
  ADD COLUMN IF NOT EXISTS fee          NUMERIC(6,3),
  ADD COLUMN IF NOT EXISTS your_price   NUMERIC(6,3),
  ADD COLUMN IF NOT EXISTS your_savings NUMERIC(6,3);
