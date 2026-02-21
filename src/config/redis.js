const Redis = require('ioredis');

const redis = new Redis(process.env.REDIS_URL || 'redis://127.0.0.1:6379/1');

redis.on('error', (err) => {
  console.error('Redis connection error:', err.message);
});

module.exports = redis;
