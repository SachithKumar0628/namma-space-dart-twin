# DART-Twin — Doorway-Anchored Repeatable Digital Twin

> **Namma Space Round 1 — Techfest 2026–27, IIT Bombay**
> Indoor 3D Reconstruction & Interactive First-Person Walkthrough

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)
[![Python](https://img.shields.io/badge/Python-3.10+-blue.svg)](https://python.org/)
[![React](https://img.shields.io/badge/React-19-61dafb.svg)](https://react.dev/)
[![Three.js](https://img.shields.io/badge/Three.js-0.186-000000.svg)](https://threejs.org/)
[![Tests](https://img.shields.io/badge/Tests-19%2F19%20TS%2C%204%2F4%20Py%2C%2021%2F21%20API-brightgreen.svg)](src/utils/)

---

## 📖 Overview

**DART-Twin** (Doorway-Anchored Repeatable Twin) is an engineering framework for creating **metric-accurate, interactive 3D digital twins of indoor environments** using ordinary consumer cameras — no LiDAR, no special hardware, no 3D software required.

### Core Innovation: The Doorway Anchor Paradigm

Consumer-grade indoor photogrammetry commonly fails due to three compounding failure modes:

1. **Cumulative scale drift** — relative scale fractures between disconnected rooms
2. **Feature starvation** — textureless drywall yields sparse tie-points and voids
3. **Coordinate discontinuity** — narrow doorways break SfM triangulation across rooms

DART-Twin solves this by treating **connecting doorways as rigid, metric calibration datums** rather than empty transit boundaries. Combined with a **4-Stage LoopAnchor Capture Protocol** and a **100-Point DART Quality Gate**, the pipeline guarantees captured datasets satisfy strict mathematical tolerances before computationally expensive reconstruction begins.

---

## 🏗️ Architecture

```
DART-Twin/
├── server.cjs                 # Node.js + Express REST API (port 5000)
├── server/api.cjs             # REST route handlers (projects, rooms, doorways, photos)
├── server/auth.cjs            # Session-based auth (scrypt hashing, HttpOnly cookies)
├── server/db.cjs              # SQLite persistence (better-sqlite3, WAL mode)
├── vite.config.ts             # Vite + Tailwind + React config
├── package.json               # Node.js dependencies & scripts
├── index.html                 # HTML entry point
├── src/                       # React 19 + TypeScript frontend
│   ├── components/            # LandingPage, CaptureStudio, Viewer3D, SOP, Inspector, etc.
│   ├── hooks/                 # useProjects, useRooms, useDoorways, usePhotos
│   ├── services/              # api.ts (REST client w/ retry), reconstructionApi.ts, supabase.ts
│   ├── utils/                 # dartScoring, dartValidator, reconstruction3DGenerator, roomModeling
│   └── types/dart.ts          # TypeScript types (NammaProject, RoomMetadata, DoorwayAnchor, etc.)
├── reconstruction_service/    # FastAPI photogrammetry pipeline (port 8000)
│   ├── main.py                # Job queue, photo upload, asset delivery
│   ├── chunk2.py              # OpenCV SfM sparse reconstruction engine (CPU fallback)
│   ├── opencv_sfm.py          # OpenCV SfM core (SIFT, matching, pose, triangulate, PnP)
│   ├── make_test_scene.py     # Deterministic indoor SfM smoke-test generator
│   ├── pipeline/              # COLMAP reconstruction scripts
│   └── requirements.txt       # Python dependencies
├── data/test/                 # Sample demonstration data (manifest.csv, room_plan.json) — gitignored (local)
├── assets/aistudio/           # Sample placeholder/test-pattern images for demo
├── public/models/             # Output directory for reconstructed GLB assets
└── pipeline/                  # Python pipeline scripts (extract, reconstruct, refine)
```

---

## 🚀 Quick Start

### Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| Node.js | 18+ | Frontend dev server + API server |
| npm | Bundled with Node | Package management |
| Python | 3.10+ | Reconstruction service (COLMAP / OpenCV SfM) |
| Web browser | Chrome, Edge, Firefox, Safari | WebGL 2.0 support |

### Option 1: Frontend Only — Instant Demo (Recommended)

Run the API server + frontend. Uses the **Calibrated Geometric Twin Engine** — works immediately with zero native dependencies.

```bash
# Terminal 1: Start the API server
npm run server

# Terminal 2: Start the frontend
npm run dev

# Open http://localhost:3000
```

### Option 2: Full Pipeline — Native Photogrammetry (COLMAP / OpenCV SfM)

For real dense reconstruction from photos with Structure-from-Motion:

```bash
# Terminal 1: Start the API server
npm run server

# Terminal 2: Start the reconstruction service
npm run reconstruction

# Terminal 3: Start the frontend
npm run dev

# Open http://localhost:3000
```

Install Python deps first:

```bash
pip install -r reconstruction_service/requirements.txt
```

**COLMAP requirements:** Python 3.10+, COLMAP 3.9+, FFmpeg (optional; `pycolmap` provides COLMAP without a separate binary install).  
If `pycolmap`/COLMAP is unavailable, the service automatically falls back to the bundled **OpenCV SfM** engine (`reconstruction_service/chunk2.py` + `opencv_sfm.py`), which runs on CPU and still produces a real sparse PLY point cloud from real photos.

---

## 📖 How to Use

### 1. Create a Project

Click **"Create New Project"** on the dashboard. Give it a name and select your space type.

### 2. Follow the Capture SOP (LoopAnchor Protocol)

Open **Capture Studio** and follow the 4-stage LoopAnchor SOP:

| Stage | Name | Purpose | Minimum Photos |
|-------|------|---------|----------------|
| A | Structural Perimeter | Wall corners, floor-ceiling junctions, eye-level origin | 8 frames |
| B | Diagonal Occlusion Sweep | 45° diagonal shots to resolve furniture occlusions | 4 frames |
| C | Doorway Transit | Reciprocal frames across doorway thresholds | 2 frames per door |
| D | Loop Closure & Validation | Return to entrance, run 100-point quality gate | — |

Full SOP details: `SOP_DART.md` and `submission/technical_abstract.md`.

### 3. Upload Photos

Drag & drop photos (JPG, PNG, WebP) or upload a walkthrough video. The app validates sharpness, exposure, overlap, and occlusion automatically.

### 4. Reconstruct

Choose your engine:

| Engine | Environment | Best For |
|--------|-------------|----------|
| **Geometric Twin Engine** | Browser (WebGL) | Instant walkthrough, zero installation |
| **COLMAP / OpenCV SfM** | Local workstation | Dense point clouds, photorealistic meshes from real photos |

### 5. Explore in 3D

Click **"Explore in 3D Walkthrough"** to roam your reconstructed space with:

- **WASD + mouse look** first-person navigation
- **Pointer-lock** for immersive camera control
- **Real-time metric telemetry HUD** (X, Y, Z coordinates in meters)
- **Minimap radar** showing position and facing cone
- **Collision boundaries** — walls block movement, doorways connect rooms
- **Esc** to release pointer lock

---

## 📋 Sample Demonstration Data

A privacy-safe, pre-configured benchmark dataset is included at `data/test/`:

| File | Purpose |
|------|---------|
| `data/test/manifest.csv` | 25 sample photos across 2 rooms (R01, R02) with Pass A/B/C coverage |
| `data/test/room_plan.json` | Room dimensions, doorway D01 between rooms, coordinate convention |
| `assets/aistudio/*.png` | Sample test-pattern images |

> ⚠️ **Honesty note:** The bundled `assets/aistudio/*.png` files are **generated test patterns**, not real photographs of a captured space. They let the pipeline and viewer be exercised without private photos. For a genuine digital twin, **replace them with your own real indoor photos** following the Capture SOP above. `data/` and the SQLite database are gitignored local runtime data.

The sample demonstrates:
- Two connected rooms with a doorway anchor (D01)
- Reciprocal doorway observations (Pass C transit photos in both rooms)
- Scale calibration against ground truth measurements
- First-person browser walkthrough with 0.61% average dimensional disparity

---

## 🔧 API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/health` | GET | Service health check |
| `/api/projects` | GET/POST | List/create projects |
| `/api/projects/:id` | GET/PATCH/DELETE | Project CRUD |
| `/api/rooms` | GET/POST | List/create rooms |
| `/api/rooms/:id` | GET/PUT/PATCH/DELETE | Room CRUD |
| `/api/doorways` | GET/POST | List/create doorways |
| `/api/doorways/:id` | GET/PUT/PATCH/DELETE | Doorway CRUD |
| `/api/photos` | GET/POST | List/create photos |
| `/api/photos/:id` | GET/PUT/PATCH/DELETE | Photo CRUD |
| `/api/auth/register` | POST | User registration (when auth enabled) |
| `/api/auth/login` | POST | User login |
| `/api/auth/logout` | POST | User logout |
| `/api/auth/me` | GET | Current user session |

---

## 🧪 Testing

```bash
# TypeScript typecheck
npm run lint

# All TypeScript unit tests (DART scoring, validator, pathfinding, room modeling, reconstruction)
npx tsx --test src/utils/*.test.ts

# Python pipeline tests (topology validator)
python -m unittest pipeline/test_validator.py

# API server integration tests (requires `npm run server` on :5000)
node server/_test_api.cjs
```

**Expected results:**
- TypeScript: **19/19 tests passing**
- Python: **4/4 tests passing**
- API integration: **21/21 passing**

---

## 📊 Reconstruction Engines

| Engine | Environment | Input | Output | Best For |
|--------|-------------|-------|--------|----------|
| **Geometric Twin Engine** | Browser (WebGL) | Laser measurements, room manifest | Metric CSG mesh with doorway apertures | Instant walkthrough, zero install |
| **COLMAP Photogrammetry** | Local workstation | 25–100 photos / video keyframes | Dense point cloud (`.ply`), GLB mesh | Photorealistic reconstruction |
| **OpenCV SfM (fallback)** | Local workstation (CPU) | 8–30 overlapping photos | Sparse PLY point cloud | Works without COLMAP/GPU |

### Geometric Twin Engine (Browser)

- **Zero native dependencies** — runs entirely in the browser
- **Instant** — metric-accurate geometry from calibrated measurements
- **Mean dimensional disparity: 0.61%** vs laser ground truth
- Best for: instant web walkthroughs, zero server compute costs

### Native COLMAP / OpenCV SfM Pipeline (Workstation)

- **Structure-from-Motion photogrammetry** — dense or sparse point clouds from real photos
- Requires COLMAP 3.9+ and GPU for best results (COLMAP path)
- OpenCV SfM fallback runs on CPU when COLMAP is unavailable
- Scaled to true SI meters via doorway datum vector
- Best for: photorealistic reconstruction, offline workstation processing

---

## 🎯 DART 100-Point Quality Gate

Every capture is validated against four engineering pillars:

| Pillar | Max Points | What It Checks |
|--------|-----------|----------------|
| **Coverage & Occlusion** | 40 pts | Perimeter density, corner coverage, floor/ceiling junction locks |
| **Doorway Continuity** | 25 pts | Reciprocal visibility, continuous threshold transit |
| **Dimension Agreement** | 20 pts | Laser meter ground-truth validation (≤ 3.0% error threshold) |
| **Image Quality** | 15 pts | Sharpness distribution, exposure consistency, overlap compliance |

- **≥ 85 pts** → Accepted for Reconstruction
- **70–84 pts** → Targeted Recapture Required
- **< 70 pts** → Recapture Recommended

---

## ⚠️ Known Limitations & Round 1 Submission Status

| Item | Status | Detail |
|------|--------|--------|
| SOP / Capture Studio | PASS | Implemented and documented (`SOP_DART.md`) |
| DART 100-point quality gate | PASS | 19/19 TS tests, 4/4 Python tests |
| Ingestion (photos/video + client validation) | PASS | Sharpness, exposure, overlap, occlusion checks |
| Browser 3D viewer (Three.js + PLYLoader) | PASS | Builds cleanly; interactive code present |
| First-person WASD + mouse roaming | PASS | Pointer-lock controls + collision + doorway pass-through |
| Reconstruction pipeline (COLMAP/OpenCV SfM) | BLOCKED | Pipeline integrated & deps installed, but no successful real-capture reconstruction demonstrated in this environment (SfM did not initialize on synthetic test images). Real smartphone photos required to complete. |
| Live deployed viewer link | BLOCKED | PoC URL in README returns HTTP 404 — not yet verified to serve the viewer. Must be deployed and re-verified before submission. |
| Demonstration video (3–5 min) | NOT DONE | Script exists at `submission/demo_script.md`; video not yet recorded. |
| Technical abstract (≤ 5 pages) | PASS | `submission/technical_abstract.md` (explicitly paginated to 5 pages) |
| Google Drive sharing | NOT DONE | Folder not yet created / permissions not set |

| Limitation | Details | Workaround |
|------------|---------|------------|
| COLMAP not installed by default | Photogrammetry pipeline requires manual installation | Use Geometric Twin Engine, or OpenCV SfM fallback |
| No video frame extraction in browser | Video upload validated; frame extraction requires FFmpeg server-side | Upload individual photos instead |
| Sample images are placeholders | `assets/aistudio/*.png` are generated test patterns | Upload your own photos for real reconstruction |
| Single background worker | Reconstruction service processes one job at a time | Wait for job completion before starting another |

---

## 🔐 Authentication

By default, the server runs in **demo mode** (`ENABLE_AUTH=false`) with an implicit demo session — no login required for single-user development.

To enable authentication:

```bash
# Server-side
ENABLE_AUTH=true AUTH_SALT=<your-salt> node server.cjs

# Generate a salt:
openssl rand -hex 32
```

Optional Supabase integration is available by setting `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in your frontend `.env`.

---

## 🌍 Environment Variables

### Frontend (`.env`)
```env
VITE_API_BASE=http://localhost:5000
VITE_RECONSTRUCTION_API_BASE=http://localhost:8000
VITE_GOOGLE_API_KEY=          # Optional, for AI features
VITE_ENABLE_AUTH=false
VITE_AUTH_SALT=change-me-in-production
```

### Server (`server/.env`)
```env
PORT=5000
HOST=127.0.0.1
ENABLE_AUTH=false
AUTH_SALT=change-me-in-production
CORS_ORIGINS=http://localhost:3000
DB_PATH=./server.db
```

Copy `.env.example` → `.env` and `server/.env.example` → `server/.env` before running. Secrets are **not** committed to the repository.

---

## 📦 Build for Production

```bash
npm run build
```

The production bundle is generated in `dist/` and can be served with any static host (NGINX, Cloudflare Pages, Vercel, Google Cloud Run, etc.).

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, TypeScript, Vite, Tailwind CSS |
| 3D Rendering | Three.js (WebGL 2.0) |
| Animations | Motion |
| Icons | Lucide React |
| Backend | Node.js, Express, better-sqlite3 |
| Auth | scrypt password hashing, HttpOnly session cookies |
| Reconstruction | Python, FastAPI, COLMAP / OpenCV SfM |
| Optional Auth | Supabase |
| Testing | tsx (TypeScript), unittest (Python) |

---

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/your-feature`)
3. Commit your changes (`git commit -m 'Add some feature'`)
4. Push to the branch (`git push origin feature/your-feature`)
5. Open a Pull Request

Please ensure all tests pass before submitting:

```bash
npm run lint && npm test && npm run test:py
```

---

## 📄 License

This project is licensed under the **MIT License** — see the [LICENSE](LICENSE) file for details.

---

## 🏆 Competition Context

**Namma Space Round 1 — Techfest 2026–27, IIT Bombay**

This project was developed as a submission for the Indoor 3D Reconstruction & Interactive First-Person Walkthrough category. Documentation (technical abstract, demo script, setup guide, proof of concept) is available in the `submission/` directory.

> Built with ❤️ for the Namma Space competition at Techfest IIT Bombay.
