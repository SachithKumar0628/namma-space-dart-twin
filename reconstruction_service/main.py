"""FastAPI reconstruction job service.

Endpoints
---------
GET    /health                              service + engine availability
POST   /v1/jobs                             upload photos, queue a job
GET    /v1/jobs?projectId=...               list jobs for a space
GET    /v1/jobs/{job_id}                    job status, progress, result stats
GET    /v1/jobs/{job_id}/assets/{path}      reconstructed .ply assets
GET    /v1/jobs/{job_id}/log                human-readable pipeline log
DELETE /v1/jobs/{job_id}                    remove job files and assets

Jobs are persisted as JSON under data/reconstructions so the UI can reconnect
after a reload. Reconstruction runs on one background worker (pycolmap and
Brush both saturate the machine, so parallel jobs would only slow each other).
"""

from __future__ import annotations

import json
import os
import shutil
import threading
import traceback
import uuid
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import quote

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, PlainTextResponse
from PIL import Image

try:  # Support both `python -m reconstruction_service.main` and direct runs.
    from .pipeline import (
        PIPELINE_VERSION,
        ReconstructionError,
        find_brush,
        reconstruct,
    )
except ImportError:  # pragma: no cover
    from pipeline import (  # type: ignore
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

MAX_PHOTOS = max(2, min(120, int(os.getenv("DART_MAX_PHOTOS", "60"))))
MAX_FILE_BYTES = max(1, int(os.getenv("DART_MAX_FILE_MB", "40"))) * 1024 * 1024
MAX_TOTAL_BYTES = max(1, int(os.getenv("DART_MAX_TOTAL_MB", "800"))) * 1024 * 1024
ALLOWED_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff"}

Image.MAX_IMAGE_PIXELS = 160_000_000


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _append_log(path: Path, message: str) -> None:
    try:
        with path.open("a", encoding="utf-8") as handle:
            handle.write(f"[{_utc_now()}] {message}\n")
    except OSError:
        pass


class JobStore:
    """Small thread-safe JSON job store."""

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

            # A process restart can leave a JSON record saying "running". Be
            # honest about it instead of polling forever with no worker.
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
            return dict(job)

    def update(self, job_id: str, **changes: Any) -> dict[str, Any] | None:
        with self._lock:
            job = self._jobs.get(job_id)
            if job is None:
                return None
            job.update(changes)
            job["updatedAt"] = _utc_now()
            self._write(job)
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


STORE = JobStore(DATA_ROOT)
EXECUTOR = ThreadPoolExecutor(max_workers=1, thread_name_prefix="dart-reconstruction")


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
    except Exception as exc:  # noqa: BLE001 - never leave a job running forever
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
        keep_work = os.getenv("DART_KEEP_WORK", "").lower() in {"1", "true", "yes"}
        if not keep_work:
            shutil.rmtree(work_dir, ignore_errors=True)
            shutil.rmtree(inputs_dir, ignore_errors=True)


@asynccontextmanager
async def lifespan(_: FastAPI):
    DATA_ROOT.mkdir(parents=True, exist_ok=True)
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

allowed_origins_env = os.getenv("DART_ALLOWED_ORIGINS", "*").strip()
allowed_origins = (
    ["*"]
    if allowed_origins_env == "*"
    else [origin.strip() for origin in allowed_origins_env.split(",") if origin.strip()]
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Length", "Content-Range", "Accept-Ranges"],
    max_age=86400,
)


@app.get("/health")
def health() -> dict[str, Any]:
    brush = find_brush()
    pycolmap_module = None
    pycolmap_error = ""
    try:
        import pycolmap  # type: ignore

        pycolmap_module = pycolmap
    except Exception as exc:  # noqa: BLE001
        pycolmap_error = str(exc)

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
        "limits": {
            "maxPhotos": MAX_PHOTOS,
            "maxFileMB": MAX_FILE_BYTES // (1024 * 1024),
            "maxTotalMB": MAX_TOTAL_BYTES // (1024 * 1024),
        },
    }


