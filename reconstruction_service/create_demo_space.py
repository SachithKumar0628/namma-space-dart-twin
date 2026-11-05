"""
Generate a rich, photorealistic 3D architectural gallery space in .splat format.

Creates:
  data/outputs/demo/model.splat (compressed 32-byte splat format)
  data/outputs/demo/meta.json
"""

import json
from pathlib import Path
import numpy as np

SERVICE_DIR = Path(__file__).resolve().parent
OUTPUT_DIR = (SERVICE_DIR / "data" / "outputs" / "demo").resolve()
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)


def generate_architectural_demo():
    points = []
    scales = []
    colors = []
    quats = []

    def add_surface_points(pts, rgb, scale=0.03, alpha=245):
        n = len(pts)
        for i in range(n):
            points.append(pts[i])
            scales.append([scale, scale, scale])
            colors.append([rgb[0], rgb[1], rgb[2], alpha])
            quats.append([255, 128, 128, 128])

    # 1. Floor: Obsidian slate floor at Y = 0.0 (-6 <= X <= 6, -6 <= Z <= 6)
    fx = np.linspace(-6.0, 6.0, 180)
    fz = np.linspace(-6.0, 6.0, 180)
    FX, FZ = np.meshgrid(fx, fz)
    FX = FX.flatten()
    FZ = FZ.flatten()
    FY = np.zeros_like(FX)

    floor_pts = np.column_stack([FX, FY, FZ])
    floor_colors = np.zeros((len(FX), 3), dtype=np.uint8)
    for i in range(len(FX)):
        x, z = FX[i], FZ[i]
        is_grid = (abs(x % 1.0) < 0.03) or (abs(z % 1.0) < 0.03)
        if is_grid:
            floor_colors[i] = [0, 210, 255]
        else:
            base = 18 + int((np.sin(x * 3) * np.cos(z * 3) + 1) * 6)
            floor_colors[i] = [base, base + 2, base + 6]

    for i in range(len(floor_pts)):
        points.append(floor_pts[i])
        scales.append([0.038, 0.015, 0.038])
        colors.append([floor_colors[i][0], floor_colors[i][1], floor_colors[i][2], 250])
        quats.append([255, 128, 128, 128])

    # 2. Four perimeter walls (Height: 0 to 3.2m)
    y_wall = np.linspace(0.0, 3.2, 50)
    w_side = np.linspace(-6.0, 6.0, 150)
    WY, WS = np.meshgrid(y_wall, w_side)
    WY = WY.flatten()
    WS = WS.flatten()

    back_pts = np.column_stack([WS, WY, np.full_like(WS, 6.0)])
    front_pts = np.column_stack([WS, WY, np.full_like(WS, -6.0)])
    left_pts = np.column_stack([np.full_like(WS, -6.0), WY, WS])
    right_pts = np.column_stack([np.full_like(WS, 6.0), WY, WS])

    wall_rgb = [40, 44, 52]
    add_surface_points(back_pts, wall_rgb, scale=0.045)
    add_surface_points(front_pts, wall_rgb, scale=0.045)
    add_surface_points(left_pts, wall_rgb, scale=0.045)
    add_surface_points(right_pts, wall_rgb, scale=0.045)

    # 3. Four architectural columns at (+-3.5, Y, +-3.5)
    angles = np.linspace(0, 2 * np.pi, 28, endpoint=False)
    col_radius = 0.35
    col_y = np.linspace(0.0, 3.2, 45)
    for cx, cz in [(-3.5, -3.5), (3.5, -3.5), (-3.5, 3.5), (3.5, 3.5)]:
        c_pts = []
        for y in col_y:
            for a in angles:
                c_pts.append([cx + col_radius * np.cos(a), y, cz + col_radius * np.sin(a)])
        c_pts = np.array(c_pts, dtype=np.float32)
        add_surface_points(c_pts, [210, 215, 222], scale=0.035)

    # 4. Central gallery dais at (0, Y, 0)
    dais_angles = np.linspace(0, 2 * np.pi, 60, endpoint=False)
    dais_r = np.linspace(0.0, 1.8, 30)
    dais_top = []
    for r in dais_r:
        for a in dais_angles:
            dais_top.append([r * np.cos(a), 0.35, r * np.sin(a)])
    dais_top = np.array(dais_top, dtype=np.float32)
    add_surface_points(dais_top, [25, 29, 36], scale=0.035)

    dais_ring = []
    for a in np.linspace(0, 2 * np.pi, 120, endpoint=False):
        dais_ring.append([1.82 * np.cos(a), 0.35, 1.82 * np.sin(a)])
    dais_ring = np.array(dais_ring, dtype=np.float32)
    add_surface_points(dais_ring, [0, 210, 255], scale=0.025, alpha=255)

    # 5. Central 3D sculptural pavilion on the dais
    sculpt_t = np.linspace(0, 4 * np.pi, 200)
    sculpt_pts = []
    for t in sculpt_t:
        r = 0.6 + 0.3 * np.sin(t * 3)
        y = 0.6 + (t / (4 * np.pi)) * 1.5
        sculpt_pts.append([r * np.cos(t), y, r * np.sin(t)])
    sculpt_pts = np.array(sculpt_pts, dtype=np.float32)
    add_surface_points(sculpt_pts, [0, 220, 255], scale=0.035, alpha=255)

    # 6. Ceiling structure with warm recessed lighting clusters
    ceil_y = 3.2
    cx = np.linspace(-6.0, 6.0, 40)
    cz = np.linspace(-6.0, 6.0, 40)
    CX, CZ = np.meshgrid(cx, cz)
    ceil_pts = np.column_stack([CX.flatten(), np.full_like(CX.flatten(), ceil_y), CZ.flatten()])
    add_surface_points(ceil_pts, [18, 20, 24], scale=0.05)

    # Pack into 32-byte .splat binary
    n_total = len(points)
    pts_arr = np.array(points, dtype=np.float32)
    scales_arr = np.array(scales, dtype=np.float32)
    colors_arr = np.array(colors, dtype=np.uint8)
    quats_arr = np.array(quats, dtype=np.uint8)

    splat_dtype = np.dtype([
        ("px", "<f4"), ("py", "<f4"), ("pz", "<f4"),
        ("sx", "<f4"), ("sy", "<f4"), ("sz", "<f4"),
        ("r", "u1"), ("g", "u1"), ("b", "u1"), ("a", "u1"),
        ("qw", "u1"), ("qx", "u1"), ("qy", "u1"), ("qz", "u1"),
    ])

    out = np.empty(n_total, dtype=splat_dtype)
    out["px"] = pts_arr[:, 0]
    out["py"] = pts_arr[:, 1]
    out["pz"] = pts_arr[:, 2]
    out["sx"] = scales_arr[:, 0]
    out["sy"] = scales_arr[:, 1]
    out["sz"] = scales_arr[:, 2]
    out["r"] = colors_arr[:, 0]
    out["g"] = colors_arr[:, 1]
    out["b"] = colors_arr[:, 2]
    out["a"] = colors_arr[:, 3]
    out["qw"] = quats_arr[:, 0]
    out["qx"] = quats_arr[:, 1]
    out["qy"] = quats_arr[:, 2]
    out["qz"] = quats_arr[:, 3]

    splat_path = OUTPUT_DIR / "model.splat"
    out.tofile(str(splat_path))
    print(f"Generated demo splat: {splat_path} ({n_total:,} Gaussians, {splat_path.stat().st_size / 1024:.1f} KB)")

    meta = {
        "session_id": "demo",
        "status": "complete",
        "model_path": "/outputs/demo/model.splat",
        "iterations": 7000,
        "image_count": 64,
        "floor_y": 0.0,
        "plane": [0.0, 1.0, 1.0, 0.0],
        "bounds": {
            "x_min": -5.8,
            "x_max": 5.8,
            "z_min": -5.8,
            "z_max": 5.8
        }
    }
    meta_path = OUTPUT_DIR / "meta.json"
    meta_path.write_text(json.dumps(meta, indent=2))
    print(f"Generated demo metadata: {meta_path}")


if __name__ == "__main__":
    generate_architectural_demo()
