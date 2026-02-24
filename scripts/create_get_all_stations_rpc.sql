-- Run this in the Supabase SQL Editor to create the RPC function
-- that the Express app calls via supabase.rpc('get_all_stations')

DROP FUNCTION IF EXISTS get_all_stations();

CREATE OR REPLACE FUNCTION get_all_stations()
RETURNS TABLE (
  id INTEGER,
  name TEXT,
  address TEXT,
  city TEXT,
  state TEXT,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  price NUMERIC,
  retail_price NUMERIC,
  our_price NUMERIC,
  savings NUMERIC,
  fee NUMERIC,
  your_price NUMERIC,
  your_savings NUMERIC
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    fs.id,
    fs.name,
    fs.address,
    fs.city,
    fs.state,
    fs.latitude,
    fs.longitude,
    fs.retail_price AS price,
    fs.retail_price,
    fs.our_price,
    fs.savings,
    fs.fee,
    fs.your_price,
    fs.your_savings
  FROM fuel_api_fuelstation fs
  ORDER BY fs.state, fs.city, fs.name;
$$;