@app.post("/v1/jobs", status_code=202)
async def create_job(
    photos: list[UploadFile] = File(...),
    projectId: str = Form(""),
) -> dict[str, Any]:
    if not photos:
        raise HTTPException(status_code=400, detail="Choose at least one photo.")
    if len(photos) < 3:
        raise HTTPException(
            status_code=400,
            detail="At least 3 overlapping photos are required for a reliable 3D reconstruction.",
        )
    if len(photos) > MAX_PHOTOS:
        raise HTTPException(
            status_code=400,
            detail=f"Too many photos. This service accepts up to {MAX_PHOTOS} at a time.",
        )

    cleaned_project_id = (projectId or "").strip()
    if len(cleaned_project_id) > 128:
        raise HTTPException(status_code=400, detail="Invalid project id.")

    job_id = f"rec_{uuid.uuid4().hex[:16]}"
    job_dir = STORE.job_dir(job_id)
    input_dir = job_dir / "input"
    input_dir.mkdir(parents=True, exist_ok=True)

    total_bytes = 0
    saved_count = 0
    try:
        for index, photo in enumerate(photos):
            original_name = (photo.filename or f"photo_{index + 1}").strip()
            suffix = Path(original_name).suffix.lower()
            if suffix == ".heic" or suffix == ".heif":
                raise HTTPException(
                    status_code=400,
                    detail=(
                        f"'{original_name}' is HEIC. Export it as JPEG first — "
                        "COLMAP cannot read HEIC photos directly."
                    ),
                )
            if suffix not in ALLOWED_SUFFIXES:
                raise HTTPException(
                    status_code=400,
                    detail=(
                        f"'{original_name}' is not a supported image. "
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
                                    f"'{original_name}' is larger than "
                                    f"{MAX_FILE_BYTES // (1024 * 1024)} MB."
                                ),
                            )
                        if total_bytes > MAX_TOTAL_BYTES:
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
                    status_code=400, detail=f"'{original_name}' is empty."
                )
            try:
                with Image.open(destination) as image:
                    image.verify()
            except Exception as exc:  # noqa: BLE001
                raise HTTPException(
                    status_code=400,
                    detail=f"'{original_name}' is not a readable image.",
                ) from exc
            saved_count += 1

        now = _utc_now()
        job = {
            "id": job_id,
            "projectId": cleaned_project_id,
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
            f"for project {cleaned_project_id or '(none)'}",
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
def list_jobs(projectId: str = "", limit: int = 50) -> dict[str, Any]:
    jobs = STORE.list(projectId.strip() or None, limit=limit)
    return {"ok": True, "jobs": [_public_job(job) for job in jobs]}


@app.get("/v1/jobs/{job_id}")
def get_job(job_id: str) -> dict[str, Any]:
    job = STORE.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Reconstruction job not found.")
    return {"ok": True, "job": _public_job(job)}


@app.get("/v1/jobs/{job_id}/log", response_class=PlainTextResponse)
def get_job_log(job_id: str) -> str:
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
def get_job_asset(job_id: str, asset_path: str) -> FileResponse:
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
        ".ply",
        ".json",
        ".jpg",
        ".jpeg",
        ".png",
    }:
        raise HTTPException(status_code=404, detail="Asset not found.")

    media_types = {
        ".ply": "application/octet-stream",
        ".json": "application/json",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
    }
    return FileResponse(
        target,
        media_type=media_types.get(target.suffix.lower(), "application/octet-stream"),
        headers={"Cache-Control": "public, max-age=3600"},
    )


@app.delete("/v1/jobs/{job_id}")
def delete_job(job_id: str) -> dict[str, Any]:
    job = STORE.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Reconstruction job not found.")
    if job.get("status") in {"queued", "running"}:
        raise HTTPException(
            status_code=409,
            detail="Wait for the reconstruction to finish before deleting it.",
        )
    STORE.delete(job_id)
    return {"ok": True, "id": job_id, "deleted": True}


if __name__ == "__main__":  # pragma: no cover
    import uvicorn

    uvicorn.run(
        "reconstruction_service.main:app",
        host=os.getenv("DART_RECONSTRUCTION_HOST", "127.0.0.1"),
        port=int(os.getenv("DART_RECONSTRUCTION_PORT", "8000")),
        reload=False,
    )
