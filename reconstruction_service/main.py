"""
FastAPI reconstruction job service with SQLite persistence, CRUD for
projects/rooms/doorways/photos, optional authentication, and structured
progress tracking.

Endpoints
---------
Auth (when DART_ENABLE_AUTH=true):
  POST   /api/auth/register
  POST   /api/auth/login
  POST   /api/auth/logout
  GET    /api/auth/me

Projects:
  GET    /api/projects
  POST   /api/projects
  GET    /api/projects/{id}
  PATCH  /api/projects/{id}
  DELETE /api/projects/{id}

Rooms:
  GET    /api/rooms?project_id=...
  POST   /api/rooms
  GET    /api/rooms/{id}
  PUT    /api/rooms/{id}
  PATCH  /api/rooms/{id}
  DELETE /api/rooms/{id}

Doorways:
  GET    /api/doorways?project_id=...
  POST   /api/doorways
  GET    /api/doorways/{id}
  PUT    /api/doorways/{id}
  PATCH  /api/doorways/{id}
  DELETE /api/doorways/{id}

Photos:
  GET    /api/photos?room_id=&pass=&project_id=
  POST   /api/photos
  GET    /api/photos/{id}
  PUT    /api/photos/{id}
  PATCH  /api/photos/{id}
  DELETE /api/photos/{id}

Jobs:
  GET    /health                              service + engine availability
  POST   /v1/jobs                             upload photos, queue a job
  GET    /v1/jobs?projectId=...               list jobs for a space
  GET    /v1/jobs/{job_id}                    job status, progress, result stats
  GET    /v1/jobs/{job_id}/assets/{path}      reconstructed .ply assets
  GET    /v1/jobs/{job_id}/log                human-readable pipeline log
  DELETE /v1/jobs/{job_id}                    remove job files and assets

Jobs are persisted both as JSON under data/reconstructions and as SQLite
records so the UI can reconnect after a reload. Reconstruction runs on one
background worker.
"""

from __future__ import annotations

import json
import os
import shutil
import sqlite3
import threading
import time
import traceback
import uuid
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import quote

from fastapi import (
    Body,
    Depends,
    FastAPI,
    File,
    Form,
    HTTPException,
    UploadFile,
    status,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, PlainTextResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from PIL import Image

try:  # Support both `python -m reconstruction_service.main` and direct runs.
    from .auth import (
        ENABLE_AUTH,
        _hash_password,
        _verify_password,
        cleanup_expired_sessions,
        create_session_token,
        destroy_session_token,
        get_current_user,
        init_auth,
        require_admin,
        security,
    )
    from .db import (
        dict_from_row,
        get_connection,
        init_db,
        now_iso,
        transaction,
    )
    from .models import (
        DoorwayCreate,
        DoorwayResponse,
        DoorwayUpdate,
        JobResponse,
        PhotoCreate,
        PhotoResponse,
        PhotoUpdate,
        ProjectCreate,
        ProjectResponse,
        ProjectUpdate,
        RoomCreate,
        RoomResponse,
        RoomUpdate,
    )
    from .pipeline import (
        PIPELINE_VERSION,
        ReconstructionError,
        find_brush,
        reconstruct,
    )
except ImportError:  # pragma: no cover
    from auth import (
        ENABLE_AUTH,
        cleanup_expired_sessions,
        create_session_token,
        destroy_session_token,
        get_current_user,
        init_auth,
        require_admin,
        security,
    )
    from db import (
        dict_from_row,
        get_connection,
        init_db,
        now_iso,
        transaction,
    )
    from models import (
        DoorwayCreate,
        DoorwayResponse,
        DoorwayUpdate,
        JobResponse,
        PhotoCreate,
        PhotoResponse,
        PhotoUpdate,
        ProjectCreate,
        ProjectResponse,
        ProjectUpdate,
        RoomCreate,
        RoomResponse,
        RoomUpdate,
    )
    from pipeline import (
        PIPELINE_VERSION,
        ReconstructionError,
        find_brush,
        reconstruct,
    )

SERVICE_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SERVICE_DIR.parent
DATA_ENV = os.getenv("DART_RECONSTRUCTION_DATA", "").strip()
if DATA_ENV:
    DATA_ROOT = Path(os.path.expanduser(DATA_ENV))
    if not DATA_ROOT.is_absolute():
        DATA_ROOT = (PROJECT_ROOT / DATA_ROOT).resolve()
else:
    DATA_ROOT = (PROJECT_ROOT / "data" / "reconstructions").resolve()

DATA_ROOT.mkdir(parents=True, exist_ok=True)

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

def _int_env_unlimited(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)))
    except (TypeError, ValueError):
        return default


# 0 = no limit. Users may upload in as many parts/batches as they need.
MAX_PHOTOS = _int_env_unlimited("DART_MAX_PHOTOS", 0)
MAX_FILE_BYTES = max(1, int(os.getenv("DART_MAX_FILE_MB", "40"))) * 1024 * 1024
MAX_TOTAL_BYTES = _int_env_unlimited("DART_MAX_TOTAL_MB", 0) * 1024 * 1024
ALLOWED_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff"}

PROJECTS_ROOT = (DATA_ROOT / "projects").resolve()
Image.MAX_IMAGE_PIXELS = 160_000_000

# Allowed CORS origins — restrictive by default, overridable via env.
_allowed_origins_env = os.getenv("DART_ALLOWED_ORIGINS", "*").strip()
ALLOWED_ORIGINS = (
    ["*"]
    if _allowed_origins_env == "*"
    else [o.strip() for o in _allowed_origins_env.split(",") if o.strip()]
)


