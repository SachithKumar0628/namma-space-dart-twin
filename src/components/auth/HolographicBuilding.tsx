/**
 * HolographicBuilding.tsx
 * 3D holographic architectural building scene rendered with Three.js.
 * Renders a procedural digital-twin architectural model with wireframes,
 * interior levels, diagonal structural trusses, scanning lines, spatial ground grid,
 * floating data particles, and telemetry anchors.
 * Directly controlled by scroll progress.
 */

import React, { useRef, useEffect, useCallback, useState, useMemo } from 'react';
import * as THREE from 'three';

interface HolographicBuildingProps {
  /** 0 = initial welcome view, 1 = fully zoomed into building / login view */
  scrollProgress: number;
  /** Whether to reduce visual complexity for performance */
  reducedMotion: boolean;
}

// Brand palette
const CYAN = new THREE.Color(0x06b6d4);
const CYAN_BRIGHT = new THREE.Color(0x22d3ee);
const TEAL = new THREE.Color(0x14b8a6);
const NAVY = new THREE.Color(0x0a0e27);
const GRID_COLOR = new THREE.Color(0x0e4a5e);
const SCAN_COLOR = new THREE.Color(0x38bdf8);

/** Helper to test WebGL support */
function checkWebGLSupport(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return !!(
      window.WebGLRenderingContext &&
      (canvas.getContext('webgl') || canvas.getContext('experimental-webgl'))
    );
  } catch {
    return false;
  }
}

