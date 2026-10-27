# DART-Twin: Proof of Concept & Live Web Viewer URLs
**Competition**: Namma Space, Techfest 2026–27, IIT Bombay — Round 1 Deliverable

---

## 1. Verified Live Deployment URLs

The interactive browser-based 3D digital twin walkthrough and DART Quality Inspector are deployed and verified at the following live public endpoints:

- **Shared Public Applet URL**:  
  `https://ais-pre-mgnf5uyoq2hyk4pavqx44q-301961471096.asia-southeast1.run.app`

- **Development Active Applet URL**:  
  `https://ais-dev-mgnf5uyoq2hyk4pavqx44q-301961471096.asia-southeast1.run.app`

---

## 2. Browser Verification Summary

- **Target Viewports Tested**:
  - Desktop: $1440 \times 900\text{ px}$ (Full HUD, 3D Roaming, Minimap Radar, Split Topology Cards)
  - Mobile: $390 \times 844\text{ px}$ (Responsive tabs, touch targets, non-overflowing metrics)
- **Supported Browsers**:
  - Chromium-based (Chrome, Edge, Brave): Full WebGL 2.0, Pointer Lock API, ResizeObserver
  - Mozilla Firefox: WebGL 2.0, Pointer Lock API
  - Apple Safari (WebKit): WebGL 2.0, Full First-Person Roaming
- **Engine Performance**:
  - Stable 60 FPS first-person camera roaming
  - Decoupled HUD physics telemetry (10 Hz update throttle) to eliminate 60 Hz React reconciliation overhead
  - Memory-safe Three.js geometry disposal on component unmount

---

## 3. Alternative Local Reproduction Procedure

To run the application locally on any standard computer:
```bash
# Clone the repository
git clone <YOUR_GIT_REPO_URL>
cd dart-twin

# Install dependencies (Node v20+ / npm v10+)
npm install

# Start local server on Port 3000
npm run dev

# Open browser to http://localhost:3000
```
