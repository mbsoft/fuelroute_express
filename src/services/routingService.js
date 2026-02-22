const axios = require('axios');
const polyline = require('@mapbox/polyline');

const NB_DIRECTIONS_URL = 'https://api.nextbillion.io/directions/json';
const NB_API_KEY = process.env.NEXTBILLION_API_KEY;

async function getRoute(startCoords, endCoords) {
  const url = `${NB_DIRECTIONS_URL}?origin=${startCoords.lat},${startCoords.lon}&destination=${endCoords.lat},${endCoords.lon}&mode=truck&overview=full&key=${NB_API_KEY}`;

  try {
    const response = await axios.get(url, { timeout: 15000 });

    if (response.data.status === 'Ok' && response.data.routes && response.data.routes.length > 0) {
      const route = response.data.routes[0];
      const points = polyline.decode(route.geometry);

      return {
        geometry: points,
        distance_miles: route.distance * 0.000621371,
        duration_minutes: route.duration / 60,
      };
    }
  } catch (err) {
    console.error('Error fetching route:', err.message);
  }

  return null;
}

module.exports = { getRoute };