# ---------------------------------------------------------------------------
# Database initialization
# ---------------------------------------------------------------------------

def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _append_log(path: Path, message: str) -> None:
    try:
        with path.open("a", encoding="utf-8") as handle:
            handle.write(f"[{_utc_now()}] {message}\n")
    except OSError:
        pass


# ---------------------------------------------------------------------------
# Job store (JSON-based, persists across reloads) — kept for compatibility
# ---------------------------------------------------------------------------

class JobStore:
    """Small thread-safe JSON job store (supplements SQLite job records)."""

    def __init__(self, root: Path):
        self.root = root
        self.root.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        self._jobs: dict[str, dict[str, Any]] = {}
        self._load()

    def _load(self) -> None:
        for job_file in sorted(self.root.glob("*/job.json")):
            try:
                job = json.loads(job_file.read_text(encoding="utf-8"))
                job_id = str(job.get("id") or job_file.parent.name)
                if not job_id:
                    continue
            except (OSError, ValueError):
                continue
            if job.get("status") in {"queued", "running"}:
                job.update(
                    status="failed",
                    stage="failed",
                    progress=int(job.get("progress") or 0),
                    message="The reconstruction service restarted before this job finished. Start the scan again.",
                    error="Reconstruction service restarted before the job finished.",
                    finishedAt=_utc_now(),
                    updatedAt=_utc_now(),
                )
                self._write(job)
                _append_log(
                    self.job_dir(job_id) / "job.log",
                    "Service restarted while this job was active; marked as failed.",
                )
            self._jobs[job_id] = job

    def _write(self, job: dict[str, Any]) -> None:
        job_file = self.job_dir(job["id"]) / "job.json"
        job_file.parent.mkdir(parents=True, exist_ok=True)
        temporary = job_file.with_suffix(".json.tmp")
        temporary.write_text(
            json.dumps(job, indent=2, ensure_ascii=False), encoding="utf-8"
        )
        os.replace(temporary, job_file)

    def job_dir(self, job_id: str) -> Path:
        return self.root / job_id

    def create(self, job: dict[str, Any]) -> dict[str, Any]:
        with self._lock:
            now = _utc_now()
            job.setdefault("createdAt", now)
            job["updatedAt"] = now
            self._jobs[job["id"]] = job
            self._write(job)
            # Also persist to SQLite
            _upsert_sqlite_job(job)
            return dict(job)

    def update(self, job_id: str, **changes: Any) -> dict[str, Any] | None:
        with self._lock:
            job = self._jobs.get(job_id)
            if job is None:
                return None
            job.update(changes)
            job["updatedAt"] = _utc_now()
            self._write(job)
            _upsert_sqlite_job(job)
            return dict(job)

    def get(self, job_id: str) -> dict[str, Any] | None:
        with self._lock:
            job = self._jobs.get(job_id)
            return dict(job) if job else None

    def delete(self, job_id: str) -> bool:
        with self._lock:
            if job_id not in self._jobs:
                return False
            self._jobs.pop(job_id, None)
            shutil.rmtree(self.job_dir(job_id), ignore_errors=True)
            # Remove from SQLite
            with transaction() as conn:
                conn.execute("DELETE FROM jobs WHERE id = ?", (job_id,))
            return True

    def list(self, project_id: str | None = None, limit: int = 50) -> list[dict[str, Any]]:
        with self._lock:
            jobs = [
                dict(job)
                for job in self._jobs.values()
                if not project_id or job.get("projectId") == project_id
            ]
        jobs.sort(key=lambda item: item.get("createdAt", ""), reverse=True)
        return jobs[: max(1, min(limit, 200))]

    def active_count(self) -> int:
        with self._lock:
            return sum(
                1
                for job in self._jobs.values()
                if job.get("status") in {"queued", "running"}
            )


def _upsert_sqlite_job(job: dict[str, Any]) -> None:
    """Mirror a job dict into the SQLite jobs table."""
    try:
        with transaction() as conn:
            conn.execute(
                """
                INSERT INTO jobs (id, project_id, status, stage, progress, message,
                                  input_count, created_at, updated_at, started_at,
                                  finished_at, stats, assets, error)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    project_id=excluded.project_id,
                    status=excluded.status,
                    stage=excluded.stage,
                    progress=excluded.progress,
                    message=excluded.message,
                    input_count=excluded.input_count,
                    updated_at=excluded.updated_at,
                    started_at=excluded.started_at,
                    finished_at=excluded.finished_at,
                    stats=excluded.stats,
                    assets=excluded.assets,
                    error=excluded.error
                """,
                (
                    job.get("id"),
                    job.get("projectId"),
                    job.get("status"),
                    job.get("stage"),
                    int(job.get("progress") or 0),
                    job.get("message", ""),
                    int(job.get("inputCount") or 0),
                    job.get("createdAt"),
                    job.get("updatedAt"),
                    job.get("startedAt"),
                    job.get("finishedAt"),
                    json.dumps(job.get("stats")) if job.get("stats") else None,
                    json.dumps(job.get("assets")) if job.get("assets") else None,
                    job.get("error"),
                ),
            )
    except Exception:
        # SQLite job mirroring is best-effort; JSON store is source of truth.
        pass


def _sqlite_job_to_public(job_row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": job_row["id"],
        "projectId": job_row.get("project_id"),
        "status": job_row["status"],
        "stage": job_row["stage"],
        "progress": int(job_row["progress"] or 0),
        "message": job_row.get("message", ""),
        "inputCount": int(job_row["input_count"] or 0),
        "createdAt": job_row.get("created_at"),
        "updatedAt": job_row.get("updated_at"),
        "startedAt": job_row.get("started_at"),
        "finishedAt": job_row.get("finished_at"),
        "stats": json.loads(job_row["stats"]) if job_row.get("stats") else None,
        "assets": json.loads(job_row["assets"]) if job_row.get("assets") else None,
        "error": job_row.get("error"),
    }


