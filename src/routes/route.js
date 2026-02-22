const express = require('express');
const router = express.Router();
const { validateRouteQuery } = require('../utils/validation');
const geocodingService = require('../services/geocodingService');
const routingService = require('../services/routingService');
const fuelOptimizationService = require('../services/fuelOptimizationService');
const { ValidationError, NotFoundError, NoPathError } = require('../utils/errors');

router.get('/', async (req, res, next) => {
  try {
    const params = validateRouteQuery(req.query);
    console.log(`Route request: ${params.start_location} → ${params.finish_location} (range=${params.range_miles}mi, mpg=${params.mpg})`);

    // 1. Geocode (skip if coordinates provided directly)
    const startCoords = (params.start_lat != null && params.start_lon != null)
      ? { lat: params.start_lat, lon: params.start_lon }
      : await geocodingService.getCoordinates(params.start_location);

    const finishCoords = (params.finish_lat != null && params.finish_lon != null)
      ? { lat: params.finish_lat, lon: params.finish_lon }
      : await geocodingService.getCoordinates(params.finish_location);

    if (!startCoords || !finishCoords) {
      throw new ValidationError('Could not geocode locations');
    }

    // 2. Parse waypoints
    const waypoints = params.waypoints
      ? params.waypoints.split('|').map((pair) => {
          const [lat, lon] = pair.split(',').map(Number);
          return { lat, lon };
        }).filter((w) => !isNaN(w.lat) && !isNaN(w.lon))
      : [];

    // 3. Get all routes (primary + alternatives)
    const allRouteDatas = await routingService.getRoutes(startCoords, finishCoords, waypoints);
    if (!allRouteDatas || allRouteDatas.length === 0) {
      throw new NotFoundError('No route found');
    }

    // 4. Optimize fuel stops for each route in parallel
    const results = await Promise.all(
      allRouteDatas.map((routeData) =>
        fuelOptimizationService.findOptimalStops(
          routeData,
          startCoords,
          finishCoords,
          params.range_miles,
          params.mpg
        ).then(({ stops, fuelCost }) => ({ routeData, stops, fuelCost }))
         .catch(() => null) // if one route fails optimization, skip it
      )
    );

    const routes = results
      .filter((r) => r !== null && r.stops !== null)
      .map((r, i) => ({
        route_index: i,
        total_distance_miles: r.routeData.distance_miles,
        total_duration_minutes: r.routeData.duration_minutes,
        fuel_cost: Math.round(r.fuelCost * 100) / 100,
        stops: r.stops,
        route_polyline: r.routeData.encodedPolyline,
      }));

    if (routes.length === 0) {
      throw new NoPathError(
        'Route exceeds vehicle range without reachable fueling stations.',
        allRouteDatas[0]
      );
    }

    res.json({
      start: params.start_location,
      finish: params.finish_location,
      routes,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
