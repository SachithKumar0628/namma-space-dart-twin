"""
SQLite database layer for the Namma Space reconstruction service.

Provides persistent storage for projects, rooms, doorways, photos, and
reconstruction jobs. Uses Python's built-in sqlite3 (no external dependency).
All tables are created idempotently on first access.
"""

from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator

SERVICE_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SERVICE_DIR.parent
DATA_ENV = __import__("os").getenv("DART_RECONSTRUCTION_DATA", "").strip()
if DATA_ENV:
    DATA_ROOT = Path(__import__("os").expanduser(DATA_ENV))
    if not DATA_ROOT.is_absolute():
        DATA_ROOT = (PROJECT_ROOT / DATA_ROOT).resolve()
else:
    DATA_ROOT = (PROJECT_ROOT / "data" / "reconstructions").resolve()

DB_PATH = DATA_ROOT / "namma_reconstruction.sqlite"
DATA_ROOT.mkdir(parents=True, exist_ok=True)


def get_connection() -> sqlite3.Connection:
    """Open a SQLite connection with WAL mode and row factory."""
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA synchronous = NORMAL")
    return conn


@contextmanager
def transaction() -> Iterator[sqlite3.Connection]:
    """Context manager that commits on success and rolls back on exception."""
    conn = get_connection()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db() -> None:
    """Create all tables idempotently."""
    with transaction() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS projects (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                description TEXT DEFAULT '',
                space_type TEXT DEFAULT 'Custom',
                units TEXT DEFAULT 'metres',
                floor_area REAL,
                ceiling_height REAL,
                capture_method TEXT DEFAULT 'Still Photos Loop',
                status TEXT DEFAULT 'Ready for Upload',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                photo_count INTEGER NOT NULL DEFAULT 0,
                room_count INTEGER NOT NULL DEFAULT 0,
                video_count INTEGER NOT NULL DEFAULT 0,
                reconstruction_engine TEXT DEFAULT 'Calibrated Geometric Twin',
                reconstruction_progress INTEGER NOT NULL DEFAULT 0,
                last_error_message TEXT,
                reconstruction_model_stats TEXT
            );

            CREATE TABLE IF NOT EXISTS rooms (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL,
                name TEXT NOT NULL,
                category TEXT DEFAULT 'Office',
                length_meters REAL NOT NULL,
                width_meters REAL NOT NULL,
                height_meters REAL NOT NULL,
                origin_description TEXT DEFAULT '',
                coordinate_convention TEXT DEFAULT 'Right-Handed Y-Up (Three.js standard)',
                connected_doorway_ids TEXT NOT NULL DEFAULT '[]',
                features TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS doorways (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL,
                name TEXT NOT NULL,
                connected_room_ids TEXT NOT NULL DEFAULT '[]',
                width_meters REAL NOT NULL,
                height_meters REAL NOT NULL,
                wall_location TEXT DEFAULT 'east',
                offset_meters REAL NOT NULL DEFAULT 0,
                has_clear_line_of_sight INTEGER NOT NULL DEFAULT 1,
                observations TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS photos (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL,
                room_id TEXT NOT NULL,
                filename TEXT NOT NULL,
                pass TEXT NOT NULL DEFAULT 'Pass A',
                modality TEXT DEFAULT 'Still Photograph',
                camera_pose_tag TEXT DEFAULT '',
                focal_length_mm REAL NOT NULL DEFAULT 24,
                sharpness_score INTEGER NOT NULL DEFAULT 0,
                exposure_review TEXT NOT NULL DEFAULT 'Good',
                overlap_review TEXT NOT NULL DEFAULT 'Sufficient (>70%)',
                occlusion_flag INTEGER NOT NULL DEFAULT 0,
                doorway_anchor_id TEXT,
                reviewer_notes TEXT DEFAULT '',
                timestamp TEXT NOT NULL,
                is_automated_metric INTEGER NOT NULL DEFAULT 1,
                image_url TEXT,
                dominant_color TEXT,
                spatial_pose TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
                FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
                FOREIGN KEY (doorway_anchor_id) REFERENCES doorways(id) ON DELETE SET NULL
            );

            CREATE TABLE IF NOT EXISTS jobs (
                id TEXT PRIMARY KEY,
                project_id TEXT,
                status TEXT NOT NULL DEFAULT 'queued',
                stage TEXT NOT NULL DEFAULT 'queued',
                progress INTEGER NOT NULL DEFAULT 0,
                message TEXT DEFAULT '',
                input_count INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                started_at TEXT,
                finished_at TEXT,
                stats TEXT,
                assets TEXT,
                error TEXT,
                FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
            );

            CREATE INDEX IF NOT EXISTS idx_rooms_project ON rooms(project_id);
            CREATE INDEX IF NOT EXISTS idx_doorways_project ON doorways(project_id);
            CREATE INDEX IF NOT EXISTS idx_photos_project ON photos(project_id);
            CREATE INDEX IF NOT EXISTS idx_photos_room ON photos(room_id);
            CREATE INDEX IF NOT EXISTS idx_jobs_project ON jobs(project_id);
            """
        )


def dict_from_row(row: sqlite3.Row) -> dict[str, Any]:
    """Convert a sqlite3.Row to a plain dict, parsing JSON fields."""
    data = {key: row[key] for key in row.keys()}
    for json_field in (
        "connected_doorway_ids",
        "features",
        "connected_room_ids",
        "observations",
        "reconstruction_model_stats",
        "stats",
        "assets",
        "spatial_pose",
    ):
        if json_field in data and data[json_field] is not None:
            try:
                data[json_field] = json.loads(data[json_field])
            except (ValueError, TypeError):
                pass
    return data


def now_iso() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).isoformat(timespec="seconds")