/** Create the realistic architectural digital twin building */
function createBuilding(scene: THREE.Scene) {
  const group = new THREE.Group();

  const cyanWire = new THREE.LineBasicMaterial({ color: CYAN, transparent: true, opacity: 0.65 });
  const tealWire = new THREE.LineBasicMaterial({ color: TEAL, transparent: true, opacity: 0.5 });
  const brightWire = new THREE.LineBasicMaterial({ color: CYAN_BRIGHT, transparent: true, opacity: 0.8 });
  const subtleGlow = new THREE.MeshBasicMaterial({
    color: CYAN,
    transparent: true,
    opacity: 0.05,
    side: THREE.DoubleSide,
  });
  const coreGlow = new THREE.MeshBasicMaterial({
    color: TEAL,
    transparent: true,
    opacity: 0.08,
    side: THREE.DoubleSide,
  });

  // 1. Central High-Rise Tower (Tier 1 - Base to Mid)
  const mainTowerGeo = new THREE.BoxGeometry(3.6, 7.2, 3.6);
  const mainTowerEdges = new THREE.EdgesGeometry(mainTowerGeo);
  const mainTowerWire = new THREE.LineSegments(mainTowerEdges, cyanWire);
  mainTowerWire.position.y = 3.6;
  group.add(mainTowerWire);

  const mainTowerMesh = new THREE.Mesh(mainTowerGeo, subtleGlow);
  mainTowerMesh.position.y = 3.6;
  group.add(mainTowerMesh);

  // 2. Central Core Spine (Glowing elevator / service core)
  const coreGeo = new THREE.BoxGeometry(1.4, 8.5, 1.4);
  const coreEdges = new THREE.EdgesGeometry(coreGeo);
  const coreWire = new THREE.LineSegments(coreEdges, tealWire);
  coreWire.position.y = 4.25;
  group.add(coreWire);
  const coreMesh = new THREE.Mesh(coreGeo, coreGlow);
  coreMesh.position.y = 4.25;
  group.add(coreMesh);

  // 3. East Wing (Cantilevered glass volume)
  const eastWingGeo = new THREE.BoxGeometry(2.4, 4.8, 2.8);
  const eastWingEdges = new THREE.EdgesGeometry(eastWingGeo);
  const eastWingWire = new THREE.LineSegments(eastWingEdges, tealWire);
  eastWingWire.position.set(3.0, 2.4, 0.4);
  group.add(eastWingWire);
  const eastWingMesh = new THREE.Mesh(eastWingGeo, subtleGlow.clone());
  eastWingMesh.position.set(3.0, 2.4, 0.4);
  group.add(eastWingMesh);

  // 4. West Wing (Terraced atrium volume)
  const westWingGeo = new THREE.BoxGeometry(2.4, 3.6, 3.0);
  const westWingEdges = new THREE.EdgesGeometry(westWingGeo);
  const westWingWire = new THREE.LineSegments(westWingEdges, tealWire);
  westWingWire.position.set(-3.0, 1.8, -0.3);
  group.add(westWingWire);
  const westWingMesh = new THREE.Mesh(westWingGeo, subtleGlow.clone());
  westWingMesh.position.set(-3.0, 1.8, -0.3);
  group.add(westWingMesh);

  // 5. Crown Observation Deck & Penthouse (Tier 2)
  const crownGeo = new THREE.BoxGeometry(2.8, 1.8, 2.8);
  const crownEdges = new THREE.EdgesGeometry(crownGeo);
  const crownWire = new THREE.LineSegments(crownEdges, brightWire);
  crownWire.position.y = 8.1;
  group.add(crownWire);
  const crownMesh = new THREE.Mesh(crownGeo, subtleGlow.clone());
  crownMesh.position.y = 8.1;
  group.add(crownMesh);

  // 6. Spire / Communication Mast with Laser Node
  const spireGeo = new THREE.CylinderGeometry(0.02, 0.08, 2.2, 6);
  const spireEdges = new THREE.EdgesGeometry(spireGeo);
  const spire = new THREE.LineSegments(spireEdges, brightWire);
  spire.position.y = 10.1;
  group.add(spire);

  // Glowing beacon light at the tip
  const beaconGeo = new THREE.SphereGeometry(0.08, 8, 8);
  const beaconMat = new THREE.MeshBasicMaterial({ color: CYAN_BRIGHT });
  const beacon = new THREE.Mesh(beaconGeo, beaconMat);
  beacon.position.y = 11.2;
  group.add(beacon);

  // 7. Structural Floor Slabs (Every 1.2m)
  const floorLevels = [1.2, 2.4, 3.6, 4.8, 6.0, 7.2];
  floorLevels.forEach((y) => {
    const floorGeo = new THREE.PlaneGeometry(3.5, 3.5);
    const floorEdges = new THREE.EdgesGeometry(floorGeo);
    const floor = new THREE.LineSegments(
      floorEdges,
      new THREE.LineBasicMaterial({ color: CYAN, transparent: true, opacity: 0.25 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = y;
    group.add(floor);
  });

  // 8. Diagrid Cross-Bracing on Main Facade
  const diagridPoints: THREE.Vector3[] = [];
  for (let f = 0; f < 5; f++) {
    const y1 = f * 1.4;
    const y2 = (f + 1) * 1.4;
    // Front face diagonals
    diagridPoints.push(new THREE.Vector3(-1.8, y1, 1.81), new THREE.Vector3(1.8, y2, 1.81));
    diagridPoints.push(new THREE.Vector3(1.8, y1, 1.81), new THREE.Vector3(-1.8, y2, 1.81));
    // Back face diagonals
    diagridPoints.push(new THREE.Vector3(-1.8, y1, -1.81), new THREE.Vector3(1.8, y2, -1.81));
    diagridPoints.push(new THREE.Vector3(1.8, y1, -1.81), new THREE.Vector3(-1.8, y2, -1.81));
  }
  const diagridGeo = new THREE.BufferGeometry().setFromPoints(diagridPoints);
  const diagridLine = new THREE.LineSegments(
    diagridGeo,
    new THREE.LineBasicMaterial({ color: TEAL, transparent: true, opacity: 0.2 })
  );
  group.add(diagridLine);

  // 9. Digital Twin Spatial Calibration Nodes (Glowing coordinate anchors)
  const nodeGeo = new THREE.SphereGeometry(0.06, 6, 6);
  const nodeMat = new THREE.MeshBasicMaterial({ color: CYAN_BRIGHT });
  const nodePositions = [
    [-1.8, 0, 1.8],
    [1.8, 0, 1.8],
    [1.8, 7.2, 1.8],
    [-1.8, 7.2, 1.8],
    [-1.8, 0, -1.8],
    [1.8, 0, -1.8],
    [1.8, 7.2, -1.8],
    [-1.8, 7.2, -1.8],
    [4.2, 4.8, 0.4],
    [-4.2, 3.6, -0.3],
  ];
  nodePositions.forEach(([x, y, z]) => {
    const nodeMesh = new THREE.Mesh(nodeGeo, nodeMat);
    nodeMesh.position.set(x, y, z);
    group.add(nodeMesh);
  });

  // 10. Foundation Podium
  const podiumGeo = new THREE.BoxGeometry(8.8, 0.2, 5.8);
  const podiumEdges = new THREE.EdgesGeometry(podiumGeo);
  const podiumWire = new THREE.LineSegments(podiumEdges, tealWire);
  podiumWire.position.y = 0;
  group.add(podiumWire);

  scene.add(group);
  return group;
}

/** Create the spatial telemetry grid on the ground */
function createGroundGrid(scene: THREE.Scene) {
  const gridGroup = new THREE.Group();
  const gridMat = new THREE.LineBasicMaterial({
    color: GRID_COLOR,
    transparent: true,
    opacity: 0.35,
  });

  const size = 36;
  const divisions = 36;
  const step = size / divisions;
  const half = size / 2;

  for (let i = 0; i <= divisions; i++) {
    const pos = -half + i * step;
    // X lines
    const xPts = [new THREE.Vector3(-half, 0, pos), new THREE.Vector3(half, 0, pos)];
    gridGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(xPts), gridMat));
    // Z lines
    const zPts = [new THREE.Vector3(pos, 0, -half), new THREE.Vector3(pos, 0, half)];
    gridGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(zPts), gridMat));
  }

  // Radiating calibration rings
  [3, 6, 10, 15].forEach((radius) => {
    const ringGeo = new THREE.RingGeometry(radius - 0.02, radius + 0.02, 64);
    const ring = new THREE.Mesh(
      ringGeo,
      new THREE.MeshBasicMaterial({ color: CYAN, transparent: true, opacity: 0.15, side: THREE.DoubleSide })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.01;
    gridGroup.add(ring);
  });

  scene.add(gridGroup);
  return gridGroup;
}

