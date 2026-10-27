# Namma Space — Round 1: 3D Reconstruction & Roaming

**Techfest IIT Bombay — Namma Space Competition**

Transform real indoor-space captures into an interactive 3D digital twin that users can explore freely in a web browser. No app install, no special camera, no 3D software required.

---

## 🏗️ Architecture

```
Namma Space
├── frontend/          React + Vite + TypeScript + Tailwind + Three.js
│   ├── src/components/   LandingPage, CaptureStudio, Viewer3D, SOP, etc.
│   ├── src/hooks/        useProjects, useRooms, useDoorways, usePhotos
│   ├── src/services/     api.ts (REST client with retry/backoff)
│   ├── src/utils/        reconstruction3DGenerator, roomModeling, dartScoring
│   └── src/types/dart.ts TypeScript types (NammaProject, RoomMetadata, etc.)
├── server.cjs          Node.js REST API (SQLite persistence)
├── server/api.cjs      API route handlers (projects, rooms, doorways, photos)
├── server/db.cjs       SQLite database schema
├── server/auth.cjs     Session-based auth (demo mode by default)
├── reconstruction_service/  FastAPI + COLMAP photogrammetry pipeline
│   ├── main.py         Job queue, photo upload, asset delivery
│   ├── pipeline/       COLMAP reconstruction scripts
│   └── requirements.txt Python dependencies
├── data/test/          Sample demonstration data (manifest.csv, room_plan.json)
├── assets/aistudio/    Sample placeholder images for demo
└── public/models/      Output directory for reconstructed GLB assets
```

---

## 🚀 Quick Start

### Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| Node.js | 18+ | Frontend dev server + API server |
| Python | 3.10+ | Reconstruction service (COLMAP) |
| npm | Bundled with Node | Package management |

### Option 1: Frontend Only (Instant Demo)

Run the frontend dev server + API server. Uses the **Calibrated Geometric Twin Engine** — works immediately with zero native dependencies.

```bash
# Terminal 1: Start the API server
npm run server

# Terminal 2: Start the frontend
npm run dev

# Open http://localhost:3000
```

### Option 2: Full Pipeline with COLMAP (Photogrammetry)

For real dense reconstruction from photos:

```bash
# Terminal 1: Start the API server
npm run server

# Terminal 2: Start the reconstruction service
npm run reconstruction

# Terminal 3: Start the frontend
npm run dev

# Open http://localhost:3000
```

**COLMAP requirements:** Python 3.10+, COLMAP 3.9+, FFmpeg
```bash
pip install -r reconstruction_service/requirements.txt
```

---

## 📖 How to Use

### 1. Create a Project
Click "Create New Project" on the dashboard. Give it a name and select your space type (Bedroom, Living Room, Office, etc.).

### 2. Follow the Capture SOP
Open **Capture Studio** and follow the 4-stage LoopAnchor SOP:

| Pass | Purpose | Minimum Photos |
|------|---------|----------------|
| Pass A | Perimeter structural loop (corners, walls) | 8 frames |
| Pass B | Diagonal occlusion sweep | 4 frames |
| Pass C | Inter-room doorway transit | 2 frames per door |

### 3. Upload Photos
Drag & drop photos (JPG, PNG, WebP) or upload a walkthrough video. The app validates sharpness, exposure, and overlap.

### 4. Reconstruct
Choose your engine:
- **Geometric Twin Engine** (recommended for web): Instant browser-based 3D from calibrated measurements
- **COLMAP Pipeline** (native): Full photogrammetry with dense point clouds

### 5. Explore in 3D
Click "Launch 3D Walkthrough". Use **WASD** to move and **mouse** to look around. Press **Esc** to exit pointer-lock mode.

---

## 📋 Sample Demonstration Project

A pre-configured sample project is included at `data/test/`:

| File | Purpose |
|------|---------|
| `data/test/manifest.csv` | 25 sample photos across 2 rooms (R01, R02) with Pass A/B/C coverage |
| `data/test/room_plan.json` | Room dimensions, doorway D01 between rooms, coordinate convention |
| `assets/aistudio/*.png` | 25 sample placeholder images |

The sample demonstrates:
- Two connected rooms with a doorway anchor (D01)
- Reciprocal doorway observations (Pass C transit photos in both rooms)
- Scale calibration against ground truth measurements
- First-person walkthrough in the browser

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
| `/api/manifest/validate` | GET/POST | Manifest integrity validation |

---

## 🧪 Testing

```bash
# TypeScript typecheck
npm run lint

# Frontend unit tests (utils)
npm test

# Python pipeline tests
npm run test:py

# API server tests
npm run test:api
```

---

## 📊 Reconstruction Engines

### Geometric Twin Engine (Browser)
- Zero native dependencies
- Runs entirely in the browser
- Dimensioned geometry from ground truth measurements
- Best for: instant web walkthroughs

### COLMAP Pipeline (Native)
- Structure-from-Motion photogrammetry
- Dense point clouds and meshes
- Requires COLMAP + GPU for best results
- Best for: photorealistic reconstruction

---

## ⚠️ Known Limitations

| Limitation | Details | Workaround |
|------------|---------|------------|
| COLMAP not installed by default | Photogrammetry pipeline requires manual installation | Use Geometric Twin Engine instead |
| No video frame extraction in browser | Video upload is validated but frame extraction requires FFmpeg server-side | Upload individual photos instead |
| Sample images are placeholders | `assets/aistudio/*.png` are generated placeholders, not real photos | Upload your own photos for real reconstruction |
| Single background worker | Reconstruction service processes one job at a time | Wait for job to complete before starting another |

---

## 📁 File Structure

```
Namma Space/
├── server.cjs              # API server entry point
├── server/api.cjs          # REST route handlers
├── server/db.cjs           # SQLite database
├── server/auth.cjs         # Session auth
├── package.json            # Node.js dependencies & scripts
├── vite.config.ts          # Vite build config
├── index.html              # HTML entry point
├── src/                    # React frontend
├── reconstruction_service/ # FastAPI + COLMAP
├── data/test/              # Sample demonstration data
├── assets/aistudio/        # Sample placeholder images
├── public/models/          # Output GLB assets
└── generate-sample-images.cjs # Sample image generator
```

---

## 📞 Support

For competition submission support, refer to the technical abstract and demonstration plan in the project documentation.
