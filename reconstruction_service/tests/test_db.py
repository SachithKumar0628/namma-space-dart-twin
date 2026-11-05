"""
Unit tests for the SQLite database layer.
"""

from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

import pytest

# Ensure the reconstruction_service package is importable.
SERVICE_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SERVICE_DIR))


@pytest.fixture
def temp_db_path():
    """Create a temporary database path for isolated tests."""
    fd, path = tempfile.mkstemp(suffix=".sqlite")
    os.close(fd)
    yield Path(path)
    try:
        os.unlink(path)
    except OSError:
        pass


def test_init_db_creates_tables(temp_db_path, monkeypatch):
    """init_db should create all expected tables."""
    import db

    monkeypatch.setattr(db, "DB_PATH", temp_db_path)
    db.init_db()

    conn = db.get_connection()
    try:
        tables = {
            row[0]
            for row in conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            ).fetchall()
        }
        for expected in (
            "projects",
            "rooms",
            "doorways",
            "photos",
            "jobs",
        ):
            assert expected in tables, f"Missing table: {expected}"
    finally:
        conn.close()


def test_project_crud(temp_db_path, monkeypatch):
    """Project insert, select, update, delete round-trip."""
    import db

    monkeypatch.setattr(db, "DB_PATH", temp_db_path)
    db.init_db()

    now = db.now_iso()
    with db.transaction() as conn:
        conn.execute(
            """
            INSERT INTO projects (id, name, description, space_type, units,
                                  floor_area, ceiling_height, capture_method,
                                  status, created_at, updated_at,
                                  photo_count, room_count, video_count,
                                  reconstruction_engine, reconstruction_progress,
                                  last_error_message, reconstruction_model_stats)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                "proj_test",
                "Test Project",
                "A test",
                "Office",
                "metres",
                25.0,
                2.85,
                "Still Photos Loop",
                "Ready for Upload",
                now,
                now,
                0,
                0,
                0,
                "Calibrated Geometric Twin",
                0,
                None,
                None,
            ),
        )

    # Read
    with db.transaction() as conn:
        row = conn.execute(
            "SELECT * FROM projects WHERE id = ?", ("proj_test",)
        ).fetchone()
    assert row is not None
    assert row["name"] == "Test Project"

    # Update
    with db.transaction() as conn:
        conn.execute(
            "UPDATE projects SET name = ?, updated_at = ? WHERE id = ?",
            ("Updated Project", now, "proj_test"),
        )
    with db.transaction() as conn:
        row = conn.execute(
            "SELECT * FROM projects WHERE id = ?", ("proj_test",)
        ).fetchone()
    assert row["name"] == "Updated Project"

    # Delete
    with db.transaction() as conn:
        conn.execute("DELETE FROM projects WHERE id = ?", ("proj_test",))
    with db.transaction() as conn:
        row = conn.execute(
            "SELECT * FROM projects WHERE id = ?", ("proj_test",)
        ).fetchone()
    assert row is None


def test_room_and_doorway_crud(temp_db_path, monkeypatch):
    """Room and doorway insert/select round-trip with foreign keys."""
    import db

    monkeypatch.setattr(db, "DB_PATH", temp_db_path)
    db.init_db()

    now = db.now_iso()
    with db.transaction() as conn:
        conn.execute(
            """
            INSERT INTO projects (id, name, description, space_type, units,
                                  floor_area, ceiling_height, capture_method,
                                  status, created_at, updated_at,
                                  photo_count, room_count, video_count,
                                  reconstruction_engine, reconstruction_progress,
                                  last_error_message, reconstruction_model_stats)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                "proj_room_test",
                "Room Test Project",
                "",
                "Office",
                "metres",
                25.0,
                2.85,
                "Still Photos Loop",
                "Ready for Upload",
                now,
                now,
                0,
                0,
                0,
                "Calibrated Geometric Twin",
                0,
                None,
                None,
            ),
        )
        conn.execute(
            """
            INSERT INTO rooms (id, project_id, name, category, length_meters,
                               width_meters, height_meters, origin_description,
                               coordinate_convention, connected_doorway_ids,
                               features, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                "room_r01",
                "proj_room_test",
                "Living Room",
                "Living",
                6.0,
                4.0,
                2.85,
                "South-west corner",
                "Right-Handed Y-Up (Three.js standard)",
                '["door_d01"]',
                '{"doorsCount": 1}',
                now,
                now,
            ),
        )
        conn.execute(
            """
            INSERT INTO doorways (id, project_id, name, connected_room_ids,
                                  width_meters, height_meters, wall_location,
                                  offset_meters, has_clear_line_of_sight,
                                  observations, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                "door_d01",
                "proj_room_test",
                "Foyer to Living",
                '["room_r01", "room_r02"]',
                0.9,
                2.1,
                "east",
                1.0,
                1,
                '{"roomAObserved": true}',
                now,
                now,
            ),
        )

    with db.transaction() as conn:
        room = conn.execute(
            "SELECT * FROM rooms WHERE id = ?", ("room_r01",)
        ).fetchone()
        assert room is not None
        assert room["name"] == "Living Room"
        assert db.dict_from_row(room)["connected_doorway_ids"] == ["door_d01"]

        door = conn.execute(
            "SELECT * FROM doorways WHERE id = ?", ("door_d01",)
        ).fetchone()
        assert door is not None
        assert db.dict_from_row(door)["connected_room_ids"] == [
            "room_r01",
            "room_r02",
        ]


def test_dict_from_row_parses_json(temp_db_path, monkeypatch):
    """dict_from_row should parse JSON text fields back to Python objects."""
    import db

    monkeypatch.setattr(db, "DB_PATH", temp_db_path)
    db.init_db()

    now = db.now_iso()
    with db.transaction() as conn:
        conn.execute(
            """
            INSERT INTO projects (id, name, description, space_type, units,
                                  floor_area, ceiling_height, capture_method,
                                  status, created_at, updated_at,
                                  photo_count, room_count, video_count,
                                  reconstruction_engine, reconstruction_progress,
                                  last_error_message, reconstruction_model_stats)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                "proj_json",
                "JSON Project",
                "",
                "Office",
                "metres",
                25.0,
                2.85,
                "Still Photos Loop",
                "Ready for Upload",
                now,
                now,
                0,
                0,
                0,
                "Calibrated Geometric Twin",
                100,
                None,
                '{"triangleCount": 28450, "vertexCount": 16820}',
            ),
        )

    with db.transaction() as conn:
        row = conn.execute(
            "SELECT * FROM projects WHERE id = ?", ("proj_json",)
        ).fetchone()
    data = db.dict_from_row(row)
    assert data["reconstruction_model_stats"] == {
        "triangleCount": 28450,
        "vertexCount": 16820,
    }
