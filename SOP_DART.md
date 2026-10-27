# DART Standard Operating Procedure (SOP_DART.md)
## Doorway-Anchored Repeatable Twin (DART) Field Capture Protocol
**Techfest 2026–27, IIT Bombay | Namma Space Round 1**

---

### 1. Pre-Capture Preparation & Room Registration
1. **Identifier Allocation**:
   - Assign unique alphanumeric codes to each room: `R01`, `R02`, etc.
   - Assign unique alphanumeric codes to each connecting doorway: `D01`, `D02`, etc.
2. **Ground Truth Metric Calibration**:
   - Measure physical room length ($L$), width ($W$), and floor-to-ceiling height ($H$) using a calibrated laser distance meter or precision steel tape.
   - Measure doorway clear aperture width ($W_D$) and clear height ($H_D$) to millimeter precision.
3. **Primary Coordinate Origin**:
   - Designate the South-West floor corner at finished floor level as the $(0, 0, 0)$ datum origin.
4. **Optical Rig Configuration**:
   - Camera: Smartphone or mirrorless digital camera.
   - Focal length: Fixed focal length (equivalent to 24mm–35mm full frame). **Do NOT use digital zoom**.
   - Focus: Fixed manual focus or autofocus locked to hyperfocal distance.
   - Exposure: Fixed manual shutter speed and ISO (ISO 100 or 200). Avoid auto-exposure changes that introduce photometric color shifts.
   - Lighting: Turn on all ambient overhead lights. Close window blinds if direct exterior sunlight creates blinding harsh specular highlights.

---

### 2. The Three-Pass Capture Protocol

#### Pass A: Structural Perimeter Sweep (Corners & Boundaries)
- **Goal**: Establish the structural skeleton of the room.
- **Execution**: Walk clockwise along the room perimeter facing outward toward walls.
- **Overlap**: Maintain a strict **>= 70% consecutive overlap** between frames.
- **Key Targets**:
  - All 4 wall-to-wall vertical corners from floor to ceiling.
  - Floor-wall junctions and ceiling-wall junctions.
  - Windows and primary doorway frames.
- **Minimum Count**: At least 8 photographs for standard rooms (2 per wall quadrant).

#### Pass B: Diagonal Cross-Angles & Occlusion Clearance
- **Goal**: Clear geometric blindspots and resolve furniture occlusions.
- **Execution**: Stand at room corners and capture diagonal 45° perspective shots traversing the center of the space.
- **Key Targets**:
  - Faces and undersides of desks, tables, and cabinets.
  - Voids behind equipment racks and columns.
  - Shadow boundaries.
- **Minimum Count**: At least 4 diagonal perspective shots.

#### Pass C: Doorway Continuity & Supplemental Capture
- **Goal**: Bridge the visual coordinate systems of Room A and Room B.
- **Execution**:
  - **Frame 1**: Stand 2.5 meters back inside Room A facing directly through Doorway D01.
  - **Frame 2**: Step halfway across the threshold of Doorway D01, keeping both jambs in frame.
  - **Frame 3**: Step fully into Room B and immediately turn 180° to capture the **reciprocal observation** of Doorway D01 looking back into Room A.
- **Supplemental**: Capture close-ups of low-texture surfaces (e.g. smooth painted drywall) with removable low-tack calibration tape marks.

---

### 3. Quality Gate Verification (DART 100-Point Metric)
Before leaving the capture site:
1. Export photo files and create `manifest.csv`.
2. Open the **DART Quality Inspector**.
3. Verify that the room achieves a minimum score of **85/100**:
   - Coverage & Occlusion: $\ge 32/40$
   - Doorway Continuity: $\ge 20/25$
   - Measured-Dimension Agreement: $\ge 15/20$
   - Sharpness & Overlap: $\ge 12/15$
4. If the score is between 70 and 84, perform targeted recapture according to the Inspector's recommendations.
5. If the score is below 70, reshoot the room.
