const Joi = require('joi');
const { ValidationError } = require('./errors');

const routeQuerySchema = Joi.object({
  start_location: Joi.string().required(),
  finish_location: Joi.string().required(),
  start_lat: Joi.number().min(-90).max(90),
  start_lon: Joi.number().min(-180).max(180),
  finish_lat: Joi.number().min(-90).max(90),
  finish_lon: Joi.number().min(-180).max(180),
  // Pipe-separated intermediate waypoints: "lat,lon|lat,lon|..."
  waypoints: Joi.string().allow(''),
  // Legacy param — kept for backward compat; no default so we can detect when it's absent
  range_miles: Joi.number().positive(),
  // Vehicle params
  mpg: Joi.number().positive().default(10),
  tank_capacity: Joi.number().positive().default(250),        // gallons
  current_gallons: Joi.number().min(0).default(250),          // gallons onboard now
  // Planning params
  deviation_miles: Joi.number().min(0).default(10),           // how far off route to search
  refuel_threshold_pct: Joi.number().min(1).max(100).default(80), // % consumed before seeking stop
}).custom((value, helpers) => {
  if (value.current_gallons > value.tank_capacity) {
    return helpers.error('any.invalid', {
      message: 'current_gallons cannot exceed tank_capacity',
    });
  }
  return value;
});

function validateRouteQuery(query) {
  const { error, value } = routeQuerySchema.validate(query, {
    abortEarly: false,
    stripUnknown: true,
  });

  if (error) {
    const messages = error.details.reduce((acc, d) => {
      acc[d.path[0]] = [d.message];
      return acc;
    }, {});
    throw Object.assign(new ValidationError('Validation failed'), {
      statusCode: 400,
      details: messages,
    });
  }

  return value;
}

module.exports = { validateRouteQuery };
