/**
 * server/auth.cjs
 * Authentication and session management for NammaTwin LoopAnchor Studio.
 *
 * - Passwords are hashed with Node's built-in crypto.scrypt (no extra deps).
 * * Sessions are server-side rows in SQLite, identified by a random token held
 *   in an HttpOnly, SameSite=Strict cookie.
 * - All behaviour is gated behind the ENABLE_AUTH environment variable. When
 *   ENABLE_AUTH is not 'true', the backend provisions a default "demo" user and
 *   issues an implicit session so the single-user tool works out of the box
 *   without a login wall. When ENABLE_AUTH=true, explicit login is required.
 */

const crypto = require('crypto');
const { db } = require('./db.cjs');

// Sessions table (idempotent).
db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
`);

// Clean up expired sessions periodically (simple lazy cleanup on startup).
db.prepare(`DELETE FROM sessions WHERE expires_at < datetime('now')`).run();

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
// App-level pepper from env. Never commit a real value—set AUTH_SALT in production.
const APP_PEPPER = process.env.AUTH_SALT || 'change-me-in-production';
const KEY_LEN = 64;

function generateSalt() {
  return crypto.randomBytes(16).toString('hex');
}

// Stores salt:hash so every password has a unique salt.
function hashPassword(password) {
  const salt = generateSalt();
  const hash = crypto.scryptSync(password, salt + APP_PEPPER, KEY_LEN);
  return `${salt}:${hash.toString('hex')}`;
}

function verifyPassword(password, storedHash) {
  try {
    const parts = storedHash.split(':');
    if (parts.length !== 2) return false;
    const [salt, hash] = parts;
    const computed = crypto.scryptSync(password, salt + APP_PEPPER, KEY_LEN);
    return crypto.timingSafeEqual(computed, Buffer.from(hash, 'hex'));
  } catch {
    return false;
  }
}

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function createSession(userId) {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  db.prepare(`INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)`).run(token, userId, expiresAt);
  return token;
}

function destroySession(token) {
  if (token) db.prepare(`DELETE FROM sessions WHERE id = ?`).run(token);
}

function getUserFromSession(token) {
  if (!token) return null;
  const row = db.prepare(`SELECT u.id, u.username, u.email, u.role FROM users u JOIN sessions s ON s.user_id = u.id WHERE s.id = ? AND s.expires_at > datetime('now')`).get(token);
  return row || null;
}

// Authentication middleware. Attaches req.user when a valid session exists.
// Does NOT 401 by itself; route handlers decide whether auth is required.
function authenticate(req, res, next) {
  req.user = null;
  const token = req.cookies && req.cookies.session_token;
  if (token) {
    try {
      req.user = getUserFromSession(token);
    } catch {
      req.user = null;
    }
  }
  next();
}

function requireAuth(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required', code: 'AUTH_REQUIRED' });
  }
  next();
}

function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required', code: 'AUTH_REQUIRED' });
    }
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden', code: 'FORBIDDEN' });
    }
    next();
  };
}

// Cookie parser (tiny, dependency-free) for the session_token cookie.
function parseCookies(cookieHeader) {
  if (!cookieHeader) return {};
  return Object.fromEntries(
    cookieHeader.split(';').map((part) => part.trim().split('=')).filter((pair) => pair.length === 2).map(([k, v]) => [k, decodeURIComponent(v)])
  );
}

function cookieMiddleware(req, res, next) {
  req.cookies = parseCookies(req.headers.cookie);
  next();
}

function setSessionCookie(res, token) {
  const isSecure = process.env.NODE_ENV === 'production' || process.env.FORCE_SECURE_COOKIE === 'true';
  res.setHeader(
    'Set-Cookie',
    `session_token=${token}; Path=/; HttpOnly; SameSite=Strict${isSecure ? '; Secure' : ''}; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`
  );
}

function clearSessionCookie(res) {
  const isSecure = process.env.NODE_ENV === 'production' || process.env.FORCE_SECURE_COOKIE === 'true';
  res.setHeader(
    'Set-Cookie',
    `session_token=; Path=/; HttpOnly; SameSite=Strict${isSecure ? '; Secure' : ''}; Max-Age=0`
  );
}

// Ensure a default demo user exists so the app is usable without sign-up.
// A random password is generated on first run and logged once—it is never stored in code.
function ensureDemoUser() {
  const row = db.prepare(`SELECT id FROM users WHERE username = 'demo'`).get();
  if (row) return row.id;
  const id = 'user_demo_0001';
  const demoPassword = crypto.randomBytes(16).toString('hex');
  const hash = hashPassword(demoPassword);
  db.prepare(`INSERT INTO users (id, username, email, password_hash, role) VALUES (?, ?, ?, ?, ?)`).run(id, 'demo', 'demo@nammatwin.local', hash, 'user');
  console.log('[AUTH] Demo user created.');
  console.log(`[AUTH]   Username: demo`);
  console.log(`[AUTH]   Password: ${demoPassword}`);
  console.log('[AUTH]   Save this password—it will not be shown again.');
  console.log('[AUTH]   Set ENABLE_AUTH=true to require login.');
  return id;
}

module.exports = {
  hashPassword,
  verifyPassword,
  generateToken,
  createSession,
  destroySession,
  getUserFromSession,
  authenticate,
  requireAuth,
  requireRole,
  cookieMiddleware,
  setSessionCookie,
  clearSessionCookie,
  ensureDemoUser,
  SESSION_TTL_MS,
};
