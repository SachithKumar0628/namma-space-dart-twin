"""
API tests using FastAPI TestClient with a temporary SQLite database.
"""

from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

SERVICE_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SERVICE_DIR))


@pytest.fixture
def temp_db_path():
    fd, path = tempfile.mkstemp(suffix=".sqlite")
    os.close(fd)
    yield Path(path)
    try:
        os.unlink(path)
    except OSError:
        pass


@pytest.fixture
def client(temp_db_path):
    """Create a TestClient backed by a temporary database, with auth disabled."""
    from reconstruction_service import db
    from reconstruction_service import main

    # Point the database at a temporary file.
    monkeypatch_db = patch.object(db, "DB_PATH", temp_db_path)
    monkeypatch_db.start()
    db.init_db()

    # Disable auth for these tests.
    monkeypatch_auth = patch.object(main, "ENABLE_AUTH", False)
    monkeypatch_auth.start()

    # Override the get_current_user dependency to return the demo user.
    def fake_user():
        return {"id": "user_demo_0001", "username": "demo", "role": "user"}

    main.app.dependency_overrides[main.get_current_user] = fake_user

    with TestClient(main.app) as tc:
        yield tc

    main.app.dependency_overrides.clear()
    monkeypatch_auth.stop()
    monkeypatch_db.stop()


def test_health(client):
    resp = client.get("/health")
    assert resp.status_code == 200
    data = resp.json()
    assert data["service"] == "namma-reconstruction"
    assert "database" in data


def test_project_crud(client):
    # Create
    resp = client.post(
        "/api/projects",
        json={
            "payload": {
                "name": "Test Apartment",
                "space_type": "Apartment",
                "units": "metres",
                "floor_area": 100.0,
                "ceiling_height": 2.85,
            }
        },
    )
    assert resp.status_code == 201, resp.text
    project = resp.json()["project"]
    proj_id = project["id"]
    assert project["name"] == "Test Apartment"

    # List
    resp = client.get("/api/projects")
    assert resp.status_code == 200
    assert len(resp.json()["projects"]) >= 1

    # Get
    resp = client.get(f"/api/projects/{proj_id}")
    assert resp.status_code == 200
    assert resp.json()["project"]["id"] == proj_id

    # Patch
    resp = client.patch(
        f"/api/projects/{proj_id}",
        json={"payload": {"name": "Updated Apartment", "status": "Completed"}},
    )
    assert resp.status_code == 200
    assert resp.json()["project"]["name"] == "Updated Apartment"
    assert resp.json()["project"]["status"] == "Completed"

    # Delete
    resp = client.delete(f"/api/projects/{proj_id}")
    assert resp.status_code == 200
    assert resp.json()["deleted"] is True


def test_room_crud(client):
    # Create project first
    resp = client.post(
        "/api/projects",
        json={"payload": {"name": "Room Test Project", "space_type": "Office"}},
    )
    proj_id = resp.json()["project"]["id"]

    # Create room
    resp = client.post(
        "/api/rooms",
        json={
            "payload": {
                "project_id": proj_id,
                "name": "Living Room",
                "category": "Living",
                "length_meters": 6.0,
                "width_meters": 4.0,
                "height_meters": 2.85,
                "origin_description": "SW corner",
            }
        },
    )
    assert resp.status_code == 201, resp.text
    room = resp.json()["room"]
    room_id = room["id"]
    assert room["name"] == "Living Room"

    # List rooms for project
    resp = client.get(f"/api/rooms?project_id={proj_id}")
    assert resp.status_code == 200
    assert any(r["id"] == room_id for r in resp.json()["rooms"])

    # Get room
    resp = client.get(f"/api/rooms/{room_id}")
    assert resp.status_code == 200

    # Update room
    resp = client.patch(
        f"/api/rooms/{room_id}",
        json={"payload": {"length_meters": 7.0, "category": "Living Room"}},
    )
    assert resp.status_code == 200
    assert resp.json()["room"]["length_meters"] == 7.0

    # Delete room
    resp = client.delete(f"/api/rooms/{room_id}")
    assert resp.status_code == 200


def test_doorway_crud(client):
    resp = client.post(
        "/api/projects",
        json={"payload": {"name": "Doorway Test Project"}},
    )
    proj_id = resp.json()["project"]["id"]

    # Create two rooms
    r1 = client.post(
        "/api/rooms",
        json={
            "payload": {
                "project_id": proj_id,
                "name": "Room A",
                "length_meters": 5.0,
                "width_meters": 4.0,
                "height_meters": 2.85,
            }
        },
    ).json()["room"]
    r2 = client.post(
        "/api/rooms",
        json={
            "payload": {
                "project_id": proj_id,
                "name": "Room B",
                "length_meters": 5.0,
                "width_meters": 4.0,
                "height_meters": 2.85,
            }
        },
    ).json()["room"]

    # Create doorway
    resp = client.post(
        "/api/doorways",
        json={
            "payload": {
                "project_id": proj_id,
                "name": "Door A-B",
                "connected_room_ids": [r1["id"], r2["id"]],
                "width_meters": 0.9,
                "height_meters": 2.1,
                "wall_location": "east",
            }
        },
    )
    assert resp.status_code == 201, resp.text
    door = resp.json()["doorway"]
    door_id = door["id"]
    assert door["width_meters"] == 0.9

    # List doorways
    resp = client.get(f"/api/doorways?project_id={proj_id}")
    assert resp.status_code == 200
    assert any(d["id"] == door_id for d in resp.json()["doorways"])

    # Update doorway
    resp = client.patch(
        f"/api/doorways/{door_id}",
        json={"payload": {"width_meters": 1.1}},
    )
    assert resp.status_code == 200
    assert resp.json()["doorway"]["width_meters"] == 1.1

    # Delete doorway
    resp = client.delete(f"/api/doorways/{door_id}")
    assert resp.status_code == 200


def test_photo_crud(client):
    resp = client.post(
        "/api/projects",
        json={"payload": {"name": "Photo Test Project"}},
    )
    proj_id = resp.json()["project"]["id"]

    room = client.post(
        "/api/rooms",
        json={
            "payload": {
                "project_id": proj_id,
                "name": "Test Room",
                "length_meters": 5.0,
                "width_meters": 4.0,
                "height_meters": 2.85,
            }
        },
    ).json()["room"]

    resp = client.post(
        "/api/photos",
        json={
            "payload": {
                "project_id": proj_id,
                "room_id": room["id"],
                "filename": "R01_PassA_001.jpg",
                "pass": "Pass A",
                "modality": "Still Photograph",
                "sharpness_score": 92,
                "exposure_review": "Good",
                "overlap_review": "Sufficient (>70%)",
            }
        },
    )
    assert resp.status_code == 201, resp.text
    photo = resp.json()["photo"]
    photo_id = photo["id"]
    assert photo["filename"] == "R01_PassA_001.jpg"

    # List photos
    resp = client.get(f"/api/photos?room_id={room['id']}")
    assert resp.status_code == 200
    assert any(p["id"] == photo_id for p in resp.json()["photos"])

    # Get photo
    resp = client.get(f"/api/photos/{photo_id}")
    assert resp.status_code == 200

    # Update photo
    resp = client.patch(
        f"/api/photos/{photo_id}",
        json={"payload": {"sharpness_score": 95}},
    )
    assert resp.status_code == 200
    assert resp.json()["photo"]["sharpness_score"] == 95

    # Delete photo
    resp = client.delete(f"/api/photos/{photo_id}")
    assert resp.status_code == 200
