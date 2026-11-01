import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import * as THREE from 'three';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
  Maximize,
  Minimize,
  AlertTriangle,
  Loader2,
  Image,
  EyeOff,
  Compass,
  MapPin,
  RotateCcw,
  Layout,
  Search,
  ChevronsUpDown,
  ArrowLeftRight,
  Maximize2,
  Minimize2,
  Activity,
  BarChart3,
  Eye,
  EyeOff as EyeOffIcon,
  Cpu,
  Gauge,
  Wifi,
  RefreshCw,
  Info,
  ArrowUpDown,
  ArrowLeftRight as HArrowLeftRight,
  RotateCw,
} from 'lucide-react';
import {
  reconstructionApi,
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
import { alignReconstructionGeometry } from '../utils/reconstructionAlignment';
import { groupPhotoFilenames, inferPhotoRoomGroup } from '../utils/photoRoomGrouping';

interface Viewer3DViewProps {
  reconstructionJob: ReconstructionJob | null;
  modelUrl?: string;
  projectName?: string;
  project?: NammaProject;
  rooms?: RoomMetadata[];
  doorways?: DoorwayAnchor[];
  photos?: CapturePhotoRecord[];
}

const DEFAULT_CLEAR_COLOR = 0x05070a;
const POINT_COLOR = 0xffffff;
const WALL_COLOR = 0x334155;
const FLOOR_COLOR = 0x1e293b;
const CEILING_COLOR = 0x0f172a;
const GRID_COLOR = 0x444455;

const WALL_EPSILON = 0.12;
const EYE_HEIGHT_FLOOR_MARGIN = 0.02;

const WALK_SPEED_MPS = 2.6;
const SPRINT_SPEED_MPS = 4.6;
const ACCELERATION = 10.0;

type ViewMode = 'points' | 'mesh' | 'combined';
type CameraMode = 'orbit' | 'firstperson';
type OrthographicView = 'perspective' | 'top' | 'front' | 'side';

let wallMaterialCache: THREE.MeshStandardMaterial | null = null;
let floorMaterialCache: THREE.MeshStandardMaterial | null = null;
let ceilingMaterialCache: THREE.MeshStandardMaterial | null = null;

function shellMaterials(): {
  wall: THREE.MeshStandardMaterial;
  floor: THREE.MeshStandardMaterial;
  ceiling: THREE.MeshStandardMaterial;
} {
  if (!wallMaterialCache) {
    wallMaterialCache = new THREE.MeshStandardMaterial({
      color: WALL_COLOR,
      roughness: 0.85,
      metalness: 0.05,
      side: THREE.DoubleSide,
    });
  }
  if (!floorMaterialCache) {
    floorMaterialCache = new THREE.MeshStandardMaterial({
      color: FLOOR_COLOR,
      roughness: 0.95,
      metalness: 0.0,
    });
  }
  if (!ceilingMaterialCache) {
    ceilingMaterialCache = new THREE.MeshStandardMaterial({
      color: CEILING_COLOR,
      roughness: 0.95,
      metalness: 0.0,
      side: THREE.DoubleSide,
    });
  }
  return { wall: wallMaterialCache, floor: floorMaterialCache, ceiling: ceilingMaterialCache };
}

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
    const halfWidth = Math.max((door.widthMeters || 1.1) / 2, 0.05);
    const doorHeight = door.heightMeters || 2.1;
    const isVerticalWall = wall === 'east' || wall === 'west';
    const onAxis = isVerticalWall ? Math.abs(pos.z - placement.z) : Math.abs(pos.x - placement.x);
    const atHeight = pos.y >= 0 && pos.y <= doorHeight + 0.2;
    if (onAxis <= halfWidth && atHeight) return true;
  }
  return false;
}

function clampCameraToLayout(
  camera: THREE.PerspectiveCamera | THREE.OrthographicCamera,
  layout: Record<string, RoomLayoutBox>,
  doorways: DoorwayAnchor[],
  eyeHeight: number
): void {
  const pos = camera.position;
  const floor = EYE_HEIGHT_FLOOR_MARGIN;
  for (const box of Object.values(layout)) {
    const { minX, maxX, minZ, maxZ, height } = box;
    if (pos.x >= minX && pos.x <= maxX && pos.z >= minZ && pos.z <= maxZ) {
      pos.y = Math.min(pos.y, height - 0.15);
    }
    if (pos.x > maxX && pos.x < maxX + WALL_EPSILON && pos.z >= minZ && pos.z <= maxZ && !isPosInDoorwayOpening(pos, box, 'east', doorways, layout)) {
      pos.x = maxX;
    }
    if (pos.x < minX && pos.x > minX - WALL_EPSILON && pos.z >= minZ && pos.z <= maxZ && !isPosInDoorwayOpening(pos, box, 'west', doorways, layout)) {
      pos.x = minX;
    }
    if (pos.z < minZ && pos.z > minZ - WALL_EPSILON && pos.x >= minX && pos.x <= maxX && !isPosInDoorwayOpening(pos, box, 'north', doorways, layout)) {
      pos.z = minZ;
    }
    if (pos.z > maxZ && pos.z < maxZ + WALL_EPSILON && pos.x >= minX && pos.x <= maxX && !isPosInDoorwayOpening(pos, box, 'south', doorways, layout)) {
      pos.z = maxZ;
    }
  }
  if (pos.y < floor) pos.y = floor;
}

