import { CapturePhotoRecord, DoorwayAnchor, RoomMetadata, ValidationIssue } from '../types/dart';

export interface ValidationSummary {
  isValid: boolean;
  errorCount: number;
  warningCount: number;
  infoCount: number;
  issues: ValidationIssue[];
}

/**
 * Validates the consistency of the DART-Twin spatial manifest and room plan.
 * Detects orphaned entities, broken doorway anchors, duplicate IDs, missing reciprocal observations,
 * and dimensional discrepancies.
 */
export function validateDartDataset(
  rooms: RoomMetadata[],
  doorways: DoorwayAnchor[],
  photos: CapturePhotoRecord[]
): ValidationSummary {
  const issues: ValidationIssue[] = [];

  // 1. Room ID uniqueness & validity
  const roomIds = new Set<string>();
  rooms.forEach((room) => {
    if (!room.id || room.id.trim() === '') {
      issues.push({
        severity: 'error',
        category: 'manifest',
        entityId: 'UNKNOWN_ROOM',
        message: 'A room is missing a valid identifier (e.g., R01).',
        suggestedFix: 'Assign a unique alphanumeric ID such as R01 or R02.',
      });
    } else if (roomIds.has(room.id)) {
      issues.push({
        severity: 'error',
        category: 'manifest',
        entityId: room.id,
        message: `Duplicate Room ID detected: "${room.id}".`,
        suggestedFix: `Rename duplicate room "${room.id}" to ensure unique primary keys.`,
      });
    } else {
      roomIds.add(room.id);
    }

    // Dimension bounds check
    if (room.lengthMeters <= 0 || room.widthMeters <= 0 || room.heightMeters <= 0) {
      issues.push({
        severity: 'error',
        category: 'dimension',
        entityId: room.id,
        message: `Room "${room.id}" (${room.name}) has zero or negative metric dimensions.`,
        suggestedFix: 'Enter actual physical tape measurements for length, width, and height.',
      });
    } else if (room.heightMeters < 1.8 || room.heightMeters > 7.0) {
      issues.push({
        severity: 'warning',
        category: 'dimension',
        entityId: room.id,
        message: `Room "${room.id}" ceiling height (${room.heightMeters}m) is atypical for standard indoor spaces.`,
        suggestedFix: 'Verify laser rangefinder ceiling measurement from finished floor level.',
      });
    }
  });

  // 2. Doorway validation & Reciprocal Continuity
  const doorwayIds = new Set<string>();
  doorways.forEach((door) => {
    if (!door.id || door.id.trim() === '') {
      issues.push({
        severity: 'error',
        category: 'doorway',
        entityId: 'UNKNOWN_DOOR',
        message: 'A doorway is missing a valid identifier (e.g., D01).',
        suggestedFix: 'Assign a structured anchor ID such as D01 or D02.',
      });
    } else if (doorwayIds.has(door.id)) {
      issues.push({
        severity: 'error',
        category: 'doorway',
        entityId: door.id,
        message: `Duplicate Doorway ID detected: "${door.id}".`,
        suggestedFix: `Re-index doorway "${door.id}" to a distinct anchor code.`,
      });
    } else {
      doorwayIds.add(door.id);
    }

    // Check connecting room references
    const [roomA, roomB] = door.connectedRoomIds;
    if (!roomIds.has(roomA)) {
      issues.push({
        severity: 'error',
        category: 'doorway',
        entityId: door.id,
        message: `Doorway "${door.id}" references non-existent Room A: "${roomA}".`,
        suggestedFix: `Ensure room "${roomA}" exists in the Room Inventory or correct doorway reference.`,
      });
    }
    if (!roomIds.has(roomB)) {
      issues.push({
        severity: 'error',
        category: 'doorway',
        entityId: door.id,
        message: `Doorway "${door.id}" references non-existent Room B: "${roomB}".`,
        suggestedFix: `Ensure room "${roomB}" exists in the Room Inventory or correct doorway reference.`,
      });
    }

    if (roomA === roomB && roomIds.has(roomA)) {
      issues.push({
        severity: 'error',
        category: 'doorway',
        entityId: door.id,
        message: `Doorway "${door.id}" connects room "${roomA}" to itself.`,
        suggestedFix: 'A doorway anchor must span two distinct physical spaces.',
      });
    }

    // Check reciprocal observations
    if (!door.observations.roomAObserved) {
      issues.push({
        severity: 'warning',
        category: 'doorway',
        entityId: door.id,
        message: `Doorway "${door.id}" is missing observation records from Room "${roomA}".`,
        suggestedFix: `Execute Pass A/B camera shots targeting door frame "${door.id}" from within ${roomA}.`,
      });
    }
    if (!door.observations.roomBObserved) {
      issues.push({
        severity: 'warning',
        category: 'doorway',
        entityId: door.id,
        message: `Doorway "${door.id}" is missing reciprocal observation records from Room "${roomB}".`,
        suggestedFix: `Execute Pass A/B camera shots targeting door frame "${door.id}" from within ${roomB}.`,
      });
    }
    if (!door.observations.hasContinuousPassCPhoto) {
      issues.push({
        severity: 'warning',
        category: 'doorway',
        entityId: door.id,
        message: `Doorway "${door.id}" lacks Pass C continuous threshold transit photos.`,
        suggestedFix: 'Capture 2-3 overlapping frames stepping through the doorway threshold.',
      });
    }

    // Offset continuity: if two doorways connect the same room pair, their
    // offsetMeters along the shared wall should agree so rooms abut precisely
    // at thresholds without drifting apart at boundaries.
    doorways.forEach((other) => {
      if (other.id === door.id) return;
      const [a1, b1] = door.connectedRoomIds;
      const [a2, b2] = other.connectedRoomIds;
      const samePair =
        (a1 === a2 && b1 === b2) || (a1 === b2 && b1 === a2);
      if (!samePair) return;
      const wallMatch = door.wallLocation === other.wallLocation;
      const offsetDiff = Math.abs((door.offsetMeters || 0) - (other.offsetMeters || 0));
      if (wallMatch && offsetDiff > 0.05) {
        issues.push({
          severity: 'warning',
          category: 'doorway',
          entityId: door.id,
          message: `Doorways "${door.id}" and "${other.id}" share the same wall between rooms "${a1}" and "${b1}" but offsetMeters differ by ${offsetDiff.toFixed(2)}m (${door.offsetMeters}m vs ${other.offsetMeters}m).`,
          suggestedFix: 'Align doorway offsetMeters on both anchors so rooms meet exactly at the threshold.',
        });
      }
    });
  });

  // 3. Photo Manifest validation
  const photoFilenames = new Set<string>();
  photos.forEach((photo) => {
    if (!photo.filename || photo.filename.trim() === '') {
      issues.push({
        severity: 'error',
        category: 'manifest',
        entityId: photo.id || 'PHOTO',
        message: 'Photo record missing image filename.',
        suggestedFix: 'Provide relative image path or filename (e.g., R01_PassA_001.jpg).',
      });
    } else if (photoFilenames.has(photo.filename)) {
      issues.push({
        severity: 'warning',
        category: 'manifest',
        entityId: photo.filename,
        message: `Duplicate photo filename registered: "${photo.filename}".`,
        suggestedFix: 'Verify image files are not redundantly registered across passes.',
      });
    } else {
      photoFilenames.add(photo.filename);
    }

    if (!roomIds.has(photo.roomId)) {
      issues.push({
        severity: 'error',
        category: 'manifest',
        entityId: photo.filename,
        message: `Photo "${photo.filename}" references non-existent Room ID: "${photo.roomId}".`,
        suggestedFix: `Assign photo to an existing room (${Array.from(roomIds).join(', ')}).`,
      });
    }

    if (photo.doorwayAnchorId && !doorwayIds.has(photo.doorwayAnchorId)) {
      issues.push({
        severity: 'warning',
        category: 'doorway',
        entityId: photo.filename,
        message: `Photo "${photo.filename}" references invalid doorway anchor "${photo.doorwayAnchorId}".`,
        suggestedFix: `Link photo to a valid doorway (${Array.from(doorwayIds).join(', ')}).`,
      });
    }
  });

  // 4. Room-level coverage warnings
  rooms.forEach((room) => {
    const roomPhotos = photos.filter((p) => p.roomId === room.id);
    if (roomPhotos.length === 0) {
      issues.push({
        severity: 'error',
        category: 'coverage',
        entityId: room.id,
        message: `Room "${room.id}" has 0 photographs registered in manifest.`,
        suggestedFix: 'Register at least Pass A perimeter photos before proceeding to reconstruction.',
      });
    } else {
      const passA = roomPhotos.filter((p) => p.pass === 'Pass A');
      const passB = roomPhotos.filter((p) => p.pass === 'Pass B');
      const passC = roomPhotos.filter((p) => p.pass === 'Pass C');

      if (passA.length < 4) {
        issues.push({
          severity: 'warning',
          category: 'coverage',
          entityId: room.id,
          message: `Room "${room.id}" Pass A has only ${passA.length} photos (minimum 4-8 recommended).`,
          suggestedFix: 'Capture all 4 wall corners and floor-ceiling boundaries.',
        });
      }
      if (passB.length === 0) {
        issues.push({
          severity: 'info',
          category: 'coverage',
          entityId: room.id,
          message: `Room "${room.id}" has no Pass B diagonal photos registered.`,
          suggestedFix: 'Take diagonal 45-degree angle shots to resolve furniture occlusions.',
        });
      }
      if (passC.length === 0) {
        issues.push({
          severity: 'info',
          category: 'coverage',
          entityId: room.id,
          message: `Room "${room.id}" has no Pass C doorway transit photos registered.`,
          suggestedFix: 'Take continuity frames bridging through the doorway anchor.',
        });
      }
    }
  });

  const errorCount = issues.filter((i) => i.severity === 'error').length;
  const warningCount = issues.filter((i) => i.severity === 'warning').length;
  const infoCount = issues.filter((i) => i.severity === 'info').length;

  return {
    isValid: errorCount === 0,
    errorCount,
    warningCount,
    infoCount,
    issues,
  };
}
