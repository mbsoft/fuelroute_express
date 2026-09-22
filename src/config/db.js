const { Pool, types } = require('pg');

// Return NUMERIC columns as JS numbers instead of strings (prices fit safely in a double)
types.setTypeParser(types.builtins.NUMERIC, (val) => (val === null ? null : parseFloat(val)));

const { DB_USER, DB_PASSWORD, DB_NAME, DB_HOST, DB_PORT, INSTANCE_CONNECTION_NAME } = process.env;

if (!DB_USER || !DB_PASSWORD || !DB_NAME) {
  throw new Error('DB_USER, DB_PASSWORD and DB_NAME must be set');
}
if (!DB_HOST && !INSTANCE_CONNECTION_NAME) {
  throw new Error('Either DB_HOST or INSTANCE_CONNECTION_NAME must be set');
}

// On Cloud Run, INSTANCE_CONNECTION_NAME connects via the /cloudsql unix socket.
// Locally, set DB_HOST=127.0.0.1 and run cloud-sql-proxy.
const pool = new Pool({
  user: DB_USER,
  password: DB_PASSWORD,
  database: DB_NAME,
  host: INSTANCE_CONNECTION_NAME ? `/cloudsql/${INSTANCE_CONNECTION_NAME}` : DB_HOST,
  port: DB_PORT ? parseInt(DB_PORT, 10) : 5432,
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

pool.on('error', (err) => {
  console.error('Unexpected Postgres pool error:', err.message);
});

module.exports = pool;
