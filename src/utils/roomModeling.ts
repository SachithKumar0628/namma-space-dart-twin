/**
 * roomModeling.ts
 * Turns the user's uploaded photo set into a calibrated room footprint and a
 * set of walkable destinations (POIs) for indoor navigation.
 *
 * This is a deterministic geometric model, not a neural reconstruction: the
 * photo count / orientation drive the room proportions, while the viewer
 * mounts the actual photos on the generated walls. Every generated destination
 * is clamped inside its room so the pathfinder always has a walkable target.
 */

import { CapturePhotoRecord, DoorwayAnchor, PointOfInterest, RoomMetadata } from '../types/dart';
import { RoomLayoutBox, getDoorwayPlacement } from './reconstruction3DGenerator';

export interface PhotoGeometrySample {
  width: number;
  height: number;
  dominantColor?: string;
}

export interface RoomFootprint {
  lengthMeters: number;
  widthMeters: number;
  heightMeters: number;
  areaSqm: number;
  photoCount: number;
  shape: 'landscape' | 'portrait' | 'square';
}

const DEFAULT_CEILING_HEIGHT_M = 2.85;
const POI_EDGE_MARGIN_M = 0.45;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Stable, deterministic hash so a given room keeps the same footprint. */
function hashString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * Estimates a room footprint from its photos.
 *
 * - Landscape-dominant captures indicate a room whose long axis faces the
 *   camera, so the footprint is elongated.
 * - More photos per room imply a larger swept area (capped so a 30-photo
 *   upload does not create an unrealistically huge space).
 * - A small deterministic variation per room avoids identical boxes.
 */
export function estimateRoomFootprint(
  photos: PhotoGeometrySample[],
  roomSeed = 'room',
  ceilingHeight: number = DEFAULT_CEILING_HEIGHT_M
): RoomFootprint {
  const count = Math.max(1, photos.length);
  const samples = photos.length > 0 ? photos : [{ width: 4, height: 3 }];

  const landscapeCount = samples.filter((p) => p.width >= p.height).length;
  const landscapeShare = landscapeCount / samples.length;
  const medianAspect = (() => {
    const aspects = samples
      .map((p) => p.width / Math.max(1, p.height))
      .sort((a, b) => a - b);
    return aspects[Math.floor(aspects.length / 2)];
  })();

  const shape: RoomFootprint['shape'] =
    Math.abs(medianAspect - 1) < 0.08 ? 'square' : medianAspect > 1 ? 'landscape' : 'portrait';

  // Long-axis / short-axis ratio: 1.05 (narrow) .. 1.60 (wide).
  const elongation = clamp(
    1.15 + (landscapeShare - 0.5) * 0.45 + (medianAspect - 1.33) * 0.22,
    1.05,
    1.6
  );

  // Swept floor area: 1 photo ≈ 16 m², 6 photos ≈ 27 m², 12+ photos cap at 34 m².
  const baseArea = clamp(14 + count * 2.2, 16, 34);
  const variation = 0.94 + (hashString(roomSeed) % 13) / 100; // 0.94 .. 1.06
  const areaSqm = baseArea * variation;

  const lengthMeters = Math.sqrt(areaSqm * elongation);
  const widthMeters = areaSqm / lengthMeters;

  return {
    lengthMeters: round2(lengthMeters),
    widthMeters: round2(widthMeters),
    heightMeters: ceilingHeight,
    areaSqm: round2(lengthMeters * widthMeters),
    photoCount: count,
    shape,
  };
}

/** Opposite wall helper — doorway anchors are always authored from room A. */
function oppositeWall(wall: DoorwayAnchor['wallLocation']): DoorwayAnchor['wallLocation'] {
  switch (wall) {
    case 'north':
      return 'south';
    case 'south':
      return 'north';
    case 'east':
      return 'west';
    case 'west':
      return 'east';
  }
}

function wallHasDoor(
  roomId: string,
  wall: DoorwayAnchor['wallLocation'],
  doorways: DoorwayAnchor[]
): boolean {
  return doorways.some((door) => {
    if (door.connectedRoomIds[0] === roomId && door.wallLocation === wall) return true;
    if (door.connectedRoomIds[1] === roomId && oppositeWall(door.wallLocation) === wall) return true;
    return false;
  });
}

function insideRoom(
  box: RoomLayoutBox,
  x: number,
  z: number,
  margin = POI_EDGE_MARGIN_M
): { x: number; z: number } {
  return {
    x: clamp(x, box.minX + margin, box.maxX - margin),
    z: clamp(z, box.minZ + margin, box.maxZ - margin),
  };
}

/**
 * Builds searchable, walkable destinations for a photo-generated space:
 * the main entrance, a window reference and the open centre of every room,
 * plus both sides of every doorway so a route can be requested from anywhere.
 */
