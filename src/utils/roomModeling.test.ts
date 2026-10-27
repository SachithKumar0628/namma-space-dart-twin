import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { estimateRoomFootprint, generateSpacePois } from './roomModeling';
import { getDoorwayPlacement, solveRoomLayout } from './reconstruction3DGenerator';
import { solveIndoorPath } from './indoorPathfinding';
import { DoorwayAnchor, RoomMetadata } from '../types/dart';

function makeRoom(id: string, name: string): RoomMetadata {
  return {
    id,
    projectId: 'proj_test',
    name,
    category: 'Living',
    lengthMeters: 5.2,
    widthMeters: 4.1,
    heightMeters: 2.85,
    originDescription: 'Test room',
    coordinateConvention: 'Right-Handed Y-Up (Three.js standard)',
    connectedDoorwayIds: [],
    features: {
      doorsCount: 1,
      windowsCount: 1,
      reflectiveSurfaces: false,
      featurelessWhiteWalls: false,
    },
  };
}

const ROOM_A = makeRoom('R_test_1', 'Room 1');
const ROOM_B = makeRoom('R_test_2', 'Room 2');
const TEST_DOOR: DoorwayAnchor = {
  id: 'D_test_1',
  projectId: 'proj_test',
  name: 'Passage 1 → 2',
  connectedRoomIds: [ROOM_A.id, ROOM_B.id],
  widthMeters: 0.95,
  heightMeters: 2.1,
  wallLocation: 'east',
  offsetMeters: 0,
  hasClearLineOfSight: true,
  observations: {
    roomAObserved: true,
    roomBObserved: true,
    hasContinuousPassCPhoto: true,
  },
};

test('Room modeling: photo orientation changes the estimated footprint', () => {
  const landscape = estimateRoomFootprint(
    Array.from({ length: 6 }, () => ({ width: 2000, height: 1500 })),
    'seed-landscape'
  );
  const portrait = estimateRoomFootprint(
    Array.from({ length: 6 }, () => ({ width: 1500, height: 2000 })),
    'seed-landscape'
  );

  assert.equal(landscape.shape, 'landscape');
  assert.equal(portrait.shape, 'portrait');
  assert.ok(landscape.areaSqm >= 20 && landscape.areaSqm <= 32);
  assert.ok(
    landscape.lengthMeters / landscape.widthMeters >
      portrait.lengthMeters / portrait.widthMeters,
    'Landscape captures should produce a more elongated room than portrait captures'
  );

  const repeat = estimateRoomFootprint(
    Array.from({ length: 6 }, () => ({ width: 2000, height: 1500 })),
    'seed-landscape'
  );
  assert.deepEqual(repeat, landscape, 'Footprint must be deterministic for the same room seed');
});

test('Room modeling: generates walkable destinations inside every room', () => {
  const layout = solveRoomLayout([ROOM_A, ROOM_B], [TEST_DOOR], []);
  const pois = generateSpacePois([ROOM_A, ROOM_B], layout, [TEST_DOOR]);

  assert.ok(pois.some((p) => p.name === 'Main Entrance'), 'Missing main entrance');
  assert.ok(pois.some((p) => p.name === 'Room 1 · Center'), 'Missing room 1 centre');
  assert.ok(pois.some((p) => p.name === 'Room 2 · Center'), 'Missing room 2 centre');
  assert.ok(pois.some((p) => p.name === 'Room 1 · Window Wall'), 'Missing room 1 window');
  assert.ok(pois.some((p) => p.name === 'Doorway to Room 2'), 'Missing forward doorway');
  assert.ok(pois.some((p) => p.name === 'Doorway to Room 1'), 'Missing return doorway');

  for (const poi of pois) {
    const box = layout[poi.roomId];
    assert.ok(box, `POI ${poi.name} references unknown room ${poi.roomId}`);
    assert.ok(
      poi.position.x >= box.minX && poi.position.x <= box.maxX,
      `POI ${poi.name} x=${poi.position.x} outside [${box.minX}, ${box.maxX}]`
    );
    assert.ok(
      poi.position.z >= box.minZ && poi.position.z <= box.maxZ,
      `POI ${poi.name} z=${poi.position.z} outside [${box.minZ}, ${box.maxZ}]`
    );
  }
});

test('Indoor Pathfinding: user space routes through the rendered doorway with directions', () => {
  const layout = solveRoomLayout([ROOM_A, ROOM_B], [TEST_DOOR], []);
  const pois = generateSpacePois([ROOM_A, ROOM_B], layout, [TEST_DOOR]);
  const target = pois.find((p) => p.name === 'Room 2 · Center')!;
  const start = new THREE.Vector3(0, 1.65, 0);

  const route = solveIndoorPath(start, target, layout, [TEST_DOOR]);
  const placement = getDoorwayPlacement(TEST_DOOR, layout)!;

  assert.equal(route.sourceRoomId, ROOM_A.id);
  assert.equal(route.targetPoiId, target.id);
  assert.equal(route.waypoints.length, 3, 'Expected start → doorway → target');
  assert.equal(route.waypoints[1].x, placement.x);
  assert.equal(route.waypoints[1].z, placement.z);
  assert.deepEqual(route.roomSequence, ['Room 1', 'Room 2']);
  assert.ok(route.instructions.some((step) => step.includes('doorway into Room 2')));
  assert.ok(route.instructions.some((step) => step.startsWith('Head east')), 'Doorway lies east of the start');
  assert.ok(route.instructions.some((step) => step.includes('arrive at Room 2 · Center')));
  assert.ok(route.totalDistanceMeters > 0);
});

test('Indoor Pathfinding: doorway offsets shift the route opening along the wall', () => {
  const offsetDoor: DoorwayAnchor = { ...TEST_DOOR, offsetMeters: 1.0 };
  const layout = solveRoomLayout([ROOM_A, ROOM_B], [offsetDoor], []);
  const placement = getDoorwayPlacement(offsetDoor, layout)!;

  // East wall of Room 1 starts at minZ; offset 1.0 m is measured from there.
  assert.equal(placement.z, layout[ROOM_A.id].minZ + 1.0);
  assert.equal(placement.x, layout[ROOM_A.id].maxX);
});
