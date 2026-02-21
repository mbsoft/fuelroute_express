class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
    this.statusCode = 400;
  }
}

class NotFoundError extends Error {
  constructor(message) {
    super(message);
    this.name = 'NotFoundError';
    this.statusCode = 404;
  }
}

class NoPathError extends Error {
  constructor(message, routeData) {
    super(message);
    this.name = 'NoPathError';
    this.statusCode = 422;
    this.routeData = routeData;
  }
}

module.exports = { ValidationError, NotFoundError, NoPathError };
