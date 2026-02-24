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

    // Derive fuel parameters (backward compat: range_miles overrides tank_capacity)
    const mpg = params.mpg;
    let tankCapacity = params.tank_capacity;
    let currentGallons = params.current_gallons;

    if (params.range_miles != null && !req.query.tank_capacity) {
      tankCapacity = params.range_miles / mpg;
      if (!req.query.current_gallons) currentGallons = tankCapacity;
    }

    const fuelOpts = {
      tankCapacity,
      currentGallons,
      mpg,
      maxRangeMiles: tankCapacity * mpg,
      deviationMiles: params.deviation_miles,
      refuelThresholdPct: params.refuel_threshold_pct,
    };

    console.log(`Route request: ${params.start_location} → ${params.finish_location} (tank=${tankCapacity}gal, fuel=${currentGallons}gal, mpg=${mpg}, deviation=${fuelOpts.deviationMiles}mi)`);

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
          fuelOpts
        ).then(({ stops, fuelCost, fuelLevels }) => ({ routeData, stops, fuelCost, fuelLevels }))
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
        toll_cost: r.routeData.toll_cost,
        tolls: r.routeData.tolls,
        stops: r.stops,
        route_polyline: r.routeData.encodedPolyline,
        fuel_levels: r.fuelLevels,
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
