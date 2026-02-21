-- Run this in the Supabase SQL Editor to create the RPC function
-- that the Express app calls via supabase.rpc('find_stations_along_route', ...)

CREATE OR REPLACE FUNCTION find_stations_along_route(
  route_wkt TEXT,
  buffer_meters DOUBLE PRECISION
)
RETURNS TABLE (
  id INTEGER,
  opis_id TEXT,
  name TEXT,
  address TEXT,
  city TEXT,
  state TEXT,
  retail_price NUMERIC,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  fraction DOUBLE PRECISION
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    fs.id,
    fs.opis_id,
    fs.name,
    fs.address,
    fs.city,
    fs.state,
    fs.retail_price,
    fs.latitude,
    fs.longitude,
    ST_LineLocatePoint(ST_GeomFromText(route_wkt, 4326), fs.location) AS fraction
  FROM fuel_api_fuelstation fs
  WHERE ST_DWithin(
    fs.location::geography,
    ST_GeomFromText(route_wkt, 4326)::geography,
    buffer_meters
  )
  ORDER BY fraction;
$$;