export function generateSpacePois(
  rooms: RoomMetadata[],
  layout: Record<string, RoomLayoutBox>,
  doorways: DoorwayAnchor[],
  ceilingHeight: number = DEFAULT_CEILING_HEIGHT_M
): PointOfInterest[] {
  const pois: PointOfInterest[] = [];
  const roomName = (roomId: string) =>
    rooms.find((r) => r.id === roomId)?.name || 'Room';

  // Eye-level markers sit below the ceiling datum; waist-height markers stay
  // floor-relative so they are always inside the room volume.
  const eyeLevel = clamp(ceilingHeight - 1.25, 1.2, ceilingHeight - 0.3);
  const windowSill = clamp(ceilingHeight - 1.5, 1.0, ceilingHeight - 0.5);

  rooms.forEach((room, index) => {
    const box = layout[room.id];
    if (!box) return;

    if (index === 0) {
      const pos = insideRoom(box, box.minX + 0.6, box.centerZ);
      const roomHasDoorway = doorways.some((door) => door.connectedRoomIds.includes(room.id));
      pois.push({
        id: `poi_${room.id}_entrance`,
        name: 'Main Entrance',
        category: 'Entrance',
        roomId: room.id,
        position: { x: pos.x, y: eyeLevel, z: pos.z },
        description: roomHasDoorway
          ? `Start of the walkthrough in ${room.name}. Follow a doorway to reach the other rooms.`
          : `Start of the walkthrough in ${room.name}.`,
      });
    }

    pois.push({
      id: `poi_${room.id}_center`,
      name: `${room.name} · Center`,
      category: 'Amenity',
      roomId: room.id,
      position: { x: box.centerX, y: 1.1, z: box.centerZ },
      description: `Open floor area in ${room.name} (${round2(box.length * box.width)} m²). Good place to stand and look around.`,
    });

    // Pick the first wall without a doorway for the daylight reference.
    const windowWall = (['north', 'south', 'east', 'west'] as const).find(
      (wall) => !wallHasDoor(room.id, wall, doorways)
    );
    if (windowWall) {
      let x = box.centerX;
      let z = box.centerZ;
      if (windowWall === 'north') z = box.minZ + 0.55;
      else if (windowWall === 'south') z = box.maxZ - 0.55;
      else if (windowWall === 'east') x = box.maxX - 0.55;
      else x = box.minX + 0.55;
      const pos = insideRoom(box, x, z);
      pois.push({
        id: `poi_${room.id}_window`,
        name: `${room.name} · Window Wall`,
        category: 'Fixture',
        roomId: room.id,
        position: { x: pos.x, y: windowSill, z: pos.z },
        description: `Daylight wall in ${room.name}. Useful as a directional reference while walking.`,
      });
    }
  });

  doorways.forEach((door) => {
    const placement = getDoorwayPlacement(door, layout);
    if (!placement) return;

    const [roomAId, roomBId] = door.connectedRoomIds;
    const boxA = layout[roomAId];
    const boxB = layout[roomBId];
    if (!boxA || !boxB) return;

    const doorWidth = door.widthMeters || 1.1;
    const doorHeight = door.heightMeters || 2.1;
    const inset = 0.55;

    const makeDoorPoi = (
      roomId: string,
      otherRoomId: string,
      box: RoomLayoutBox,
      x: number,
      z: number
    ) => {
      const pos = insideRoom(box, x, z, 0.3);
      pois.push({
        id: `poi_${door.id}_${roomId}`,
        name: `Doorway to ${roomName(otherRoomId)}`,
        category: 'Entrance',
        roomId,
        position: { x: pos.x, y: eyeLevel, z: pos.z },
        description: `${doorWidth.toFixed(2)} m wide, ${doorHeight.toFixed(2)} m high opening between ${roomName(
          roomId
        )} and ${roomName(otherRoomId)}.`,
      });
    };

    if (placement.wall === 'east') {
      makeDoorPoi(roomAId, roomBId, boxA, placement.x - inset, placement.z);
      makeDoorPoi(roomBId, roomAId, boxB, placement.x + inset, placement.z);
    } else if (placement.wall === 'west') {
      makeDoorPoi(roomAId, roomBId, boxA, placement.x + inset, placement.z);
      makeDoorPoi(roomBId, roomAId, boxB, placement.x - inset, placement.z);
    } else if (placement.wall === 'north') {
      makeDoorPoi(roomAId, roomBId, boxA, placement.x, placement.z + inset);
      makeDoorPoi(roomBId, roomAId, boxB, placement.x, placement.z - inset);
    } else {
      makeDoorPoi(roomAId, roomBId, boxA, placement.x, placement.z - inset);
      makeDoorPoi(roomBId, roomAId, boxB, placement.x, placement.z + inset);
    }
  });

  return pois;
}
