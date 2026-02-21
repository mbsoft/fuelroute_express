const axios = require('axios');
const polyline = require('@mapbox/polyline');
const redis = require('../config/redis');

const OSRM_URL = 'http://router.project-osrm.org/route/v1/driving';

async function getRoute(startCoords, endCoords) {
  const cacheKey = `route:${startCoords.lat},${startCoords.lon}:${endCoords.lat},${endCoords.lon}`;

  const cached = await redis.get(cacheKey);
  if (cached) {
    return JSON.parse(cached);
  }

  const url = `${OSRM_URL}/${startCoords.lon},${startCoords.lat};${endCoords.lon},${endCoords.lat}?overview=full&geometries=polyline`;

  try {
    const response = await axios.get(url, { timeout: 10000 });

    if (response.data.code === 'Ok') {
      const route = response.data.routes[0];
      const points = polyline.decode(route.geometry); // [[lat, lng], ...]

      const result = {
        geometry: points,
        distance_miles: route.distance * 0.000621371,
        duration_minutes: route.duration / 60,
      };

      await redis.set(cacheKey, JSON.stringify(result), 'EX', 3600); // 1h
      return result;
    }
  } catch (err) {
    console.error('Error fetching route:', err.message);
  }

  return null;
}

module.exports = { getRoute };
