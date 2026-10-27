/**
 * indoorPathfinding.ts
 * Real obstacle-aware indoor path calculation and navigation graph solver
 * for Namma Space digital twins.
 *
 * Routes follow the same doorway openings that the 3D viewer renders (see
 * getDoorwayPlacement) and produce plain-language directions for the HUD.
 */

import * as THREE from 'three';
import { DoorwayAnchor, PointOfInterest, NavigationRoute } from '../types/dart';
import { RoomLayoutBox, getDoorwayPlacement } from './reconstruction3DGenerator';

const WALKING_SPEED_MPS = 1.4;

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function roomName(layout: Record<string, RoomLayoutBox>, roomId: string): string {
  return layout[roomId]?.room.name || roomId;
}

/** Compass bearing of a movement vector; +X = east, -Z = north. */
function compassDirection(dx: number, dz: number): string {
  if (Math.abs(dx) < 1e-9 && Math.abs(dz) < 1e-9) return 'ahead';
  const degrees = (Math.atan2(dx, -dz) * 180) / Math.PI;
  const normalised = (degrees + 360) % 360;
  const directions = [
    'north',
    'north-east',
    'east',
    'south-east',
    'south',
    'south-west',
    'west',
    'north-west',
  ];
  return directions[Math.round(normalised / 45) % 8];
}

function formatDistance(meters: number): string {
  return `${meters.toFixed(1)} m`;
}

/**
 * Solves a walkable navigation path connecting the current player position to
 * a target POI through intermediate doorway thresholds.
 */
