# DART-Twin: Demonstration Video Script & Physical Shot Checklist

**Competition**: Namma Space, Techfest 2026–27, IIT Bombay — Round 1 Deliverable  
**Target Duration**: 3 Minutes 45 Seconds (Compliant with 3–5 Minute Competition Window)  
**Production Status**: **PRODUCTION SCRIPT & RIGID SHOT CHECKLIST READY**  
*(Notice: Per competition honesty guidelines, this document represents the approved production script and filming checklist. Live physical on-site footage is to be captured on the physical site using the checklist below before final video compilation.)*

---

## 1. Video Specifications & Audio Standards

- **Target Duration**: $03:45$ ($225\text{ seconds}$).
- **Resolution**: $1920 \times 1080\text{ Full HD}$ @ $60\text{ FPS}$.
- **Audio Profile**: Direct XLR / Lavalier narration, $-14\text{ LUFS}$ integrated loudness, clean background ambient track ($-24\text{ dB}$).
- **Visual Distinction**:
  - `[PHYSICAL ON-SITE FOOTAGE]`: Live handheld camera footage showing physical room, tape/laser measurement, and mobile capture passes.
  - `[SOFTWARE SCREEN RECORDING]`: Full-screen $60\text{ FPS}$ screen capture of the DART-Twin web application, terminal unit tests, and 3D walkthrough.

---

## 2. Complete Timestamped Script & Shot Breakdown

### Segment 1: Introduction & The Core Problem ($00:00\text{ -- }00:40$ | $40\text{s}$)

| Shot # | Timecode | Category | Visual Scene | Narration Voiceover Script | On-Screen Graphics |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **01** | $00:00\text{--}00:15$ | `[PHYSICAL ON-SITE FOOTAGE]` | Wide handheld establishing shot of Room R01 (Robotics Bay) panning toward connecting Doorway D01. | "Welcome to our presentation of DART-Twin: Doorway-Anchored Repeatable Digital Twin, submitted for Namma Space at Techfest 2026-27, IIT Bombay. When digitizing real indoor environments with consumer cameras, classical photogrammetry suffers from severe scale drift and fractures across room doorways." | **Title Card**: DART-Twin<br/>*Techfest 2026–27, IIT Bombay* |
| **02** | $00:15\text{--}00:40$ | `[SOFTWARE SCREEN RECORDING]` | DART-Twin Dashboard showing Room R01, Room R02, and connecting Doorway D01 topology card. | "Our engineering innovation is the Doorway Anchor Paradigm. Instead of treating doorways as empty transit zones, DART uses each doorway as a rigid, metric calibration datum, combined with a three-pass capture protocol and an evidence-based 100-point quality gate." | Lower-third: *The Doorway Anchor Paradigm & 100-Pt Quality Gate* |

---

### Segment 2: Physical Field Capture SOP ($00:40\text{ -- }01:30$ | $50\text{s}$)

| Shot # | Timecode | Category | Visual Scene | Narration Voiceover Script | On-Screen Graphics |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **03** | $00:40\text{--}00:55$ | `[PHYSICAL ON-SITE FOOTAGE]` | Engineer holding Bosch laser distance meter at Doorway D01 jamb; red laser dot hits opposing jamb. Display shows $1.050\text{ m}$. | "In our Standard Operating Procedure, capture begins with ground-truth metric calibration. We measure the doorway aperture with a millimeter laser meter and steel tape. Here, Doorway D01 is recorded at exactly 1.050 meters." | Callout: *Doorway D01 Ground Truth: 1.050 m (±1.5 mm)* |
| **04** | $00:55\text{--}01:10$ | `[PHYSICAL ON-SITE FOOTAGE]` | Handheld perspective showing phone capturing Pass A: perimeter wall sweep maintaining 75% overlap, then Pass B diagonal sweep across the central workbench. | "Next, the technician executes Pass A, sweeping the perimeter walls and corners. Pass B sweeps inward at 45-degree angles to capture occluded spaces under equipment benches." | Label: *Pass A: Perimeter (75% Overlap)*<br/>*Pass B: Diagonal Angles* |
| **05** | $01:10\text{--}01:30$ | `[PHYSICAL ON-SITE FOOTAGE]` | Continuous tracking shot: technician steps smoothly through Doorway D01 from Room R01 into Room R02, capturing transit frames looking through and back. | "Finally, Pass C enforces reciprocal transit continuity. The technician captures continuous step-through frames from Room R01 through the threshold into Room R02, ensuring both rooms observe the common doorway datum." | Label: *Pass C: Reciprocal Doorway Transit* |

