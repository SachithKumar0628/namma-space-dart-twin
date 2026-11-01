/**
 * reconstructionAlignment.ts
 *
 * Aligns a photo-derived reconstruction (COLMAP sparse point cloud / Brush
 * splat export) into the viewer's calibrated walkable frame.
 *
 * SfM reconstructions have an arbitrary world frame: there is no gravity
 * alignment, the origin is solver-chosen, and the cloud is often offset far
 * below y = 0 (e.g. sceneCenter.y = -2.38 m or -7.85 m in captured jobs).
 * The viewer, by contrast, assumes a right-handed Y-up frame with the floor
 * at y = 0 and room shells anchored at the layout origin. Rendering the raw
 * cloud without alignment puts the reconstruction far away from (or below)
 * the walkable room shell, which is the root cause of the "disconnected /
 * disappearing / shifting" walkthrough symptoms.
 *
 * This module:
 *   1. Aligns the reconstruction's world up (from the recovered camera poses)
 *      to +Y.
 *   2. Culls outlier points beyond the robust SfM radius.
 *   3. Detects the dominant floor plane (robust lower percentile of the dense
 *      core height) and translates the floor to y = 0.
 *   4. Recentres the dense core on the room-layout centre so the captured
 *      points and the measured room shell occupy the same volume.
 *
 * The transform is a rigid rotation + translation at metric scale. No
 * geometry is invented and no arbitrary rescaling is applied: the SfM
 * reconstruction is already metric, so the captured data is preserved as-is,
 * just expressed in the walker's coordinate frame.
 */

import * as THREE from 'three';
import type { RoomLayoutBox } from './reconstruction3DGenerator';

const Y_AXIS = new THREE.Vector3(0, 1, 0);
const TMP_V3 = new THREE.Vector3();
const TMP_QUAT = new THREE.Quaternion();

export interface AlignmentResult {
  /** Rigid rotation applied to the reconstruction (world up -> +Y). */
  rotation: THREE.Quaternion;
  /** Translation applied after rotation (floor to y = 0, core centred on layout). */
  translation: THREE.Vector3;
  /** World-up vector used for the alignment. */
  up: THREE.Vector3;
  /** Detected floor height in the pre-translation, rotated frame. */
  floorY: number;
  /** Radius of the dense core around its centre (aligned frame, pre-translation). */
  coreRadius: number;
  /** Points kept after outlier culling. */
  kept: number;
  /** Total points before culling. */
  total: number;
}

/** Nearest-rank percentile of an unsorted Float32Array. */
function percentile(values: Float32Array, p: number): number {
  const n = values.length;
  if (n === 0) return 0;
  const sorted = Array.from(values).sort((a, b) => a - b);
  const rank = Math.max(0, Math.min(n - 1, Math.ceil((p / 100) * n) - 1));
  return sorted[rank];
}

/**
 * Aligns `geometry`'s position attribute into the calibrated walkable frame.
 *
 * Returns a NEW geometry (positions interleaved, colours carried across) with
 * outliers removed, up aligned to +Y, the detected floor at y = 0, and the
 * dense core centred on the supplied room layout. The caller is responsible
 * for disposing the original geometry.
 */