STORE = JobStore(DATA_ROOT)
EXECUTOR = ThreadPoolExecutor(max_workers=1, thread_name_prefix="dart-reconstruction")
CANCEL_FLAGS: dict[str, bool] = {}


# ---------------------------------------------------------------------------
# Asset URL helpers
# ---------------------------------------------------------------------------

def _asset_urls(job: dict[str, Any]) -> dict[str, str]:
    job_id = job["id"]
    assets = job.get("assets") or {}
    return {
        key: f"/v1/jobs/{job_id}/assets/{quote(str(filename))}"
        for key, filename in assets.items()
        if filename
    }


def _public_job(job: dict[str, Any]) -> dict[str, Any]:
    public = {key: value for key, value in job.items() if key != "assets"}
    public["assetUrls"] = _asset_urls(job)
    public["logUrl"] = f"/v1/jobs/{job['id']}/log"
    return public


# ---------------------------------------------------------------------------
# Reconstruction worker
# ---------------------------------------------------------------------------

def _run_job(job_id: str) -> None:
    job = STORE.get(job_id)
    if job is None:
        return
    job_dir = STORE.job_dir(job_id)
    log_path = job_dir / "job.log"
    inputs_dir = job_dir / "input"
    work_dir = job_dir / "work"
    assets_dir = job_dir / "assets"

    STORE.update(
        job_id,
        status="running",
        stage="starting",
        progress=1,
        message="Starting photoreal reconstruction",
        startedAt=_utc_now(),
        error=None,
    )
    _append_log(log_path, f"Worker started for project {job.get('projectId') or '(none)'}")

    cancelled = lambda: bool(CANCEL_FLAGS.get(job_id, False))

    def progress(stage: str, percent: int, message: str) -> None:
        STORE.update(
            job_id,
            status="running",
            stage=stage,
            progress=max(0, min(99, int(percent))),
            message=message,
        )

    try:
        image_files = sorted(
            path for path in inputs_dir.iterdir() if path.is_file()
        ) if inputs_dir.exists() else []
        stats = reconstruct(
            images=image_files,
            work_dir=work_dir,
            assets_dir=assets_dir,
            log_path=log_path,
            progress=progress,
            cancel=cancelled,
        )

        assets: dict[str, str] = {}
        if (assets_dir / "scene.ply").is_file():
            stats["splatUrl"] = f"/v1/jobs/{job_id}/assets/scene.ply"
            assets["splat"] = "scene.ply"
        else:
            stats["splatUrl"] = None
        if (assets_dir / "point-cloud.ply").is_file():
            stats["pointCloudUrl"] = f"/v1/jobs/{job_id}/assets/point-cloud.ply"
            assets["pointCloud"] = "point-cloud.ply"
        else:
            stats["pointCloudUrl"] = None
        if (assets_dir / "mesh.glb").is_file():
            stats["meshUrl"] = f"/v1/jobs/{job_id}/assets/mesh.glb"
            assets["mesh"] = "mesh.glb"
        elif (assets_dir / "mesh.ply").is_file():
            stats["meshUrl"] = f"/v1/jobs/{job_id}/assets/mesh.ply"
            assets["mesh"] = "mesh.ply"
        else:
            stats["meshUrl"] = None

        stats["jobId"] = job_id
        stats["jobStatus"] = "completed"
        if assets:
            (assets_dir / "manifest.json").write_text(
                json.dumps(stats, indent=2, ensure_ascii=False), encoding="utf-8"
            )
            assets["manifest"] = "manifest.json"

        splat_count = int(stats.get("splatCount") or 0)
        if splat_count:
            message = (
                f"Photoreal scan ready — {splat_count:,} Gaussian splats from "
                f"{stats.get('registeredImages', 0)} cameras"
            )
        else:
            message = (
                f"COLMAP scan ready — {stats.get('sparsePoints', 0):,} sparse points "
                "from "
                f"{stats.get('registeredImages', 0)} cameras. "
                "Install Brush for Gaussian splats."
            )

        STORE.update(
            job_id,
            status="completed",
            stage="complete",
            progress=100,
            message=message,
            stats=stats,
            assets=assets,
            finishedAt=_utc_now(),
            error=None,
        )
        _append_log(log_path, message)
    except ReconstructionError as exc:
        message = str(exc)
        STORE.update(
            job_id,
            status="failed",
            stage="failed",
            message=message,
            error=message,
            finishedAt=_utc_now(),
        )
        _append_log(log_path, f"Job failed: {message}")
    except Exception as exc:  # noqa: BLE001
        message = f"Reconstruction failed unexpectedly: {exc}"
        STORE.update(
            job_id,
            status="failed",
            stage="failed",
            message=message,
            error=message,
            finishedAt=_utc_now(),
        )
        _append_log(log_path, "Job failed:\n" + traceback.format_exc())
    finally:
        CANCEL_FLAGS.pop(job_id, None)
        keep_work = os.getenv("DART_KEEP_WORK", "").lower() in {"1", "true", "yes"}
        if not keep_work:
            shutil.rmtree(work_dir, ignore_errors=True)
            shutil.rmtree(inputs_dir, ignore_errors=True)


# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(_: FastAPI):
    DATA_ROOT.mkdir(parents=True, exist_ok=True)
    init_db()
    init_auth()
    cleanup_expired_sessions()
    yield
    EXECUTOR.shutdown(wait=False, cancel_futures=True)