/** Create floating ambient digital twin particles */
function createParticles(scene: THREE.Scene, count: number) {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);

  for (let i = 0; i < count; i++) {
    positions[i * 3] = (Math.random() - 0.5) * 24;
    positions[i * 3 + 1] = Math.random() * 14;
    positions[i * 3 + 2] = (Math.random() - 0.5) * 24;

    const t = Math.random();
    const c = new THREE.Color().lerpColors(CYAN, TEAL, t);
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const mat = new THREE.PointsMaterial({
    size: 0.08,
    transparent: true,
    opacity: 0.75,
    vertexColors: true,
    sizeAttenuation: true,
  });

  const points = new THREE.Points(geo, mat);
  scene.add(points);
  return points;
}

/** Create dynamic vertical and horizontal scan planes */
function createScanPlane(scene: THREE.Scene) {
  const geo = new THREE.PlaneGeometry(9, 0.08);
  const mat = new THREE.MeshBasicMaterial({
    color: SCAN_COLOR,
    transparent: true,
    opacity: 0.7,
    side: THREE.DoubleSide,
  });
  const plane = new THREE.Mesh(geo, mat);
  plane.position.y = 3;
  scene.add(plane);
  return plane;
}

export const HolographicBuilding: React.FC<HolographicBuildingProps> = ({
  scrollProgress,
  reducedMotion,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const buildingRef = useRef<THREE.Group | null>(null);
  const particlesRef = useRef<THREE.Points | null>(null);
  const scanPlaneRef = useRef<THREE.Mesh | null>(null);
  const gridRef = useRef<THREE.Group | null>(null);
  const frameRef = useRef<number>(0);
  const clockRef = useRef<number>(0);
  const [hasWebGL, setHasWebGL] = useState(true);

  // Initialize Three.js scene
  const init = useCallback(() => {
    if (!containerRef.current) return;
    if (!checkWebGLSupport()) {
      setHasWebGL(false);
      return;
    }

    const w = containerRef.current.clientWidth;
    const h = containerRef.current.clientHeight;

    const scene = new THREE.Scene();
    scene.background = NAVY;
    scene.fog = new THREE.FogExp2(NAVY.getHex(), 0.028);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(48, w / h, 0.1, 100);
    camera.position.set(0, 7.5, 20);
    camera.lookAt(0, 4.2, 0);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    containerRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Build scene graph
    buildingRef.current = createBuilding(scene);
    gridRef.current = createGroundGrid(scene);
    particlesRef.current = createParticles(scene, reducedMotion ? 80 : 250);
    scanPlaneRef.current = createScanPlane(scene);

    // Dynamic spatial light
    const ambientLight = new THREE.AmbientLight(0x0a1c2a, 0.6);
    scene.add(ambientLight);

    const cyanPoint = new THREE.PointLight(0x06b6d4, 1.2, 25);
    cyanPoint.position.set(5, 8, 8);
    scene.add(cyanPoint);

    const tealPoint = new THREE.PointLight(0x14b8a6, 0.8, 20);
    tealPoint.position.set(-5, 4, 6);
    scene.add(tealPoint);
  }, [reducedMotion]);

  // Main animation frame loop
  const animate = useCallback(() => {
    if (!rendererRef.current || !sceneRef.current || !cameraRef.current) return;
    const t = scrollProgress;
    clockRef.current += 0.016;
    const time = clockRef.current;

    const camera = cameraRef.current;
    const building = buildingRef.current;
    const particles = particlesRef.current;
    const scanPlane = scanPlaneRef.current;
    const grid = gridRef.current;

    // Smooth cinematic camera flight into the digital twin building
    const startCam = { x: 0, y: 7.5, z: 20 };
    const endCam = { x: 0, y: 4.8, z: 6.4 };

    // Curved glide path with subtle cinematic banking
    const bankArc = Math.sin(t * Math.PI) * 1.2;
    camera.position.x = startCam.x + (endCam.x - startCam.x) * t + bankArc;
    camera.position.y = startCam.y + (endCam.y - startCam.y) * t;
    camera.position.z = startCam.z + (endCam.z - startCam.z) * t;
    camera.lookAt(0, 4.2 + t * 0.3, 0);

    // Dynamic building rotation with smooth inertia
    if (building) {
      const baseRotation = reducedMotion ? 0 : Math.sin(time * 0.25) * 0.05;
      building.rotation.y = baseRotation + t * 0.35;
    }

    // Particle field acceleration during flight
    if (particles && !reducedMotion) {
      const positions = particles.geometry.attributes.position.array as Float32Array;
      const speedMultiplier = 1 + t * 3.5; // Accelerate particles forward as camera zooms in
      for (let i = 0; i < positions.length; i += 3) {
        positions[i + 1] += 0.005 * speedMultiplier;
        if (positions[i + 1] > 14) positions[i + 1] = 0;
        positions[i] += Math.sin(time + i * 0.1) * 0.001;
      }
      particles.geometry.attributes.position.needsUpdate = true;
      (particles.material as THREE.PointsMaterial).opacity = 0.75 * (1 - t * 0.3);
    }

    // High-energy laser scan line sweep
    if (scanPlane) {
      const scanHeight = ((Math.sin(time * 1.6 + t * 3) + 1) / 2) * 9.5;
      scanPlane.position.y = scanHeight;
      (scanPlane.material as THREE.MeshBasicMaterial).opacity = 0.45 + t * 0.4;
    }

    // Ground grid dimming as we approach
    if (grid) {
      grid.children.forEach((child) => {
        if ((child as THREE.Line).material) {
          ((child as THREE.Line).material as THREE.Material).opacity = 0.35 * (1 - t * 0.6);
        }
      });
    }

    // Dynamic wireframe pulsing
    if (building) {
      building.traverse((child) => {
        if (child instanceof THREE.LineSegments) {
          const mat = child.material as THREE.LineBasicMaterial;
          mat.opacity = 0.5 + Math.sin(time * 1.8) * 0.15 + t * 0.25;
        }
      });
    }

    rendererRef.current.render(sceneRef.current, camera);
    frameRef.current = requestAnimationFrame(animate);
  }, [scrollProgress, reducedMotion]);

  // Mount/Unmount lifecycle
  useEffect(() => {
    init();
    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
      if (rendererRef.current && containerRef.current && rendererRef.current.domElement) {
        if (containerRef.current.contains(rendererRef.current.domElement)) {
          containerRef.current.removeChild(rendererRef.current.domElement);
        }
        rendererRef.current.dispose();
      }
      if (sceneRef.current) {
        sceneRef.current.traverse((obj) => {
          if (obj instanceof THREE.Mesh || obj instanceof THREE.LineSegments || obj instanceof THREE.Line) {
            obj.geometry?.dispose();
            if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
            else obj.material?.dispose();
          }
          if (obj instanceof THREE.Points) {
            obj.geometry?.dispose();
            (obj.material as THREE.Material)?.dispose();
          }
        });
      }
    };
  }, [init]);

  useEffect(() => {
    frameRef.current = requestAnimationFrame(animate);
    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    };
  }, [animate]);

  // Responsive resize handler
  useEffect(() => {
    const handleResize = () => {
      if (!containerRef.current || !rendererRef.current || !cameraRef.current) return;
      const w = containerRef.current.clientWidth;
      const h = containerRef.current.clientHeight;
      cameraRef.current.aspect = w / h;
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(w, h);
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Graceful 2D fallback for devices without WebGL
  if (!hasWebGL) {
    return (
      <div className="absolute inset-0 bg-[#0a0e27] flex items-center justify-center overflow-hidden">
        <div
          className="w-80 h-96 border border-cyan-500/40 rounded-xl relative flex items-center justify-center transition-transform duration-500"
          style={{ transform: `scale(${1 + scrollProgress * 0.4})` }}
        >
          <div className="absolute inset-4 border border-teal-500/30" />
          <div className="text-center font-mono text-cyan-400 text-xs tracking-widest">
            <div>[ DIGITAL TWIN SCHEMATIC ]</div>
            <div className="mt-2 text-slate-500">2D COMPATIBILITY MODE</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 w-full h-full pointer-events-none"
      style={{ zIndex: 0 }}
    />
  );
};
