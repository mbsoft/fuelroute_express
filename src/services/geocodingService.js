const axios = require('axios');
const redis = require('../config/redis');

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';

async function getCoordinates(locationName) {
  const cacheKey = `geo:${locationName.toLowerCase().replace(/ /g, '_')}`;

  const cached = await redis.get(cacheKey);
  if (cached) {
    return JSON.parse(cached);
  }

  try {
    const response = await axios.get(NOMINATIM_URL, {
      params: {
        q: locationName,
        format: 'json',
        limit: 1,
        countrycodes: 'us',
      },
      headers: { 'User-Agent': 'FuelRoutingApp/1.0' },
      timeout: 5000,
    });

    if (response.data && response.data.length > 0) {
      console.log(response.data);
      const coords = {
        lat: parseFloat(response.data[0].lat),
        lon: parseFloat(response.data[0].lon),
      };
      await redis.set(cacheKey, JSON.stringify(coords), 'EX', 86400); // 24h
      return coords;
    }
  } catch (err) {
    console.error(`Error geocoding ${locationName}:`, err.message);
  }

  return null;
}

module.exports = { getCoordinates };
