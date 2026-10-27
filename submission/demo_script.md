# NammaTwin: LoopAnchor Studio — Official Demonstration Video Script & Filming Checklist

**Competition**: Namma Space Round 1, Techfest 2026–27, IIT Bombay  
**Module Name**: LoopAnchor Studio (DART-Twin Framework)  
**Target Video Duration**: 3 Minutes 45 Seconds (Within the 3–5 Minute Competition Limit)  
**Production Status**: Ready for Demonstration Recording  

---

## 1. Video Technical Specifications & Production Standards

- **Target Running Time**: Exactly $03:45$ ($225\text{ seconds}$).
- **Video Resolution**: $1920 \times 1080\text{ (Full HD)}$ @ $60\text{ FPS}$, 16:9 aspect ratio.
- **Audio Profile**: Direct voiceover recording via external microphone, $-14\text{ LUFS}$ integrated loudness, clear narration without distracting background music.
- **Visual Honesty Tags**:
  - `[PHYSICAL ON-SITE FOOTAGE]`: Handheld camera footage showing physical room, Bosch laser distance meter measurement, doorpost tape markers, and physical capture passes.
  - `[SOFTWARE SCREEN RECORDING]`: Full-screen 60 FPS recording of the live DART-Twin web application, terminal test runs, and interactive WebGL 3D walkthrough.

---

## 2. Complete Timestamped Script & Shot-by-Shot Matrix

### Segment 1: Project Scope, Core Challenge & Architecture ($00:00\text{ -- }00:40$ | $40\text{s}$)

| Shot | Timecode | Category | Visual Scene | Spoken Voiceover Script | On-Screen Graphic / Text |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **01** | $00:00\text{--}00:15$ | `[PHYSICAL ON-SITE FOOTAGE]` | Handheld establishing shot of physical room (Robotics Assembly Bay) panning across the space toward connecting Doorway D01. | "Hello, this is our submission for the Namma Space Round 1 competition at Techfest 2026-27, IIT Bombay. Creating interactive 3D digital twins of real indoor spaces using ordinary consumer cameras typically suffers from three major flaws: cumulative scale drift, feature starvation on textureless walls, and coordinate fractures across doorways." | **Title Card**: NammaTwin — LoopAnchor Studio<br/>*Techfest 2026–27, IIT Bombay* |
| **02** | $00:15\text{--}00:40$ | `[SOFTWARE SCREEN RECORDING]` | NammaTwin Project Overview dashboard showing Room R01 ($6.20\text{m} \times 4.50\text{m}$) and Room R02 ($5.40\text{m} \times 4.20\text{m}$) connected by Doorway D01. | "To solve this, we built LoopAnchor Studio. Our core architectural innovation is the Doorway Anchor Paradigm. Instead of treating doorways as empty boundaries, we use doorways as rigid metric calibration anchors, combined with a four-stage capture protocol and an automated 100-point capture quality gate." | Lower-Third: *Doorway Anchor Paradigm & 100-Point Quality Gate* |

---

### Segment 2: The LoopAnchor Physical Capture SOP ($00:40\text{ -- }01:30$ | $50\text{s}$)

| Shot | Timecode | Category | Visual Scene | Spoken Voiceover Script | On-Screen Graphic / Text |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **03** | $00:40\text{--}00:55$ | `[PHYSICAL ON-SITE FOOTAGE]` | Close-up of operator holding a Bosch laser distance meter at the left doorpost of Doorway D01. Red laser beam hits right doorpost. Display reads $1.050\text{ m}$. | "Our capture SOP begins with physical ground-truth calibration. Before shooting images, we measure the reference doorway aperture with a millimeter laser distance meter. Here, Doorway D01 measures exactly 1.050 meters wide." | Callout: *Doorway D01 Ground Truth = 1.050 m (±1.5 mm)* |
| **04** | $00:55\text{--}01:10$ | `[PHYSICAL ON-SITE FOOTAGE]` | Third-person shot of operator walking Pass A (perimeter sweep maintaining 75% overlap along room walls), followed by Pass B (45-degree diagonal sweep capturing beneath workbenches). | "Next, the operator follows our strict multi-pass capture protocol: Pass A sweeps perimeter walls with 70 to 80 percent overlap to capture structural floor-wall-ceiling junctions. Pass B sweeps inward at 45-degree angles to map occluded spaces under equipment desks." | Callout: *Pass A: Perimeter (75% Overlap)*<br/>*Pass B: Diagonal Sweep* |
| **05** | $01:10\text{--}01:30$ | `[PHYSICAL ON-SITE FOOTAGE]` | Over-the-shoulder view of operator smoothly walking through Doorway D01 from Room R01 into Room R02 while capturing continuous reciprocal transit frames. | "Finally, Pass C enforces reciprocal transit continuity. The operator takes continuous step-through photos from Room R01 through the threshold into Room R02. This ensures both rooms share identical optical keypoints on the doorway frame, locking their coordinate systems together." | Callout: *Pass C: Reciprocal Doorway Transit* |

---

### Segment 3: Evidence Ingestion & 100-Point Quality Gate ($01:30\text{ -- }02:25$ | $55\text{s}$)

