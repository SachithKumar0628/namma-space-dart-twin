/**
 * server.cjs
 * NammaTwin LoopAnchor Studio - REST API server entry point.
 *
 * Runs a lightweight Node.js HTTP server on port 5000 that backs the frontend
 * with SQLite-persisted projects, rooms, doorways, and photo manifests.
 *
 * Usage:
 *   node server.cjs
 *   PORT=5000 ENABLE_AUTH=true node server.cjs
 */

const http = require('http');
const { dispatch } = require('./server/api.cjs');

const PORT = parseInt(process.env.PORT || '5000', 10);
const HOST = process.env.HOST || '127.0.0.1';
// CORS origins: comma-separated list. Defaults to '*' in dev, but must be set explicitly in production.
// Never combine '*' with Access-Control-Allow-Credentials: true.
const CORS_ORIGINS = process.env.CORS_ORIGINS || (process.env.NODE_ENV === 'production' ? '' : '*');

const server = http.createServer((req, res) => {
  // CORS headers so the Vite dev server can call this API.
  const origin = req.headers.origin || '';
  let allowOrigin = CORS_ORIGINS;
  if (CORS_ORIGINS && CORS_ORIGINS !== '*') {
    const allowed = CORS_ORIGINS.split(',').map((o) => o.trim());
    allowOrigin = allowed.includes(origin) ? origin : (allowed[0] || '');
  }
  res.setHeader('Access-Control-Allow-Origin', allowOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, Authorization, Cookie');
  res.setHeader('Access-Control-Allow-Credentials', 'true');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Dev logging
  if (process.env.NODE_ENV !== 'production') {
    const start = Date.now();
    const method = req.method;
    const url = req.url;
    res.on('finish', () => {
      const duration = Date.now() - start;
      const status = res.statusCode;
      const color = status >= 500 ? '\x1b[31m' : status >= 400 ? '\x1b[33m' : status >= 300 ? '\x1b[36m' : '\x1b[32m';
      console.log(`${color}[${method}]${'\x1b[0m'} ${url} ${color}${status}${'\x1b[0m'} ${duration}ms`);
    });
  }

  dispatch(req, res);
});

server.listen(PORT, HOST, () => {
  // eslint-disable-next-line no-console
  console.log(`[NammaTwin API] Listening on http://${HOST}:${PORT}`);
  // eslint-disable-next-line no-console
  console.log(`[NammaTwin API] Health: http://${HOST}:${PORT}/api/health`);
});

server.on('error', (err) => {
  // eslint-disable-next-line no-console
  console.error('[NammaTwin API] Server error:', err.message);
  process.exit(1);
});

module.exports = { server };
