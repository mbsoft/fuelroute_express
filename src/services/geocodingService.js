const axios = require('axios');

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';

async function getCoordinates(locationName) {
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
      return {
        lat: parseFloat(response.data[0].lat),
        lon: parseFloat(response.data[0].lon),
      };
    }
  } catch (err) {
    console.error(`Error geocoding ${locationName}:`, err.message);
  }

  return null;
}

module.exports = { getCoordinates };
