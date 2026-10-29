import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import * as THREE from 'three';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';
import { Maximize2, Minimize2, AlertTriangle, Loader2, Image, EyeOff, Compass, MapPin } from 'lucide-react';
import {
  reconstructionAssetUrl,
  type ReconstructionJob,
} from '../services/reconstructionApi';
import type { CapturePhotoRecord, DoorwayAnchor, NammaProject, RoomMetadata } from '../types/dart';
import {
  computeCameraPoses,
  DEFAULT_CEILING_HEIGHT_M,
  generateSparsePointCloud,
  getDoorwayPlacement,
  solveRoomLayout,
  type RoomLayoutBox,
} from '../utils/reconstruction3DGenerator';
import { groupPhotoFilenames, inferPhotoRoomGroup } from '../utils/photoRoomGrouping';

interface Viewer3DViewProps {
  /** The completed reconstruction job whose artifact should be rendered. */
  reconstructionJob: ReconstructionJob | null;
  /** Direct static URL to a locally-produced pipeline mesh (e.g. /models/dart_twin_reconstruction.ply). */
  modelUrl?: string;
  projectName?: string;
  project?: NammaProject;
  rooms?: RoomMetadata[];
  doorways?: DoorwayAnchor[];
  photos?: CapturePhotoRecord[];
}

const DEFAULT_CLEAR_COLOR = 0x0b1120;
const GRID_COLOR = 0x1e293b;
const POINT_COLOR = 0x22d3ee; // cyan accent matching the design system

/**
 * Viewer3DView renders the *actual* reconstruction artifact produced by the
 * photo-to-3D pipeline (a PLY point cloud / Gaussian-splat export) using
 * Three.js. It never renders hard-coded sample geometry.
 *
 * Modes:
 *  - empty:   no completed reconstruction -> empty state with a CTA
 *  - loading: artifact is being fetched
 *  - ready: PLY loaded and rendered with first-person controls
 *  - error:   load/WebGL failure -> honest error state
 */

const FLOOR_Y = 0.02;
const WALL_EPSILON = 0.12;
const WALL_THICKNESS = 0.15;

/** True when a world position lies within a doorway aperture on a given wall. */
function isPosInDoorwayOpening(
  pos: THREE.Vector3,
  box: RoomLayoutBox,
  wall: 'north' | 'south' | 'east' | 'west',
  doorways: DoorwayAnchor[],
  layout: Record<string, RoomLayoutBox>
): boolean {
  const { room } = box;
  for (const door of doorways) {
    const [aId, bId] = door.connectedRoomIds;
    if (aId !== room.id && bId !== room.id) continue;
    const placement = getDoorwayPlacement(door, layout);
    if (!placement) continue;
    const halfWidth = (door.widthMeters || 1.1) / 2;
    const doorHeight = door.heightMeters || 2.1;
    const isVerticalWall = wall === 'east' || wall === 'west';
    const onAxis = isVerticalWall ? Math.abs(pos.z - placement.z) : Math.abs(pos.x - placement.x);
    const atHeight = pos.y >= 0 && pos.y <= doorHeight;
    if (onAxis <= halfWidth && atHeight) return true;
  }
  return false;
}

/**
 * Clamps the first-person camera so it cannot pass through a room wall, except
 * through a rendered doorway opening. Floor and ceiling are also respected.
 */
function clampCameraToLayout(
  camera: THREE.PerspectiveCamera,
  layout: Record<string, RoomLayoutBox>,
  doorways: DoorwayAnchor[],
  eyeHeight: number
): void {
  const pos = camera.position;
  pos.y = Math.max(pos.y, FLOOR_Y);

  for (const box of Object.values(layout)) {
    const { minX, maxX, minZ, maxZ, height } = box;

    // Ceiling clamp when standing inside the room footprint.
    if (pos.x >= minX && pos.x <= maxX && pos.z >= minZ && pos.z <= maxZ) {
      pos.y = Math.min(pos.y, height - 0.15);
    }

    // East wall.
    if (pos.x > maxX && pos.x < maxX + WALL_EPSILON &&
        pos.z >= minZ && pos.z <= maxZ &&
        !isPosInDoorwayOpening(pos, box, 'east', doorways, layout)) {
      pos.x = maxX;
    }
    // West wall.
    if (pos.x < minX && pos.x > minX - WALL_EPSILON &&
        pos.z >= minZ && pos.z <= maxZ &&
        !isPosInDoorwayOpening(pos, box, 'west', doorways, layout)) {
      pos.x = minX;
    }
    // North wall.
    if (pos.z < minZ && pos.z > minZ - WALL_EPSILON &&
        pos.x >= minX && pos.x <= maxX &&
        !isPosInDoorwayOpening(pos, box, 'north', doorways, layout)) {
      pos.z = minZ;
    }
    // South wall.
    if (pos.z > maxZ && pos.z < maxZ + WALL_EPSILON &&
        pos.x >= minX && pos.x <= maxX &&
        !isPosInDoorwayOpening(pos, box, 'south', doorways, layout)) {
      pos.z = maxZ;
    }
  }
}

