require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const swaggerUi = require('swagger-ui-express');
const swaggerSpec = require('./config/swagger');
const routeRouter = require('./routes/route');
const errorHandler = require('./middleware/errorHandler');
const redis = require('./config/redis');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(helmet());
app.use(express.json());

// Rate limiting: 100 requests per day (matches Django anon throttle)
const limiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000, // 24 hours
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// API routes
app.use('/api/route', routeRouter);

// Swagger documentation
app.use('/api/schema/swagger-ui', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
app.get('/api/schema', (req, res) => res.json(swaggerSpec));

// Error handler (must be last)
app.use(errorHandler);

const server = app.listen(PORT, () => {
  console.log(`Fuel Route API listening on http://localhost:${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received. Shutting down...');
  server.close();
  redis.disconnect();
  process.exit(0);
});

module.exports = app;
