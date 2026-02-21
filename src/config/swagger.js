const swaggerJsdoc = require('swagger-jsdoc');

const options = {
  definition: {
    openapi: '3.0.3',
    info: {
      title: 'Fuel Optimization API',
      version: '1.0.0',
      description: 'API for optimal fuel stops and routing',
    },
  },
  apis: ['./src/routes/*.js'],
};

module.exports = swaggerJsdoc(options);
