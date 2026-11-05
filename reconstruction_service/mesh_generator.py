"""Independent worker script for dense 3D mesh reconstruction.

Runs in an isolated process to protect the main FastAPI uvicorn daemon from
Open3D/OpenMP thread-pool conflicts on macOS Apple Silicon.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np


def generate_mesh(point_cloud_path: Path, output_dir: Path) -> dict[str, int]:
    import open3d as o3d
    import trimesh
    from scipy.spatial import cKDTree

    pcd = o3d.io.read_point_cloud(str(point_cloud_path))
    num_pts = len(pcd.points)
    if num_pts < 30:
        raise ValueError(f"Point cloud has too few points ({num_pts}) for meshing.")

    # Filter statistical outliers
    cl, ind = pcd.remove_statistical_outlier(nb_neighbors=20, std_ratio=2.0)
    pcd_clean = pcd.select_by_index(ind)

    # Estimate surface normals
    pcd_clean.estimate_normals(
        search_param=o3d.geometry.KDTreeSearchParamHybrid(radius=0.5, max_nn=30)
    )
    pcd_clean.orient_normals_consistent_tangent_plane(15)

    # Poisson surface reconstruction
    mesh, densities = o3d.geometry.TriangleMesh.create_from_point_cloud_poisson(
        pcd_clean, depth=8, scale=1.1
    )

    densities_arr = np.asarray(densities)
    if len(densities_arr) > 0:
        threshold = float(np.quantile(densities_arr, 0.12))
        mesh.remove_vertices_by_mask(densities_arr < threshold)

    mesh.remove_degenerate_triangles()
    mesh.remove_duplicated_triangles()
    mesh.remove_duplicated_vertices()
    mesh.remove_non_manifold_edges()

    verts = np.asarray(mesh.vertices)
    faces = np.asarray(mesh.triangles)
    if len(verts) == 0 or len(faces) == 0:
        raise ValueError("Poisson reconstruction produced an empty mesh.")

    # Color interpolation from points
    clean_pts = np.asarray(pcd_clean.points)
    clean_cols = np.asarray(pcd_clean.colors)
    if len(clean_cols) == len(clean_pts) and len(clean_cols) > 0:
        tree = cKDTree(clean_pts)
        distances, indices = tree.query(verts, k=3)
        weights = 1.0 / np.maximum(distances, 1e-4)
        weights /= weights.sum(axis=1, keepdims=True)
        vertex_colors = np.sum(clean_cols[indices] * weights[:, :, None], axis=1)
        vertex_colors_u8 = (np.clip(vertex_colors, 0.0, 1.0) * 255).astype(np.uint8)
    else:
        vertex_colors_u8 = np.full((len(verts), 4), 220, dtype=np.uint8)

    tri_mesh = trimesh.Trimesh(
        vertices=verts,
        faces=faces,
        vertex_colors=vertex_colors_u8,
    )

    output_dir.mkdir(parents=True, exist_ok=True)
    glb_path = output_dir / "mesh.glb"
    glb_bytes = tri_mesh.export(file_type="glb")
    glb_path.write_bytes(glb_bytes)

    ply_path = output_dir / "mesh.ply"
    o3d.io.write_triangle_mesh(str(ply_path), mesh)

    return {
        "vertices": int(len(verts)),
        "triangles": int(len(faces)),
        "glbBytes": int(len(glb_bytes)),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate 3D mesh from point cloud")
    parser.add_argument("--point-cloud", required=True, type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    args = parser.parse_args()

    try:
        stats = generate_mesh(args.point_cloud, args.output_dir)
        print(json.dumps({"ok": True, "stats": stats}))
        sys.exit(0)
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()