app = FastAPI(
    title="Namma Space Reconstruction Service",
    version="0.1.0",
    description=(
        "Local COLMAP structure-from-motion and Brush Gaussian-splatting "
        "pipeline for user-uploaded interior photos."
    ),
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=ENABLE_AUTH,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Length", "Content-Range", "Accept-Ranges"],
    max_age=86400,
)


# ---------------------------------------------------------------------------
# Auth endpoints
# ---------------------------------------------------------------------------

@app.post("/api/auth/register", status_code=status.HTTP_201_CREATED)
async def auth_register(
    username: str = Form(...),
    email: str = Form(...),
    password: str = Form(...),
    _user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    if not ENABLE_AUTH:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Self-registration is disabled in demo mode.",
        )
    if len(password) < 6:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Password must be at least 6 characters.",
        )
    password_hash, salt_hex = _hash_password(password)
    user_id = f"user_{uuid.uuid4().hex[:16]}"
    try:
        with transaction() as conn:
            conn.execute(
                """
                INSERT INTO users (id, username, email, password_hash, salt, role, created_at)
                VALUES (?, ?, ?, ?, ?, 'user', ?)
                """,
                (user_id, username.strip(), email.lower().strip(), password_hash, salt_hex, _utc_now()),
            )
    except sqlite3.IntegrityError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Username or email already exists.",
        )
    token = create_session_token(user_id)
    return {
        "ok": True,
        "user": {"id": user_id, "username": username.strip(), "email": email.lower().strip(), "role": "user"},
        "session_token": token,
    }


@app.post("/api/auth/login")
async def auth_login(
    username: str = Form(...),
    password: str = Form(...),
) -> dict[str, Any]:
    with transaction() as conn:
        row = conn.execute(
            "SELECT id, username, email, password_hash, salt, role FROM users WHERE username = ? OR email = ?",
            (username.strip(), username.lower().strip()),
        ).fetchone()
    if row is None or not _verify_password(password, row["password_hash"], row["salt"]):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials.",
        )
    token = create_session_token(row["id"])
    with transaction() as conn:
        conn.execute("UPDATE users SET last_login = ? WHERE id = ?", (_utc_now(), row["id"]))
    return {
        "ok": True,
        "user": {"id": row["id"], "username": row["username"], "email": row["email"], "role": row["role"]},
        "session_token": token,
    }


@app.post("/api/auth/logout")
async def auth_logout(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
) -> dict[str, Any]:
    if credentials is not None:
        destroy_session_token(credentials.credentials)
    return {"ok": True}


