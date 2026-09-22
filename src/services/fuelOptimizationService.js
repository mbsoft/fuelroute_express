const db = require('../config/db');

const MILES_TO_METERS = 1609.34;
const MAX_WKT_POINTS = 500;

/**
 * Build a WKT LINESTRING from route geometry points.
 * Route geometry is [[lat, lon], ...], PostGIS needs LINESTRING(lon lat, ...).
 * Downsamples to MAX_WKT_POINTS to avoid slow spatial queries on long routes.
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
 * Greedy windowed fuel stop selection.
 *
 * When fuel drops to the refuel threshold, the algorithm searches a bounded
 * lookahead window for the cheapest station. The window size equals the
 * distance it takes to consume fuel from full down to the threshold — so a
 * higher threshold means a smaller window and earlier stops.
 *
 * At each stop the truck fills to full capacity.
 *
 * @param {Array} nodes   — [START, ...stations, END] sorted by distFromStart
 * @param {number} totalDist — total route distance in miles
 * @param {Object} opts
 * @returns {{ path: number[], stops: Object[], fuelCost: number } | null}
 */
function selectStops(nodes, totalDist, opts) {
  const { tankCapacity, currentGallons, mpg, refuelThresholdPct } = opts;
  const thresholdGallons = tankCapacity * (refuelThresholdPct / 100);

  // Search window: bounded lookahead past the threshold point.
  // Use the smaller of (full-to-threshold) and (threshold-to-half-threshold)
  // so the truck doesn't drive far below the threshold level.
  const fullToThreshold = (tankCapacity - thresholdGallons) * mpg;
  const thresholdToHalf = (thresholdGallons / 2) * mpg;
  const searchDistance = Math.min(fullToThreshold, thresholdToHalf);

  const endIdx = nodes.length - 1;
  let fuel = currentGallons;
  let position = 0;
  const path = [0]; // node indices: starts with START
  const stops = [];
  let totalCost = 0;
  let iterations = 0;

  while (iterations++ < 100) {
    const remainingDist = totalDist - position;

    // Where does fuel drop to the threshold level?
    const distToThreshold = Math.max(0, (fuel - thresholdGallons) * mpg);

    // Can we reach the destination without fuel dropping to threshold?
    if (distToThreshold >= remainingDist) {
      path.push(endIdx);
      break;
    }

    const thresholdPoint = position + distToThreshold;

    // Max distance reachable from current position
    const maxReach = position + fuel * mpg;

    // Preferred window: from threshold point to threshold + searchDistance
    const windowEnd = Math.min(thresholdPoint + searchDistance, maxReach);

    // Pass 1: find cheapest station in the preferred window
    let bestIdx = -1;
    let bestPrice = Infinity;

    for (let i = 1; i < endIdx; i++) {
      const s = nodes[i];
      if (s.distFromStart <= position) continue;
      if (s.distFromStart > maxReach) break; // sorted, nothing further is reachable
      if (s.distFromStart >= thresholdPoint && s.distFromStart <= windowEnd) {
        if (s.price < bestPrice) {
          bestPrice = s.price;
          bestIdx = i;
        }
      }
    }

    // Pass 2 (fallback): no station in preferred window — extend to full range
    if (bestIdx === -1) {
      for (let i = 1; i < endIdx; i++) {
        const s = nodes[i];
        if (s.distFromStart <= position) continue;
        if (s.distFromStart > maxReach) break;
        if (s.price < bestPrice) {
          bestPrice = s.price;
          bestIdx = i;
        }
      }
    }

    // No reachable station — go to destination if possible, otherwise impossible
    if (bestIdx === -1) {
      if (fuel >= remainingDist / mpg) {
        path.push(endIdx);
        break;
      }
      return null;
    }

    const best = nodes[bestIdx];
    const driveDist = best.distFromStart - position;
    fuel -= driveDist / mpg;
    const fuelOnArrival = fuel;

    // Fill to full
    const gallonsToBuy = tankCapacity - fuel;
    const cost = gallonsToBuy * best.price;
    totalCost += cost;
    fuel = tankCapacity;

    path.push(bestIdx);
    stops.push({
      station: best.name,
      city: best.city,
      state: best.state,
      price: best.price,
      our_price: best.our_price,
      your_price: best.your_price,
      your_savings: best.your_savings,
      gallons: Math.round(gallonsToBuy * 100) / 100,
      cost: Math.round(cost * 100) / 100,
      lat: best.lat,
      lon: best.lon,
      fuel_level_arriving: Math.round((fuelOnArrival / tankCapacity) * 100),
      fuel_level_after: 100,
    });

    position = best.distFromStart;
  }

  return { path, stops, fuelCost: totalCost };
}

