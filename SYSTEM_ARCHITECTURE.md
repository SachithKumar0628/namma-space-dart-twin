# DART-Twin: System Architecture Document

**Competition**: Namma Space, Techfest 2026–27, IIT Bombay  
**Document Revision**: 1.0 (Round 1 Deliverable)

---

## 1. High-Level Architecture Overview

DART-Twin utilizes a **hybrid photogrammetric and metric calibration architecture** that balances photorealistic geometric recovery with real-world metric dimensions.

```
+-----------------------------------------------------------------------------------+
|                              1. FIELD CAPTURE STAGE                               |
|  - Pass A: Structural perimeter (corners, boundaries, doors)                      |
|  - Pass B: Diagonal sweeps (furniture, occlusions)                                |
|  - Pass C: Doorway threshold transit (reciprocal observation R01 <-> D01 <-> R02)  |
|  - Laser / Tape Measurements: Ground Truth (L, W, H, Door width/height)           |
+-----------------------------------------------------------------------------------+
                                          |
                                          v
+-----------------------------------------------------------------------------------+
|                        2. MANIFEST AUDIT & VALIDATION                             |
|  - Manifest CSV Parser & Field Type Checker                                       |
|  - Duplicate Identifier Detection (Room IDs, Door IDs, Image Filenames)           |
|  - Reciprocal Doorway Link Validator                                              |
+-----------------------------------------------------------------------------------+
                                          |
                                          v
+-----------------------------------------------------------------------------------+
|                     3. DART CAPTURE QUALITY INSPECTOR GATE                        |
|  - Pillar 1: Coverage & Occlusion Review (40 Points)                              |
|  - Pillar 2: Doorway Continuity & Reciprocity (25 Points)                         |
|  - Pillar 3: Measured-Dimension Agreement (20 Points)                             |
|  - Pillar 4: Sharpness, Exposure & Overlap (15 Points)                            |
|                                                                                   |
|  Decision Boundary:                                                               |
|    * Score >= 85: Accepted -> Proceed to Reconstruction                           |
|    * Score 70-84: Targeted Recapture Required                                     |
|    * Score < 70 : Recapture Recommended                                           |
+-----------------------------------------------------------------------------------+
                                          |
                                          v
+-----------------------------------------------------------------------------------+
|                 4. STRUCTURE-FROM-MOTION (COLMAP SfM)                             |
|  - SIFT Feature Extraction across Pass A/B/C                                      |
|  - Sequential Feature Matcher with Doorway Loop Detection                         |
|  - Bundle Adjustment & Sparse Point Cloud Generation                              |
+-----------------------------------------------------------------------------------+
                                          |
                                          v
+-----------------------------------------------------------------------------------+
|               5. BLENDER METRIC SCALE CALIBRATION & REFINEMENT                    |
|  - Doorway Anchor Calibration: Scale factor S = W_ground_truth / D_sfm            |
|  - Coordinate Origin Alignment: SW floor corner at (0, 0, 0)                      |
|  - Outlier mesh trimming & Poisson surface reconstruction                         |
|  - glTF 2.0 / GLB Binary Export with Draco Compression                            |
+-----------------------------------------------------------------------------------+
                                          |
                                          v
+-----------------------------------------------------------------------------------+
|                    6. WEB-BASED 3D DIGITAL TWIN VIEWER                            |
|  - Three.js WebGL Engine with Software Fallback Support                           |
|  - First-Person Controller: WASD + Pointer Lock Mouse-Look                        |
|  - Real-Time 2D Minimap Radar (Coordinates, Direction Cone, Doorway Markers)      |
|  - Doorway Proximity & Transit Telemetry HUD                                      |
|  - Client-Side Custom GLB Upload and Scale Verification                           |
+-----------------------------------------------------------------------------------+
```

---

## 2. Metric Calibration Formula

In uncalibrated monocular photogrammetry, Structure-from-Motion estimates geometry only up to an arbitrary scale factor $\lambda$:

$$\mathbf{x}_{\text{real}} = \lambda \cdot \mathbf{x}_{\text{sfm}}$$

DART-Twin computes the precise scalar multiplier using the ground-truth physical width of the calibrated doorway anchor $D01$:

$$\lambda = \frac{W_{\text{tape}}}{\|\mathbf{v}_{\text{jamb,left}} - \mathbf{v}_{\text{jamb,right}}\|}$$

Where:
- $W_{\text{tape}}$ is the physical measurement of the doorway aperture in meters.
- $\mathbf{v}_{\text{jamb,left}}$ and $\mathbf{v}_{\text{jamb,right}}$ are the 3D vertex coordinates of the doorway frame base in the SfM coordinate space.

---

## 3. Data Integrity & Schemas

### Room Metadata Schema (`room_plan.json`)
```json
{
  "id": "R01",
  "name": "Robotics Assembly Bay",
  "category": "Laboratory",
  "lengthMeters": 6.20,
  "widthMeters": 4.50,
  "heightMeters": 2.85,
  "originDescription": "South-West floor corner datum",
  "connectedDoorwayIds": ["D01"]
}
```

### Doorway Anchor Schema
```json
{
  "id": "D01",
  "name": "Inter-Bay Access Portal",
  "connectedRoomIds": ["R01", "R02"],
  "widthMeters": 1.05,
  "heightMeters": 2.15,
  "wallLocation": "east",
  "offsetMeters": 2.10,
  "observations": {
    "roomAObserved": true,
    "roomBObserved": true,
    "hasContinuousPassCPhoto": true,
    "measuredWidthDiffMm": 3.2
  }
}
```