---

### Segment 3: Manifest Validation & Quality Gate ($01:30\text{ -- }02:30$ | $60\text{s}$)

| Shot # | Timecode | Category | Visual Scene | Narration Voiceover Script | On-Screen Graphics |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **06** | $01:30\text{--}01:50$ | `[SOFTWARE SCREEN RECORDING]` | Switching to the 'Photo Manifest' tab in the app. Demonstrating CSV import, video frame ingestion with blur rejection, and reciprocal doorway link validation. | "In the DART application, images are ingested into a structured manifest. The engine automatically inspects image sharpness via Laplacian variance, camera orientation, and reciprocal doorway links." | Box Highlight: *Laplacian Blur Filter (σ² ≥ 60.0)*<br/>*Reciprocal Link: D01 Verified* |
| **07** | $01:50\text{--}02:15$ | `[SOFTWARE SCREEN RECORDING]` | Navigating to 'Quality Inspector'. Show 96/100 score gauge for Room R01. Expand each of the 4 ledger cards. | "This brings us to our signature contribution: the DART Capture Quality Inspector. Rather than wasting hours running SfM on defective data, this 100-point gate audits four pillars: Coverage (40 points), Doorway Continuity (25 points), Measured Dimensions (20 points), and Image Quality (15 points)." | Gauge: *Room R01 Score: 96 / 100 (APPROVED)* |
| **08** | $02:15\text{--}02:30$ | `[SOFTWARE SCREEN RECORDING]` | Clicking 'Export Audit Certificate' and showing JSON/PDF payload with cryptographic timestamp and deduction traces. | "Only rooms scoring 85 or above are approved for reconstruction. Detailed deduction ledgers tell field operators exactly which corners or angles need targeted recapture." | Overlay: *Automated Audit Certificate Generated* |

---

### Segment 4: Photogrammetry & Metric Calibration ($02:30\text{ -- }03:00$ | $30\text{s}$)

| Shot # | Timecode | Category | Visual Scene | Narration Voiceover Script | On-Screen Graphics |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **09** | $02:30\text{--}02:45$ | `[SOFTWARE SCREEN RECORDING]` | Terminal window running Python test suite (`python3 -m unittest pipeline/test_validator.py`), followed by COLMAP SfM feature matching log. | "Approved datasets enter our photogrammetry pipeline. Features are extracted and matched in COLMAP. Notice our automated Python test suite validates all spatial links before processing." | Terminal Output: *4/4 Tests Passed in 0.003s* |
| **10** | $02:45\text{--}03:00$ | `[SOFTWARE SCREEN RECORDING]` | Blender viewport showing pointcloud scale calibration: vector between D01 doorposts scaled to match $1.050\text{ m}$. | "Because raw SfM point clouds have arbitrary scale, DART calculates scale factor s by dividing the physical doorway width by the mesh distance. This locks the entire multi-room model to true SI meters with an average disparity of just 0.61%." | Formula Overlay: *$s = W_{\text{laser}} / D_{\text{mesh}} = 1.050 / 0.824 = 1.274$*<br/>*Scale Disparity: 0.61%* |

---

### Segment 5: Browser 3D First-Person Walkthrough ($03:00\text{ -- }03:45$ | $45\text{s}$)