| Shot | Timecode | Category | Visual Scene | Spoken Voiceover Script | On-Screen Graphic / Text |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **06** | $01:30\text{--}01:50$ | `[SOFTWARE SCREEN RECORDING]` | Capture Studio view in web app. Demonstrate video keyframe sampling at 1.0-second intervals and client-side Laplacian blur rejection ($\sigma^2 \ge 60.0$). | "Back in LoopAnchor Studio, raw photos and video footage are ingested. The browser client calculates real-time Laplacian sharpness metrics, automatically flagging or rejecting blurry frames before they corrupt the point cloud." | Indicator: *Laplacian Sharpness Check: Passed ($\sigma^2 \ge 60.0$)* |
| **07** | $01:50\text{--}02:10$ | `[SOFTWARE SCREEN RECORDING]` | Switching to the Quality Inspector view. The 100-point DART score gauge displays 96/100 for Room R01. Expanding all 4 pillar ledgers. | "Datasets then pass through our 100-Point Quality Gate. Rather than blindly launching heavy photogrammetry reconstruction on flawed data, the gate verifies four pillars: Coverage (40 pts), Doorway Continuity (25 pts), Dimension Agreement (20 pts), and Image Sharpness (15 pts)." | Score Gauge: *Room R01 Score: 96 / 100 (APPROVED)* |
| **08** | $02:10\text{--}02:25$ | `[SOFTWARE SCREEN RECORDING]` | Clicking 'Export Audit Certificate' to display the cryptographically timestamped JSON certificate with full deduction traces. | "Only datasets achieving 85 points or higher are approved for 3D reconstruction. Transparent deduction ledgers provide actionable feedback if any corner or doorway link requires recapture." | Overlay: *Cryptographic Audit Certificate Generated* |

---

### Segment 4: Dual Reconstruction & Automated Tests ($02:25\text{ -- }02:55$ | $30\text{s}$)

| Shot | Timecode | Category | Visual Scene | Spoken Voiceover Script | On-Screen Graphic / Text |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **09** | $02:25\text{--}02:40$ | `[SOFTWARE SCREEN RECORDING]` | Terminal window executing automated tests: `python3 -m unittest pipeline/test_validator.py` and `npx tsx --test src/utils/dartScoring.test.ts`. Both pass completely. | "Our architecture features transparent dual engines. Every spatial constraint is verified through automated test suites in both TypeScript and Python, confirming topological integrity and score stability across environments." | Terminal: *6/6 TypeScript Tests OK | 4/4 Python Tests OK* |
| **10** | $02:40\text{--}02:55$ | `[SOFTWARE SCREEN RECORDING]` | Reconstruction Workspace view showing the calibrated geometric twin generation and the native COLMAP CLI export scripts for offline dense meshing. | "For browser clients, our Scale-Calibrated Geometric Twin engine generates accurate 3D rooms instantly without crashing browser memory. For offline workstations, our COLMAP scripts compute dense point clouds scaled to true SI meters using the doorway datum." | Workflow Diagram: *Dual-Engine Architecture Overview* |

---

### Segment 5: Browser 3D Walkthrough & Metric Verification ($02:55\text{ -- }03:45$ | $50\text{s}$)

| Shot | Timecode | Category | Visual Scene | Spoken Voiceover Script | On-Screen Graphic / Text |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **11** | $02:55\text{--}03:20$ | `[SOFTWARE SCREEN RECORDING]` | 3D Walkthrough viewport in Three.js WebGL 2.0. Demonstrating mouse pointer-lock, walking forward with `W`, turning smoothly, walking through Doorway D01 from Room R01 into Room R02. | "Now let's explore the reconstructed 3D digital twin. Running entirely in WebGL at a rock-solid 60 FPS, the viewer features full first-person WASD navigation, pointer-lock mouse look, and physics collision boundaries. Here, we smoothly navigate from the Robotics Assembly Bay through Doorway D01 directly into the Telemetry Bay." | Live HUD: *FPS: 60 | Pos: X=4.12m, Y=1.68m, Z=-2.04m* |
| **12** | $03:20\text{--}03:35$ | `[SOFTWARE SCREEN RECORDING]` | Close-up of real-time Minimap Radar in top-right corner tracking player coordinates and facing cone; bottom-left telemetry showing exact coordinates in meters. | "The minimap radar tracks user position in real time. Notice the metric telemetry HUD displaying precise physical coordinates in SI meters." | Overlay: *Real-time Minimap & Metric Coordinate HUD* |
| **13** | $03:35\text{--}03:45$ | `[SOFTWARE SCREEN RECORDING]` | Side-by-side split screen showing laser ground-truth measurements vs model dimensions (mean disparity: $0.61\%$) and the live public URL. | "Comparing model dimensions with our laser ground truth confirms a mean dimensional disparity of just 0.61 percent across eight measured axes. The viewer is deployed live and ready to explore. Thank you." | Closing Card: *Mean Disparity: 0.61% | Live at ais-pre-mgnf5uyoq2hyk4pavqx44q...* |

---

## 3. Physical Filming Equipment Checklist

To record the physical on-site footage required for Shots 01, 03, 04, and 05:
1. **Smartphone / Mirrorless Camera**: Set to $1080\text{p}$ / $60\text{ FPS}$ with fixed white balance and locked exposure.
2. **Bosch GLM-50C Laser Distance Meter** (or standard millimeter steel tape): For measuring doorway jambs and wall lengths on camera.
3. **Contrast Marker Tape / Printed ArUco Markers**: Placed on doorposts to clearly demonstrate visual anchor registration.
4. **Wireless Lavalier Mic**: For clean narration audio without ambient room reverb.
