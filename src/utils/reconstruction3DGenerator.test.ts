import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  solveRoomLayout,
  computeCameraPoses,
  generateSparsePointCloud,
} from './reconstruction3DGenerator';
import { INITIAL_ROOMS, INITIAL_DOORWAYS, INITIAL_PHOTOS } from './sampleData';

test('Reconstruction3D: solveRoomLayout returns 6 rooms', () => {
  const layout = solveRoomLayout(INITIAL_ROOMS, INITIAL_DOORWAYS, INITIAL_PHOTOS);
  assert.equal(Object.keys(layout).length, 6);
});

test('Reconstruction3D: computeCameraPoses returns one pose per photo', () => {
  const layout = solveRoomLayout(INITIAL_ROOMS, INITIAL_DOORWAYS, INITIAL_PHOTOS);
  const poses = computeCameraPoses(INITIAL_PHOTOS, layout, INITIAL_DOORWAYS);
  assert.equal(poses.length, INITIAL_PHOTOS.length);
  assert.ok(poses.every((p) => p.position instanceof THREE.Vector3));
});

test('Reconstruction3D: generateSparsePointCloud produces vertices with color', () => {
  const layout = solveRoomLayout(INITIAL_ROOMS, INITIAL_DOORWAYS, INITIAL_PHOTOS);
  const poses = computeCameraPoses(INITIAL_PHOTOS, layout, INITIAL_DOORWAYS);
  const cloud = generateSparsePointCloud(layout, poses, INITIAL_PHOTOS.length);
  assert.ok(cloud.attributes.position.count > 0);
  assert.ok(cloud.attributes.color);
});

test('Reconstruction3D: extracted video frames follow a spatial walkthrough path', () => {
  const layout = solveRoomLayout(INITIAL_ROOMS, INITIAL_DOORWAYS, INITIAL_PHOTOS);
  const videoPhotos = [
    { ...INITIAL_PHOTOS[0], id: 'video-1', modality: 'Extracted Video Frame' as const },
    { ...INITIAL_PHOTOS[0], id: 'video-2', modality: 'Extracted Video Frame' as const },
    { ...INITIAL_PHOTOS[0], id: 'video-3', modality: 'Extracted Video Frame' as const },
  ];
  const poses = computeCameraPoses(videoPhotos, layout, INITIAL_DOORWAYS);

  assert.equal(poses.length, 3);
  assert.notDeepEqual(poses[0].position.toArray(), poses[1].position.toArray());
  assert.notDeepEqual(poses[1].position.toArray(), poses[2].position.toArray());
});
