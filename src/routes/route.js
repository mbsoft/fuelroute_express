const express = require('express');
const router = express.Router();
const { validateRouteQuery } = require('../utils/validation');
const geocodingService = require('../services/geocodingService');
const routingService = require('../services/routingService');
const fuelOptimizationService = require('../services/fuelOptimizationService');
const { ValidationError, NotFoundError, NoPathError } = require('../utils/errors');

/**
 * @openapi
 * /api/route/:
 *   get:
 *     summary: Calculate optimal fuel stops along a route
 *     description: Finds the cheapest fuel stops along a driving route using Dijkstra's algorithm on a DAG of nearby fuel stations.
 *     parameters:
 *       - in: query
 *         name: start_location
 *         required: true
 *         schema:
 *           type: string
 *         description: Starting location name (e.g. "Milford,IA")
 *       - in: query
 *         name: finish_location
 *         required: true
 *         schema:
 *           type: string
 *         description: Destination location name (e.g. "Minneapolis,MN")
 *       - in: query
 *         name: range_miles
 *         schema:
 *           type: number
 *           default: 500
 *         description: Vehicle fuel tank range in miles
 *       - in: query
 *         name: mpg
 *         schema:
 *           type: number
 *           default: 10
 *         description: Vehicle fuel efficiency in miles per gallon
 *     responses:
 *       200:
 *         description: Optimal route with fuel stops
 *       400:
 *         description: Invalid parameters or geocoding failure
 *       404:
 *         description: No route found
 *       422:
 *         description: Route exceeds vehicle range without reachable stations
 */
router.get('/', async (req, res, next) => {
  try {
    const params = validateRouteQuery(req.query);
    console.log(`Route request: ${params.start_location} → ${params.finish_location} (range=${params.range_miles}mi, mpg=${params.mpg})`);

    // 1. Geocode
    const startCoords = await geocodingService.getCoordinates(params.start_location);
    const finishCoords = await geocodingService.getCoordinates(params.finish_location);

    if (!startCoords || !finishCoords) {
      throw new ValidationError('Could not geocode locations');
    }

    // 2. Get Route
    const routeData = await routingService.getRoute(startCoords, finishCoords);
    if (!routeData) {
      throw new NotFoundError('No route found');
    }

    // 3. Optimize Fuel Stops
    const { stops, fuelCost } = await fuelOptimizationService.findOptimalStops(
      routeData,
      startCoords,
      finishCoords,
      params.range_miles,
      params.mpg
    );

    if (stops === null) {
      throw new NoPathError(
        'Route exceeds vehicle range without reachable fueling stations.',
        routeData
      );
    }

    res.json({
      start: params.start_location,
      finish: params.finish_location,
      total_distance_miles: routeData.distance_miles,
      total_duration_minutes: routeData.duration_minutes,
      fuel_cost: Math.round(fuelCost * 100) / 100,
      stops,
      route_geometry: routeData.geometry,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