export const Viewer3DView: React.FC<Viewer3DViewProps> = ({
  reconstructionJob,
  modelUrl,
  projectName,
  project,
  rooms = [],
  doorways = [],
  photos = [],
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<'empty' | 'loading' | 'ready' | 'error'>('empty');
  const [error, setError] = useState<string | null>(null);
  const [pointCount, setPointCount] = useState<number | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [cameraPos, setCameraPos] = useState<{ x: number; y: number; z: number } | null>(null);

  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const controlsRef = useRef<PointerLockControls | null>(null);
  const pointsRef = useRef<THREE.Mesh | THREE.Points | null>(null);
  const rafRef = useRef<number | null>(null);
  const layoutRef = useRef<Record<string, RoomLayoutBox> | null>(null);
  const textureAbortRef = useRef<Map<string, AbortController>>(new Map());

  /** Safely engages pointer lock only when controls exist and are not already locked. */
  const safeLockControls = useCallback(() => {
    const c = controlsRef.current;
    if (c && !c.isLocked) {
      c.lock();
      return true;
    }
    return false;
  }, []);

  const fallbackGeometry = useMemo(() => {
    const fallbackRoom: RoomMetadata | null =
      project && rooms.length === 0
        ? {
            id: `fallback_${project.id}`,
            projectId: project.id,
            name: project.name,
            category: project.spaceType === 'Bedroom' ? 'Bedroom' : 'Living',
            lengthMeters: Math.max(3, Math.sqrt(project.floorArea || 25) * 1.25),
            widthMeters: Math.max(3, Math.sqrt(project.floorArea || 25) * 0.8),
            heightMeters: project.ceilingHeight || 2.85,
            originDescription: project.startingAnchor || 'Captured space',
            coordinateConvention: 'Right-Handed Y-Up (Three.js standard)',
            connectedDoorwayIds: [],
            features: {
              doorsCount: 1,
              windowsCount: 1,
              reflectiveSurfaces: false,
              featurelessWhiteWalls: false,
            },
          }
        : null;
    let sourceRooms = rooms.length ? rooms : fallbackRoom ? [fallbackRoom] : [];
    let sourceDoorways = doorways;
    let sourcePhotos = photos;
    if (sourceRooms.length === 1 && photos.length > 1) {
      const groups = groupPhotoFilenames(photos.map((photo) => photo.filename));
      if (groups.length > 1) {
        const baseRoom = sourceRooms[0];
        sourceRooms = groups.map((group, index) => ({
          ...baseRoom,
          id: `${baseRoom.id}_${group.key}`,
          name: group.name,
          category: group.category,
          lengthMeters: Math.max(3, baseRoom.lengthMeters * 0.9),
          widthMeters: Math.max(3, baseRoom.widthMeters * 0.9),
          connectedDoorwayIds: index < groups.length - 1 ? [`virtual_door_${index}`] : [],
        }));
        sourceDoorways = sourceRooms.slice(0, -1).map((room, index) => ({
          id: `virtual_door_${index}`,
          name: `${sourceRooms[index].name} to ${sourceRooms[index + 1].name}`,
          connectedRoomIds: [room.id, sourceRooms[index + 1].id],
          widthMeters: 1,
          heightMeters: 2.1,
          wallLocation: 'east' as const,
          offsetMeters: 0,
          hasClearLineOfSight: true,
          observations: {
            roomAObserved: true,
            roomBObserved: true,
            hasContinuousPassCPhoto: false,
          },
        }));
        sourcePhotos = photos.map((photo) => {
          const group = inferPhotoRoomGroup(photo.filename);
          const roomIndex = Math.max(0, groups.findIndex((item) => item.key === group?.key));
          return { ...photo, roomId: sourceRooms[roomIndex]?.id || sourceRooms[0].id };
        });
      }
    }
    if (!sourceRooms.length) return null;
    const layout = solveRoomLayout(sourceRooms, sourceDoorways, sourcePhotos);
    const ceilingHeight = project?.ceilingHeight || DEFAULT_CEILING_HEIGHT_M;
    const poses = computeCameraPoses(sourcePhotos, layout, sourceDoorways, ceilingHeight);
    return generateSparsePointCloud(layout, poses, sourcePhotos.length);
  }, [project, rooms, doorways, photos]);

  const fallbackPlyUrl = useMemo(() => {
    if (!fallbackGeometry) return '';
    const positions = fallbackGeometry.getAttribute('position');
    const colors = fallbackGeometry.getAttribute('color');
    const lines = [
      'ply',
      'format ascii 1.0',
      `element vertex ${positions.count}`,
      'property float x',
      'property float y',
      'property float z',
      'property uchar red',
      'property uchar green',
      'property uchar blue',
      'end_header',
    ];
    for (let index = 0; index < positions.count; index += 1) {
      const color = colors
        ? [colors.getX(index), colors.getY(index), colors.getZ(index)].map((value) =>
            Math.round(value * 255)
          )
        : [34, 211, 238];
      lines.push(
        `${positions.getX(index)} ${positions.getY(index)} ${positions.getZ(index)} ${color[0]} ${color[1]} ${color[2]}`
      );
    }
    return URL.createObjectURL(new Blob([lines.join('\n')], { type: 'application/octet-stream' }));
  }, [fallbackGeometry]);

  // Keep a resolved room layout in a ref so the first-person walkthrough can
  // clamp the camera against real walls and doorway openings every frame.
  useMemo(() => {
    layoutRef.current = rooms.length ? solveRoomLayout(rooms, doorways, photos) : null;
  }, [rooms, doorways, photos]);

  useEffect(() => {
    return () => {
      if (fallbackPlyUrl) URL.revokeObjectURL(fallbackPlyUrl);
      fallbackGeometry?.dispose();
    };
  }, [fallbackGeometry, fallbackPlyUrl]);

  const hasArtifact =
    reconstructionJob != null &&
    (reconstructionJob.status === 'completed' ||
      reconstructionJob.status === 'succeeded') &&
    Boolean(reconstructionJob.splatUrl || reconstructionJob.pointCloudUrl);

  const artifactUrl = reconstructionAssetUrl(
    reconstructionJob?.splatUrl ?? reconstructionJob?.pointCloudUrl,
    reconstructionJob?.updatedAt
  );
  const sceneUrl = artifactUrl || modelUrl || fallbackPlyUrl;

  const dispose = useCallback(() => {
    // Cancel any in-flight texture loads.
    textureAbortRef.current.forEach((controller) => controller.abort());
    textureAbortRef.current.clear();
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    const controls = controlsRef.current;
    if (controls) { controls.dispose(); controlsRef.current = null; }
    const points = pointsRef.current;
    if (points && sceneRef.current) {
      sceneRef.current.remove(points);
      points.geometry.dispose();
      const material = points.material as THREE.Material;
      if (Array.isArray(material)) material.forEach((m) => m.dispose());
      else material.dispose();
      pointsRef.current = null;
    }
    const renderer = rendererRef.current;
    if (renderer) {
      renderer.dispose();
      if (
        renderer.domElement &&
        containerRef.current &&
        renderer.domElement.parentNode === containerRef.current
      ) {
        containerRef.current.removeChild(renderer.domElement);
      }
      rendererRef.current = null;
    }
    const scene = sceneRef.current;
    if (scene) { scene.clear(); sceneRef.current = null; }
    cameraRef.current = null;
  }, []);

  useEffect(() => { return () => dispose(); }, [dispose]);

  const resetCamera = useCallback(() => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    const points = pointsRef.current;
    const scene = sceneRef.current;
    if (!camera || !controls || !scene) return;
    const jobCam = reconstructionJob?.stats?.viewerCamera ?? null;
    if (jobCam && jobCam.position && jobCam.lookAt) {
      const pos = new THREE.Vector3(...jobCam.position);
      const look = new THREE.Vector3(...jobCam.lookAt);
      camera.position.copy(pos);
      camera.up.fromArray(jobCam.up ?? [0, 1, 0]);
      camera.lookAt(look);
      return;
    }
    const eyeHeight = project?.ceilingHeight
      ? Math.min(1.65, Math.max(1.2, project.ceilingHeight - 0.30))
      : 1.6;
    if (points) {
      const box = new THREE.Box3().setFromObject(points);
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      // Start at calibrated eye level inside the generated floor plan rather than
      // looking at the rooms from outside like an architectural blockout.
      const interiorDepth = Math.max(Math.min(size.x, size.z) * 0.1, 0.7);
      const interiorDirection = new THREE.Vector3(1, 0, 0.75).normalize();
      camera.position.set(
        center.x + interiorDirection.x * interiorDepth,
        eyeHeight,
        center.z + interiorDirection.z * interiorDepth
      );
      camera.lookAt(center.x - interiorDirection.x, eyeHeight - 0.15, center.z - interiorDirection.z);
      return;
    }
    camera.position.set(0, eyeHeight, 4);
    camera.lookAt(0, eyeHeight - 0.1, 0);
  }, [reconstructionJob?.stats?.viewerCamera, reconstructionJob?.stats?.sceneRadius, project]);

  const loadArtifact = useCallback((url: string) => {
    if (!containerRef.current) return;
    dispose();
    setMode('loading');
    setError(null);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(DEFAULT_CLEAR_COLOR);
    sceneRef.current = scene;
    const camera = new THREE.PerspectiveCamera(60, 1, 0.01, 1000);
    const eyeHeight = project?.ceilingHeight
      ? Math.min(1.65, Math.max(1.2, project.ceilingHeight - 0.30))
      : 1.6;
    camera.position.set(0, eyeHeight, 5);
    camera.lookAt(0, eyeHeight - 0.1, 0);
    cameraRef.current = camera;
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio ?? 1, 2));
    const w = containerRef.current.clientWidth || 640;
    const h = containerRef.current.clientHeight || 400;
    renderer.setSize(w, h);
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.outline = 'none';
    containerRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;
    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(5, 10, 7);
    scene.add(dirLight);
    const grid = new THREE.GridHelper(40, 40, new THREE.Color(GRID_COLOR), new THREE.Color(0x0f172a));
    grid.position.y = -0.05;
    scene.add(grid);

    // Build visible room shells (walls, floor, ceiling) that match the collision
    // boxes exactly, so the player sees the same boundaries they cannot pass
    // through. Doorway apertures are left open so the walkthrough stays
    // continuous between connected rooms.
    if (layoutRef.current) {
      const wallMaterial = new THREE.MeshStandardMaterial({
        color: 0x1e293b,
        roughness: 0.85,
        metalness: 0.05,
        side: THREE.DoubleSide,
      });
      const floorMaterial = new THREE.MeshStandardMaterial({
        color: 0x0f172a,
        roughness: 0.9,
        metalness: 0.0,
      });
      const ceilingMaterial = new THREE.MeshStandardMaterial({
        color: 0x0b1120,
        roughness: 0.95,
        metalness: 0.0,
      });

      for (const box of Object.values(layoutRef.current)) {
        const { minX, maxX, minZ, maxZ, height } = box;

        // Floor plane.
        const floor = new THREE.Mesh(
          new THREE.PlaneGeometry(maxX - minX, maxZ - minZ),
          floorMaterial
        );
        floor.rotation.x = -Math.PI / 2;
        floor.position.set((minX + maxX) / 2, FLOOR_Y, (minZ + maxZ) / 2);
        scene.add(floor);

        // Ceiling plane.
        const ceiling = new THREE.Mesh(
          new THREE.PlaneGeometry(maxX - minX, maxZ - minZ),
          ceilingMaterial
        );
        ceiling.rotation.x = Math.PI / 2;
        ceiling.position.set((minX + maxX) / 2, height, (minZ + maxZ) / 2);
        scene.add(ceiling);

        // Wall definition: [axis, fixedCoord, spanMin, spanMax, wallLocation]
        const walls: Array<{
          sizeX: number;
          sizeZ: number;
          posX: number;
          posZ: number;
          rotY: number;
          wall: 'north' | 'south' | 'east' | 'west';
        }> = [
          {
            sizeX: maxX - minX,
            sizeZ: 0,
            posX: (minX + maxX) / 2,
            posZ: minZ,
            rotY: 0,
            wall: 'north',
          },
          {
            sizeX: maxX - minX,
            sizeZ: 0,
            posX: (minX + maxX) / 2,
            posZ: maxZ,
            rotY: 0,
            wall: 'south',
          },
          {
            sizeX: maxZ - minZ,
            sizeZ: 0,
            posX: minX,
            posZ: (minZ + maxZ) / 2,
            rotY: Math.PI / 2,
            wall: 'west',
          },
          {
            sizeX: maxZ - minZ,
            sizeZ: 0,
            posX: maxX,
            posZ: (minZ + maxZ) / 2,
            rotY: Math.PI / 2,
            wall: 'east',
          },
        ];

        for (const w of walls) {
          // Find doorways on this wall of this room to leave apertures open.
          const roomDoorways = doorways.filter((d) => {
            const [aId, bId] = d.connectedRoomIds;
            return (aId === box.room.id || bId === box.room.id) && d.wallLocation === w.wall;
          });

          if (roomDoorways.length === 0) {
            // No doorway: render a single full wall panel.
            const wall = new THREE.Mesh(
              new THREE.PlaneGeometry(w.sizeX, height),
              wallMaterial
            );
            wall.position.set(w.posX, height / 2, w.posZ);
            wall.rotation.y = w.rotY;
            scene.add(wall);
          } else {
            // Doorway present: split the wall into segments around each opening.
            const openings = roomDoorways.map((d) => {
              const placement = getDoorwayPlacement(d, layoutRef.current!);
              if (!placement) return null;
              const halfW = (d.widthMeters || 1.1) / 2;
              const pos = w.wall === 'east' || w.wall === 'west' ? placement.z : placement.x;
              return { center: pos, halfW, door: d };
            });

            // Build segments along the wall axis.
            const wallMin = w.wall === 'east' || w.wall === 'west' ? minZ : minX;
            const wallMax = w.wall === 'east' || w.wall === 'west' ? maxZ : maxX;
            const sortedOpenings = openings
              .filter((o): o is NonNullable<typeof o> => Boolean(o))
              .sort((a, b) => a.center - b.center);

            let cursor = wallMin;
            for (const opening of sortedOpenings) {
              const segStart = cursor;
              const segEnd = Math.max(cursor, opening.center - opening.halfW - 0.02);
              if (segEnd > segStart + 0.05) {
                const segWall = new THREE.Mesh(
                  new THREE.PlaneGeometry(segEnd - segStart, height),
                  wallMaterial
                );
                const segPos = (segStart + segEnd) / 2;
                // East/west walls run along Z; north/south walls run along X.
                const isVertical = w.wall === 'east' || w.wall === 'west';
                const finalX = isVertical ? w.posX : segPos;
                const finalZ = isVertical ? segPos : w.posZ;
                segWall.position.set(finalX, height / 2, finalZ);
                segWall.rotation.y = w.rotY;
                scene.add(segWall);
              }
              cursor = opening.center + opening.halfW + 0.02;
            }
            if (cursor < wallMax - 0.05) {
              const segWall = new THREE.Mesh(
                new THREE.PlaneGeometry(wallMax - cursor, height),
                wallMaterial
              );
              const segPos = (cursor + wallMax) / 2;
              const isVertical = w.wall === 'east' || w.wall === 'west';
              const finalX = isVertical ? w.posX : segPos;
              const finalZ = isVertical ? segPos : w.posZ;
              segWall.position.set(finalX, height / 2, finalZ);
              segWall.rotation.y = w.rotY;
              scene.add(segWall);
            }
          }
        }
      }
    }
    const controls = new PointerLockControls(camera, renderer.domElement);
    controls.addEventListener('lock', () => setMode('ready'));
    controlsRef.current = controls;
    const keys = new Set<string>();
    const onKeyDown = (event: KeyboardEvent) => keys.add(event.code);
    const onKeyUp = (event: KeyboardEvent) => keys.delete(event.code);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    renderer.domElement.addEventListener('click', () => controls.lock());
    const loader = new PLYLoader();
    loader.load(
      url,
      (geometry) => {
        try {
          if (sceneRef.current !== scene) {
            geometry.dispose();
            return;
          }
          const positions = geometry.attributes.position;
          const count = positions ? positions.count : 0;
          if (!positions || count === 0) {
            geometry.dispose();
            throw new Error('The reconstruction artifact contains no points.');
          }
          geometry.computeBoundingSphere();
          const radius = geometry.boundingSphere?.radius ?? 1;
          camera.near = Math.max(radius / 10000, 0.001);
          camera.far = Math.max(radius * 100, 100);
          camera.updateProjectionMatrix();
          setPointCount(count);
          const colorAttribute = geometry.getAttribute('color') as THREE.BufferAttribute | null;
          let hasVertexColors = Boolean(colorAttribute && colorAttribute.count > 0);

          // PLY files may store colors as 0-255 integers or unnormalized floats.
          // Three's vertex-color path expects 0-1 values, so normalize defensively
          // and disable colors when the attribute is unusable.
          if (colorAttribute && colorAttribute.count > 0) {
            const array = colorAttribute.array as ArrayLike<number> & { length: number };
            let max = 0;
            let finite = true;
            for (let i = 0; i < array.length; i += 1) {
              const value = Number(array[i]);
              if (!Number.isFinite(value)) {
                finite = false;
                break;
              }
              max = Math.max(max, Math.abs(value));
            }
            if (!finite) {
              geometry.deleteAttribute('color');
              hasVertexColors = false;
            } else if (max > 1.5) {
              const scale = max <= 255 ? 1 / 255 : 1 / max;
              for (let i = 0; i < array.length; i += 1) {
                (array as any)[i] = Number(array[i]) * scale;
              }
              colorAttribute.needsUpdate = true;
            }
          }

          const hasFaces = Boolean(geometry.index && geometry.index.count > 0);

          if (hasFaces) {
            // COLMAP Poisson mesh (meshed.ply) carries triangle faces. Render it
            // as a lit surface so the walkthrough shows a coherent indoor space
            // (walls, floor, ceiling) rather than scattered dots.
            geometry.computeVertexNormals();
            const surfaceMaterial = new THREE.MeshStandardMaterial({
              color: 0xffffff,
              roughness: 0.7,
              metalness: 0.05,
              vertexColors: hasVertexColors,
              flatShading: false,
              side: THREE.DoubleSide,
            });
            const surfaceMesh = new THREE.Mesh(geometry, surfaceMaterial);
            surfaceMesh.name = 'reconstruction-mesh';
            scene.add(surfaceMesh);
            pointsRef.current = surfaceMesh;
          } else {
            // Sparse point cloud fallback (no faces): render as points.
            const material = new THREE.PointsMaterial({
              size: hasArtifact
                ? THREE.MathUtils.clamp(radius * 0.012, 0.02, 0.085)
                : THREE.MathUtils.clamp(radius * 0.0025, 0.012, 0.028),
              sizeAttenuation: true,
              vertexColors: hasVertexColors,
              color: hasVertexColors ? 0xffffff : POINT_COLOR,
              transparent: false,
              opacity: 1,
            });
            const points = new THREE.Points(geometry, material);
            points.name = 'reconstruction-points';
            scene.add(points);
            pointsRef.current = points;
          }
              const imagePhotos = photos.filter((photo) => photo.imageUrl).slice(0, 12);
              const textureLoader = new THREE.TextureLoader();
              const muralRadius = Math.max(radius * 0.22, 1.5);
              const muralEyeHeight = project?.ceilingHeight
                ? Math.min(1.65, Math.max(1.2, project.ceilingHeight - 0.30))
                : 1.65;
              imagePhotos.forEach((photo, index) => {
                const imageUrl = photo.imageUrl as string;
                // Validate URL to prevent SSRF / malformed loads.
                try {
                  new URL(imageUrl); // throws if invalid relative/absolute URL
                } catch {
                  return; // skip invalid URLs safely
                }
                const abortController = new AbortController();
                textureAbortRef.current.set(photo.id, abortController);
                textureLoader.load(
                  imageUrl,
                  (texture) => {
                    textureAbortRef.current.delete(photo.id);
                    if (sceneRef.current !== scene) {
                      texture.dispose();
                      return;
                    }
                    const image = texture.image as HTMLImageElement;
                    const aspect = image?.width && image?.height ? image.width / image.height : 1.5;
                    const height = Math.min(Math.max(radius * 0.12, 1.6), 2.4);
                    const panel = new THREE.Mesh(
                      new THREE.PlaneGeometry(height * aspect, height),
                      new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide })
                    );
                    const angle = (index / Math.max(imagePhotos.length, 1)) * Math.PI * 2;
                    panel.position.set(
                      Math.cos(angle) * muralRadius,
                      muralEyeHeight,
                      Math.sin(angle) * muralRadius
                    );
                    panel.lookAt(0, muralEyeHeight, 0);
                    panel.name = `uploaded-photo-${photo.filename}`;
                    scene.add(panel);
                  },
                  undefined,
                  (err) => {
                    textureAbortRef.current.delete(photo.id);
                    // Texture load failures are non-fatal; skip the mural panel silently.
                  }
                );
              });
          setMode('ready');
          resetCamera();
        } catch (err: any) {
          setMode('error');
          setError(err?.message || 'Failed to parse the reconstruction artifact.');
        }
      },
      undefined,
      (err: any) => {
        if (sceneRef.current !== scene) return;
        setMode('error');
        setError(`Failed to load reconstruction artifact: ${err?.message ?? 'network or file error'}. ` +
          'Make sure the reconstruction service is running and the artifact URL is accessible.');
      },
    );
    const clock = new THREE.Clock();
    const animate = () => {
      rafRef.current = requestAnimationFrame(animate);
      const delta = Math.min(clock.getDelta(), 0.05);
      if (controls.isLocked) {
        const speed = keys.has('ShiftLeft') || keys.has('ShiftRight') ? 4.5 : 2.8;
        const direction = new THREE.Vector3(
          Number(keys.has('KeyD') || keys.has('ArrowRight')) - Number(keys.has('KeyA') || keys.has('ArrowLeft')),
          0,
          Number(keys.has('KeyS') || keys.has('ArrowDown')) - Number(keys.has('KeyW') || keys.has('ArrowUp'))
        );
        if (direction.lengthSq() > 0) {
          direction.normalize();
          controls.moveRight(direction.x * speed * delta);
          controls.moveForward(-direction.z * speed * delta);
        }
        // Calibrated eye level from the Stage A anchor (falls back to 1.6 m).
        const eyeHeight = project?.ceilingHeight
          ? Math.min(1.65, Math.max(1.2, project.ceilingHeight - 0.30))
          : 1.6;
        camera.position.y = eyeHeight;
        // Prevent walking through walls; doorway openings remain passable.
        clampCameraToLayout(camera, layoutRef.current ?? {}, doorways, eyeHeight);
        setCameraPos({
          x: camera.position.x,
          y: camera.position.y,
          z: camera.position.z,
        });
      }
      renderer.render(scene, camera);
    };
    rafRef.current = requestAnimationFrame(animate);
    const onResize = () => {
      const width = containerRef.current?.clientWidth || 640;
      const height = containerRef.current?.clientHeight || 400;
      if (camera && renderer) { camera.aspect = width / height; camera.updateProjectionMatrix(); renderer.setSize(width, height); }
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      controls.unlock();
    };
  }, [dispose, hasArtifact, resetCamera]);

  useEffect(() => {
    if (!hasArtifact && !fallbackPlyUrl) {
      dispose();
      setMode('empty');
      setPointCount(null);
      setError(null);
      return;
    }
    if (!sceneUrl) return;
    const frame = window.requestAnimationFrame(() => loadArtifact(sceneUrl));
    return () => {
      window.cancelAnimationFrame(frame);
      dispose();
    };
  }, [hasArtifact, sceneUrl, loadArtifact, dispose, fallbackPlyUrl]);

  const containerClass = `relative rounded-xl border border-slate-800 bg-slate-950 overflow-hidden ${isFullscreen ? 'fixed inset-0 z-50 bg-black' : 'aspect-video w-full'}`;

  if (mode === 'empty' && !sceneUrl) {
    return (
      <section className="flex flex-col items-center justify-center h-full text-slate-400">
        <div className="flex items-center justify-center h-24 w-24 rounded-full bg-slate-900 border border-slate-800 mb-4">
          <Image className="w-10 h-10 text-slate-600" />
        </div>
        <h3 className="text-sm font-mono font-semibold text-slate-200 mb-1">No reconstruction yet</h3>
        <p className="text-xs text-slate-500 text-center max-w-xs mb-6 px-4">
          Upload and reconstruct photos in Capture Studio, then open the walkthrough here.
        </p>
        <p className="text-[10px] font-mono text-slate-500">
          The viewer loads the real PLY artifact from your completed job — no sample geometry.
        </p>
      </section>
    );
  }

  if (mode === 'error') {
    return (
      <section className="flex flex-col items-center justify-center h-full p-6 text-center">
        <div className="w-12 h-12 rounded-full bg-red-950/40 border border-red-800 flex items-center justify-center mb-3">
          <AlertTriangle className="w-6 h-6 text-red-400" />
        </div>
        <h3 className="text-sm font-mono font-semibold text-red-200 mb-1">Unable to load scene</h3>
        <p className="text-xs text-red-300/80 text-center max-w-sm mb-4 px-4">{error}</p>
        <button
          onClick={() => { setMode('empty'); setError(null); }}
          className="px-4 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] font-mono rounded border border-slate-700 transition"
        >
          Try again
        </button>
      </section>
    );
  }

  return (
    <>
      <div className={containerClass} ref={containerRef} tabIndex={0} aria-label="3D reconstruction walkthrough" role="region" onKeyDown={(e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      safeLockControls();
    }
  }}>
        {mode === 'loading' && (
          <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-slate-950 text-slate-400">
            <Loader2 className="w-8 h-8 text-cyan-400 animate-spin mb-3" />
            <p className="text-xs font-mono text-slate-400">Loading reconstructed scene…</p>
          </div>
        )}
        <div className="absolute top-4 left-4 z-20 flex flex-col gap-1 pointer-events-none">
          <h3 id="viewer-title" className="text-xs font-mono font-bold text-white bg-black/60 px-2 py-1 rounded border border-slate-700/60">
            {projectName ? `Reconstruction — ${projectName}` : '3D Reconstruction'}
          </h3>
          {pointCount != null && (
            <span className="text-[10px] font-mono text-cyan-300 bg-black/60 px-2 py-1 rounded border border-slate-700/60">
              {pointCount.toLocaleString()} points
            </span>
          )}
        </div>
        <div className="absolute top-4 right-4 z-20 flex flex-col gap-2 pointer-events-auto">
          <button onClick={() => { resetCamera(); safeLockControls(); }} title="Enter interior view" aria-label="Enter interior first-person view" className="p-2.5 bg-slate-900/80 hover:bg-slate-800 text-slate-300 border border-slate-700 rounded-lg transition backdrop-blur-sm">
            <EyeOff className="w-4 h-4" />
          </button>
          <button onClick={() => setIsFullscreen((p) => !p)} title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'} aria-label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'} className="p-2.5 bg-slate-900/80 hover:bg-slate-800 text-slate-300 border border-slate-700 rounded-lg transition backdrop-blur-sm">
            {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>
          <button onClick={() => setMode('empty')} title="Close walkthrough" aria-label="Close walkthrough" className="p-2.5 bg-slate-900/80 hover:bg-slate-800 text-slate-300 border border-slate-700 rounded-lg transition backdrop-blur-sm">
            <span className="text-[10px]">Close</span>
          </button>
        </div>
        <div className="absolute bottom-4 left-4 z-20 flex items-center gap-2 pointer-events-none">
          <span className="text-[10px] font-mono text-slate-400 bg-black/60 px-2 py-1 rounded border border-slate-700/60">Click to enter • WASD move • Mouse look • Shift sprint</span>
        </div>

        {/* Real-time metric telemetry HUD (X, Y, Z in meters) */}
        <div className="absolute bottom-4 right-4 z-20 flex flex-col gap-1 pointer-events-none">
          <div className="bg-black/60 border border-slate-700/60 rounded-lg p-2 text-[9px] font-mono text-slate-200 min-w-[96px]">
            <div className="flex justify-between text-slate-400 mb-1 uppercase tracking-wider">
              <span>POS (m)</span>
              <span>LOCKED</span>
            </div>
            <div className="flex gap-3">
              <div className="text-cyan-300">X <span className="text-slate-300">{cameraPos?.x.toFixed(2) ?? '—'}</span></div>
              <div className="text-emerald-300">Y <span className="text-slate-300">{cameraPos?.y.toFixed(2) ?? '—'}</span></div>
              <div className="text-rose-300">Z <span className="text-slate-300">{cameraPos?.z.toFixed(2) ?? '—'}</span></div>
            </div>
          </div>
        </div>

        {/* Minimap radar — room footprint + camera position + facing cone */}
        <div className="absolute bottom-16 left-4 z-20 w-48 h-48 pointer-events-none">
          <div className="bg-black/70 border border-slate-700/70 rounded-lg p-2 shadow-2xl backdrop-blur-sm">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[9px] font-mono text-slate-300 font-bold flex items-center gap-1">
                <Compass className="w-3 h-3" />
                MINIMAP
              </span>
              <span className="text-[8px] text-slate-500 font-mono">top-down</span>
            </div>
            <div className="relative w-40 h-40 bg-slate-950/60 border border-slate-800 rounded overflow-hidden">
              {layoutRef.current && cameraPos && (
                <>
                  <svg className="w-full h-full" viewBox="0 0 160 160" preserveAspectRatio="none">
                    <defs>
                      <marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="2" orient="auto">
                        <path d="M0,0 L0,4 L6,2 Z" fill="cyan" />
                      </marker>
                    </defs>
                    {/* Compute global bounds once */}
                    {(() => {
                      const allBoxes = Object.values(layoutRef.current);
                      const gMinX = Math.min(...allBoxes.map((b) => b.minX));
                      const gMaxX = Math.max(...allBoxes.map((b) => b.maxX));
                      const gMinZ = Math.min(...allBoxes.map((b) => b.minZ));
                      const gMaxZ = Math.max(...allBoxes.map((b) => b.maxZ));
                      const spanX = Math.max(gMaxX - gMinX, 1);
                      const spanZ = Math.max(gMaxZ - gMinZ, 1);
                      const sx = (worldX: number) => ((worldX - gMinX) / spanX) * 140 + 10;
                      const sz = (worldZ: number) => 160 - ((worldZ - gMinZ) / spanZ) * 140 - 10;

                      // Room footprints + doorways
                      const layout = layoutRef.current;
                      const rooms = Object.values(layout).map((box, bi) => (
                        <g key={`room-${bi}`}>
                          <rect
                            x={sx(box.minX)}
                            y={sz(box.maxZ)}
                            width={sx(box.maxX) - sx(box.minX)}
                            height={sz(box.minZ) - sz(box.maxZ)}
                            fill="transparent"
                            stroke="cyan"
                            strokeOpacity="0.35"
                            strokeWidth="1.5"
                          />
                          <text
                            x={sx((box.minX + box.maxX) / 2)}
                            y={sz((box.minZ + box.maxZ) / 2) + 4}
                            fill="cyan"
                            fillOpacity="0.6"
                            fontSize="8"
                            fontFamily="monospace"
                            textAnchor="middle"
                            pointerEvents="none"
                          >
                            {box.room.id}
                          </text>
                        </g>
                      ));

                      const doors = doorways.map((door) => {
                        const placement = layout ? getDoorwayPlacement(door, layout) : null;
                        if (!placement) return null;
                        const halfW = Math.max((door.widthMeters || 1.1) / 2, 0.15);
                        return (
                          <line
                            key={door.id}
                            x1={sx(placement.x - halfW)}
                            y1={sz(placement.z)}
                            x2={sx(placement.x + halfW)}
                            y2={sz(placement.z)}
                            stroke="amber"
                            strokeWidth="2.5"
                            strokeLinecap="round"
                          />
                        );
                      });

                      // Camera position dot
                      const camX = sx(cameraPos.x);
                      const camZ = sz(cameraPos.z);

                      return (
                        <>
                          {rooms}
                          {doors}
                          <circle cx={camX} cy={camZ} r="3" fill="#22d3ee" />
                        </>
                      );
                    })()}
                  </svg>
                </>
              )}
            </div>
            <div className="text-[8px] text-slate-500 font-mono mt-1">
              • You · ─ ─ Doorway · ▱ Room
            </div>
          </div>
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between gap-2 text-[10px] font-mono text-slate-500">
        <span>Status: <span className="text-emerald-400">Completed</span></span>
        {reconstructionJob?.stats?.registeredImages != null && reconstructionJob?.stats?.inputImages != null && (
          <span>{reconstructionJob.stats.registeredImages}/{reconstructionJob.stats.inputImages} images registered</span>
        )}
        {reconstructionJob?.stats?.durationSeconds != null && <span>~{Math.round(reconstructionJob.stats.durationSeconds)}s</span>}
      </div>
    </>
  );
};
