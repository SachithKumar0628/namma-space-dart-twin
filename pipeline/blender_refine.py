"""
DART-Twin: Blender Metric Scale Calibration & GLB Export Script
Run within Blender's Python console: blender --background --python pipeline/blender_refine.py -- <args>
"""

import sys
import os

BLENDER_INSTRUCTIONS = """
DART-TWIN BLENDER SCALE CALIBRATION & CLEANUP SOP
--------------------------------------------------
1. IMPORT:
   - File -> Import -> Stanford (.ply) or Wavefront (.obj)
   - Select COLMAP dense mesh or Poisson reconstruction output.

2. METRIC DATUM CALIBRATION USING DOORWAY ANCHOR D01:
   - Identify Doorway D01 frame markers in Edit Mode.
   - Select the two lower frame jamb vertices.
   - Press [N] -> Measure Tool or inspect Euclidean distance between vertices (D_mesh).
   - Compute Scale Factor: S = W_ground_truth / D_mesh
     (e.g., if ground truth width is 1.05m and D_mesh is 3.12 units, S = 1.05 / 3.12 = 0.3365).
   - In Object Mode: Object -> Transform -> Scale -> Enter factor S.
   - Object -> Apply -> All Transforms (Ctrl+A).

3. COORDINATE SYSTEM ALIGNMENT:
   - Set 3D Cursor to Room R01 SW floor corner.
   - Object -> Set Origin -> To 3D Cursor.
   - Position origin at (0, 0, 0).
   - Ensure Floor aligns exactly with Z = 0 (Blender) -> Y = 0 (glTF export conversion).

4. POISSON HOLE FILLING & CLEANUP:
   - Enter Edit Mode -> Select Loose Vertices -> Delete.
   - Apply 'Remesh' modifier (Voxel size 0.03m) for architectural solid boundaries or decimate flat walls.
   - Retain texture UVs from COLMAP unwrap.

5. GLB EXPORT:
   - File -> Export -> glTF 2.0 (.glb)
   - Format: glTF Binary (.glb)
   - Include: Selected Objects, Normals, UVs, Materials.
   - Compression: Optional Draco mesh compression (level 7).
   - Destination: public/models/dart_twin_reconstruction.glb
"""

def print_help():
    print(BLENDER_INSTRUCTIONS)

if __name__ == "__main__":
    print_help()
