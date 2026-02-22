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
  const params = {
    origin: `${startCoords.lat},${startCoords.lon}`,
    destination: `${endCoords.lat},${endCoords.lon}`,
    mode: 'truck',
    overview: 'full',
    alternatives: true,
    altCount: 3,
    key: NB_API_KEY,
  };

  if (waypoints.length > 0) {
    params.waypoints = waypoints.map((w) => `${w.lat},${w.lon}`).join('|');
  }

  try {
    const response = await axios.get(NB_DIRECTIONS_URL, { params, timeout: 15000 });

    if (response.data.status === 'Ok' && response.data.routes && response.data.routes.length > 0) {
      return response.data.routes.map((route) => {
        const encodedPolyline = route.geometry;
        const geometry = polyline.decode(encodedPolyline); // [[lat, lon], ...]
        return {
          geometry,
          encodedPolyline,
          distance_miles: route.distance * 0.000621371,
          duration_minutes: route.duration / 60,
        };
      });
    }
  } catch (err) {
    console.error('Error fetching route:', err.message);
  }

  return null;
}

module.exports = { getRoutes };
