import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateDartScore } from './dartScoring';
import { validateDartDataset } from './dartValidator';
import { INITIAL_ROOMS, INITIAL_DOORWAYS, INITIAL_PHOTOS } from './sampleData';
import { RoomMetadata, DoorwayAnchor, CapturePhotoRecord } from '../types/dart';

test('DART Score: sample dataset Room R01 achieves Accepted status (>=85)', () => {
  const room = INITIAL_ROOMS[0];
  const score = calculateDartScore(room, INITIAL_PHOTOS, INITIAL_DOORWAYS);

  assert.equal(score.roomId, 'R01');
  assert.ok(score.totalScore >= 85, `Expected score >= 85, got ${score.totalScore}`);
  assert.equal(score.status, 'Accepted for Reconstruction');
  assert.equal(score.categories.coverage.maxPoints, 40);
  assert.equal(score.categories.doorway.maxPoints, 25);
  assert.equal(score.categories.dimension.maxPoints, 20);
  assert.equal(score.categories.imageQuality.maxPoints, 15);
  assert.equal(
    score.totalScore,
    score.categories.coverage.earnedPoints +
      score.categories.doorway.earnedPoints +
      score.categories.dimension.earnedPoints +
      score.categories.imageQuality.earnedPoints
  );
});

test('DART Score: missing doorway anchors incurs full doorway penalty', () => {
  const room = INITIAL_ROOMS[0];
  const score = calculateDartScore(room, INITIAL_PHOTOS, []); // no doorways

  assert.equal(score.categories.doorway.earnedPoints, 0);
  assert.ok(score.totalScore < 85);
  assert.ok(score.categories.doorway.deductions.some((d) => d.includes('doorway anchors')));
});

test('DART Score: large metric scale disparity (>6%) receives 0 points for scale precision', () => {
  const badScaleRoom: RoomMetadata = {
    ...INITIAL_ROOMS[0],
    reconstructionDimensionEstimate: {
      lengthMeters: 7.50, // 20% error from 6.20m
      widthMeters: 5.50,
      heightMeters: 2.85,
      source: 'COLMAP Sparse Pointcloud',
    },
  };
  const score = calculateDartScore(badScaleRoom, INITIAL_PHOTOS, INITIAL_DOORWAYS);
  // Ground truth tape measurement earns 5, recon exists earns 5, scale precision receives 0 -> total 10 pts out of 20
  assert.equal(score.categories.dimension.earnedPoints, 10);
  assert.ok(score.categories.dimension.deductions.some((d) => d.includes('scale deviation')));
});

test('DART Score: empty photo set triggers severe deductions and Recapture Recommended', () => {
  const room = INITIAL_ROOMS[0];
  const score = calculateDartScore(room, [], INITIAL_DOORWAYS);

  assert.equal(score.categories.coverage.earnedPoints, 0);
  assert.equal(score.categories.imageQuality.earnedPoints, 0);
  assert.equal(score.status, 'Recapture Recommended');
});

test('DART Validator: flags duplicate Room IDs and non-existent doorway links', () => {
  const duplicateRooms: RoomMetadata[] = [
    INITIAL_ROOMS[0],
    { ...INITIAL_ROOMS[0], name: 'Duplicate Room' },
  ];
  const brokenDoorways: DoorwayAnchor[] = [
    {
      ...INITIAL_DOORWAYS[0],
      connectedRoomIds: ['R01', 'R99_NON_EXISTENT'],
    },
  ];

  const result = validateDartDataset(duplicateRooms, brokenDoorways, INITIAL_PHOTOS);

  assert.equal(result.isValid, false);
  assert.ok(result.errorCount >= 2);
  assert.ok(result.issues.some((i) => i.message.includes('Duplicate Room ID')));
  assert.ok(result.issues.some((i) => i.message.includes('non-existent Room B')));
});

test('DART Validator: flags missing reciprocal doorway observations', () => {
  const unreciprocalDoor: DoorwayAnchor[] = [
    {
      ...INITIAL_DOORWAYS[0],
      observations: {
        roomAObserved: true,
        roomBObserved: false, // missing reciprocal from Room B!
        hasContinuousPassCPhoto: false,
      },
    },
  ];

  const result = validateDartDataset(INITIAL_ROOMS, unreciprocalDoor, INITIAL_PHOTOS);
  assert.ok(result.warningCount >= 2);
  assert.ok(result.issues.some((i) => i.message.includes('missing reciprocal observation')));
  assert.ok(result.issues.some((i) => i.message.includes('lacks Pass C continuous threshold transit')));
});