export function alignReconstructionGeometry(
  geometry: THREE.BufferGeometry,
  stats: {
    sceneCenter?: [number, number, number] | null;
    sceneRadius?: number | null;
    viewerCamera?: {
      up?: [number, number, number] | null;
    } | null;
  } | null,
  layout: Record<string, RoomLayoutBox>
): { geometry: THREE.BufferGeometry; result: AlignmentResult } {
  const position = geometry.attributes.position;
  const color = geometry.getAttribute('color');
  const total = position ? position.count : 0;
  const result: AlignmentResult = {
    rotation: new THREE.Quaternion(),
    translation: new THREE.Vector3(),
    up: Y_AXIS.clone(),
    floorY: 0,
    coreRadius: 1,
    kept: 0,
    total,
  };
  if (!position || total === 0) {
    return { geometry, result };
  }

  const hasColors = Boolean(color && color.count === total);
  const xs = new Float32Array(total);
  const ys = new Float32Array(total);
  const zs = new Float32Array(total);
  for (let i = 0; i < total; i += 1) {
    xs[i] = position.getX(i);
    ys[i] = position.getY(i);
    zs[i] = position.getZ(i);
  }

  // --- 1. Recover world up from point cloud geometry ----------------------
  // In an indoor scene, the vertical axis has the least point variance
  // (floor and ceiling are flat planes). Detect it directly from the cloud
  // so inverted camera poses don't flip the scene upside down.
  let pcCx = 0,
    pcCy = 0,
    pcCz = 0;
  for (let i = 0; i < total; i += 1) {
    pcCx += xs[i];
    pcCy += ys[i];
    pcCz += zs[i];
  }
  pcCx /= total;
  pcCy /= total;
  pcCz /= total;
  let vx = 0,
    vy = 0,
    vz = 0;
  for (let i = 0; i < total; i += 1) {
    const dx = xs[i] - pcCx;
    const dy = ys[i] - pcCy;
    const dz = zs[i] - pcCz;
    vx += dx * dx;
    vy += dy * dy;
    vz += dz * dz;
  }
  // The axis with the smallest variance is vertical.
  let up: THREE.Vector3;
  if (vy <= vx && vy <= vz) up = new THREE.Vector3(0, 1, 0);
  else if (vx <= vz) up = new THREE.Vector3(1, 0, 0);
  else up = new THREE.Vector3(0, 0, 1);

  // Cross-check with camera-reported up if available.
  const upRaw = stats?.viewerCamera?.up ?? null;
  if (upRaw) {
    const camUp = new THREE.Vector3(
      Number.isFinite(upRaw[0]) ? upRaw[0] : 0,
      Number.isFinite(upRaw[1]) ? upRaw[1] : 0,
      Number.isFinite(upRaw[2]) ? upRaw[2] : 0
    );
    const camLenSq = camUp.x * camUp.x + camUp.y * camUp.y + camUp.z * camUp.z;
    if (!Number.isFinite(camLenSq) || camLenSq < 1e-8) camUp.set(0, 1, 0);
    else camUp.normalize();
    if (camUp.y < 0) camUp.negate();
    // Trust camera up only if it agrees with point-cloud up and is more Y-aligned.
    if (camUp.dot(up) > 0 && Math.abs(camUp.y) >= Math.abs(up.y)) up.copy(camUp);
  }
  if (up.y < 0) up.negate(); // always point generally upward
  result.up.copy(up);

  // --- 2. Rigid rotation aligning world up to +Y --------------------------
  const rotation = TMP_QUAT.setFromUnitVectors(up, Y_AXIS);
  const qLenSq = rotation.x * rotation.x + rotation.y * rotation.y + rotation.z * rotation.z + rotation.w * rotation.w;
  if (!Number.isFinite(qLenSq) || qLenSq < 1e-8) rotation.set(0, 0, 0, 1);
  const rotMatrix = new THREE.Matrix4().makeRotationFromQuaternion(rotation);
  result.rotation.copy(rotation);

  const vec = TMP_V3;
  for (let i = 0; i < total; i += 1) {
    vec.set(xs[i], ys[i], zs[i]).applyMatrix4(rotMatrix);
    xs[i] = vec.x;
    ys[i] = vec.y;
    zs[i] = vec.z;
  }

  // --- 3. Outlier cull: keep points inside the robust SfM radius ----------
  const sceneRadius =
    stats?.sceneRadius != null && Number.isFinite(stats.sceneRadius) && stats.sceneRadius > 0
      ? stats.sceneRadius
      : 1;
  let cx = 0,
    cy = 0,
    cz = 0;
  for (let i = 0; i < total; i += 1) {
    cx += xs[i];
    cy += ys[i];
    cz += zs[i];
  }
  cx /= total;
  cy /= total;
  cz /= total;

  const keep: number[] = [];
  const r2 = sceneRadius * sceneRadius * 1.44; // 20 % tolerance beyond the 99 % core
  for (let i = 0; i < total; i += 1) {
    const dx = xs[i] - cx;
    const dy = ys[i] - cy;
    const dz = zs[i] - cz;
    if (dx * dx + dy * dy + dz * dz <= r2) keep.push(i);
  }
  result.kept = keep.length;
  if (keep.length === 0) {
    // Degenerate cloud: keep everything rather than rendering nothing.
    for (let i = 0; i < total; i += 1) keep.push(i);
    result.kept = total;
  }

  // --- 4. Detect the dominant floor plane ---------------------------------
  // The floor is the lowest substantial horizontal surface. A robust lower
  // percentile of the dense-core height ignores sparse outliers above/below.
  const keptY = new Float32Array(keep.length);
  let kx = 0,
    ky = 0,
    kz = 0;
  for (let i = 0; i < keep.length; i += 1) {
    const idx = keep[i];
    keptY[i] = ys[idx];
    kx += xs[idx];
    ky += ys[idx];
    kz += zs[idx];
  }
  kx /= keep.length;
  ky /= keep.length;
  kz /= keep.length;
  const floorY = percentile(keptY, 5);
  result.floorY = floorY;

  // Core radius about the kept-core centre (aligned frame, pre-translation).
  let maxDist = 0;
  for (let i = 0; i < keep.length; i += 1) {
    const idx = keep[i];
    const dx = xs[idx] - kx;
    const dy = ys[idx] - ky;
    const dz = zs[idx] - kz;
    const d = dx * dx + dy * dy + dz * dz;
    if (d > maxDist) maxDist = d;
  }
  result.coreRadius = Math.sqrt(maxDist) || 1;

  // --- 5. Centre the core on the room-layout origin -----------------------
  // Layout boxes already sit with their floor at y = 0 in the calibrated
  // frame. Align the cloud's dense core to the layout's overall XZ centre so
  // captured points and the measured room shell share one volume.
  const boxes = Object.values(layout);
  let lx = 0,
    lz = 0;
  if (boxes.length > 0) {
    let minX = Infinity,
      maxX = -Infinity,
      minZ = Infinity,
      maxZ = -Infinity;
    for (const box of boxes) {
      if (box.minX < minX) minX = box.minX;
      if (box.maxX > maxX) maxX = box.maxX;
      if (box.minZ < minZ) minZ = box.minZ;
      if (box.maxZ > maxZ) maxZ = box.maxZ;
    }
    lx = (minX + maxX) / 2;
    lz = (minZ + maxZ) / 2;
  }
  const tx = lx - kx;
  const ty = -floorY;
  const tz = lz - kz;
  const translation = new THREE.Vector3(tx, ty, tz);
  result.translation.copy(translation);

  // --- 6. Rebuild geometry: kept points only, rotated + translated --------
  const outPositions = new Float32Array(keep.length * 3);
  const outColors = hasColors ? new Float32Array(keep.length * 3) : null;
  const colorArray = hasColors ? (color!.array as ArrayLike<number>) : null;
  let o = 0;
  for (let i = 0; i < keep.length; i += 1) {
    const idx = keep[i];
    outPositions[o] = xs[idx] + tx;
    outPositions[o + 1] = ys[idx] + ty;
    outPositions[o + 2] = zs[idx] + tz;
    o += 3;
  }
  if (outColors) {
    o = 0;
    const ca = colorArray!;
    for (let i = 0; i < keep.length; i += 1) {
      const idx = keep[i];
      outColors[o] = ca[idx * 3];
      outColors[o + 1] = ca[idx * 3 + 1];
      outColors[o + 2] = ca[idx * 3 + 2];
      o += 3;
    }
  }

  const aligned = new THREE.BufferGeometry();
  aligned.setAttribute('position', new THREE.Float32BufferAttribute(outPositions, 3));
  if (outColors) aligned.setAttribute('color', new THREE.Float32BufferAttribute(outColors, 3));
  aligned.computeBoundingSphere();

  return { geometry: aligned, result };
}
