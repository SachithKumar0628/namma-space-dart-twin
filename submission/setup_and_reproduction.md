# NammaTwin: LoopAnchor Studio — Setup, Reproduction & Rebuild Guide

**Competition**: Namma Space Round 1, Techfest 2026–27, IIT Bombay  
**Target Environment**: Windows 10/11 with VS Code (also fully compatible with macOS and Ubuntu Linux)  
**Deliverable**: Setup, Verification, and Pipeline Reproduction Instructions  

---

## 1. System Requirements & Prerequisites

### Minimum Requirements:
- **Operating System**: Windows 10/11 64-bit (or macOS 12+ / Ubuntu 22.04 LTS)
- **Code Editor**: Visual Studio Code
- **Node.js**: v20.x LTS or higher (includes `npm` v10+)
- **Python**: v3.10 or higher
- **Web Browser**: Google Chrome, Microsoft Edge, Brave, or Mozilla Firefox with WebGL 2.0 support

### Optional for Native Photogrammetry Pipeline:
- **COLMAP**: v3.8+ (Windows binary with CUDA or CPU support)
- **FFmpeg**: v5.0+ (for native video frame extraction)
- **Blender**: v3.6+ or v4.x (for mesh clean-up and GLB export)

---

## 2. Quickstart: Running the Web Application (3 Minutes)

Open **VS Code**, launch a terminal (**Ctrl + `** or `Terminal -> New Terminal`), and run the following commands:

### Step 1: Clone Repository & Navigate to Directory
```powershell
# Open terminal in your development workspace
cd \path\to\nammato-studio
```

### Step 2: Install Frontend Dependencies
```powershell
npm install
```
*Installs React 19, Three.js, Lucide icons, Vite, Tailwind CSS, Motion, and development tools.*

### Step 3: Run the Development Server
```powershell
npm run dev
```
*Output:*
```
  VITE v8.3.0  ready in 240 ms

  ➜  Local:   http://localhost:3000/
  ➜  Network: use --host to expose
```

### Step 4: Access in Browser
Open your browser and navigate to:
```
http://localhost:3000
```
The application will load with pre-calibrated sample project data for the Robotics Assembly Bay ($6.20\text{m} \times 4.50\text{m}$) and Operations & Telemetry Bay ($5.40\text{m} \times 4.20\text{m}$).

---

## 3. Running Automated Test Suites

The application includes dual test suites in TypeScript and Python to verify scoring accuracy, spatial constraints, and topological integrity.

### Test Suite 1: TypeScript DART 100-Point Quality Gate
Verifies scoring edge cases, deduction penalties, and gate pass thresholds:
```powershell
npx tsx --test src/utils/dartScoring.test.ts
```
*Expected Output:*
```
✔ DART Scoring Suite > should score sample data with high quality (approving room)
✔ DART Scoring Suite > should apply heavy penalties for missing doorway continuity
✔ DART Scoring Suite > should penalize dimensional disparity above tolerance
✔ DART Scoring Suite > should deduct points for low image sharpness and blur
✔ DART Scoring Suite > should correctly identify approval status (>= 85 pts)
✔ DART Scoring Suite > should handle edge case with empty photos cleanly
ℹ tests 6
ℹ suites 1
ℹ pass 6
ℹ fail 0
```

### Test Suite 2: Python Topology & Spatial Anchor Validator
Validates the structural manifest and room topology against laser ground truth:
```powershell
python3 -m unittest pipeline/test_validator.py
```
*(On Windows command prompt, use `python -m unittest pipeline/test_validator.py`)*  
*Expected Output:*
```
....
----------------------------------------------------------------------
Ran 4 tests in 0.003s

OK
```

---

## 4. Rebuilding a 3D Model from Sample Data

The repository includes a privacy-safe calibrated benchmark dataset located in both `data/test/` and `test/sample_data/`:
- `data/test/room_plan.json` — Room dimensions, category, and doorway connection definitions.
- `data/test/manifest.csv` — 25 logged photographic records with pose tags, focal lengths, sharpness metrics, and doorway anchors.

### Rebuilding via Browser Geometric Twin Engine:
1. Launch the web application (`npm run dev`).
2. Navigate to **"Capture Studio"** in the top navigation.
3. Observe the 4-Stage LoopAnchor protocol checklist.
4. Click **"Reconstruction"** in the top navigation.
5. In the Reconstruction Workspace, select **"Browser Scale-Calibrated Geometric Twin"**.
6. Click **"Run Reconstruction Pipeline"**.
7. The engine executes 5 sequential stages:
   - `Ingesting Evidence & Photos`
   - `Extracting Keypoints & Spatial Graph`
   - `Calibrating Metric Scale via Doorway Anchor (D01: 1.050m)`
   - `Building 3D Mesh & Doorway Cutouts`
   - `Optimizing Three.js Textures & Collisions`
8. Upon completion, click **"Explore in 3D Walkthrough"** to immediately roam the rebuilt environment.

---

## 5. Offline Native Photogrammetry Pipeline (Optional Advanced Workflow)

For users wishing to run full Structure-from-Motion (SfM) dense point cloud reconstruction on their local workstation:

### Step 1: Video Frame Extraction with Blur Filtering
```powershell
python pipeline/extract_video_frames.py `
  --video data/test/sample_walkthrough.mp4 `
  --output data/test/extracted_frames/ `
  --interval 1.0 `
  --blur_threshold 60.0
```

### Step 2: Run COLMAP Feature Matching & Sparse Reconstruction
```powershell
python pipeline/reconstruct_full.py `
  --images colmap_images `
  --workspace data/colmap_workspace/ `
  --doorway-width 1.050 `
  --gpu-index 0
```
*This performs feature extraction, exhaustive matching, triangulation, and bundle adjustment, scaling the sparse point cloud using the measured doorway aperture datum ($1.050\text{ m}$).*

### Step 3: Blender Mesh Optimization & GLB Export
```powershell
blender --background --python pipeline/blender_refine.py -- `
  --input data/colmap_workspace/sparse/0/points3D.ply `
  --output public/models/reconstructed_space.glb
```

---

## 6. Building for Production Deployment

To compile the single-page application into static production assets:
```powershell
npm run build
```
The compiled, production-ready bundle will be generated in the `dist/` directory. It can be served with any static web host, NGINX, Cloudflare Pages, or Google Cloud Run.
