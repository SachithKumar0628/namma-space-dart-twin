# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.0.x   | :white_check_mark: |

## Authentication

- Passwords are hashed with Node's `crypto.scrypt` (no external deps).
- Every password uses a **unique random salt** stored as `salt:hash`.
- An app-level **pepper** is read from the `AUTH_SALT` environment variable.
  - **Never commit a real pepper.** Generate one per deployment:
    ```bash
    openssl rand -hex 32
    ```
- Sessions are server-side SQLite rows, held in an `HttpOnly`, `SameSite=Strict` cookie.
- Secure cookie flag is enabled automatically when `NODE_ENV=production` or `FORCE_SECURE_COOKIE=true`.

## Demo Mode (default)

- Authentication is disabled by default (`ENABLE_AUTH=false`).
- A demo user is created on first run with a **randomly generated password** logged once to stdout. It is never stored in code.
- For production, set `ENABLE_AUTH=true` and register real users via `/api/auth/register`.

## CORS

- Controlled via `CORS_ORIGINS` (comma-separated).
- Defaults to `*` in development only.
- In production, set an explicit list (e.g. `https://yourdomain.com`) — `*` is not used.
- `Access-Control-Allow-Credentials: true` is always sent; never combined with wildcard origin.

## Environment Variables

| File | Key | Purpose |
|------|-----|---------|
| `server/.env` | `AUTH_SALT` | Password hashing pepper (required, production) |
| `server/.env` | `CORS_ORIGINS` | Allowed frontend origins |
| `server/.env` | `ENABLE_AUTH` | Enable login requirement |
| `server/.env` | `NODE_ENV` | `production` enables Secure cookies |
| `.env` | `VITE_GOOGLE_API_KEY` | Optional Gemini key (frontend) |
| `.env` | `VITE_API_BASE` | API server URL |

Copy `.env.example` → `.env` and `server/.env.example` → `server/.env` before running locally.

## What is NOT committed

- `.env*` (real secrets) — only `.env.example` is tracked
- `*.txt` — local logs that may reveal file paths/usernames
- `.aistudio/` — IDE/agent artifacts
- `data/`, `*.sqlite` — local SQLite databases
- `node_modules/`, `build/`, `dist/`, `target/`

## Reporting

If you find a security issue, please open a private advisory or contact the maintainer directly. Do not disclose vulnerabilities in public issues.

## Dependency Scanning

This project uses `npm audit` and `better-sqlite3` (native). Run `npm audit` before releasing and upgrade any packages with known vulnerabilities.