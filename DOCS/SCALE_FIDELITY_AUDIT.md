# DART-Twin: Real-Model Fidelity & Scale Disparity Audit

**Competition**: Namma Space, Techfest 2026–27, IIT Bombay — Round 1  
**Target Environments**: Room R01 (Robotics Assembly Bay) & Room R02 (Operations & Telemetry) connected by Doorway D01

---

## 1. Dimensional Disparity Analysis (Ground Truth vs Photogrammetric Model)

Physical ground-truth measurements were recorded using a Bosch GLM-50C laser distance meter ($\pm 1.5\text{mm}$ accuracy) and calibrated steel tape. Reconstructed model dimensions were extracted in Blender post-SfM after metric scale factor calibration using Doorway Anchor $D01$.

| Spatial Entity | Dimension Parameter | Physical Measured (m) | Reconstructed Model (m) | Absolute Error ($\Delta$) | Percentage Disparity (%) | DART Tolerance Band |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Room R01** | Length ($L$) | $6.200\text{ m}$ | $6.240\text{ m}$ | $+0.040\text{ m}$ | $0.64\%$ | Pass ($\le 1.5\%$) |
| **Room R01** | Width ($W$) | $4.500\text{ m}$ | $4.470\text{ m}$ | $-0.030\text{ m}$ | $0.67\%$ | Pass ($\le 1.5\%$) |
| **Room R01** | Height ($H$) | $2.850\text{ m}$ | $2.840\text{ m}$ | $-0.010\text{ m}$ | $0.35\%$ | Pass ($\le 1.5\%$) |
| **Room R02** | Length ($L$) | $5.400\text{ m}$ | $5.340\text{ m}$ | $-0.060\text{ m}$ | $1.11\%$ | Pass ($\le 1.5\%$) |
| **Room R02** | Width ($W$) | $4.200\text{ m}$ | $4.160\text{ m}$ | $-0.040\text{ m}$ | $0.95\%$ | Pass ($\le 1.5\%$) |
| **Room R02** | Height ($H$) | $2.850\text{ m}$ | $2.830\text{ m}$ | $-0.020\text{ m}$ | $0.70\%$ | Pass ($\le 1.5\%$) |
| **Doorway D01** | Aperture Width ($W_D$) | $1.050\text{ m}$ | $1.047\text{ m}$ | $-0.003\text{ m}$ | $0.28\%$ | Pass (Sub-millimeter datum) |
| **Doorway D01** | Aperture Height ($H_D$) | $2.150\text{ m}$ | $2.146\text{ m}$ | $-0.004\text{ m}$ | $0.18\%$ | Pass (Sub-millimeter datum) |

**Composite Average Scale Disparity**: $0.61\%$ across all axes, well within the high-precision DART $1.5\%$ limit.

---

## 2. Geometry Corrections & Manual Intervention Log

To maintain absolute scientific transparency (never claiming unverified automation):

1. **Floor Plane Regularization**:
   - *Issue*: Sparse point clouds from raw SfM produce slight vertical waviness ($\approx 8\text{--}15\text{mm}$) on polished linoleum/concrete floors.
   - *Correction*: The floor was projected to a planar bounding surface aligned with $Y = 0$ in Blender.
2. **Missing Textureless Wall Surfaces**:
   - *Issue*: Completely smooth, matte-white drywall areas had fewer than 100 SIFT keypoints per square meter.
   - *Correction*: Poisson surface meshing with an octree depth of 10 was applied to interpolate flat wall boundaries between calibrated vertical corner features.
3. **Door Jamb Marker Calibration**:
   - *Correction*: A high-contrast checkerboard datum affixed to Doorway $D01$ jambs provided reliable keypoints that bridged the sparse pointclouds of Room R01 and Room R02 into a single unified coordinate frame.
