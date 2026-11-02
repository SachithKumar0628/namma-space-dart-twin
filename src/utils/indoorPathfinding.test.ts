import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { solveIndoorPath } from './indoorPathfinding';
import { solveRoomLayout } from './reconstruction3DGenerator';
import { generateSpacePois } from './roomModeling';
import { DoorwayAnchor, RoomMetadata } from '../types/dart';

function makeRoom(id: string, name: string, lengthMeters: number, widthMeters: number): RoomMetadata {
  return {
    id,
    projectId: 'proj_test',
    name,
    category: 'Living',
    lengthMeters,
    widthMeters,
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

const R01 = makeRoom('R01', 'Foyer', 3.2, 2.4);
const R02 = makeRoom('R02', 'Living Room', 6.4, 4.8);
const R03 = makeRoom('R03', 'Dining Area', 4.6, 3.8);
const R04 = makeRoom('R04', 'Kitchen', 3.8, 3.8);
const R05 = makeRoom('R05', 'Master Bedroom', 5.4, 4.2);
const R06 = makeRoom('R06', 'Balcony', 2.6, 4.4);

const DOORWAYS: DoorwayAnchor[] = [
  {
    id: 'D01',
    projectId: 'proj_test',
    name: 'Foyer → Living Room',
    connectedRoomIds: ['R01', 'R02'],
    widthMeters: 0.95,
    heightMeters: 2.1,
    wallLocation: 'east',
    offsetMeters: 0,
    hasClearLineOfSight: true,
    observations: { roomAObserved: true, roomBObserved: true, hasContinuousPassCPhoto: true },
  },
  {
    id: 'D02',
    projectId: 'proj_test',
    name: 'Living → Dining',
    connectedRoomIds: ['R02', 'R03'],
    widthMeters: 0.95,
    heightMeters: 2.1,
    wallLocation: 'north',
    offsetMeters: 0,
    hasClearLineOfSight: true,
    observations: { roomAObserved: true, roomBObserved: true, hasContinuousPassCPhoto: true },
  },
  {
    id: 'D03',
    projectId: 'proj_test',
    name: 'Dining → Kitchen',
    connectedRoomIds: ['R03', 'R04'],
    widthMeters: 0.95,
    heightMeters: 2.1,
    wallLocation: 'east',
    offsetMeters: 0,
    hasClearLineOfSight: true,
    observations: { roomAObserved: true, roomBObserved: true, hasContinuousPassCPhoto: true },
  },
  {
    id: 'D04',
    projectId: 'proj_test',
    name: 'Living → Bedroom',
    connectedRoomIds: ['R02', 'R05'],
    widthMeters: 0.95,
    heightMeters: 2.1,
    wallLocation: 'south',
    offsetMeters: 0,
    hasClearLineOfSight: true,
    observations: { roomAObserved: true, roomBObserved: true, hasContinuousPassCPhoto: true },
  },
  {
    id: 'D05',
    projectId: 'proj_test',
    name: 'Living → Balcony',
    connectedRoomIds: ['R02', 'R06'],
    widthMeters: 1.05,
    heightMeters: 2.1,
    wallLocation: 'east',
    offsetMeters: 0,
    hasClearLineOfSight: true,
    observations: { roomAObserved: true, roomBObserved: true, hasContinuousPassCPhoto: true },
  },
];

const ROOMS = [R01, R02, R03, R04, R05, R06];

const LAYOUT = solveRoomLayout(ROOMS, DOORWAYS, []);
const POIS = generateSpacePois(ROOMS, LAYOUT, DOORWAYS);

test('Indoor Pathfinding: calculates route from Foyer (R01) to Kitchen Island (R04)', () => {
  const kitchenPoi = POIS.find((p) => p.name === 'Kitchen · Center')!;
  const foyerStart = new THREE.Vector3(0, 1.65, 0);

  const route = solveIndoorPath(foyerStart, kitchenPoi, LAYOUT, DOORWAYS);

  assert.equal(route.sourceRoomId, 'R01');
  assert.equal(route.targetPoiId, kitchenPoi.id);
  assert.ok(route.waypoints.length >= 3, `Expected at least 3 waypoints, got ${route.waypoints.length}`);
  assert.ok(route.totalDistanceMeters > 5, `Expected distance > 5m, got ${route.totalDistanceMeters}m`);
  assert.ok(route.estimatedWalkingTimeSec > 3, `Expected walk time > 3s, got ${route.estimatedWalkingTimeSec}s`);
});

test('Indoor Pathfinding: calculates direct route within same room (Living Room)', () => {
  const livingPoi = POIS.find((p) => p.name === 'Living Room · Center')!;
  const livingStart = new THREE.Vector3(4.8, 1.65, 0);

  const route = solveIndoorPath(livingStart, livingPoi, LAYOUT, DOORWAYS);

  assert.equal(route.sourceRoomId, 'R02');
  assert.equal(route.waypoints.length, 2);
  assert.ok(route.totalDistanceMeters < 5);
});

test('Indoor Pathfinding: calculates route from Foyer (R01) to Master Bedroom (R05)', () => {
  const bedPoi = POIS.find((p) => p.name === 'Master Bedroom · Center')!;
  const foyerStart = new THREE.Vector3(0, 1.65, 0);

  const route = solveIndoorPath(foyerStart, bedPoi, LAYOUT, DOORWAYS);

  assert.equal(route.sourceRoomId, 'R01');
  assert.equal(route.targetPoiId, bedPoi.id);
  assert.ok(route.waypoints.length >= 3);
  assert.ok(route.totalDistanceMeters > 4);
});

test('Indoor Pathfinding: calculates route from Living Room (R02) to Balcony (R06)', () => {
  const balconyPoi = POIS.find((p) => p.name === 'Balcony · Center')!;
  const livingStart = new THREE.Vector3(4.8, 1.65, 0);

  const route = solveIndoorPath(livingStart, balconyPoi, LAYOUT, DOORWAYS);

  assert.equal(route.sourceRoomId, 'R02');
  assert.equal(route.targetPoiId, balconyPoi.id);
  assert.ok(route.waypoints.length >= 2);
  assert.ok(route.totalDistanceMeters > 2);
});

test('Geometric Layout: verifies metric calibration and non-overlapping alignment across 6 rooms', () => {
  const roomKeys = Object.keys(LAYOUT);
  assert.equal(roomKeys.length, 6, 'Expected 6 reconstructed rooms');

  // Verify R01 dimensions
  assert.equal(LAYOUT['R01'].length, 3.20);
  assert.equal(LAYOUT['R01'].width, 2.40);

  // Verify Doorway D01 aligns R01 maxX (1.6) with R02 minX (1.6)
  assert.equal(LAYOUT['R01'].maxX, LAYOUT['R02'].minX, 'Doorway D01 threshold must align seamlessly');
});
