# Stage 1 — Environment & Repository Audit

**Date:** 2026-11-02
**Scope:** read-only audit. No source file was changed. The only file added is this report.
**Machine:** Windows 11 Home 10.0.26300 · AMD Ryzen 7 7435HS (8C/16T) · 16 GB RAM (~2.3 GB free at audit time)
**GPU:** NVIDIA GeForce RTX 3050 Laptop, 4096 MiB VRAM (~2.9 GB free at audit time), driver 610.74, CUDA UMD 13.3
**Disk:** 90.5 GB free on C:

---

## 1. Verified toolchain (measured, not assumed)

| Tool | Status | Version / path | Notes |
| --- | --- | --- | --- |
| Node.js | PASS | v24.20.0 | npm 11.19.0 |
| Python (base, on PATH) | PASS | 3.13.5 · `C:\Program Files\Python313\python.exe` | This is what `npm run reconstruction` uses |
| Anaconda | PASS (not on PATH) | `C:\Users\<user>\anaconda3` | Envs: `base`, `pytorch` |
| Conda env `pytorch` | PASS | Python 3.12.16 | torch 2.14.1+cu130, torchvision 0.29.1+cu130 |
| CUDA runtime (nvcc) | PASS | 13.4.92 | Driver supports CUDA 13.x |
| PyTorch CUDA | PASS | `torch.cuda.is_available() == True` | 1 device, RTX 3050 Laptop, CC 8.6, 4.0 GB |
| COLMAP CLI | PASS | 4.2.1 CUDA build · `C:\COLMAP\colmap-x64-windows-cuda\bin\colmap.exe` | `patch_match_stereo`, `stereo_fusion`, `poisson_mesher` available |
| pycolmap | PASS (CPU-only) | 4.2.1 in base 3.13 | **`pycolmap.has_cuda == False`** |
| FFmpeg | PASS | 9.0.2 essentials | on PATH |
| Open3D | PARTIAL | 0.20.0 in base 3.13 only | missing from `pytorch` env |
| OpenCV | PASS | 5.0.0.93 in base 3.13 | missing from `pytorch` env |
| scipy / sklearn | PASS | 1.17.1 / 1.8.0 (base) | |
| Blender | PASS | 5.2.3 LTS · `C:\Program Files\Blender Foundation\Blender 5.2\blender.exe` | **not on PATH**; Python 3.13.13 inside |
| Brush (3DGS trainer) | PARTIAL | `brush_app.exe` (151 MB) exists only in the sibling folder `Downloads\dart-twin---doorway-anchored-repeatable-twin\.tools\brush` | **not present in this repo** → `/health` reports `splattingAvailable: false` |
| gsplat | **NOT INSTALLED** | no module in any interpreter found | `pip index` shows 1.5.3 available |
| Nerfstudio | **NOT INSTALLED** | no module, no `ns-train`/`ns-export` | |
| trimesh | **NOT INSTALLED** | required by `reconstruction_service/mesh_generator.py` | |
| SuperSplat | **NOT FOUND** | no app/CLI on PATH or in Program Files | optional inspection tool only |
| React Three Fiber | **NOT INSTALLED** | `@react-three/fiber` absent | viewer uses plain Three.js |
| `@mkkellogg/gaussian-splats-3d` | PASS | 0.4.7 | genuine web splat renderer, already used by `PhotorealScanView` |
| three | PASS | 0.186.1 | |
| Vite / React | PASS | 8.3.5 / 19.3.1 | |

### Windows / CUDA notes
- `pycolmap` from pip on Windows is a **CPU-only** build (`has_cuda = False`). The `Device.auto` calls therefore fall back to CPU while the job metadata currently claims "CUDA GPU". This is a correctness/honesty bug, not just cosmetics.
- The standalone COLMAP CLI **is** CUDA-built. GPU SfM is available there if we choose to switch the SfM engine; the proven pycolmap path runs CPU SfM (~3 min for 30 photos).
- Torch is `+cu130`; do **not** install Nerfstudio 1.1.5 into this env — it pins older torch and would break CUDA 13 / torch 2.14.

---

## 2. Repository baseline (verified)

**Branch:** `main`, remote `github.com/Vignesh2139/NAMMA_SPACE_PROJECT`
**Working tree already dirty before this audit (user work — preserved):** `README.md`, `package.json`, `server/db.cjs`
**Last commit:** `27de1d7 updated Namma Space project`

Baseline checks that pass today:
- `npx tsc --noEmit` → **0 errors**
- `npm test` → **19/19 pass** (DART scoring, validator, pathfinding, room modelling, synthetic reconstruction helpers)
- `GET http://127.0.0.1:8000/health` on a real uvicorn start → `ok: true`, `pycolmap 4.2.1`, `colmapSfmAvailable: true`, `splattingAvailable: false`, `brushPath: null`