/**
 * Compute fuel level percentage at each decoded polyline coordinate.
 * Returns an integer array (0-100) the same length as routeData.geometry.
 */
function computeFuelLevels(geometry, totalDistMiles, path, nodes, stops, opts) {
  const { tankCapacity, currentGallons, mpg } = opts;
  const numPoints = geometry.length;
  const fuelLevels = new Array(numPoints);

  // Build fuel state at each path node (arrival and after fill)
  const pathFuelAfter = [currentGallons]; // START: no fill, just current fuel
  let stopIdx = 0;

  for (let k = 1; k < path.length; k++) {
    const prevNode = nodes[path[k - 1]];
    const currNode = nodes[path[k]];
    const dist = currNode.distFromStart - prevNode.distFromStart;
    const fuelUsed = dist / mpg;
    const fuelOnArrival = pathFuelAfter[k - 1] - fuelUsed;

    if (currNode.id !== 'START' && currNode.id !== 'END' && stopIdx < stops.length) {
      // Fuel stop — add the gallons purchased
      pathFuelAfter.push(fuelOnArrival + stops[stopIdx].gallons);
      stopIdx++;
    } else {
      pathFuelAfter.push(fuelOnArrival);
    }
  }

  // Build segments: each has a start distance, end distance, start fuel, and consumption rate
  const segments = [];
  for (let k = 0; k < path.length - 1; k++) {
    segments.push({
      startDist: nodes[path[k]].distFromStart,
      endDist: nodes[path[k + 1]].distFromStart,
      startFuel: pathFuelAfter[k],
    });
  }

  // Interpolate fuel level for each geometry point
  let segIdx = 0;
  for (let i = 0; i < numPoints; i++) {
    const fraction = i / (numPoints - 1 || 1);
    const dist = fraction * totalDistMiles;

    // Advance to the correct segment
    while (segIdx < segments.length - 1 && dist > segments[segIdx].endDist) {
      segIdx++;
    }

    const seg = segments[segIdx];
    const distIntoSegment = Math.max(0, dist - seg.startDist);
    const fuelAtPoint = seg.startFuel - (distIntoSegment / mpg);
    const pct = Math.max(0, Math.min(100, Math.round((fuelAtPoint / tankCapacity) * 100)));
    fuelLevels[i] = pct;
  }

  return fuelLevels;
}

/**
 * Find optimal fuel stops along a route using PostGIS spatial queries
 * and greedy windowed stop selection, then interpolate fuel levels for
 * gradient polyline rendering.
 *
 * @param {Object} routeData - { geometry, encodedPolyline, distance_miles, duration_minutes }
 * @param {Object} start - { lat, lon }
 * @param {Object} finish - { lat, lon }
 * @param {Object} opts - { tankCapacity, currentGallons, mpg, maxRangeMiles, deviationMiles, refuelThresholdPct }
 */
async function findOptimalStops(routeData, start, finish, opts) {
  const { deviationMiles } = opts;
  const totalDist = routeData.distance_miles;
  const wkt = buildWktLineString(routeData.geometry);

  // Configurable buffer distance for spatial query
  const bufferMeters = deviationMiles * MILES_TO_METERS;

  // Call the PostGIS SQL function
  const { rows: stations } = await db.query(
    'SELECT * FROM find_stations_along_route($1, $2)',
    [wkt, bufferMeters]
  );

  // Build station list with distance from start, excluding stations where
  // the retail price is less than "your price" (no savings benefit)
  const stationList = stations
    .map((s) => ({
      id: s.id,
      name: s.name,
      city: s.city,
      state: s.state,
      price: parseFloat(s.retail_price),
      our_price: s.our_price != null ? parseFloat(s.our_price) : null,
      your_price: s.your_price != null ? parseFloat(s.your_price) : null,
      your_savings: s.your_savings != null ? parseFloat(s.your_savings) : null,
      lat: parseFloat(s.latitude),
      lon: parseFloat(s.longitude),
      distFromStart: parseFloat(s.fraction) * totalDist,
    }))
    .filter((s) => s.your_price == null || s.price >= s.your_price);

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

  // Greedy windowed stop selection
  const result = selectStops(nodes, totalDist, opts);

  if (!result) {
    return { stops: null, fuelCost: 0, fuelLevels: [] };
  }

  // Compute fuel level at each polyline coordinate for gradient rendering
  const fuelLevels = computeFuelLevels(
    routeData.geometry,
    totalDist,
    result.path,
    nodes,
    result.stops,
    opts
  );

  return { stops: result.stops, fuelCost: result.fuelCost, fuelLevels };
}

module.exports = { findOptimalStops };
