"""
Authentication module for the Namma Space reconstruction service.

Provides session-based authentication with scrypt password hashing and
HttpOnly-style session tokens. Authentication is optional and controlled by
the DART_ENABLE_AUTH environment variable. When disabled, an implicit demo
session is attached to every request.
"""

from __future__ import annotations

import hashlib
import os
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any, Optional
from uuid import uuid4

from fastapi import HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

try:
    from .db import transaction, dict_from_row, now_iso
except ImportError:  # pragma: no cover
    from db import transaction, dict_from_row, now_iso

security = HTTPBearer(auto_error=False)

SESSION_TTL_HOURS = int(os.getenv("DART_SESSION_TTL_HOURS", "24"))
ENABLE_AUTH = os.getenv("DART_ENABLE_AUTH", "false").lower() in {"1", "true", "yes", "on"}
DEMO_USER_ID = "user_demo_0001"
DEMO_USERNAME = "demo"
DEMO_PASSWORD_HASH = hashlib.scrypt(
    b"demo1234", salt=b"namma-recon-salt", n=2**14, r=8, p=1, dklen=64
).hex()


def _hash_password(password: str, salt: Optional[bytes] = None) -> tuple[str, str]:
    """Hash a password with scrypt. Returns (hash_hex, salt_hex)."""
    if salt is None:
        salt = secrets.token_bytes(32)
    dk = hashlib.scrypt(
        password.encode("utf-8"),
        salt=salt,
        n=2**14,
        r=8,
        p=1,
        dklen=64,
    )
    return dk.hex(), salt.hex()


def _verify_password(password: str, hash_hex: str, salt_hex: str) -> bool:
    """Verify a password against a scrypt hash."""
    try:
        salt = bytes.fromhex(salt_hex)
        expected = bytes.fromhex(hash_hex)
        dk = hashlib.scrypt(
            password.encode("utf-8"),
            salt=salt,
            n=2**14,
            r=8,
            p=1,
            dklen=64,
        )
        return secrets.compare_digest(dk, expected)
    except (ValueError, TypeError):
        return False


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: datetime) -> str:
    return dt.isoformat(timespec="seconds")


def init_auth() -> None:
    """Ensure the demo user exists in the database."""
    with transaction() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                username TEXT UNIQUE NOT NULL,
                email TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                salt TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT 'user',
                created_at TEXT NOT NULL,
                last_login TEXT
            );
            CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                token_hash TEXT NOT NULL,
                expires_at TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
            CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token_hash);
            """
        )
        # Seed demo user if absent
        existing = conn.execute(
            "SELECT id FROM users WHERE username = ?", (DEMO_USERNAME,)
        ).fetchone()
        if not existing:
            conn.execute(
                """
                INSERT INTO users (id, username, email, password_hash, salt, role, created_at)
                VALUES (?, ?, ?, ?, ?, 'user', ?)
                """,
                (
                    DEMO_USER_ID,
                    DEMO_USERNAME,
                    "demo@namma-recon.local",
                    DEMO_PASSWORD_HASH,
                    "namma-recon-salt",
                    _iso(_now_utc()),
                ),
            )


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def create_session_token(user_id: str) -> str:
    """Create a new session token and store its hash. Returns the raw token."""
    token = secrets.token_urlsafe(32)
    token_hash = _hash_token(token)
    expires_at = _iso(_now_utc() + timedelta(hours=SESSION_TTL_HOURS))
    with transaction() as conn:
        conn.execute(
            """
            INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (f"sess_{uuid4().hex[:16]}", user_id, token_hash, expires_at, _iso(_now_utc())),
        )
    return token


def verify_session_token(token: str) -> Optional[dict[str, Any]]:
    """Validate a session token. Returns user dict or None."""
    token_hash = _hash_token(token)
    now = _iso(_now_utc())
    with transaction() as conn:
        row = conn.execute(
            """
            SELECT s.id, s.user_id, s.expires_at, u.username, u.email, u.role
            FROM sessions s
            JOIN users u ON u.id = s.user_id
            WHERE s.token_hash = ? AND s.expires_at > ?
            """,
            (token_hash, now),
        ).fetchone()
        if row is None:
            return None
        # Touch last_login
        conn.execute(
            "UPDATE users SET last_login = ? WHERE id = ?",
            (now, row["user_id"]),
        )
        return dict_from_row(row)


def destroy_session_token(token: str) -> None:
    """Remove a session token."""
    token_hash = _hash_token(token)
    with transaction() as conn:
        conn.execute("DELETE FROM sessions WHERE token_hash = ?", (token_hash,))


def cleanup_expired_sessions() -> None:
    """Remove expired sessions."""
    now = _iso(_now_utc())
    with transaction() as conn:
        conn.execute("DELETE FROM sessions WHERE expires_at <= ?", (now,))


async def get_current_user(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = None,
) -> dict[str, Any]:
    """Dependency that returns the current user. If auth is disabled, returns
    the implicit demo user. If auth is enabled, requires a valid Bearer token."""
    if not ENABLE_AUTH:
        return {
            "id": DEMO_USER_ID,
            "username": DEMO_USERNAME,
            "email": "demo@namma-recon.local",
            "role": "user",
        }

    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required",
            headers={"WWW-Authenticate": "Bearer"},
        )

    user = verify_session_token(credentials.credentials)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired session token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return user


async def require_admin(user: dict[str, Any] = None) -> dict[str, Any]:
    """Dependency that requires admin role."""
    # Injected via Depends in routes that need admin
    if user is None:
        user = {"id": DEMO_USER_ID, "username": DEMO_USERNAME, "role": "user"}
    if user.get("role") != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required",
        )
    return user