Existing components:
- `src/components/Viewer3DView.tsx` (67 KB): plain Three.js first-person/OrbitControls viewer, WASD + pointer lock, collision helpers, floor constraint, GLB and PLY loading.
- `src/components/PhotorealScanView.tsx` (50 KB): the **only** genuine Gaussian-splat renderer in the app (`@mkkellogg/gaussian-splats-3d`, `.ply`).
- `reconstruction_service/`: flat FastAPI service; `pipeline.py` does EXIF normalize → pycolmap SfM → dataset export → Brush → PLY stats. `mesh_generator.py` (broken, see below).
- `pipeline/reconstruct_full.py`: offline COLMAP CLI pipeline incl. dense stage (broken, see below).
- `pipeline/extract_video_frames.py`: offline FFmpeg frame extractor with a fake-frame fallback.
- Server: `server.cjs` + `server/api.cjs` (SQLite via `node:sqlite`), API on :5000; Vite proxies `/api` → :5000 and `/reconstruction-api` → :8000.

Existing DB content: 1 hidden demo project `proj_b804` (fabricated stats, "Calibrated Geometric Twin"), 6 rooms, 6 doorways, 11 photos with **no** image data.

---

## 3. Genuine reconstruction evidence found on disk

A sibling copy of the project (`Downloads\dart-twin---doorway-anchored-repeatable-twin`) contains a **real successful run** from 2026-11-01:

```
30 photos → 30/30 registered cameras
24,101 sparse points
mean reprojection error 0.486 px
Brush: 229,345 Gaussians (20,655 outliers filtered)
duration 489.4 s on this laptop
assets: scene.ply (54 MB, valid 3DGS PLY: f_dc_*, f_rest_*, SH degree 3), point-cloud.ply
```

That same copy's SQLite DB stores **50 genuine indoor photographs** (a real rotunda interior, `00001.jpg`…`00050.jpg`, JPEG data URLs, ~150–250 KB each). The input images of the successful job were deleted by `DART_KEEP_WORK` default, but the 50 source photos are recoverable.

This gives us:
1. proof the pycolmap + Brush path works on this exact hardware,
2. a real indoor capture set for Stage 2/10 tests,
3. a real splat asset for viewer tests.

The current repo itself has **no** sample images, no `.tools/`, no reconstruction jobs.

---

## 4. Defects found (ordered by impact)

### Blocking / correctness
1. **No `requirements.txt`** although README and `verify_setup.ps1` reference it. Setup is not reproducible.
2. **Split Python environments.** Base 3.13 has pycolmap/FastAPI/Open3D but **CPU-only torch**; `pytorch` env has working CUDA torch but **no** pycolmap/FastAPI/Open3D/gsplat. `npm run reconstruction` uses base, so there is currently no environment in which the whole pipeline can run with GPU training.
3. **"CUDA GPU" engine label is false** — pycolmap is CPU-only. Job stats say `COLMAP SfM (CUDA GPU)`.
4. **Dense MVS is not implemented in the live service.** `_generate_dense_mesh()` runs Poisson on the *sparse* cloud and labels it "dense 3D surface mesh". Also `mesh_generator.py` imports `trimesh` (missing), so meshing actually fails every run.
5. **Offline dense pipeline is broken:** `reconstruct_full.py` calls `colmap dense_stereo` (does not exist in COLMAP 4.2.1; it is `patch_match_stereo`), uses removed `--DeepStereo.*` options, and never runs `image_undistorter` to create the dense workspace.
6. **Invalid GLB fallback:** when Blender is not on PATH, `export_glb()` copies the PLY to a `.glb` filename. A PLY with a GLB extension must never be served as a model.
7. **Viewer loads `scene.ply` with `PLYLoader`** and renders it as `THREE.Points` — Gaussian splats are treated as ordinary points in the walkthrough. Only `PhotorealScanView` renders splats correctly.
8. **Procedural fallback point cloud** (`generateSparsePointCloud`) is displayed whenever no artifact exists, with no explicit "no reconstruction" state. It can easily be mistaken for a real result.
9. **Fabricated UI metrics:** `ReconstructionWorkspaceView` prints invented logs (hard-coded "0.74 px", keypoint counts); the hidden B-804 demo has invented vertex/triangle/reprojection stats.

### Functional gaps vs. brief
10. **No server-side video ingestion.** Video frames are extracted in the browser via `<video>`+canvas and stored as data URLs; FFmpeg is never used in the live pipeline. The offline extractor generates **1×1 placeholder JPEGs** when FFmpeg is missing and hard-codes sharpness 84.
11. **Frontend 30-photo cap** in `PhotorealScanView.photoRecordsToFiles` (`photos.slice(0, 30)`), contradicting the "no limit" service.
12. Missing API surface: no `GET /v1/jobs/{id}/assets`, log endpoint is `/log` not `/logs`, no cancel/resume, delete is refused while running, no per-stage detail objects.
13. No automated pipeline tests (only TS unit tests).
14. No quality filtering (blur/duplicate detection), no manifest, no preserved originals in the live path.
15. Brush binary is not vendored in this repo (`.tools/` is gitignored); `find_brush()` returns `None`.
16. Blender is not on PATH, so `shutil.which("blender")` and `export_glb` fail silently-ish.
17. gsplat / Nerfstudio / SuperSplat / R3F — stated as installed in the brief, but **not installed**. They must not be reported as available.