function buildShell(
  layout: Record<string, RoomLayoutBox>,
  doorways: DoorwayAnchor[]
): THREE.Group {
  const group = new THREE.Group();
  group.name = 'architecture-shell';
  const { wall, floor, ceiling } = shellMaterials();

  for (const box of Object.values(layout)) {
    const { minX, maxX, minZ, maxZ, height } = box;

    const floorMesh = new THREE.Mesh(new THREE.PlaneGeometry(maxX - minX, maxZ - minZ), floor);
    floorMesh.rotation.x = -Math.PI / 2;
    floorMesh.position.set((minX + maxX) / 2, EYE_HEIGHT_FLOOR_MARGIN, (minZ + maxZ) / 2);
    floorMesh.name = `floor-${box.room.id}`;
    floorMesh.receiveShadow = true;
    group.add(floorMesh);

    const ceilingMesh = new THREE.Mesh(new THREE.PlaneGeometry(maxX - minX, maxZ - minZ), ceiling);
    ceilingMesh.rotation.x = Math.PI / 2;
    ceilingMesh.position.set((minX + maxX) / 2, height, (minZ + maxZ) / 2);
    ceilingMesh.name = `ceiling-${box.room.id}`;
    ceilingMesh.receiveShadow = true;
    group.add(ceilingMesh);

    const walls: Array<{
      sizeX: number;
      posX: number;
      posZ: number;
      rotY: number;
      wall: 'north' | 'south' | 'east' | 'west';
    }> = [
      { sizeX: maxX - minX, posX: (minX + maxX) / 2, posZ: minZ, rotY: 0, wall: 'north' },
      { sizeX: maxX - minX, posX: (minX + maxX) / 2, posZ: maxZ, rotY: 0, wall: 'south' },
      { sizeX: maxZ - minZ, posX: minX, posZ: (minZ + maxZ) / 2, rotY: Math.PI / 2, wall: 'west' },
      { sizeX: maxZ - minZ, posX: maxX, posZ: (minZ + maxZ) / 2, rotY: Math.PI / 2, wall: 'east' },
    ];

    for (const w of walls) {
      const roomDoorways = doorways.filter(
        (d) => (d.connectedRoomIds[0] === box.room.id || d.connectedRoomIds[1] === box.room.id) && d.wallLocation === w.wall
      );

      if (roomDoorways.length === 0) {
        const wallMesh = new THREE.Mesh(new THREE.PlaneGeometry(w.sizeX, height), wall);
        wallMesh.position.set(w.posX, height / 2, w.posZ);
        wallMesh.rotation.y = w.rotY;
        wallMesh.name = `wall-${box.room.id}-${w.wall}`;
        wallMesh.castShadow = true;
        wallMesh.receiveShadow = true;
        group.add(wallMesh);
      } else {
        const openings = roomDoorways.map((d) => {
          const placement = getDoorwayPlacement(d, layout);
          if (!placement) return null;
          const halfW = (d.widthMeters || 1.1) / 2;
          const pos = w.wall === 'east' || w.wall === 'west' ? placement.z : placement.x;
          return { center: pos, halfW, door: d };
        });
        const sortedOpenings = openings
          .filter((o): o is NonNullable<typeof o> => Boolean(o))
          .sort((a, b) => a.center - b.center);
        const wallMin = w.wall === 'east' || w.wall === 'west' ? minZ : minX;
        const wallMax = w.wall === 'east' || w.wall === 'west' ? maxZ : maxX;
        let cursor = wallMin;
        for (const opening of sortedOpenings) {
          const segStart = cursor;
          const segEnd = Math.max(cursor, opening.center - opening.halfW - 0.02);
          if (segEnd > segStart + 0.05) {
            const segWall = new THREE.Mesh(new THREE.PlaneGeometry(segEnd - segStart, height), wall);
            const segPos = (segStart + segEnd) / 2;
            const isVertical = w.wall === 'east' || w.wall === 'west';
            segWall.position.set(isVertical ? w.posX : segPos, height / 2, isVertical ? segPos : w.posZ);
            segWall.rotation.y = w.rotY;
            segWall.name = `wall-${box.room.id}-${w.wall}-seg`;
            segWall.castShadow = true;
            segWall.receiveShadow = true;
            group.add(segWall);
          }
          cursor = opening.center + opening.halfW + 0.02;
        }
        if (cursor < wallMax - 0.05) {
          const segWall = new THREE.Mesh(new THREE.PlaneGeometry(wallMax - cursor, height), wall);
          const segPos = (cursor + wallMax) / 2;
          const isVertical = w.wall === 'east' || w.wall === 'west';
          segWall.position.set(isVertical ? w.posX : segPos, height / 2, isVertical ? segPos : w.posZ);
          segWall.rotation.y = w.rotY;
          segWall.name = `wall-${box.room.id}-${w.wall}-seg`;
          segWall.castShadow = true;
          segWall.receiveShadow = true;
          group.add(segWall);
        }
      }
    }
  }
  return group;
}

function computeSceneBounds(
  scene: THREE.Scene,
  layout: Record<string, RoomLayoutBox>
): { min: THREE.Vector3; max: THREE.Vector3; center: THREE.Vector3; radius: number } | null {
  const box = new THREE.Box3();
  let hasContent = false;

  scene.traverse((obj) => {
    if (obj.type === 'Scene' || obj.type === 'Camera' || obj.type === 'Light') return;
    if (obj instanceof THREE.Mesh || obj instanceof THREE.Points) {
      box.expandByObject(obj);
      hasContent = true;
    }
  });

  if (layout && Object.values(layout).length > 0) {
    for (const b of Object.values(layout)) {
      box.expandByPoint(new THREE.Vector3(b.minX, 0, b.minZ));
      box.expandByPoint(new THREE.Vector3(b.maxX, b.height, b.maxZ));
    }
    hasContent = true;
  }

  if (!hasContent) return null;
  const min = box.min.clone();
  const max = box.max.clone();
  const center = box.getCenter(new THREE.Vector3());
  const radius = box.getSize(new THREE.Vector3()).length() / 2 || 1;
  return { min, max, center, radius };
}

const QUALITY_TIERS = [
  { label: 'GOOD' as const, color: 'text-emerald-400' as const, dot: 'bg-emerald-400' as const },
  { label: 'PARTIAL' as const, color: 'text-amber-400' as const, dot: 'bg-amber-400' as const },
  { label: 'POOR' as const, color: 'text-rose-400' as const, dot: 'bg-rose-400' as const },
  { label: 'INSUFFICIENT' as const, color: 'text-slate-400' as const, dot: 'bg-slate-500' as const },
];

type QualityTier = (typeof QUALITY_TIERS)[number];