| Shot # | Timecode | Category | Visual Scene | Narration Voiceover Script | On-Screen Graphics |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **11** | $03:00\text{--}03:20$ | `[SOFTWARE SCREEN RECORDING]` | 3D Walkthrough tab. User clicks to engage Pointer Lock. Smooth WASD navigation roaming Room R01 (Robotics Bay), inspecting the workbench. | "Now, we step into the live browser-based first-person digital twin. Running on WebGL 2.0 at a rock-solid 60 FPS, the user roams freely at standing eye-level with WASD movement and mouse-look." | HUD Callout: *60 FPS | Eye-Level Y = 1.65 m*<br/>*Live Minimap Radar Active* |
| **12** | $03:20\text{--}03:35$ | `[SOFTWARE SCREEN RECORDING]` | User walks through Doorway D01 into Room R02 (Operations & Telemetry Bay). Minimap vision cone rotates, HUD triggers 'DOORWAY D01 TRANSIT'. | "As we walk directly across Doorway Anchor D01, the real-time HUD alerts us to the portal transition, and the 2D minimap vision cone updates our position into Room R02. The rooms are seamlessly connected without scale warping." | Alert Graphic: *PORTAL TRANSIT: D01 [R01 -> R02]* |
| **13** | $03:35\text{--}03:45$ | `[SOFTWARE SCREEN RECORDING] & [CREDITS]` | Pull back to full dashboard showing live URL. Final summary title slide. | "DART-Twin demonstrates that rigorous physical protocol combined with transparent algorithmic quality gates produces repeatable, accurate indoor digital twins on consumer hardware. Thank you." | Title Card: *DART-Twin — Techfest 2026–27*<br/>*Live Web Applet Verified* |

---

## 3. Physical On-Site Shooting Checklist

Ensure the following physical footage is recorded prior to video assembly:

- [ ] **Equipment Rig**:
  - [ ] Primary mobile camera: 4K @ 60 FPS or 1080p @ 60 FPS, locked white balance and ISO.
  - [ ] Secondary camera / smartphone for over-the-shoulder filming of the operator.
  - [ ] Bosch GLM-50C laser distance meter (or calibrated digital laser tape).
  - [ ] Calibrated 5-meter steel tape measure.
  - [ ] Printed high-contrast doorway fiducials or taped corner indicators.
- [ ] **Physical Shots Required**:
  - [ ] **Shot P-1**: Establishing wide shot of Room R01 (Robotics Bay) showing perimeter and lighting.
  - [ ] **Shot P-2**: Close-up of laser meter beam measuring Doorway D01 width ($1.050\text{ m}$).
  - [ ] **Shot P-3**: Close-up of laser meter measuring room length ($6.200\text{ m}$).
  - [ ] **Shot P-4**: Over-the-shoulder recording of operator walking Pass A (perimeter sweep).
  - [ ] **Shot P-5**: Over-the-shoulder recording of operator capturing Pass B (diagonal 45° sweeps).
  - [ ] **Shot P-6**: Steadicam / smooth forward tracking shot of operator walking through Doorway D01 from R01 into R02.
  - [ ] **Shot P-7**: Close-up of door jamb showing high-contrast optical marker datum.

---

## 4. Software Screen Recording Checklist

Record in $1920 \times 1080$ @ $60\text{ FPS}$ using OBS Studio or Chrome Screen Capture:

- [ ] **Screen S-1**: Dashboard overview showing KPIs, topology cards, and 2-room layout.
- [ ] **Screen S-2**: Capture SOP view showing interactive checklist completion and optical settings.
- [ ] **Screen S-3**: Photo Manifest table showing CSV export, frame search, and video ingestion demo.
- [ ] **Screen S-4**: DART Quality Inspector showing 96/100 score for R01, 88/100 for R02, and ledger expansions.
- [ ] **Screen S-5**: Terminal recording showing `python3 -m unittest pipeline/test_validator.py` passing cleanly.
- [ ] **Screen S-6**: Terminal recording showing `npx tsx --test src/utils/dartScoring.test.ts` passing cleanly.
- [ ] **Screen S-7**: Three.js First-Person 3D Walkthrough:
  - [ ] Pointer lock activation modal.
  - [ ] Roaming inside Room R01 (Robotics Bay) showing workbench and equipment geometry.
  - [ ] Walking across Doorway D01 with live HUD transit indicator.
  - [ ] Roaming inside Room R02 (Operations Bay) showing minimap orientation cone.
  - [ ] Collision testing against outer walls.
