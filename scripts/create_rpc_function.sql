-- Run this against the database (e.g. via psql) to create the SQL function
-- that the Express app calls via SELECT * FROM find_stations_along_route($1, $2)

DROP FUNCTION IF EXISTS find_stations_along_route(TEXT, DOUBLE PRECISION);

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
  our_price NUMERIC,
  your_price NUMERIC,
  your_savings NUMERIC,
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
    fs.our_price,
    fs.your_price,
    fs.your_savings,
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
