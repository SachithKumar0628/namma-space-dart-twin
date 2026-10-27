import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { solveIndoorPath } from './indoorPathfinding';
import { solveRoomLayout } from './reconstruction3DGenerator';
import { INITIAL_ROOMS, INITIAL_DOORWAYS, INITIAL_PHOTOS, INITIAL_POIS } from './sampleData';

test('Indoor Pathfinding: calculates route from Foyer (R01) to Kitchen Island (R04)', () => {
  const layout = solveRoomLayout(INITIAL_ROOMS, INITIAL_DOORWAYS, INITIAL_PHOTOS);
  const foyerStart = new THREE.Vector3(0, 1.65, 0);
  const kitchenPoi = INITIAL_POIS.find((p) => p.id === 'poi_08')!; // Kitchen Island

  const route = solveIndoorPath(foyerStart, kitchenPoi, layout, INITIAL_DOORWAYS);

  assert.equal(route.sourceRoomId, 'R01');
  assert.equal(route.targetPoiId, 'poi_08');
  assert.ok(route.waypoints.length >= 3, `Expected at least 3 waypoints, got ${route.waypoints.length}`);
  assert.ok(route.totalDistanceMeters > 5, `Expected distance > 5m, got ${route.totalDistanceMeters}m`);
  assert.ok(route.estimatedWalkingTimeSec > 3, `Expected walk time > 3s, got ${route.estimatedWalkingTimeSec}s`);
});

test('Indoor Pathfinding: calculates direct route within same room (Living Room)', () => {
  const layout = solveRoomLayout(INITIAL_ROOMS, INITIAL_DOORWAYS, INITIAL_PHOTOS);
  const livingStart = new THREE.Vector3(4.8, 1.65, 0);
  const tvPoi = INITIAL_POIS.find((p) => p.id === 'poi_03')!; // TV Wall in R02

  const route = solveIndoorPath(livingStart, tvPoi, layout, INITIAL_DOORWAYS);

  assert.equal(route.sourceRoomId, 'R02');
  assert.equal(route.waypoints.length, 2);
  assert.ok(route.totalDistanceMeters < 5);
});

test('Indoor Pathfinding: calculates route from Foyer (R01) to Master Bedroom Bed (R05)', () => {
  const layout = solveRoomLayout(INITIAL_ROOMS, INITIAL_DOORWAYS, INITIAL_PHOTOS);
  const foyerStart = new THREE.Vector3(0, 1.65, 0);
  const bedPoi = INITIAL_POIS.find((p) => p.id === 'poi_10')!; // Master Bed in R05

  const route = solveIndoorPath(foyerStart, bedPoi, layout, INITIAL_DOORWAYS);

  assert.equal(route.sourceRoomId, 'R01');
  assert.equal(route.targetPoiId, 'poi_10');
  assert.ok(route.waypoints.length >= 3);
  assert.ok(route.totalDistanceMeters > 4);
});

test('Indoor Pathfinding: calculates route from Living Room (R02) to Balcony Planter (R06)', () => {
  const layout = solveRoomLayout(INITIAL_ROOMS, INITIAL_DOORWAYS, INITIAL_PHOTOS);
  const livingStart = new THREE.Vector3(4.8, 1.65, 0);
  const balconyPoi = INITIAL_POIS.find((p) => p.id === 'poi_12')!; // Balcony in R06

  const route = solveIndoorPath(livingStart, balconyPoi, layout, INITIAL_DOORWAYS);

  assert.equal(route.sourceRoomId, 'R02');
  assert.equal(route.targetPoiId, 'poi_12');
  assert.ok(route.waypoints.length >= 2);
  assert.ok(route.totalDistanceMeters > 2);
});

test('Geometric Layout: verifies metric calibration and non-overlapping alignment across 6 rooms', () => {
  const layout = solveRoomLayout(INITIAL_ROOMS, INITIAL_DOORWAYS, INITIAL_PHOTOS);
  const roomKeys = Object.keys(layout);
  assert.equal(roomKeys.length, 6, 'Expected 6 reconstructed rooms');

  // Verify R01 dimensions
  assert.equal(layout['R01'].length, 3.20);
  assert.equal(layout['R01'].width, 2.40);

  // Verify Doorway D01 aligns R01 maxX (1.6) with R02 minX (1.6)
  assert.equal(layout['R01'].maxX, layout['R02'].minX, 'Doorway D01 threshold must align seamlessly');
});