@app.get("/api/auth/me")
async def auth_me(user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    return {"ok": True, "user": user}


# ---------------------------------------------------------------------------
# Project CRUD
# ---------------------------------------------------------------------------

@app.get("/api/projects", response_model=dict[str, Any])
def list_projects(user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    with transaction() as conn:
        rows = conn.execute(
            "SELECT * FROM projects ORDER BY updated_at DESC"
        ).fetchall()
    return {"ok": True, "projects": [dict_from_row(r) for r in rows]}


@app.post("/api/projects", response_model=dict[str, Any], status_code=status.HTTP_201_CREATED)
def create_project(
    payload: ProjectCreate = Body(..., embed=False),
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    proj_id = f"proj_{uuid.uuid4().hex[:16]}"
    now = _utc_now()
    with transaction() as conn:
        conn.execute(
            """
            INSERT INTO projects (id, name, description, space_type, units, floor_area,
                                  ceiling_height, capture_method, status, created_at,
                                  updated_at, photo_count, room_count, video_count,
                                  reconstruction_engine, reconstruction_progress,
                                  last_error_message, reconstruction_model_stats)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                proj_id,
                payload.name.strip(),
                payload.description,
                payload.space_type,
                payload.units,
                payload.floor_area,
                payload.ceiling_height,
                payload.capture_method,
                payload.status,
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
    row = _get_project_by_id(proj_id)
    if row is None:
        raise HTTPException(status_code=500, detail="Failed to create project.")
    return {"ok": True, "project": dict_from_row(row)}


@app.get("/api/projects/{proj_id}")
def get_project(proj_id: str, user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    row = _get_project_by_id(proj_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Project not found.")
    return {"ok": True, "project": dict_from_row(row)}


@app.patch("/api/projects/{proj_id}")
def update_project(
    proj_id: str,
    payload: ProjectUpdate = Body(..., embed=False),
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    row = _get_project_by_id(proj_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Project not found.")
    updates = []
    values = []
    data = payload.model_dump(exclude_unset=True)
    col_map = {
        "name": "name",
        "description": "description",
        "space_type": "space_type",
        "units": "units",
        "floor_area": "floor_area",
        "ceiling_height": "ceiling_height",
        "capture_method": "capture_method",
        "status": "status",
        "photo_count": "photo_count",
        "room_count": "room_count",
        "video_count": "video_count",
        "reconstruction_engine": "reconstruction_engine",
        "reconstruction_progress": "reconstruction_progress",
        "last_error_message": "last_error_message",
        "reconstruction_model_stats": "reconstruction_model_stats",
    }
    for key, val in data.items():
        col = col_map.get(key)
        if col is None:
            continue
        if col == "reconstruction_model_stats" and val is not None:
            val = json.dumps(val)
        updates.append(f"{col} = ?")
        values.append(val)
    if not updates:
        raise HTTPException(status_code=400, detail="No updatable fields provided.")
    updates.append("updated_at = ?")
    values.append(_utc_now())
    values.append(proj_id)
    with transaction() as conn:
        conn.execute(f"UPDATE projects SET {', '.join(updates)} WHERE id = ?", values)
    row = _get_project_by_id(proj_id)
    return {"ok": True, "project": dict_from_row(row)}


@app.delete("/api/projects/{proj_id}")
def delete_project(proj_id: str, user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    row = _get_project_by_id(proj_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Project not found.")
    with transaction() as conn:
        conn.execute("DELETE FROM projects WHERE id = ?", (proj_id,))
    return {"ok": True, "id": proj_id, "deleted": True}


def _get_project_by_id(proj_id: str) -> Any:
    with transaction() as conn:
        return conn.execute("SELECT * FROM projects WHERE id = ?", (proj_id,)).fetchone()


# ---------------------------------------------------------------------------
# Room CRUD
# ---------------------------------------------------------------------------

@app.get("/api/rooms")
def list_rooms(
    project_id: str | None = None,
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    with transaction() as conn:
        if project_id:
            rows = conn.execute(
                "SELECT * FROM rooms WHERE project_id = ? ORDER BY name", (project_id,)
            ).fetchall()
        else:
            rows = conn.execute("SELECT * FROM rooms ORDER BY name").fetchall()
    return {"ok": True, "rooms": [dict_from_row(r) for r in rows]}


@app.post("/api/rooms", response_model=dict[str, Any], status_code=status.HTTP_201_CREATED)
def create_room(
    payload: RoomCreate = Body(..., embed=False),
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    room_id = f"room_{uuid.uuid4().hex[:16]}"
    now = _utc_now()
    with transaction() as conn:
        conn.execute(
            """
            INSERT INTO rooms (id, project_id, name, category, length_meters,
                               width_meters, height_meters, origin_description,
                               coordinate_convention, connected_doorway_ids, features,
                               created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                room_id,
                payload.project_id,
                payload.name.strip(),
                payload.category,
                payload.length_meters,
                payload.width_meters,
                payload.height_meters,
                payload.origin_description,
                payload.coordinate_convention,
                json.dumps(payload.connected_doorway_ids),
                json.dumps(payload.features),
                now,
                now,
            ),
        )
    row = _get_room_by_id(room_id)
    if row is None:
        raise HTTPException(status_code=500, detail="Failed to create room.")
    return {"ok": True, "room": dict_from_row(row)}


@app.get("/api/rooms/{room_id}")
def get_room(room_id: str, user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    row = _get_room_by_id(room_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Room not found.")
    return {"ok": True, "room": dict_from_row(row)}


@app.put("/api/rooms/{room_id}")
@app.patch("/api/rooms/{room_id}")
def update_room(
    room_id: str,
    payload: RoomUpdate = Body(..., embed=False),
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    row = _get_room_by_id(room_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Room not found.")
    updates = []
    values = []
    data = payload.model_dump(exclude_unset=True)
    col_map = {
        "name": "name",
        "category": "category",
        "length_meters": "length_meters",
        "width_meters": "width_meters",
        "height_meters": "height_meters",
        "origin_description": "origin_description",
        "coordinate_convention": "coordinate_convention",
        "connected_doorway_ids": "connected_doorway_ids",
        "features": "features",
        "reconstruction_dimension_estimate": "reconstruction_dimension_estimate",
    }
    for key, val in data.items():
        col = col_map.get(key)
        if col is None:
            continue
        if col in ("connected_doorway_ids", "features", "reconstruction_dimension_estimate") and val is not None:
            val = json.dumps(val)
        updates.append(f"{col} = ?")
        values.append(val)
    if not updates:
        raise HTTPException(status_code=400, detail="No updatable fields provided.")
    updates.append("updated_at = ?")
    values.append(_utc_now())
    values.append(room_id)
    with transaction() as conn:
        conn.execute(f"UPDATE rooms SET {', '.join(updates)} WHERE id = ?", values)
    row = _get_room_by_id(room_id)
    return {"ok": True, "room": dict_from_row(row)}


@app.delete("/api/rooms/{room_id}")
def delete_room(room_id: str, user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    row = _get_room_by_id(room_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Room not found.")
    with transaction() as conn:
        conn.execute("DELETE FROM rooms WHERE id = ?", (room_id,))
    return {"ok": True, "id": room_id, "deleted": True}


def _get_room_by_id(room_id: str) -> Any:
    with transaction() as conn:
        return conn.execute("SELECT * FROM rooms WHERE id = ?", (room_id,)).fetchone()


# ---------------------------------------------------------------------------
# Doorway CRUD
# ---------------------------------------------------------------------------

@app.get("/api/doorways")
def list_doorways(
    project_id: str | None = None,
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    with transaction() as conn:
        if project_id:
            rows = conn.execute(
                "SELECT * FROM doorways WHERE project_id = ? ORDER BY id", (project_id,)
            ).fetchall()
        else:
            rows = conn.execute("SELECT * FROM doorways ORDER BY id").fetchall()
    return {"ok": True, "doorways": [dict_from_row(r) for r in rows]}


@app.post("/api/doorways", response_model=dict[str, Any], status_code=status.HTTP_201_CREATED)
def create_doorway(
    payload: DoorwayCreate = Body(..., embed=False),
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    door_id = f"door_{uuid.uuid4().hex[:16]}"
    now = _utc_now()
    with transaction() as conn:
        conn.execute(
            """
            INSERT INTO doorways (id, project_id, name, connected_room_ids,
                                  width_meters, height_meters, wall_location,
                                  offset_meters, has_clear_line_of_sight,
                                  observations, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                door_id,
                payload.project_id,
                payload.name.strip(),
                json.dumps(payload.connected_room_ids),
                payload.width_meters,
                payload.height_meters,
                payload.wall_location,
                payload.offset_meters,
                1 if payload.has_clear_line_of_sight else 0,
                json.dumps(payload.observations),
                now,
                now,
            ),
        )
    row = _get_doorway_by_id(door_id)
    if row is None:
        raise HTTPException(status_code=500, detail="Failed to create doorway.")
    return {"ok": True, "doorway": dict_from_row(row)}


@app.get("/api/doorways/{door_id}")
def get_doorway(door_id: str, user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    row = _get_doorway_by_id(door_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Doorway not found.")
    return {"ok": True, "doorway": dict_from_row(row)}


@app.put("/api/doorways/{door_id}")
@app.patch("/api/doorways/{door_id}")
def update_doorway(
    door_id: str,
    payload: DoorwayUpdate = Body(..., embed=False),
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    row = _get_doorway_by_id(door_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Doorway not found.")
    updates = []
    values = []
    data = payload.model_dump(exclude_unset=True)
    col_map = {
        "name": "name",
        "connected_room_ids": "connected_room_ids",
        "width_meters": "width_meters",
        "height_meters": "height_meters",
        "wall_location": "wall_location",
        "offset_meters": "offset_meters",
        "has_clear_line_of_sight": "has_clear_line_of_sight",
        "observations": "observations",
    }
    for key, val in data.items():
        col = col_map.get(key)
        if col is None:
            continue
        if col in ("connected_room_ids", "observations") and val is not None:
            val = json.dumps(val)
        if col == "has_clear_line_of_sight" and val is not None:
            val = 1 if val else 0
        updates.append(f"{col} = ?")
        values.append(val)
    if not updates:
        raise HTTPException(status_code=400, detail="No updatable fields provided.")
    updates.append("updated_at = ?")
    values.append(_utc_now())
    values.append(door_id)
    with transaction() as conn:
        conn.execute(f"UPDATE doorways SET {', '.join(updates)} WHERE id = ?", values)
    row = _get_doorway_by_id(door_id)
    return {"ok": True, "doorway": dict_from_row(row)}


@app.delete("/api/doorways/{door_id}")
def delete_doorway(door_id: str, user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    row = _get_doorway_by_id(door_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Doorway not found.")
    with transaction() as conn:
        conn.execute("DELETE FROM doorways WHERE id = ?", (door_id,))
    return {"ok": True, "id": door_id, "deleted": True}


def _get_doorway_by_id(door_id: str) -> Any:
    with transaction() as conn:
        return conn.execute("SELECT * FROM doorways WHERE id = ?", (door_id,)).fetchone()


# ---------------------------------------------------------------------------
# Photo CRUD
# ---------------------------------------------------------------------------

@app.get("/api/photos")
def list_photos(
    room_id: str | None = None,
    pass_label: str | None = None,
    project_id: str | None = None,
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    with transaction() as conn:
        query = "SELECT * FROM photos WHERE 1=1"
        params: list[Any] = []
        if room_id:
            query += " AND room_id = ?"
            params.append(room_id)
        if pass_label:
            query += " AND pass = ?"
            params.append(pass_label)
        if project_id:
            query += " AND project_id = ?"
            params.append(project_id)
        query += " ORDER BY timestamp DESC"
        rows = conn.execute(query, params).fetchall()
    return {"ok": True, "photos": [dict_from_row(r) for r in rows]}


@app.post("/api/photos", response_model=dict[str, Any], status_code=status.HTTP_201_CREATED)
def create_photo(
    payload: PhotoCreate = Body(..., embed=False),
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    photo_id = f"photo_{uuid.uuid4().hex[:16]}"
    now = _utc_now()
    with transaction() as conn:
        conn.execute(
            """
            INSERT INTO photos (id, project_id, room_id, filename, pass, modality,
                                camera_pose_tag, focal_length_mm, sharpness_score,
                                exposure_review, overlap_review, occlusion_flag,
                                doorway_anchor_id, reviewer_notes, timestamp,
                                is_automated_metric, image_url, dominant_color,
                                spatial_pose, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                photo_id,
                payload.project_id,
                payload.room_id,
                payload.filename.strip(),
                payload.pass_label,
                payload.modality,
                payload.camera_pose_tag,
                payload.focal_length_mm,
                payload.sharpness_score,
                payload.exposure_review,
                payload.overlap_review,
                1 if payload.occlusion_flag else 0,
                payload.doorway_anchor_id,
                payload.reviewer_notes,
                payload.timestamp or now,
                1 if payload.is_automated_metric else 0,
                payload.image_url,
                payload.dominant_color,
                json.dumps(payload.spatial_pose) if payload.spatial_pose else None,
                now,
                now,
            ),
        )
    row = _get_photo_by_id(photo_id)
    if row is None:
        raise HTTPException(status_code=500, detail="Failed to create photo.")
    return {"ok": True, "photo": dict_from_row(row)}


@app.get("/api/photos/{photo_id}")
def get_photo(photo_id: str, user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    row = _get_photo_by_id(photo_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Photo not found.")
    return {"ok": True, "photo": dict_from_row(row)}


@app.put("/api/photos/{photo_id}")
@app.patch("/api/photos/{photo_id}")
def update_photo(
    photo_id: str,
    payload: PhotoUpdate = Body(..., embed=False),
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    row = _get_photo_by_id(photo_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Photo not found.")
    updates = []
    values = []
    data = payload.model_dump(exclude_unset=True)
    col_map = {
        "filename": "filename",
        "room_id": "room_id",
        "pass_label": "pass",
        "modality": "modality",
        "camera_pose_tag": "camera_pose_tag",
        "focal_length_mm": "focal_length_mm",
        "sharpness_score": "sharpness_score",
        "exposure_review": "exposure_review",
        "overlap_review": "overlap_review",
        "occlusion_flag": "occlusion_flag",
        "doorway_anchor_id": "doorway_anchor_id",
        "reviewer_notes": "reviewer_notes",
        "timestamp": "timestamp",
        "is_automated_metric": "is_automated_metric",
        "image_url": "image_url",
        "dominant_color": "dominant_color",
        "spatial_pose": "spatial_pose",
    }
    for key, val in data.items():
        col = col_map.get(key)
        if col is None:
            continue
        if col in ("occlusion_flag", "is_automated_metric") and val is not None:
            val = 1 if val else 0
        if col == "spatial_pose" and val is not None:
            val = json.dumps(val)
        updates.append(f"{col} = ?")
        values.append(val)
    if not updates:
        raise HTTPException(status_code=400, detail="No updatable fields provided.")
    updates.append("updated_at = ?")
    values.append(_utc_now())
    values.append(photo_id)
    with transaction() as conn:
        conn.execute(f"UPDATE photos SET {', '.join(updates)} WHERE id = ?", values)
    row = _get_photo_by_id(photo_id)
    return {"ok": True, "photo": dict_from_row(row)}


@app.delete("/api/photos/{photo_id}")
def delete_photo(photo_id: str, user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    row = _get_photo_by_id(photo_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Photo not found.")
    with transaction() as conn:
        conn.execute("DELETE FROM photos WHERE id = ?", (photo_id,))
    return {"ok": True, "id": photo_id, "deleted": True}


def _get_photo_by_id(photo_id: str) -> Any:
    with transaction() as conn:
        return conn.execute("SELECT * FROM photos WHERE id = ?", (photo_id,)).fetchone()


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------

@app.get("/health")
def health() -> dict[str, Any]:
    import sqlite3 as _sqlite3

    brush = find_brush()
    pycolmap_module = None
    pycolmap_error = ""
    try:
        import pycolmap  # type: ignore
        pycolmap_module = pycolmap
    except Exception as exc:  # noqa: BLE001
        pycolmap_error = str(exc)

    db_ok = False
    try:
        with transaction() as conn:
            conn.execute("SELECT 1").fetchone()
        db_ok = True
    except Exception:
        db_ok = False

    return {
        "ok": pycolmap_module is not None,
        "service": "namma-reconstruction",
        "version": PIPELINE_VERSION,
        "pycolmap": (
            getattr(pycolmap_module, "__version__", None)
            if pycolmap_module is not None
            else None
        ),
        "colmapSfmAvailable": pycolmap_module is not None,
        "pycolmapError": pycolmap_error or None,
        "splattingAvailable": brush is not None,
        "brushPath": str(brush) if brush else None,
        "dataDirectory": str(DATA_ROOT),
        "activeJobs": STORE.active_count(),
        "database": db_ok,
        "authEnabled": ENABLE_AUTH,
        "limits": {
            "maxPhotos": MAX_PHOTOS,
            "maxFileMB": MAX_FILE_BYTES // (1024 * 1024),
            "maxTotalMB": MAX_TOTAL_BYTES // (1024 * 1024),
        },
    }


# ---------------------------------------------------------------------------
# Job endpoints
# ---------------------------------------------------------------------------

@app.post("/v1/jobs", status_code=202)
async def create_job(
    photos: list[UploadFile] = File(...),
    projectId: str = Form(""),
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    if not photos:
        raise HTTPException(status_code=400, detail="Choose at least one photo.")
    if len(photos) < 3:
        raise HTTPException(
            status_code=400,
            detail="At least 3 overlapping photos are required for a reliable 3D reconstruction.",
        )
    if MAX_PHOTOS and len(photos) > MAX_PHOTOS:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Too many photos. This service accepts up to {MAX_PHOTOS} at a time. "
                "For very large captures, use the offline CLI instead: "
                "python pipeline/reconstruct_full.py --images colmap_images"
            ),
        )

    cleaned_project_id = (projectId or "").strip()
    if len(cleaned_project_id) > 128:
        raise HTTPException(status_code=400, detail="Invalid project id.")

    job_id = f"rec_{uuid.uuid.uuid4().hex[:16]}"
    job_dir = STORE.job_dir(job_id)
    input_dir = job_dir / "input"
    input_dir.mkdir(parents=True, exist_ok=True)

    total_bytes = 0
    saved_count = 0
    try:
        for index, photo in enumerate(photos):
            original_name = (photo.filename or f"photo_{index + 1}").strip()
            # Sanitize filename — use only the basename to prevent path traversal.
            safe_name = os.path.basename(original_name)
            suffix = Path(safe_name).suffix.lower()
            if suffix == ".heic" or suffix == ".heif":
                raise HTTPException(
                    status_code=400,
                    detail=(
                        f"'{safe_name}' is HEIC. Export it as JPEG first — "
                        "COLMAP cannot read HEIC photos directly."
                    ),
                )
            if suffix not in ALLOWED_SUFFIXES:
                raise HTTPException(
                    status_code=400,
                    detail=(
                        f"'{safe_name}' is not a supported image. "
                        "Use JPG, PNG, WebP, BMP or TIFF."
                    ),
                )

            destination = input_dir / f"photo_{saved_count:03d}{suffix}"
            file_bytes = 0
            try:
                with destination.open("wb") as handle:
                    while True:
                        chunk = await photo.read(1024 * 1024)
                        if not chunk:
                            break
                        file_bytes += len(chunk)
                        total_bytes += len(chunk)
                        if file_bytes > MAX_FILE_BYTES:
                            raise HTTPException(
                                status_code=400,
                                detail=(
                                    f"'{safe_name}' is larger than "
                                    f"{MAX_FILE_BYTES // (1024 * 1024)} MB."
                                ),
                            )
                        if MAX_TOTAL_BYTES and total_bytes > MAX_TOTAL_BYTES:
                            raise HTTPException(
                                status_code=413,
                                detail=(
                                    "The photo set is too large. Upload fewer photos "
                                    "or smaller files."
                                ),
                            )
                        handle.write(chunk)
            finally:
                await photo.close()

            if file_bytes == 0:
                raise HTTPException(
                    status_code=400, detail=f"'{safe_name}' is empty."
                )
            try:
                with Image.open(destination) as image:
                    image.verify()
            except Exception as exc:  # noqa: BLE001
                raise HTTPException(
                    status_code=400,
                    detail=f"'{safe_name}' is not a readable image.",
                ) from exc
            saved_count += 1

        now = _utc_now()
        job = {
            "id": job_id,
            "projectId": cleaned_project_id,
            "userId": user.get("id"),
            "status": "queued",
            "stage": "queued",
            "progress": 0,
            "message": (
                f"{saved_count} photo{'s' if saved_count != 1 else ''} uploaded. "
                "Waiting for the reconstruction worker."
            ),
            "inputCount": saved_count,
            "createdAt": now,
            "updatedAt": now,
            "startedAt": None,
            "finishedAt": None,
            "stats": None,
            "assets": {},
            "error": None,
        }
        STORE.create(job)
        _append_log(
            job_dir / "job.log",
            f"Received {saved_count} photos ({total_bytes / (1024 * 1024):.1f} MB) "
            f"for project {cleaned_project_id or '(none)'} by user {user.get('id')}",
        )
        EXECUTOR.submit(_run_job, job_id)
        return _public_job(STORE.get(job_id) or job)
    except HTTPException:
        shutil.rmtree(job_dir, ignore_errors=True)
        raise
    except Exception as exc:  # noqa: BLE001
        shutil.rmtree(job_dir, ignore_errors=True)
        raise HTTPException(
            status_code=500, detail=f"Could not store the uploaded photos: {exc}"
        ) from exc


@app.get("/v1/jobs")
def list_jobs(
    projectId: str = "",
    limit: int = 50,
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    jobs = STORE.list(projectId.strip() or None, limit=limit)
    return {"ok": True, "jobs": [_public_job(job) for job in jobs]}


@app.get("/v1/jobs/{job_id}")
def get_job(job_id: str, user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    job = STORE.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Reconstruction job not found.")
    return {"ok": True, "job": _public_job(job)}


@app.get("/v1/jobs/{job_id}/log", response_class=PlainTextResponse)
def get_job_log(job_id: str, user: dict[str, Any] = Depends(get_current_user)) -> str:
    job = STORE.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Reconstruction job not found.")
    log_path = STORE.job_dir(job_id) / "job.log"
    if not log_path.is_file():
        return ""
    with log_path.open("rb") as handle:
        handle.seek(0, os.SEEK_END)
        size = handle.tell()
        handle.seek(max(0, size - 200_000))
        return handle.read().decode("utf-8", errors="replace")


@app.get("/v1/jobs/{job_id}/assets/{asset_path:path}")
def get_job_asset(job_id: str, asset_path: str, user: dict[str, Any] = Depends(get_current_user)) -> FileResponse:
    job = STORE.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Reconstruction job not found.")

    assets_root = (STORE.job_dir(job_id) / "assets").resolve()
    target = (assets_root / asset_path).resolve()
    try:
        target.relative_to(assets_root)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="Asset not found.") from exc

    if not target.is_file() or target.suffix.lower() not in {
        ".ply", ".json", ".jpg", ".jpeg", ".png", ".glb", ".gltf",
    }:
        raise HTTPException(status_code=404, detail="Asset not found.")

    media_types = {
        ".ply": "application/octet-stream",
        ".json": "application/json",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".glb": "model/gltf-binary",
        ".gltf": "model/gltf+json",
    }
    return FileResponse(
        target,
        media_type=media_types.get(target.suffix.lower(), "application/octet-stream"),
        headers={"Cache-Control": "public, max-age=3600"},
    )


@app.delete("/v1/jobs/{job_id}")
def delete_job(job_id: str, user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    job = STORE.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Reconstruction job not found.")

    status_val = job.get("status")
    if status_val in {"queued", "running"}:
        CANCEL_FLAGS[job_id] = True
        for _ in range(20):
            time.sleep(0.1)
            refreshed = STORE.get(job_id)
            if refreshed is None or refreshed.get("status") not in {"queued", "running"}:
                break
        job = STORE.get(job_id)
        if job is None:
            return {"ok": True, "id": job_id, "deleted": True}
        status_val = job.get("status")

    if status_val in {"queued", "running"}:
        raise HTTPException(
            status_code=409,
            detail="Reconstruction is still running; cancellation is in progress. Try again shortly.",
        )
    STORE.delete(job_id)
    return {"ok": True, "id": job_id, "deleted": True}


if __name__ == "__main__":  # pragma: no cover
    import sqlite3  # noqa: F401
    import uvicorn

    uvicorn.run(
        "reconstruction_service.main:app",
        host=os.getenv("DART_RECONSTRUCTION_HOST", "127.0.0.1"),
        port=int(os.getenv("DART_RECONSTRUCTION_PORT", "8000")),
        reload=False,
    )
