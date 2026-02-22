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
  range_miles: Joi.number().positive().default(500),
  mpg: Joi.number().positive().default(10),
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
