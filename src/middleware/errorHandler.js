const { NoPathError } = require('../utils/errors');

function errorHandler(err, req, res, next) {
  const statusCode = err.statusCode || 500;

  if (err instanceof NoPathError) {
    return res.status(422).json({
      message: err.message,
      route: err.routeData,
    });
  }

  if (statusCode === 400) {
    return res.status(400).json({ error: err.message });
  }

  if (statusCode === 404) {
    return res.status(404).json({ error: err.message });
  }

  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
}

module.exports = errorHandler;