### Non-issues
- `reconstruction_service/opencv_sfm.py`, `chunk2.py`, `make_test_scene.py` are dead code (not imported by the service).
- `data/` and `.tools/` are correctly gitignored.
- CORS/proxy wiring for :8000 is correct.

---

## 5. Hardware-aware pipeline design (RTX 3050 4 GB / 16 GB RAM)

Measured budget: ~2.9 GB VRAM free with the desktop running, ~2.3 GB RAM free at audit time.

| Stage | Engine | Setting for this machine |
| --- | --- | --- |
| Frame extraction | FFmpeg | server-side, 0.5–1.0 s sampling, max 30–60 frames |
| Quality filter | OpenCV (base env) | Laplacian variance + perceptual hash dedupe |
| SfM | pycolmap (CPU, proven) or COLMAP CLI (CUDA) | 8–30 images, `SIMPLE_RADIAL`, 1600 px, 8192 SIFT, exhaustive matching; CPU ~3 min / 30 imgs |
| Dense MVS | COLMAP `patch_match_stereo` + `stereo_fusion` | 1024–1280 px max, GPU index 0, geometric fusion; CPU fallback |
| Mesh | Open3D Poisson + decimation; Blender GLB export | depth 8, target ≤150k triangles, vertex colors |
| Splats | gsplat (primary if it installs) or Brush (proven) | 500×375–960×540, 7k–15k steps, ≤250k Gaussians, checkpoint every 2k, VRAM guard ~3.0 GB |
| Viewer | `@mkkellogg/gaussian-splats-3d` for 3DGS PLY, `GLTFLoader` for GLB | progressive load, explicit error/fallback UI |

VRAM rules: only one GPU stage at a time (single worker, already the case); free the previous stage before the next; abort training gracefully on `torch.cuda.OutOfMemoryError` and downscale rather than crash.

---

## 6. Environment decision proposed for Stage 2

**One service environment**, not two:

- Use the existing **`pytorch` env (3.12, torch 2.14.1+cu130)** as the single reconstruction runtime.
- Add to it: `pycolmap` (CPU SfM is proven and adequate), `fastapi`, `uvicorn`, `python-multipart`, `opencv-python`, `open3d`, `numpy`, `pillow`, plus `trimesh` only if needed; `gsplat` attempted separately in Stage 3.
- Keep the **COLMAP CUDA CLI** as the optional GPU SfM/dense engine (configurable), so we do not depend on a CUDA pycolmap wheel.
- Do **not** install Nerfstudio (torch pin conflict). gsplat is the Nerfstudio rasterizer anyway; a small dedicated gsplat trainer is the correct choice.
- Create `reconstruction_service/requirements.txt` (currently missing) and pin versions.
- Add `.tools/brush/brush_app.exe` by copying the already-downloaded 151 MB binary (no re-download).
- Correct all engine labels to report what actually ran.

**Sample data:** copy the 50 genuine rotunda photos from the sibling DB into a local, gitignored test fixture (`test/fixtures/rotunda/`) for Stage 2 and Stage 10. They are real photographs, not renders or placeholders.

---

## 7. Stage 2 plan (awaiting approval)

1. Create `reconstruction_service/stages/`, `engines/`, `utils/`; move existing working code into modules without changing the public `reconstruct()` contract or any HTTP route.
2. Add `requirements.txt`, `.env.example` entries, and a real `scripts/verify_setup.ps1` that checks CUDA, torch, pycolmap, COLMAP, FFmpeg, Blender and gsplat truthfully.
3. Implement server-side ingestion: JPG/JPEG/PNG/MP4/MOV, FFmpeg sampling, EXIF normalize, sRGB JPEG, resolution policy, blur/duplicate rejection, preserved originals, quality report + reconstruction manifest.
4. Refactor SfM into `engines/colmap_engine.py` with honest CPU/GPU reporting and robust failure messages.
5. Remove the fake-frame fallback and the fake GLB copy; never fabricate metrics.
6. Verify with the 50 real photos: features → matches → registration → sparse PLY + stats, logging real timings and memory.
7. Commit as a logical milestone; report measured results, then stop for approval.

Not in Stage 2: gsplat training, dense MVS, viewer changes (Stages 3–6).

---

## 8. Open questions for you

1. Approve using the **`pytorch` conda env** as the single runtime? (Alternative: install CUDA torch into base 3.13 — riskier, larger change.)
2. Approve copying the 151 MB **Brush** binary and the **50 real rotunda photos** into this repo's local, gitignored folders?
3. Do you want gsplat to be the **primary** trainer (requires a build attempt against torch 2.14+cu130, may fail) with Brush as the guaranteed fallback? Or Brush primary and gsplat optional?
