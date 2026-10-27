/**
 * server/db.js
 * SQLite database connection, schema migrations, and default data seeding
 * for the NammaTwin LoopAnchor Studio backend.
 *
 * Uses better-sqlite3: a single-file, zero-config SQL database that persists
 * to disk. No external database server or credentials required.
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(process.cwd(), 'data'));
fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = path.join(DATA_DIR, 'nammatwin.sqlite');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function runMigrations() {
  const exec = (stmt) => db.exec(stmt);

  // 1. USERS
  exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_login TEXT
    );
  `);

  // 2. PROJECTS
  exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      space_type TEXT NOT NULL DEFAULT 'Custom',
      units TEXT NOT NULL DEFAULT 'metres',
      floor_area REAL,
      ceiling_height REAL,
      capture_method TEXT NOT NULL DEFAULT 'Still Photos Loop',
      status TEXT NOT NULL DEFAULT 'Ready for Upload',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      photo_count INTEGER NOT NULL DEFAULT 0,
      room_count INTEGER NOT NULL DEFAULT 0,
      video_count INTEGER NOT NULL DEFAULT 0,
      has_floor_plan INTEGER NOT NULL DEFAULT 0,
      floor_plan_name TEXT,
      starting_anchor TEXT,
      reference_measurement TEXT,
      reconstruction_engine TEXT DEFAULT 'Calibrated Geometric Twin',
      reconstruction_progress INTEGER NOT NULL DEFAULT 0,
      last_error_message TEXT,
      reconstruction_model_stats TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  // 3. ROOMS
  exec(`
    CREATE TABLE IF NOT EXISTS rooms (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      project_id TEXT,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      length_meters REAL NOT NULL,
      width_meters REAL NOT NULL,
      height_meters REAL NOT NULL,
      origin_description TEXT NOT NULL DEFAULT '',
      coordinate_convention TEXT NOT NULL DEFAULT 'Right-Handed Y-Up (Three.js standard)',
      connected_doorway_ids TEXT NOT NULL DEFAULT '[]',
      features TEXT NOT NULL DEFAULT '{}',
      reconstruction_dimension_estimate TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
    );
  `);

  // 4. DOORWAYS
  exec(`
    CREATE TABLE IF NOT EXISTS doorways (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      project_id TEXT,
      name TEXT NOT NULL,
      connected_room_ids TEXT NOT NULL DEFAULT '[]',
      width_meters REAL NOT NULL,
      height_meters REAL NOT NULL,
      wall_location TEXT NOT NULL DEFAULT 'east',
      offset_meters REAL NOT NULL DEFAULT 0,
      has_clear_line_of_sight INTEGER NOT NULL DEFAULT 1,
      observations TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
    );
  `);

  // 5. PHOTOS (capture manifest)
  exec(`
    CREATE TABLE IF NOT EXISTS photos (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      project_id TEXT,
      filename TEXT NOT NULL,
      room_id TEXT NOT NULL,
      pass TEXT NOT NULL DEFAULT 'Pass A',
      modality TEXT DEFAULT 'Still Photograph',
      camera_pose_tag TEXT DEFAULT '',
      focal_length_mm REAL NOT NULL DEFAULT 24,
      sharpness_score INTEGER NOT NULL DEFAULT 0,
      exposure_review TEXT NOT NULL DEFAULT 'Good',
      overlap_review TEXT NOT NULL DEFAULT 'Sufficient (>70%)',
      occlusion_flag INTEGER NOT NULL DEFAULT 0,
      doorway_anchor_id TEXT,
      sensor_metadata TEXT,
      reviewer_notes TEXT DEFAULT '',
      timestamp TEXT NOT NULL DEFAULT (datetime('now')),
      is_automated_metric INTEGER NOT NULL DEFAULT 1,
      image_url TEXT,
      dominant_color TEXT,
      spatial_pose TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL,
      FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
      FOREIGN KEY (doorway_anchor_id) REFERENCES doorways(id) ON DELETE SET NULL
    );
  `);

  // 6. SOP CHECKLIST
  exec(`
    CREATE TABLE IF NOT EXISTS sop_checklist (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      pass TEXT NOT NULL DEFAULT 'General',
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      rule_reference TEXT NOT NULL DEFAULT '',
      completed INTEGER NOT NULL DEFAULT 0,
      critical INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  // Migrations for columns added after initial schema. SQLite ALTER TABLE is
  // idempotent-guarded by checking pragma table_info first.
  try {
    const cols = db.prepare(`PRAGMA table_info(projects)`).all().map((c) => c.name);
    if (!cols.includes('room_count')) {
      db.exec(`ALTER TABLE projects ADD COLUMN room_count INTEGER NOT NULL DEFAULT 0`);
    }
  } catch (e) {
    console.error('Migration error (room_count):', e.message);
  }
}
function seedDefaultData() {
  const now = new Date().toISOString().replace('T', ' ').substring(0, 16);
  const insertUser = db.prepare(
    `INSERT OR IGNORE INTO users (id, username, email, password_hash, role) VALUES (?, ?, ?, ?, ?)`
  );
  const insertProject = db.prepare(
    `INSERT OR IGNORE INTO projects (id, user_id, name, description, space_type, units, floor_area, ceiling_height, capture_method, status, created_at, updated_at, photo_count, room_count, video_count, has_floor_plan, floor_plan_name, starting_anchor, reference_measurement, reconstruction_engine, reconstruction_progress, reconstruction_model_stats) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insertRoom = db.prepare(
    `INSERT OR IGNORE INTO rooms (id, user_id, project_id, name, category, length_meters, width_meters, height_meters, origin_description, coordinate_convention, connected_doorway_ids, features, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insertDoorway = db.prepare(
    `INSERT OR IGNORE INTO doorways (id, user_id, project_id, name, connected_room_ids, width_meters, height_meters, wall_location, offset_meters, has_clear_line_of_sight, observations, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insertPhoto = db.prepare(
    `INSERT OR IGNORE INTO photos (id, user_id, project_id, filename, room_id, pass, modality, camera_pose_tag, focal_length_mm, sharpness_score, exposure_review, overlap_review, occlusion_flag, doorway_anchor_id, reviewer_notes, timestamp, is_automated_metric, image_url, dominant_color, spatial_pose) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insertChecklist = db.prepare(
    `INSERT OR IGNORE INTO sop_checklist (id, user_id, pass, title, description, rule_reference, completed, critical, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const demoUserId = 'user_demo_0001';
  const demoPasswordHash = crypto.scryptSync('demo1234', 'nammatwin-salt', 64).toString('hex');

  insertUser.run(demoUserId, 'demo', 'demo@nammatwin.local', demoPasswordHash, 'user');


  const projectId = 'proj_b804';
  insertProject.run(
    projectId,
    demoUserId,
    'Apartment B-804 Digital Twin (6-Room Suite)',
    'Full 6-room residential digital twin captured via LoopAnchor perimeter protocol with calibrated doorway anchors across Foyer, Living Room, Dining, Modular Kitchen, Master Bedroom, and Scenic Balcony.',
    'Apartment',
    'metres',
    104.2,
    2.85,
    'Hybrid Multi-Modal',
    'Completed',
    now,
    now,
    11,
    6,
    1,
    1,
    'apartment_b804_cad_blueprint.pdf',
    'Foyer Entrance Doorway D01 (Unit B-804)',
    'Living Hall length: 6.40m ± 1.5mm (Laser datum)',
    'Calibrated Geometric Twin',
    100,
    JSON.stringify({
      triangleCount: 28450,
      vertexCount: 16820,
      pointCloudCount: 14200,
      reprojectionErrorPx: 0.68,
      scaleDisparityPercent: 0.14,
      lastGeneratedAt: now,
    })
  );

  const rooms = [
    { id: 'R01', name: 'Foyer & Entrance (Unit B-804)', category: 'Entrance', lengthMeters: 3.20, widthMeters: 2.40, heightMeters: 2.85, originDescription: 'West entryway threshold at Apartment B-804 front doorway plate', connectedDoorwayIds: ['D01'], features: { doorsCount: 2, windowsCount: 0, reflectiveSurfaces: false, featurelessWhiteWalls: false } },
    { id: 'R02', name: 'Living Room Salon', category: 'Living', lengthMeters: 6.40, widthMeters: 4.80, heightMeters: 2.85, originDescription: 'Central living hall with ceiling fan, TV accent wall, and circulation spine', connectedDoorwayIds: ['D01', 'D02', 'D04', 'D05'], features: { doorsCount: 4, windowsCount: 1, reflectiveSurfaces: true, featurelessWhiteWalls: false } },
    { id: 'R03', name: 'Dining Area', category: 'Dining', lengthMeters: 4.60, widthMeters: 3.80, heightMeters: 2.85, originDescription: 'North dining wing with circular halo chandelier and 6-seater dining table', connectedDoorwayIds: ['D02', 'D03'], features: { doorsCount: 2, windowsCount: 1, reflectiveSurfaces: true, featurelessWhiteWalls: false } },
    { id: 'R04', name: 'Modular Kitchen', category: 'Kitchen', lengthMeters: 5.20, widthMeters: 3.90, heightMeters: 2.85, originDescription: 'L-shaped kitchen with black galaxy granite island and breakfast bar', connectedDoorwayIds: ['D03', 'D04', 'D06'], features: { doorsCount: 3, windowsCount: 2, reflectiveSurfaces: true, featurelessWhiteWalls: false } },
    { id: 'R05', name: 'Master Bedroom', category: 'Bedroom', lengthMeters: 4.20, widthMeters: 3.60, heightMeters: 2.85, originDescription: 'King bed suite with ensuite access and wardrobe alcove', connectedDoorwayIds: ['D05', 'D06'], features: { doorsCount: 2, windowsCount: 1, reflectiveSurfaces: false, featurelessWhiteWalls: false } },
    { id: 'R06', name: 'Scenic Balcony', category: 'Balcony', lengthMeters: 3.80, widthMeters: 2.20, heightMeters: 2.85, originDescription: 'High-floor outdoor terrace with glass balustrade and city vista', connectedDoorwayIds: ['D06'], features: { doorsCount: 1, windowsCount: 0, reflectiveSurfaces: false, featurelessWhiteWalls: false } }
  ];

  const doorways = [
    { id: 'D01', name: 'Foyer to Living Room', connectedRoomIds: ['R01', 'R02'], widthMeters: 0.90, heightMeters: 2.10, wallLocation: 'east', offsetMeters: 1.0, hasClearLineOfSight: true, observations: { roomAObserved: true, roomBObserved: true, hasContinuousPassCPhoto: true, measuredWidthDiffMm: 2.0 } },
    { id: 'D02', name: 'Living Room to Dining', connectedRoomIds: ['R02', 'R03'], widthMeters: 1.10, heightMeters: 2.10, wallLocation: 'north', offsetMeters: 2.0, hasClearLineOfSight: true, observations: { roomAObserved: true, roomBObserved: true, hasContinuousPassCPhoto: true, measuredWidthDiffMm: 1.5 } },
    { id: 'D03', name: 'Dining to Kitchen', connectedRoomIds: ['R03', 'R04'], widthMeters: 0.95, heightMeters: 2.10, wallLocation: 'east', offsetMeters: 1.5, hasClearLineOfSight: true, observations: { roomAObserved: true, roomBObserved: true, hasContinuousPassCPhoto: true, measuredWidthDiffMm: 3.0 } },
    { id: 'D04', name: 'Living Room to Kitchen', connectedRoomIds: ['R02', 'R04'], widthMeters: 1.00, heightMeters: 2.10, wallLocation: 'south', offsetMeters: 3.0, hasClearLineOfSight: true, observations: { roomAObserved: true, roomBObserved: true, hasContinuousPassCPhoto: true, measuredWidthDiffMm: 1.0 } },
    { id: 'D05', name: 'Living Room to Master Bedroom', connectedRoomIds: ['R02', 'R05'], widthMeters: 0.90, heightMeters: 2.10, wallLocation: 'west', offsetMeters: 4.0, hasClearLineOfSight: true, observations: { roomAObserved: true, roomBObserved: true, hasContinuousPassCPhoto: true, measuredWidthDiffMm: 2.5 } },
    { id: 'D06', name: 'Master Bedroom to Balcony', connectedRoomIds: ['R05', 'R06'], widthMeters: 1.20, heightMeters: 2.10, wallLocation: 'north', offsetMeters: 1.0, hasClearLineOfSight: true, observations: { roomAObserved: true, roomBObserved: true, hasContinuousPassCPhoto: true, measuredWidthDiffMm: 0.5 } }
  ];

  const photos = [
    { id: 'P01', filename: 'R01_PassA_001.jpg', roomId: 'R01', pass: 'Pass A', modality: 'Still Photograph', cameraPoseTag: 'R01_Perimeter_NE_Corner', focalLengthMm: 24, sharpnessScore: 92, exposureReview: 'Good', overlapReview: 'Sufficient (>70%)', occlusionFlag: false, reviewerNotes: 'Clean corner features, good exposure.' },
    { id: 'P02', filename: 'R01_PassA_002.jpg', roomId: 'R01', pass: 'Pass A', modality: 'Still Photograph', cameraPoseTag: 'R01_Perimeter_SE_Corner', focalLengthMm: 24, sharpnessScore: 88, exposureReview: 'Good', overlapReview: 'Sufficient (>70%)', occlusionFlag: false, reviewerNotes: 'Strong vertical edges.' },
    { id: 'P03', filename: 'R01_PassA_003.jpg', roomId: 'R01', pass: 'Pass A', modality: 'Still Photograph', cameraPoseTag: 'R01_Perimeter_SW_Corner', focalLengthMm: 24, sharpnessScore: 90, exposureReview: 'Good', overlapReview: 'Sufficient (>70%)', occlusionFlag: false, reviewerNotes: 'Door frame D01 visible.' },
    { id: 'P04', filename: 'R01_PassA_004.jpg', roomId: 'R01', pass: 'Pass A', modality: 'Still Photograph', cameraPoseTag: 'R01_Perimeter_NW_Corner', focalLengthMm: 24, sharpnessScore: 85, exposureReview: 'Good', overlapReview: 'Sufficient (>70%)', occlusionFlag: false, reviewerNotes: 'Complete wall sweep.' },
    { id: 'P05', filename: 'R02_PassA_001.jpg', roomId: 'R02', pass: 'Pass A', modality: 'Still Photograph', cameraPoseTag: 'R02_Perimeter_Center_Wall', focalLengthMm: 24, sharpnessScore: 91, exposureReview: 'Good', overlapReview: 'Sufficient (>70%)', occlusionFlag: false, reviewerNotes: 'TV accent wall texture.' },
    { id: 'P06', filename: 'R02_PassC_D01.jpg', roomId: 'R02', pass: 'Pass C', modality: 'Still Photograph', cameraPoseTag: 'R02_Door_D01_Facing_R01', focalLengthMm: 24, sharpnessScore: 87, exposureReview: 'Good', overlapReview: 'Sufficient (>70%)', occlusionFlag: false, doorwayAnchorId: 'D01', reviewerNotes: 'Reciprocal doorway transit frame.' },
    { id: 'P07', filename: 'R01_PassC_D01.jpg', roomId: 'R01', pass: 'Pass C', modality: 'Still Photograph', cameraPoseTag: 'R01_Door_D01_Facing_R02', focalLengthMm: 24, sharpnessScore: 89, exposureReview: 'Good', overlapReview: 'Sufficient (>70%)', occlusionFlag: false, doorwayAnchorId: 'D01', reviewerNotes: 'Reciprocal doorway transit frame.' },
    { id: 'P08', filename: 'R03_PassA_001.jpg', roomId: 'R03', pass: 'Pass A', modality: 'Still Photograph', cameraPoseTag: 'R03_Perimeter_North_Wall', focalLengthMm: 24, sharpnessScore: 90, exposureReview: 'Good', overlapReview: 'Sufficient (>70%)', occlusionFlag: false, reviewerNotes: 'Dining wall and chandelier base.' },
    { id: 'P09', filename: 'R04_PassA_001.jpg', roomId: 'R04', pass: 'Pass A', modality: 'Still Photograph', cameraPoseTag: 'R04_Perimeter_Island', focalLengthMm: 24, sharpnessScore: 86, exposureReview: 'Good', overlapReview: 'Sufficient (>70%)', occlusionFlag: false, reviewerNotes: 'Granite island countertop.' },
    { id: 'P10', filename: 'R05_PassA_001.jpg', roomId: 'R05', pass: 'Pass A', modality: 'Still Photograph', cameraPoseTag: 'R05_Perimeter_Headboard', focalLengthMm: 24, sharpnessScore: 88, exposureReview: 'Good', overlapReview: 'Sufficient (>70%)', occlusionFlag: false, reviewerNotes: 'King bed headboard wall.' },
    { id: 'P11', filename: 'R06_PassA_001.jpg', roomId: 'R06', pass: 'Pass A', modality: 'Still Photograph', cameraPoseTag: 'R06_Perimeter_Railing', focalLengthMm: 24, sharpnessScore: 84, exposureReview: 'Good', overlapReview: 'Sufficient (>70%)', occlusionFlag: false, reviewerNotes: 'Balcony railing and vista.' }
  ];

  const checklist = [
    { id: 'SOP_A_1', pass: 'Pass A', title: 'Register entrance origin and eye-level camera height (~1.55m)', description: 'Record standing eye-level camera height and entrance origin.', ruleReference: 'Stage A - Anchor', completed: true, critical: true },
    { id: 'SOP_A_2', pass: 'Pass A', title: 'Capture ground truth physical measurement (laser/tape)', description: 'Record at least one physical laser/tape measurement for scale calibration.', ruleReference: 'Stage A - Anchor', completed: true, critical: true },
    { id: 'SOP_B_1', pass: 'Pass B', title: 'Perimeter structural sweep with lateral translation', description: 'Sidestep along the perimeter; do not pivot in place.', ruleReference: 'Stage B - Loop', completed: true, critical: true },
    { id: 'SOP_C_1', pass: 'Pass C', title: 'Reciprocal step-through frames across each doorway', description: 'Capture frames from both adjoining rooms looking through the shared aperture.', ruleReference: 'Stage C - Bridge', completed: true, critical: true },
    { id: 'SOP_D_1', pass: 'Pass D', title: 'Geometric loop closure back at entrance', description: 'Return to the entrance anchor and verify closure.', ruleReference: 'Stage D - Close & Validate', completed: false, critical: true },
    { id: 'SOP_D_2', pass: 'Pass D', title: 'Pre-reconstruction evidence audit', description: 'Run DART 100-point quality gate before reconstruction.', ruleReference: 'Stage D - Close & Validate', completed: false, critical: true }
  ];

  const tx = db.transaction(() => {
    rooms.forEach((r) =>
      insertRoom.run(
        r.id, demoUserId, projectId, r.name, r.category, r.lengthMeters, r.widthMeters, r.heightMeters,
        r.originDescription, 'Right-Handed Y-Up (Three.js standard)', JSON.stringify(r.connectedDoorwayIds),
        JSON.stringify(r.features), now, now
      )
    );
    doorways.forEach((d) =>
      insertDoorway.run(
        d.id, demoUserId, projectId, d.name, JSON.stringify(d.connectedRoomIds), d.widthMeters, d.heightMeters,
        d.wallLocation, d.offsetMeters, d.hasClearLineOfSight ? 1 : 0,
        JSON.stringify(d.observations), now, now
      )
    );
    photos.forEach((p) =>
      insertPhoto.run(
        p.id, demoUserId, projectId, p.filename, p.roomId, p.pass, p.modality, p.cameraPoseTag,
        p.focalLengthMm, p.sharpnessScore, p.exposureReview, p.overlapReview, p.occlusionFlag ? 1 : 0,
        p.doorwayAnchorId || null, p.reviewerNotes, new Date().toISOString(), 1, null, null, null
      )
    );
    checklist.forEach((c) =>
      insertChecklist.run(c.id, demoUserId, c.pass, c.title, c.description, c.ruleReference, c.completed ? 1 : 0, c.critical ? 1 : 0, now, now)
    );
  });
  tx();
}

module.exports = { db, runMigrations, seedDefaultData, DATA_DIR, DB_PATH };
