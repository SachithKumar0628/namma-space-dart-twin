# Namma Space — Photoreal Reconstruction Service

Local FastAPI job service that turns uploaded room photos into a photo-derived
3D reconstruction:

```
photos -> pycolmap SfM (CPU) -> COLMAP dataset -> Brush Gaussian splats (GPU)
       -> scene.ply + point-cloud.ply -> browser viewer
```

The Express/SQLite product API remains on `:5000`; this service runs separately
on `:8000`. It is intentionally local-only and binds to `127.0.0.1`.

## 1. Install

From the repository root:

```powershell
pip install -r reconstruction_service/requirements.txt
```

`pycolmap` supplies COLMAP feature extraction, matching and incremental mapping
without requiring a separate COLMAP installation.

### Brush (Gaussian splatting)

Download the Brush v0.3.0 Windows build and place it at
`.tools/brush/brush_app.exe`:

```powershell
New-Item -ItemType Directory -Force .tools/brush | Out-Null
Invoke-WebRequest `
  https://github.com/ArthurBrussee/brush/releases/download/v0.3.0/brush-app-x86_64-pc-windows-msvc.zip `
  -OutFile .tools/brush.zip
Expand-Archive .tools/brush.zip -DestinationPath .tools/brush -Force
```

Brush uses WebGPU and works on NVIDIA/AMD/Intel GPUs. If Brush is missing or
fails, the job still succeeds with a sparse COLMAP point cloud so the scan view
always has a real photo-derived asset.

Set `BRUSH_BINARY` to use a different executable location.

## 2. Run

```powershell
npm run reconstruction
```

The service listens on <http://127.0.0.1:8000>. Check it with:

```powershell
Invoke-RestMethod http://127.0.0.1:8000/health
```

In another terminal, start the product UI and API as usual:

```powershell
npm run server   # Express + SQLite on :5000
npm run dev      # React/Vite on :3000
```

The frontend calls `http://127.0.0.1:8000` by default. Override it with
`VITE_RECONSTRUCTION_API_BASE`.

## 3. API

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health` | pycolmap/Brush availability, limits, active jobs |
| `POST` | `/v1/jobs` | multipart `photos` + `projectId`, queues a job |
| `GET` | `/v1/jobs?projectId=...` | list jobs for a space |
| `GET` | `/v1/jobs/{id}` | status, stage, progress, metrics |
| `GET` | `/v1/jobs/{id}/assets/{file}` | `scene.ply`, `point-cloud.ply`, manifest |
| `GET` | `/v1/jobs/{id}/log` | pipeline log tail |
| `DELETE` | `/v1/jobs/{id}` | remove job folder and assets |

Jobs are persisted as JSON in `data/reconstructions/<job-id>/`. Uploaded input
photos and temporary COLMAP workspaces are deleted when a job finishes; only the
PLY assets, manifest and log are kept. Deleting a job from the Photoreal Scan tab
removes those files too.

The exported splat PLY is cleaned of oversized outlier Gaussians before it is
served, and the viewer starts from the best-supported registered COLMAP camera
pose. Both the splat and sparse-cloud views can still be orbited and reset.

## 4. Tuning

| Variable | Default | Meaning |
| --- | --- | --- |
| `DART_SPLAT_STEPS` | `8000` | Brush training steps (quality vs. time) |
| `DART_SPLAT_RESOLUTION` | `720` | Max training image dimension |
| `DART_SPLAT_MAX` | `250000` | Maximum Gaussian count |
| `DART_MAX_IMAGE_SIZE` | `1600` | Photo normalisation / SIFT size |
| `DART_MIN_REGISTRATION_RATE` | `0.5` | Minimum fraction of uploaded photos that must register |
| `DART_SPLAT_TIMEOUT` | `1800` | Brush timeout in seconds |
| `DART_KEEP_WORK` | unset | Keep input/COLMAP workspace for debugging |
| `DART_RECONSTRUCTION_DATA` | `data/reconstructions` | Job storage root |
| `DART_ALLOWED_ORIGINS` | `*` | CORS origins (local-only service) |
| `BRUSH_BINARY` | auto | Brush executable path |

On a 4 GB RTX 3050 laptop GPU, 20 photos at 8000 steps take roughly 3–5 minutes
including CPU SfM. The first job may take longer while shaders compile.

## 5. Capture guidance

COLMAP needs visual overlap, not just many photos. The service requires at least
3 photos and rejects a reconstruction when fewer than half of the uploaded
photos register (the threshold can be adjusted with
`DART_MIN_REGISTRATION_RATE`):

- 8–30 sharp photos, landscape orientation, good lighting.
- Turn in place and keep ~70% overlap between neighbouring shots.
- Include corners, furniture and texture; blank white walls alone are weak.
- Walk through doorways and photograph both sides to connect rooms.
- Avoid motion blur, mirrors at grazing angles and drastic exposure changes.

If SfM fails, the job reports a clear message in the Photoreal Scan tab and the
walkable geometric twin remains available.
