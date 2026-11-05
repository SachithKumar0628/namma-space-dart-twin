"""Open3D geometry processing: outlier removal, normals, Poisson surface and
quadric decimation.

Only dense clouds are meshed. A sparse SfM cloud is never presented as a dense
surface; the orchestrator decides which input is eligible.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Callable

import numpy as np


class MeshError(RuntimeError):
    pass


def _require_open3d():
    try:
        import open3d as o3d  # type: ignore

        return o3d
    except Exception as exc:  # noqa: BLE001
        raise MeshError(
            "Open3D is not installed in this Python environment. "
            "Run `pip install -r reconstruction_service/requirements.txt`."
        ) from exc


def mesh_from_dense_cloud(
    point_cloud: Path,
    output_ply: Path,
    *,
    target_triangles: int = 150_000,
    poisson_depth: int = 8,
    logger: Callable[[str], None] = lambda _m: None,
) -> dict[str, Any]:
    o3d = _require_open3d()

    if not point_cloud.is_file():
        raise MeshError(f"Dense point cloud not found: {point_cloud}")

    pcd = o3d.io.read_point_cloud(str(point_cloud))
    if len(pcd.points) < 1_000:
        raise MeshError(
            f"Dense cloud has only {len(pcd.points)} points; a surface cannot be reconstructed."
        )
    logger(f"Meshing {len(pcd.points):,} dense points")

    # Bound memory: Poisson on 10M+ points is not viable on 16 GB RAM.
    if len(pcd.points) > 600_000:
        voxel = max(0.002, float(np.linalg.norm(pcd.get_max_bound() - pcd.get_min_bound())) / 900.0)
        pcd = pcd.voxel_down_sample(voxel)
        logger(f"Voxel-downsampled dense cloud to {len(pcd.points):,} points (voxel {voxel:.4f})")

    pcd, _ = pcd.remove_statistical_outlier(nb_neighbors=20, std_ratio=2.0)
    if len(pcd.points) < 1_000:
        raise MeshError("Outlier removal left too few dense points to mesh.")

    pcd.estimate_normals(
        search_param=o3d.geometry.KDTreeSearchParamHybrid(radius=0.25, max_nn=40)
    )
    try:
        pcd.orient_normals_consistent_tangent_plane(30)
    except Exception as exc:  # noqa: BLE001 - orientation is best-effort
        logger(f"Normal orientation warning: {exc}")

    mesh, densities = o3d.geometry.TriangleMesh.create_from_point_cloud_poisson(
        pcd, depth=max(6, min(11, poisson_depth)), scale=1.1
    )
    densities_array = np.asarray(densities)
    if densities_array.size:
        threshold = float(np.quantile(densities_array, 0.12))
        mesh.remove_vertices_by_mask(densities_array < threshold)

    mesh.remove_degenerate_triangles()
    mesh.remove_duplicated_triangles()
    mesh.remove_duplicated_vertices()
    mesh.remove_non_manifold_edges()

    triangles = len(mesh.triangles)
    if triangles == 0:
        raise MeshError("Poisson reconstruction produced an empty mesh.")

    if triangles > target_triangles:
        mesh = mesh.simplify_quadric_decimation(int(target_triangles))
        mesh.remove_degenerate_triangles()
        mesh.remove_duplicated_triangles()
        mesh.remove_duplicated_vertices()
        mesh.remove_non_manifold_edges()
        logger(f"Decimated mesh to {len(mesh.triangles):,} triangles")

    if not mesh.has_vertex_colors():
        logger("Mesh has no interpolated vertex colours; transferring from the dense cloud")
        mesh = _transfer_colors(o3d, mesh, pcd)

    mesh.compute_vertex_normals()
    output_ply.parent.mkdir(parents=True, exist_ok=True)
    if not o3d.io.write_triangle_mesh(str(output_ply), mesh, write_ascii=False):
        raise MeshError(f"Open3D could not write {output_ply.name}")

    return {
        "path": str(output_ply),
        "vertices": int(len(mesh.vertices)),
        "triangles": int(len(mesh.triangles)),
        "bytes": output_ply.stat().st_size,
        "decimated": triangles > target_triangles,
        "sourcePoints": int(len(pcd.points)),
    }


def _transfer_colors(o3d, mesh, pcd):
    from scipy.spatial import cKDTree

    points = np.asarray(pcd.points)
    colors = np.asarray(pcd.colors)
    vertices = np.asarray(mesh.vertices)
    if points.size == 0 or colors.size == 0:
        return mesh
    tree = cKDTree(points)
    distances, indices = tree.query(vertices, k=3)
    weights = 1.0 / np.maximum(distances, 1e-4)
    weights /= weights.sum(axis=1, keepdims=True)
    vertex_colors = np.sum(colors[indices] * weights[:, :, None], axis=1)
    mesh.vertex_colors = o3d.utility.Vector3dVector(np.clip(vertex_colors, 0.0, 1.0))
    return mesh