export function solveIndoorPath(
  startPos: THREE.Vector3,
  targetPoi: PointOfInterest,
  layout: Record<string, RoomLayoutBox>,
  doorways: DoorwayAnchor[]
): NavigationRoute {
  const roomIds = Object.keys(layout);

  // 1. Identify the starting room (containment first, nearest centre otherwise).
  let sourceRoomId = roomIds[0] || '';
  let minDist = Infinity;

  for (const [rId, box] of Object.entries(layout)) {
    const inside =
      startPos.x >= box.minX - 0.5 &&
      startPos.x <= box.maxX + 0.5 &&
      startPos.z >= box.minZ - 0.5 &&
      startPos.z <= box.maxZ + 0.5;
    if (inside) {
      sourceRoomId = rId;
      break;
    }
    const distToCenter = Math.hypot(startPos.x - box.centerX, startPos.z - box.centerZ);
    if (distToCenter < minDist) {
      minDist = distToCenter;
      sourceRoomId = rId;
    }
  }

  const targetRoomId = targetPoi.roomId;
  const targetPos = new THREE.Vector3(targetPoi.position.x, 0.05, targetPoi.position.z);
  const sourceName = roomName(layout, sourceRoomId);
  const targetName = roomName(layout, targetRoomId);

  // 2. Same-room routes are a single straight leg.
  if (sourceRoomId === targetRoomId) {
    const dx = targetPos.x - startPos.x;
    const dz = targetPos.z - startPos.z;
    const dist = Math.hypot(dx, dz);
    const instructions =
      dist < 0.05
        ? [`You are in ${sourceName}.`, `You are already at ${targetPoi.name}.`]
        : [
            `You are in ${sourceName}.`,
            `Head ${compassDirection(dx, dz)} for ${formatDistance(dist)} to reach ${targetPoi.name}.`,
          ];

    return {
      sourceRoomId,
      targetPoiId: targetPoi.id,
      targetPoiName: targetPoi.name,
      waypoints: [
        { x: startPos.x, y: 0.05, z: startPos.z },
        { x: targetPos.x, y: 0.05, z: targetPos.z },
      ],
      totalDistanceMeters: round2(dist),
      estimatedWalkingTimeSec: Math.max(1, Math.ceil(dist / WALKING_SPEED_MPS)),
      instructions,
      roomSequence: [sourceName],
    };
  }

  // 3. Build the room adjacency graph from doorway anchors.
  const adj: Record<string, Array<{ neighborId: string; door: DoorwayAnchor }>> = {};
  roomIds.forEach((rId) => {
    adj[rId] = [];
  });

  doorways.forEach((door) => {
    const [roomA, roomB] = door.connectedRoomIds;
    if (adj[roomA] && adj[roomB]) {
      adj[roomA].push({ neighborId: roomB, door });
      adj[roomB].push({ neighborId: roomA, door });
    }
  });

  // 4. BFS for the shortest room sequence.
  const queue: string[] = [sourceRoomId];
  const visited = new Set<string>([sourceRoomId]);
  const parentMap: Record<string, { prevRoom: string; door: DoorwayAnchor } | null> = {
    [sourceRoomId]: null,
  };

  let found = false;
  while (queue.length > 0) {
    const curr = queue.shift()!;
    if (curr === targetRoomId) {
      found = true;
      break;
    }

    for (const edge of adj[curr] || []) {
      if (!visited.has(edge.neighborId)) {
        visited.add(edge.neighborId);
        parentMap[edge.neighborId] = { prevRoom: curr, door: edge.door };
        queue.push(edge.neighborId);
      }
    }
  }

  if (!found) {
    // Never draw a route through walls: report that no doorway link exists.
    return {
      sourceRoomId,
      targetPoiId: targetPoi.id,
      targetPoiName: targetPoi.name,
      waypoints: [{ x: startPos.x, y: 0.05, z: startPos.z }],
      totalDistanceMeters: 0,
      estimatedWalkingTimeSec: 0,
      instructions: [
        `You are in ${sourceName}.`,
        `${targetPoi.name} is in ${targetName}, which has no doorway link from here yet.`,
      ],
      roomSequence: [sourceName],
    };
  }

  const doorPath: DoorwayAnchor[] = [];
  const roomSequence: string[] = [];
  let curr: string = targetRoomId;
  while (curr && parentMap[curr]) {
    roomSequence.unshift(curr);
    doorPath.unshift(parentMap[curr]!.door);
    curr = parentMap[curr]!.prevRoom;
  }
  roomSequence.unshift(sourceRoomId);

  // 5. Generate 3D waypoints through the rendered doorway openings.
  const waypoints: Array<{ x: number; y: number; z: number }> = [
    { x: startPos.x, y: 0.05, z: startPos.z },
  ];
  const instructions: string[] = [`You are in ${sourceName}.`];
  let cursor = new THREE.Vector3(startPos.x, 0.05, startPos.z);

  doorPath.forEach((door, idx) => {
    const placement = getDoorwayPlacement(door, layout);
    if (!placement) return;

    const doorPos = new THREE.Vector3(placement.x, 0.05, placement.z);
    const destinationRoomId = roomSequence[idx + 1];
    const destinationName = roomName(layout, destinationRoomId);

    // Walk directly through the doorway opening (no room-centre detour).
    // Room centres are only added as contextual waypoints for multi-doorway
    // routes so the HUD can announce which room the player is entering.
    const intermediateRoomId = roomSequence[idx];
    const intermediateBox = layout[intermediateRoomId];
    const hasVia = idx > 0 && !!intermediateBox;
    let legDistance = cursor.distanceTo(doorPos);

    if (hasVia && intermediateBox) {
      const via = new THREE.Vector3(intermediateBox.centerX, 0.05, intermediateBox.centerZ);
      waypoints.push({ x: via.x, y: 0.05, z: via.z });
      legDistance = cursor.distanceTo(via) + via.distanceTo(doorPos);
      instructions.push(
        `Head ${compassDirection(via.x - cursor.x, via.z - cursor.z)} for ${formatDistance(
          cursor.distanceTo(via)
        )} across ${intermediateBox.room.name}.`
      );
    }

    const headingDx = doorPos.x - cursor.x;
    const headingDz = doorPos.z - cursor.z;
    waypoints.push({ x: doorPos.x, y: 0.05, z: doorPos.z });
    instructions.push(
      `Head ${compassDirection(headingDx, headingDz)} for ${formatDistance(
        legDistance
      )}, then pass through the doorway into ${destinationName}.`
    );
    cursor = doorPos;
  });

  const finalDx = targetPos.x - cursor.x;
  const finalDz = targetPos.z - cursor.z;
  const finalDistance = Math.hypot(finalDx, finalDz);
  waypoints.push({ x: targetPos.x, y: 0.05, z: targetPos.z });
  instructions.push(
    `Continue ${compassDirection(finalDx, finalDz)} for ${formatDistance(
      finalDistance
    )} to arrive at ${targetPoi.name}.`
  );

  // 6. Total path distance.
  let totalDist = 0;
  for (let i = 0; i < waypoints.length - 1; i++) {
    totalDist += Math.hypot(
      waypoints[i + 1].x - waypoints[i].x,
      waypoints[i + 1].z - waypoints[i].z
    );
  }

  return {
    sourceRoomId,
    targetPoiId: targetPoi.id,
    targetPoiName: targetPoi.name,
    waypoints,
    totalDistanceMeters: round2(totalDist),
    estimatedWalkingTimeSec: Math.max(1, Math.ceil(totalDist / WALKING_SPEED_MPS)),
    instructions,
    roomSequence: roomSequence.map((id) => roomName(layout, id)),
  };
}