function assessQuality(
  registeredImages: number,
  inputImages: number,
  pointCount: number,
  reprojectionError: number | null
): { tier: QualityTier; coverage: number } {
  const registrationRate = inputImages > 0 ? registeredImages / inputImages : 0;
  const coverage = Math.min(1, registrationRate * 0.6 + Math.min(1, pointCount / 50000) * 0.4);
  let tier: QualityTier = QUALITY_TIERS[3];
  if (coverage >= 0.75 && reprojectionError != null && reprojectionError < 2) tier = QUALITY_TIERS[0];
  else if (coverage >= 0.45) tier = QUALITY_TIERS[1];
  else if (coverage >= 0.2) tier = QUALITY_TIERS[2];
  return { tier, coverage };
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
  const [loadState, setLoadState] = useState<'empty' | 'loading' | 'ready' | 'error'>('empty');
  const [viewMode, setViewMode] = useState<ViewMode>('combined');
  const [cameraMode, setCameraMode] = useState<CameraMode>('orbit');
  const [orthoView, setOrthoView] = useState<OrthographicView>('perspective');
  const [isOrtho, setIsOrtho] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pointCount, setPointCount] = useState<number | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [cameraPos, setCameraPos] = useState<{ x: number; y: number; z: number } | null>(null);
  const [qualityMetrics, setQualityMetrics] = useState<{
    registered: number;
    input: number;
    points: number;
    reprojection: number | null;
    duration: number | null;
    tier: QualityTier;
    coverage: number;
  } | null>(null);

  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | THREE.OrthographicCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const orbitControlsRef = useRef<OrbitControls | null>(null);
  const pointerControlsRef = useRef<PointerLockControls | null>(null);
  const pointsRef = useRef<THREE.Points | null>(null);
  const surfaceRef = useRef<THREE.Mesh | null>(null);
  const shellRef = useRef<THREE.Group | null>(null);
  const rafRef = useRef<number | null>(null);
  const layoutRef = useRef<Record<string, RoomLayoutBox> | null>(null);
  const textureAbortRef = useRef<Map<string, AbortController>>(new Map());
  const urlListRef = useRef<string[]>([]);
  const urlIndexRef = useRef(0);
  const frameRefs = useRef<number[]>([]);
  const lastHudUpdate = useRef(0);
  const alignmentRef = useRef<{
    rotation: THREE.Quaternion;
    translation: THREE.Vector3;
    up: THREE.Vector3;
    coreRadius: number;
  } | null>(null);
  const moveRef = useRef<{
    velocity: THREE.Vector3;
    target: THREE.Vector3;
    keys: Set<string>;
  } | null>(null);
  const sceneBoundsRef = useRef<{
    min: THREE.Vector3;
    max: THREE.Vector3;
    center: THREE.Vector3;
    radius: number;
  } | null>(null);

  const toggleFullscreen = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    if (!document.fullscreenElement) {
      el.requestFullscreen().catch(() => setIsFullscreen(true));
    } else {
      document.exitFullscreen().catch(() => setIsFullscreen(false));
    }
  }, []);

  useEffect(() => {
    const onFullscreenChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, []);

  const [fetchedJob, setFetchedJob] = useState<ReconstructionJob | null>(null);

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
        ? [colors.getX(index), colors.getY(index), colors.getZ(index)].map((value) => Math.round(value * 255))
        : [34, 211, 238];
      lines.push(`${positions.getX(index)} ${positions.getY(index)} ${positions.getZ(index)} ${color[0]} ${color[1]} ${color[2]}`);
    }
    return URL.createObjectURL(new Blob([lines.join('\n')], { type: 'application/octet-stream' }));
  }, [fallbackGeometry]);

  useEffect(() => {
    layoutRef.current = rooms.length ? solveRoomLayout(rooms, doorways, photos) : null;
  }, [rooms, doorways, photos]);

  useEffect(() => {
    return () => {
      if (fallbackPlyUrl) URL.revokeObjectURL(fallbackPlyUrl);
      fallbackGeometry?.dispose();
    };
  }, [fallbackGeometry, fallbackPlyUrl]);

  const effectiveJob = fetchedJob ?? reconstructionJob;
  const effectiveStats =
    effectiveJob?.stats ?? (project?.reconstructionModelStats ?? null);
  const effectiveStatus =
    effectiveJob?.status ??
    (project?.reconstructionModelStats?.jobStatus ?? null);

  const hasArtifact =
    effectiveStats != null &&
    (effectiveStatus === 'completed' || effectiveStatus === 'succeeded') &&
    Boolean(
      effectiveStats.splatUrl ||
        effectiveStats.pointCloudUrl ||
        effectiveJob?.assetUrls?.splat ||
        effectiveJob?.assetUrls?.pointCloud
    );

  const artifactUrl = reconstructionAssetUrl(
    effectiveStats?.pointCloudUrl ??
      effectiveStats?.splatUrl ??
      effectiveJob?.assetUrls?.pointCloud ??
      effectiveJob?.assetUrls?.splat,
    effectiveJob?.updatedAt ?? project?.reconstructionModelStats?.lastGeneratedAt
  );
  const sceneUrl = artifactUrl || modelUrl || fallbackPlyUrl;

  const eyeHeight = useMemo(() => {
    return project?.ceilingHeight
      ? Math.min(1.65, Math.max(1.2, project.ceilingHeight - 0.30))
      : 1.6;
  }, [project?.ceilingHeight]);

  // Compute quality metrics once when job/artifact is available
  useEffect(() => {
    const registered = effectiveStats?.registeredImages ?? effectiveJob?.stats?.registeredImages ?? 0;
    const input = effectiveStats?.inputImages ?? effectiveJob?.stats?.inputImages ?? 0;
    const pts = effectiveStats?.sparsePoints ?? effectiveStats?.pointCloudCount ?? pointCount ?? 0;
    const reproj = effectiveStats?.reprojectionErrorPx ?? null;
    const duration = effectiveStats?.durationSeconds ?? null;
    if (registered > 0 || input > 0 || pts > 0) {
      const { tier, coverage } = assessQuality(registered, input, pts, reproj);
      setQualityMetrics({ registered, input, points: pts, reprojection: reproj, duration, tier, coverage });
    }
  }, [effectiveStats, effectiveJob?.stats, pointCount]);

  const applyViewMode = useCallback(() => {
    const points = pointsRef.current;
    const shell = shellRef.current;
    const surface = surfaceRef.current;
    const showPoints = viewMode === 'points' || viewMode === 'combined';
    const showShell = viewMode === 'mesh' || viewMode === 'combined';
    if (points) points.visible = showPoints;
    if (shell) shell.visible = showShell;
    if (surface) surface.visible = showShell;
  }, [viewMode]);

  useEffect(() => { applyViewMode(); }, [applyViewMode]);

  const dispose = useCallback(() => {
    textureAbortRef.current.forEach((controller) => controller.abort());
    textureAbortRef.current.clear();
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    const orbit = orbitControlsRef.current;
    if (orbit) { orbit.dispose(); orbitControlsRef.current = null; }
    const pointer = pointerControlsRef.current;
    if (pointer) { pointer.dispose(); pointerControlsRef.current = null; }
    const points = pointsRef.current;
    const pointsGeometry = points?.geometry ?? null;
    if (points && sceneRef.current) {
      sceneRef.current.remove(points);
      if (pointsGeometry) pointsGeometry.dispose();
      const material = points.material as THREE.Material;
      if (Array.isArray(material)) material.forEach((m) => m.dispose());
      else material.dispose();
      pointsRef.current = null;
    }
    const surface = surfaceRef.current;
    if (surface && sceneRef.current) {
      sceneRef.current.remove(surface);
      if (surface.geometry !== pointsGeometry) surface.geometry.dispose();
      const material = surface.material as THREE.Material;
      if (Array.isArray(material)) material.forEach((m) => m.dispose());
      else material.dispose();
      surfaceRef.current = null;
    }
    const shell = shellRef.current;
    if (shell && sceneRef.current) sceneRef.current.remove(shell);
    shellRef.current = null;
    const renderer = rendererRef.current;
    if (renderer) {
      renderer.dispose();
      if (renderer.domElement && containerRef.current && renderer.domElement.parentNode === containerRef.current) {
        containerRef.current.removeChild(renderer.domElement);
      }
      rendererRef.current = null;
    }
    const scene = sceneRef.current;
    if (scene) { scene.clear(); sceneRef.current = null; }
    cameraRef.current = null;
    alignmentRef.current = null;
    moveRef.current = null;
    sceneBoundsRef.current = null;
  }, []);

  useEffect(() => { return () => dispose(); }, [dispose]);

  useEffect(() => {
    const hasAsset = Boolean(
      effectiveJob?.stats?.splatUrl ||
        effectiveJob?.stats?.pointCloudUrl ||
        effectiveJob?.assetUrls?.splat ||
        effectiveJob?.assetUrls?.pointCloud
    );
    const jobId = project?.reconstructionModelStats?.jobId;
    if (hasAsset || !jobId) return;
    let cancelled = false;
    (async () => {
      try {
        const result = await reconstructionApi.getJob(jobId);
        if (cancelled || !result.ok || !result.data) return;
        setFetchedJob(result.data);
      } catch {
        /* swallow */
      }
    })();
    return () => { cancelled = true; };
  }, [effectiveJob?.splatUrl, effectiveJob?.pointCloudUrl, project?.reconstructionModelStats?.jobId]);

  const createCamera = useCallback((aspect: number): THREE.PerspectiveCamera | THREE.OrthographicCamera => {
    if (isOrtho) {
      const cam = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 1000);
      cam.position.set(0, 10, 0);
      cam.lookAt(0, 0, 0);
      return cam;
    }
    const cam = new THREE.PerspectiveCamera(60, aspect, 0.05, 500);
    cam.position.set(0, eyeHeight, 0);
    cam.lookAt(0, eyeHeight, 0);
    return cam;
  }, [isOrtho, eyeHeight]);

  const fitCameraToScene = useCallback(() => {
    const camera = cameraRef.current;
    const scene = sceneRef.current;
    const controls = orbitControlsRef.current;
    const pointer = pointerControlsRef.current;
    const layout = layoutRef.current;
    if (!camera || !scene) return;

    const bounds = computeSceneBounds(scene, layout ?? {});
    sceneBoundsRef.current = bounds;
    if (!bounds) return;

    const { center, radius } = bounds;

    if (isOrtho && camera instanceof THREE.OrthographicCamera) {
      const size = radius * 1.5;
      camera.left = -size;
      camera.right = size;
      camera.top = size;
      camera.bottom = -size;
      camera.near = 0.1;
      camera.far = radius * 10;
      camera.updateProjectionMatrix();

      const view = orthoView;
      if (view === 'top') {
        camera.position.set(center.x, center.y + radius * 2, center.z);
        camera.lookAt(center.x, center.y, center.z);
        controls?.target.set(center.x, center.y, center.z);
      } else if (view === 'front') {
        camera.position.set(center.x, center.y + radius * 0.5, center.z + radius * 2);
        camera.lookAt(center);
        controls?.target.set(center.x, center.y, center.z);
      } else if (view === 'side') {
        camera.position.set(center.x + radius * 2, center.y + radius * 0.5, center.z);
        camera.lookAt(center);
        controls?.target.set(center.x, center.y, center.z);
      } else {
        camera.position.set(center.x, center.y + radius * 0.5, center.z + radius * 1.5);
        camera.lookAt(center);
        controls?.target.set(center.x, center.y, center.z);
      }
    } else {
      const cam = camera as THREE.PerspectiveCamera;
      const fov = (cam.fov * Math.PI) / 180;
      const dist = radius / Math.sin(fov / 2) * 1.35;
      cam.position.set(center.x, center.y + radius * 0.45, center.z + dist);
      cam.lookAt(center);
      cam.updateMatrixWorld();

      cam.near = Math.max(0.01, radius * 0.001);
      cam.far = Math.max(80, radius * 8);
      cam.updateProjectionMatrix();

      if (controls) {
        controls.target.set(center.x, center.y, center.z);
        controls.maxDistance = radius * 10;
        controls.minDistance = Math.max(0.1, radius * 0.05);
        controls.update();
      }
    }

    if (pointer) {
      pointer.object.position.copy(camera.position);
      pointer.object.quaternion.copy(camera.quaternion);
    }
  }, [isOrtho, orthoView, eyeHeight]);

  const resetCamera = useCallback(() => {
    fitCameraToScene();
    const pointer = pointerControlsRef.current;
    if (cameraMode === 'firstperson' && pointer && !pointer.isLocked) {
      pointer.lock();
    }
  }, [fitCameraToScene, cameraMode]);

  const zoomCamera = useCallback((delta: number) => {
    const camera = cameraRef.current;
    const orbit = orbitControlsRef.current;
    const pointer = pointerControlsRef.current;
    if (!camera) return;
    const bounds = sceneBoundsRef.current;
    const center = bounds ? bounds.center : new THREE.Vector3(0, eyeHeight, 0);
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    const step = (bounds ? Math.max(bounds.radius * 0.15, 0.5) : 1) * delta;
    camera.position.addScaledVector(dir, step);
    camera.lookAt(center);
    camera.updateMatrixWorld();
    if (orbit) orbit.update();
    if (pointer) {
      pointer.object.position.copy(camera.position);
      pointer.object.quaternion.copy(camera.quaternion);
    }
  }, [eyeHeight]);

  const setOrthographicView = useCallback((view: OrthographicView) => {
    setOrthoView(view);
    setIsOrtho(view !== 'perspective');
    fitCameraToScene();
  }, [fitCameraToScene]);

  const lockPointer = useCallback(() => {
    const pointer = pointerControlsRef.current;
    if (pointer && !pointer.isLocked) pointer.lock();
  }, []);

  // Auto-lock pointer when entering first-person mode
  useEffect(() => {
    if (cameraMode === 'firstperson') {
      const frame = window.requestAnimationFrame(() => lockPointer());
      frameRefs.current.push(frame);
      return () => window.cancelAnimationFrame(frame);
    }
    const pointer = pointerControlsRef.current;
    if (pointer && pointer.isLocked) pointer.unlock();
  }, [cameraMode, lockPointer]);

  const loadArtifact = useCallback((url: string) => {
    if (!containerRef.current) return;
    dispose();
    setLoadState('loading');
    setError(null);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(DEFAULT_CLEAR_COLOR);
    sceneRef.current = scene;

    const container = containerRef.current;
    const w = container.clientWidth || 640;
    const h = container.clientHeight || 400;
    const camera = createCamera(w / h);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio ?? 1, 1.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setSize(w, h);
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.outline = 'none';
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Brighter PBR-friendly indoor lighting
    scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x222233, 0.8);
    hemiLight.position.set(0, 10, 0);
    scene.add(hemiLight);
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.4);
    dirLight.position.set(6, 10, 4);
    dirLight.castShadow = true;
    dirLight.shadow.camera.left = -30;
    dirLight.shadow.camera.right = 30;
    dirLight.shadow.camera.top = 30;
    dirLight.shadow.camera.bottom = -30;
    dirLight.shadow.mapSize.width = 1024;
    dirLight.shadow.mapSize.height = 1024;
    dirLight.shadow.normalBias = 0.02;
    scene.add(dirLight);

    // Floor grid for spatial reference
    const floorGrid = new THREE.GridHelper(60, 60, GRID_COLOR, 0x1a1c24);
    floorGrid.position.y = EYE_HEIGHT_FLOOR_MARGIN;
    floorGrid.name = 'floor-grid';
    floorGrid.renderOrder = 0;
    scene.add(floorGrid);

    const layout = layoutRef.current ?? {};
    const shellGroup = buildShell(layout, doorways);
    scene.add(shellGroup);
    shellRef.current = shellGroup;

    const orbit = new OrbitControls(camera, renderer.domElement);
    orbit.enableDamping = true;
    orbit.dampingFactor = 0.06;
    orbit.enablePan = true;
    orbit.minPolarAngle = 0.05;
    orbit.maxPolarAngle = Math.PI - 0.05;
    orbit.autoRotate = false;
    orbitControlsRef.current = orbit;

    const pointer = new PointerLockControls(camera, renderer.domElement);
    pointer.addEventListener('lock', () => setLoadState('ready'));
    pointerControlsRef.current = pointer;
    const keys = new Set<string>();
    moveRef.current = {
      velocity: new THREE.Vector3(),
      target: new THREE.Vector3(),
      keys,
    };

    const onKeyDown = (event: KeyboardEvent) => keys.add(event.code);
    const onKeyUp = (event: KeyboardEvent) => keys.delete(event.code);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    renderer.domElement.addEventListener('click', () => {
      if (cameraMode === 'firstperson') pointer.lock();
    });

    const loader = new PLYLoader();
    loader.load(
      url,
      (loadedGeometry) => {
        try {
          if (sceneRef.current !== scene) {
            loadedGeometry.dispose();
            return;
          }
          const positions = loadedGeometry.attributes.position;
          const count = positions ? positions.count : 0;
          if (!positions || count === 0) {
            loadedGeometry.dispose();
            throw new Error('The reconstruction artifact contains no points.');
          }

          const stats = effectiveStats ?? null;
          const { geometry, result } = alignReconstructionGeometry(loadedGeometry, stats, layout);
          loadedGeometry.dispose();
          alignmentRef.current = {
            rotation: result.rotation,
            translation: result.translation,
            up: result.up,
            coreRadius: result.coreRadius,
          };
          setPointCount(result.kept);

          const colorAttribute = geometry.getAttribute('color') as THREE.BufferAttribute | null;
          let hasVertexColors = Boolean(colorAttribute && colorAttribute.count > 0);
          if (colorAttribute && colorAttribute.count > 0) {
            const array = colorAttribute.array as ArrayLike<number> & { length: number };
            let max = 0;
            let finite = true;
            for (let i = 0; i < array.length; i += 1) {
              const value = Number(array[i]);
              if (!Number.isFinite(value)) { finite = false; break; }
              max = Math.max(max, Math.abs(value));
            }
            if (!finite) {
              geometry.deleteAttribute('color');
              hasVertexColors = false;
            } else if (max > 1.5) {
              const scale = max <= 255 ? 1 / 255 : 1 / max;
              for (let i = 0; i < array.length; i += 1) (array as any)[i] = Number(array[i]) * scale;
              colorAttribute.needsUpdate = true;
            }
          }

          const hasFaces = Boolean(geometry.index && geometry.index.count > 0);
          geometry.computeBoundingSphere();
          const sphere = geometry.boundingSphere;
          const coreRadius = (sphere?.radius ?? 1) || 1;

          const cam = camera as THREE.PerspectiveCamera;
          cam.near = Math.max(0.01, coreRadius * 0.001);
          cam.far = Math.max(80, coreRadius * 8);
          cam.updateProjectionMatrix();
          scene.fog = new THREE.Fog(DEFAULT_CLEAR_COLOR, Math.max(coreRadius * 0.25, 3), Math.max(coreRadius * 5.0, 60));

          // Point cloud: solid, distance-adaptive points
          const baseSize = Math.max(coreRadius * 0.05, 0.4);
          const pointMaterial = new THREE.PointsMaterial({
            size: baseSize,
            sizeAttenuation: true,
            vertexColors: hasVertexColors,
            color: hasVertexColors ? 0xffffff : POINT_COLOR,
            depthWrite: true,
            blending: THREE.NormalBlending,
          });
          const points = new THREE.Points(geometry, pointMaterial);
          points.name = 'reconstruction-points';
          points.frustumCulled = true;
          scene.add(points);
          pointsRef.current = points;

          if (hasFaces) {
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
            surfaceMesh.castShadow = true;
            surfaceMesh.receiveShadow = true;
            scene.add(surfaceMesh);
            surfaceRef.current = surfaceMesh;
          }

          applyViewMode();

          fitCameraToScene();

          const imagePhotos = photos.filter((photo) => photo.imageUrl).slice(0, 16);
          const textureLoader = new THREE.TextureLoader();
          const photoEyeHeight = project?.ceilingHeight
            ? Math.min(1.65, Math.max(1.2, project.ceilingHeight - 0.30))
            : 1.65;
          const align = alignmentRef.current;
          imagePhotos.forEach((photo) => {
            const imageUrl = photo.imageUrl as string;
            try { new URL(imageUrl); } catch { return; }
            const pose = photo.spatialPose as { x?: number; y?: number; z?: number; yaw?: number } | undefined;
            const px = pose?.x ?? 0;
            const py = pose?.y ?? photoEyeHeight;
            const pz = pose?.z ?? 0;
            let wx = px, wy = py, wz = pz;
            let wyaw = (pose?.yaw ?? 0) * (Math.PI / 180);
            if (align) {
              const p = new THREE.Vector3(px, py, pz).applyQuaternion(align.rotation).add(align.translation);
              wx = p.x; wy = p.y; wz = p.z;
              const yawFromAlign = new THREE.Euler().setFromQuaternion(align.rotation).y;
              wyaw = yawFromAlign - (pose?.yaw ?? 0) * (Math.PI / 180);
            }
            const abortController = new AbortController();
            textureAbortRef.current.set(photo.id, abortController);
            textureLoader.load(
              imageUrl,
              (texture) => {
                textureAbortRef.current.delete(photo.id);
                if (sceneRef.current !== scene) { texture.dispose(); return; }
                const image = texture.image as HTMLImageElement;
                const aspect = image?.width && image?.height ? image.width / image.height : 1.5;
                const height = Math.min(Math.max(coreRadius * 0.10, 1.4), 2.2);
                const panel = new THREE.Mesh(
                  new THREE.PlaneGeometry(height * aspect, height),
                  new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide, transparent: true, opacity: 0.55 })
                );
                panel.position.set(wx, wy, wz);
                panel.rotation.y = -wyaw;
                panel.name = `uploaded-photo-${photo.filename}`;
                scene.add(panel);
              },
              undefined,
              () => { textureAbortRef.current.delete(photo.id); }
            );
          });

          setLoadState('ready');
        } catch (err: any) {
          setLoadState('error');
          setError(err?.message || 'Failed to parse the reconstruction artifact.');
        }
      },
      undefined,
      (err: any) => {
        if (sceneRef.current !== scene) return;
        urlIndexRef.current += 1;
        const nextUrl = urlListRef.current[urlIndexRef.current];
        if (nextUrl) {
          const frame = window.requestAnimationFrame(() => { loadArtifact(nextUrl); });
          frameRefs.current.push(frame);
          return;
        }
        setLoadState('error');
        setError(`Failed to load reconstruction artifact: ${err?.message ?? 'network or file error'}.`);
      }
    );

    const clock = new THREE.Clock();
    const animate = () => {
      rafRef.current = requestAnimationFrame(animate);
      const camera = cameraRef.current;
      const renderer = rendererRef.current;
      const scene = sceneRef.current;
      if (!camera || !renderer || !scene) return;

      const delta = Math.min(clock.getDelta(), 0.05);

      if (cameraMode === 'orbit') {
        const orbit = orbitControlsRef.current;
        if (orbit) orbit.update();
      } else {
        const pointer = pointerControlsRef.current;
        const move = moveRef.current;
        if (pointer && pointer.isLocked && move) {
          const speed = move.keys.has('ShiftLeft') || move.keys.has('ShiftRight') ? SPRINT_SPEED_MPS : WALK_SPEED_MPS;
          const target = move.target;
          target.x =
            Number(move.keys.has('KeyD') || move.keys.has('ArrowRight')) -
            Number(move.keys.has('KeyA') || move.keys.has('ArrowLeft'));
          target.z =
            Number(move.keys.has('KeyS') || move.keys.has('ArrowDown')) -
            Number(move.keys.has('KeyW') || move.keys.has('ArrowUp'));
          if (target.lengthSq() > 0) {
            target.normalize();
            target.multiplyScalar(speed);
          } else {
            target.set(0, 0, 0);
          }
          const velocity = move.velocity;
          velocity.lerp(target, delta * ACCELERATION);
          if (velocity.lengthSq() < 0.0004) velocity.set(0, 0, 0);

          pointer.moveRight(velocity.x * delta);
          pointer.moveForward(-velocity.z * delta);

          camera.position.y = Math.max(camera.position.y, EYE_HEIGHT_FLOOR_MARGIN);
          clampCameraToLayout(camera, layoutRef.current ?? {}, doorways, eyeHeight);
        }
      }

      const now = performance.now();
      if (now - lastHudUpdate.current > 100) {
        lastHudUpdate.current = now;
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
      if (camera && renderer) {
        if (camera instanceof THREE.PerspectiveCamera) {
          camera.aspect = width / height;
          camera.updateProjectionMatrix();
        } else if (camera instanceof THREE.OrthographicCamera) {
          const size = Math.max(width, height) / 100;
          camera.left = -size;
          camera.right = size;
          camera.top = size;
          camera.bottom = -size;
          camera.updateProjectionMatrix();
        }
        renderer.setSize(width, height);
      }
    };
    window.addEventListener('resize', onResize);
    let roRef: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined' && containerRef.current) {
      roRef = new ResizeObserver(onResize);
      roRef.observe(containerRef.current);
    }
    return () => {
      window.removeEventListener('resize', onResize);
      roRef?.disconnect();
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      pointer.unlock();
    };
  }, [dispose, fitCameraToScene, resetCamera, applyViewMode, eyeHeight, doorways, cameraMode, isOrtho, orthoView, createCamera]);

  const setViewModeCallback = useCallback((next: ViewMode) => { setViewMode(next); }, []);

  useEffect(() => {
    const urls = [artifactUrl, modelUrl, fallbackPlyUrl].filter((u): u is string => Boolean(u));
    urlListRef.current = urls;
    urlIndexRef.current = 0;

    if (urls.length === 0) {
      dispose();
      setLoadState('empty');
      setPointCount(null);
      setError(null);
      return;
    }

    let cancelled = false;
    const tryLoad = (index: number) => {
      if (cancelled || index >= urls.length) return;
      const frame = window.requestAnimationFrame(() => {
        if (cancelled) return;
        loadArtifact(urls[index]);
      });
      frameRefs.current.push(frame);
    };
    tryLoad(0);

    return () => {
      cancelled = true;
      frameRefs.current.forEach((f) => window.cancelAnimationFrame(f));
      frameRefs.current = [];
      dispose();
    };
  }, [hasArtifact, sceneUrl, loadArtifact, dispose, artifactUrl, modelUrl, fallbackPlyUrl]);

  const containerClass = `relative rounded-xl border border-slate-800 bg-slate-950 overflow-hidden ${isFullscreen ? 'fixed inset-0 z-50 bg-black' : 'h-full w-full'}`;

  if (loadState === 'empty' && !sceneUrl) {
    return (
      <section className="flex flex-col items-center justify-center h-full text-slate-400 p-8">
        <div className="flex items-center justify-center h-24 w-24 rounded-full bg-slate-900 border border-slate-800 mb-4">
          <Image className="w-10 h-10 text-slate-600" />
        </div>
        <h3 className="text-sm font-mono font-semibold text-slate-200 mb-1">No reconstruction yet</h3>
        <p className="text-xs text-slate-500 text-center max-w-xs mb-6 px-4">
          Upload and reconstruct photos in Capture Studio, then open the walkthrough here.
        </p>
      </section>
    );
  }

  if (loadState === 'error') {
    return (
      <section className="flex flex-col items-center justify-center h-full p-6 text-center">
        <div className="w-12 h-12 rounded-full bg-red-950/40 border border-red-800 flex items-center justify-center mb-3">
          <AlertTriangle className="w-6 h-6 text-red-400" />
        </div>
        <h3 className="text-sm font-mono font-semibold text-red-200 mb-1">Unable to load scene</h3>
        <p className="text-xs text-red-300/80 text-center max-w-sm mb-4 px-4">{error}</p>
        <button
          onClick={() => { setLoadState('empty'); setError(null); }}
          className="px-4 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] font-mono rounded border border-slate-700 transition"
        >
          Try again
        </button>
      </section>
    );
  }

  const viewModeLabels: Record<ViewMode, string> = { points: 'Point cloud', mesh: 'Estimated mesh', combined: 'Both' };
  const camModeLabels: Record<CameraMode, string> = { orbit: 'Orbit', firstperson: 'First-person' };
  const orthoLabels: Record<OrthographicView, string> = {
    perspective: 'Perspective',
    top: 'Top',
    front: 'Front',
    side: 'Side',
  };

  return (
    <>
      <div
        className={containerClass}
        ref={containerRef}
        tabIndex={0}
        aria-label="3D reconstruction walkthrough"
        role="region"
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            if (cameraMode === 'firstperson') lockPointer();
          }
        }}
      >
        {loadState === 'loading' && (
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

        <div className="absolute top-4 right-4 z-20 flex flex-col gap-1.5 pointer-events-auto">
          <div className="flex items-center gap-1">
            <span className="text-[9px] font-mono text-slate-400 bg-black/60 px-2 py-1 rounded border border-slate-700/60">Camera</span>
            {(['orbit', 'firstperson'] as CameraMode[]).map((m) => (
              <button
                key={m}
                onClick={() => {
                  setCameraMode(m);
                  if (m === 'firstperson') lockPointer();
                  else {
                    const p = pointerControlsRef.current;
                    if (p && p.isLocked) p.unlock();
                  }
                }}
                aria-pressed={cameraMode === m}
                title={camModeLabels[m]}
                className={`p-1.5 rounded border text-[9px] font-mono transition ${
                  cameraMode === m
                    ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/50'
                    : 'bg-slate-900 text-slate-500 border-slate-700 hover:text-slate-200 hover:border-slate-500'
                }`}
              >
                {m === 'orbit' ? 'Orbit' : 'Walk'}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1">
            <span className="text-[9px] font-mono text-slate-400 bg-black/60 px-2 py-1 rounded border border-slate-700/60">View</span>
            {(['points', 'mesh', 'combined'] as ViewMode[]).map((m) => (
              <button
                key={m}
                onClick={() => setViewModeCallback(m)}
                aria-pressed={viewMode === m}
                title={viewModeLabels[m]}
                className={`p-1.5 rounded border text-[9px] font-mono transition ${
                  viewMode === m
                    ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/50'
                    : 'bg-slate-900 text-slate-500 border-slate-700 hover:text-slate-200 hover:border-slate-500'
                }`}
              >
                {m === 'points' ? 'Pts' : m === 'mesh' ? 'Mesh' : 'Both'}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1">
            <span className="text-[9px] font-mono text-slate-400 bg-black/60 px-2 py-1 rounded border border-slate-700/60">Ortho</span>
            {(['perspective', 'top', 'front', 'side'] as OrthographicView[]).map((v) => (
              <button
                key={v}
                onClick={() => setOrthographicView(v)}
                aria-pressed={orthoView === v && isOrtho}
                title={orthoLabels[v]}
                className={`p-1.5 rounded border text-[9px] font-mono transition ${
                  orthoView === v && isOrtho
                    ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/50'
                    : 'bg-slate-900 text-slate-500 border-slate-700 hover:text-slate-200 hover:border-slate-500'
                }`}
              >
                {v === 'perspective' ? 'Persp' : v === 'top' ? 'Top' : v === 'front' ? 'Front' : 'Side'}
              </button>
            ))}
          </div>

          <div className="flex gap-1">
            <button onClick={resetCamera} title="Reset camera" className="p-1.5 rounded border text-[9px] font-mono bg-slate-900 text-slate-300 border-slate-700 hover:text-slate-200 hover:border-slate-500 transition">
              <RotateCcw className="w-3 h-3" />
            </button>
            <button onClick={fitCameraToScene} title="Fit entire room" className="p-1.5 rounded border text-[9px] font-mono bg-slate-900 text-slate-300 border-slate-700 hover:text-slate-200 hover:border-slate-500 transition">
              <Layout className="w-3 h-3" />
            </button>
            <button onClick={() => zoomCamera(1)} title="Zoom in" className="p-1.5 rounded border text-[9px] font-mono bg-slate-900 text-slate-300 border-slate-700 hover:text-slate-200 hover:border-slate-500 transition">
              <Search className="w-3 h-3" />
            </button>
            <button onClick={() => zoomCamera(-1)} title="Zoom out" className="p-1.5 rounded border text-[9px] font-mono bg-slate-900 text-slate-300 border-slate-700 hover:text-slate-200 hover:border-slate-500 transition">
              <ChevronsUpDown className="w-3 h-3" />
            </button>
          </div>

          <button onClick={toggleFullscreen} title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'} className="p-1.5 rounded border text-[9px] font-mono bg-slate-900 text-slate-300 border-slate-700 hover:text-slate-200 hover:border-slate-500 transition">
            {isFullscreen ? <Minimize className="w-3 h-3" /> : <Maximize className="w-3 h-3" />}
          </button>
          <button onClick={() => setLoadState('empty')} title="Close walkthrough" className="p-1.5 rounded border text-[9px] font-mono bg-slate-900 text-slate-300 border-slate-700 hover:text-slate-200 hover:border-slate-500 transition">
            <span className="text-[9px]">Close</span>
          </button>
        </div>

        <div className="absolute bottom-8 left-4 z-20 flex flex-col gap-1 pointer-events-none">
          {cameraMode === 'firstperson' ? (
            <span className="text-[10px] font-mono text-slate-400 bg-black/60 px-2 py-1 rounded border border-slate-700/60">Click to enter • WASD move • Mouse look • Shift sprint</span>
          ) : (
            <span className="text-[10px] font-mono text-slate-400 bg-black/60 px-2 py-1 rounded border border-slate-700/60">Drag to orbit • Scroll to zoom • 360° rotation</span>
          )}
        </div>

        <div className="absolute bottom-4 right-4 z-20 flex flex-col gap-1 pointer-events-none">
          <div className="bg-black/60 border border-slate-700/60 rounded-lg p-2 text-[9px] font-mono text-slate-200 min-w-[96px]">
            <div className="flex justify-between text-slate-400 mb-1 uppercase tracking-wider">
              <span>POS (m)</span>
              <span>{cameraMode === 'firstperson' ? 'LOCKED' : 'ORBIT'}</span>
            </div>
            <div className="flex gap-3">
              <div className="text-cyan-300">X <span className="text-slate-300">{cameraPos?.x.toFixed(2) ?? '—'}</span></div>
              <div className="text-emerald-300">Y <span className="text-slate-300">{cameraPos?.y.toFixed(2) ?? '—'}</span></div>
              <div className="text-rose-300">Z <span className="text-slate-300">{cameraPos?.z.toFixed(2) ?? '—'}</span></div>
            </div>
          </div>
        </div>

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
                        <path d="M0,0 L0,4 L6,2 Z" fill="#22d3ee" />
                      </marker>
                    </defs>
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

                      const camX = sx(cameraPos.x);
                      const camZ = sz(cameraPos.z);
                      const camera = cameraRef.current;
                      let dirX = 0;
                      let dirZ = -1;
                      if (camera) {
                        const d = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
                        dirX = d.x;
                        dirZ = d.z;
                      }
                      const arrowLen = 16;
                      const endX = camX + dirX * arrowLen;
                      const endY = camZ - dirZ * arrowLen;

                      return (
                        <>
                          {rooms}
                          {doors}
                          <line
                            x1={camX}
                            y1={camZ}
                            x2={endX}
                            y2={endY}
                            stroke="#22d3ee"
                            strokeWidth="2"
                            strokeLinecap="round"
                            marker-end="url(#arrow)"
                          />
                          <circle cx={camX} cy={camZ} r="3" fill="#22d3ee" />
                        </>
                      );
                    })()}
                  </svg>
                </>
              )}
            </div>
            <div className="text-[8px] text-slate-500 font-mono mt-1">
              • You · ─ ─ Doorway · ▱ Room · — Facing
            </div>
          </div>
        </div>

        {qualityMetrics && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 pointer-events-none">
            <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-slate-900/80 border border-slate-700/60 backdrop-blur-sm text-[10px] font-mono">
              <span className={`w-2 h-2 rounded-full ${qualityMetrics.tier.dot}`} />
              <span className={`font-bold ${qualityMetrics.tier.color}`}>{qualityMetrics.tier.label}</span>
              <span className="text-slate-500">• Coverage {Math.round(qualityMetrics.coverage * 100)}%</span>
              {qualityMetrics.registered && qualityMetrics.input && (
                <span className="text-slate-500">• {qualityMetrics.registered}/{qualityMetrics.input} cams</span>
              )}
              {qualityMetrics.points && (
                <span className="text-slate-500">• {qualityMetrics.points.toLocaleString()} pts</span>
              )}
              {qualityMetrics.reprojection != null && (
                <span className="text-slate-500">• {qualityMetrics.reprojection.toFixed(1)}px reproj</span>
              )}
              {qualityMetrics.duration != null && (
                <span className="text-slate-500">• {Math.round(qualityMetrics.duration)}s</span>
              )}
            </div>
          </div>
        )}

        <div className="absolute bottom-4 left-4 right-4 z-20 flex items-center justify-between gap-2 px-3 text-[10px] font-mono text-slate-500 bg-black/60 border border-slate-700/60 rounded-lg backdrop-blur-sm">
          <span>Status: <span className="text-emerald-400">Completed</span></span>
          {effectiveJob?.stats?.registeredImages != null && effectiveJob?.stats?.inputImages != null && (
            <span>{effectiveJob.stats.registeredImages}/{effectiveJob.stats.inputImages} images registered</span>
          )}
          {effectiveJob?.stats?.durationSeconds != null && <span>~{Math.round(effectiveJob.stats.durationSeconds)}s</span>}
          <span className="text-cyan-300">Cam: {camModeLabels[cameraMode]}</span>
          <span className="text-cyan-300">View: {viewModeLabels[viewMode]}</span>
        </div>
      </div>
    </>
  );
};
