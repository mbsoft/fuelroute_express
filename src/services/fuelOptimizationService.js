const supabase = require('../config/db');
const { dijkstra } = require('../utils/dijkstra');

const BUFFER_MILES = 10;
const BUFFER_METERS = BUFFER_MILES * 1609.34; // ST_DWithin with geography uses meters

const MAX_WKT_POINTS = 500;

/**
 * Build a WKT LINESTRING from route geometry points.
 * Route geometry is [[lat, lon], ...], PostGIS needs LINESTRING(lon lat, ...).
 * Downsamples to MAX_WKT_POINTS to avoid Supabase statement timeouts on long routes.
 */
function buildWktLineString(points) {
  let sampled = points;
  if (points.length > MAX_WKT_POINTS) {
    const step = (points.length - 1) / (MAX_WKT_POINTS - 1);
    sampled = Array.from({ length: MAX_WKT_POINTS }, (_, i) =>
      points[Math.round(i * step)]
    );
  }
  const coords = sampled.map((p) => `${p[1]} ${p[0]}`).join(', ');
  return `LINESTRING(${coords})`;
}

/**
 * Find optimal fuel stops along a route using PostGIS spatial queries
 * and Dijkstra's shortest path on a DAG.
 */
async function findOptimalStops(routeData, start, finish, rangeMiles, mpg) {
  const totalDist = routeData.distance_miles;
  const wkt = buildWktLineString(routeData.geometry);

  // Call the PostGIS RPC function via Supabase REST API
  const { data: stations, error } = await supabase.rpc(
    'find_stations_along_route',
    { route_wkt: wkt, buffer_meters: BUFFER_METERS }
  );

  if (error) {
    throw new Error(`Supabase RPC error: ${error.message}`);
  }

  // Build station list with distance from start
  const stationList = stations.map((s) => ({
    id: s.id,
    name: s.name,
    city: s.city,
    state: s.state,
    price: parseFloat(s.retail_price),
    lat: parseFloat(s.latitude),
    lon: parseFloat(s.longitude),
    distFromStart: parseFloat(s.fraction) * totalDist,
  }));

  // Build nodes: [START, ...stations, END]
  const startNode = {
    id: 'START',
    distFromStart: 0,
    price: 0,
    isVirtual: true,
  };
  const endNode = {
    id: 'END',
    distFromStart: totalDist,
    price: 0,
    isVirtual: true,
  };

  const nodes = [startNode, ...stationList, endNode];
  const numNodes = nodes.length;

  // Build adjacency list
  const adjacency = new Map();

  for (let i = 0; i < numNodes; i++) {
    const edges = [];
    const u = nodes[i];

    for (let j = i + 1; j < numNodes; j++) {
      const v = nodes[j];
      const routeDist = v.distFromStart - u.distFromStart;

      if (routeDist > rangeMiles) break; // Sorted, so all further nodes are out of range

      let segmentCost;
      if (u.id === 'START') {
        segmentCost = 0; // Full tank at start, no cost
      } else {
        segmentCost = (routeDist / mpg) * u.price;
      }

      edges.push({
        to: j,
        weight: segmentCost,
        fuel: routeDist / mpg,
      });
    }

    adjacency.set(i, edges);
  }

  // Run Dijkstra
  const result = dijkstra(adjacency, 0, numNodes - 1, numNodes);

  if (!result) {
    return { stops: null, fuelCost: 0 };
  }

  // Extract stops from path
  const stops = [];
  let totalCost = 0;

  for (let k = 0; k < result.path.length - 1; k++) {
    const uIdx = result.path[k];
    const vIdx = result.path[k + 1];
    const u = nodes[uIdx];

    // Find the edge from u to v
    const edge = adjacency.get(uIdx).find((e) => e.to === vIdx);
    totalCost += edge.weight;

    if (u.id !== 'START') {
      stops.push({
        station: u.name,
        city: u.city,
        state: u.state,
        price: u.price,
        gallons: Math.round(edge.fuel * 100) / 100,
        cost: Math.round(edge.weight * 100) / 100,
        lat: u.lat,
        lon: u.lon,
      });
    }
  }

  return { stops, fuelCost: totalCost };
}

module.exports = { findOptimalStops };
