const axios = require('axios');
const polyline = require('@mapbox/polyline');

const NB_DIRECTIONS_URL = 'https://api.nextbillion.io/directions/json';
const NB_API_KEY = process.env.NEXTBILLION_API_KEY;

/**
 * Get driving routes from start to end, including up to 3 alternatives.
 *
 * @param {object} startCoords  - { lat, lon }
 * @param {object} endCoords    - { lat, lon }
 * @param {Array}  waypoints    - optional array of { lat, lon } intermediate points
 * @returns {Array<{ geometry, encodedPolyline, distance_miles, duration_minutes }>} — 1–4 routes
 */
async function getRoutes(startCoords, endCoords, waypoints = []) {
  const hasWaypoints = waypoints.length > 0;

  const params = {
    origin: `${startCoords.lat},${startCoords.lon}`,
    destination: `${endCoords.lat},${endCoords.lon}`,
    mode: 'truck',
    overview: 'full',
    road_info: 'toll_info | toll_cost',
    key: NB_API_KEY,
    option: 'flexible'
  };

  // NB.ai does not support alternatives when waypoints are present
  if (!hasWaypoints) {
    params.alternatives = true;
    params.altCount = 3;
  }

  if (hasWaypoints) {
    params.waypoints = waypoints.map((w) => `${w.lat},${w.lon}`).join('|');
  }

  try {
    // Build URL manually to avoid axios encoding '|' in waypoints as %7C
    const qs = Object.entries(params).map(([k, v]) => `${k}=${v}`).join('&');
    const url = `${NB_DIRECTIONS_URL}?${qs}`;
    console.log('NB Directions URL:', url.replace(/key=[^&]+/, 'key=***'));
    const response = await axios.get(url, { timeout: 15000 });

    if (response.data.status === 'Ok' && response.data.routes && response.data.routes.length > 0) {
      return response.data.routes.map((route) => {
        const encodedPolyline = route.geometry;
        const geometry = polyline.decode(encodedPolyline); // [[lat, lon], ...]
        const tollCost = route.road_info?.toll_cost ?? null;
        const tolls = route.road_info?.toll_info ?? [];
        return {
          geometry,
          encodedPolyline,
          distance_miles: route.distance * 0.000621371,
          duration_minutes: route.duration / 60,
          toll_cost: tollCost,
          tolls,
        };
      });
    }
  } catch (err) {
    console.error('Error fetching route:', err.message);
    if (err.response) {
      console.error('NB response status:', err.response.status);
      console.error('NB response body:', JSON.stringify(err.response.data));
    }
  }

  return null;
}

module.exports = { getRoutes };
