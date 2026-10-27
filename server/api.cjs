/**
 * server/api.cjs
 * REST API for NammaTwin LoopAnchor Studio.
 *
 * All endpoints are JSON. Mutating endpoints require a valid session (except
 * when ENABLE_AUTH is not 'true', in which case an implicit demo session is
 * attached by the server entry point). Input is validated and sanitized;
 * errors never expose stack traces or internal details.
 */

const { db } = require('./db.cjs');
const {
  authenticate,
  requireAuth,
  cookieMiddleware,
  setSessionCookie,
  clearSessionCookie,
  ensureDemoUser,
  createSession,
  hashPassword,
  verifyPassword,
  destroySession,
} = require('./auth.cjs');

const nowIso = () => new Date().toISOString().replace('T', ' ').substring(0, 16);

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function ok(res, data) {
  json(res, 200, { ok: true, data });
}

function created(res, data) {
  json(res, 201, { ok: true, data });
}

function badRequest(res, message, code = 'BAD_REQUEST', fields) {
  json(res, 400, { ok: false, error: message, code, ...(fields ? { fields } : {}) });
}

function notFound(res, message = 'Not found') {
  json(res, 404, { ok: false, error: message, code: 'NOT_FOUND' });
}

function serverError(res, err) {
  console.error('API error:', err);
  json(res, 500, { ok: false, error: 'Internal server error', code: 'INTERNAL_ERROR' });
}

function requiredFields(obj, fields) {
  const missing = [];
  for (const f of fields) {
    const v = obj[f];
    if (v === undefined || v === null || v === '') missing.push(f);
  }
  return missing;
}

function isPositiveNumber(v) {
  return typeof v === 'number' && Number.isFinite(v) && v > 0;
}

function nonNegativeNumber(v) {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0;
}

function ownedProject(userId, projectId) {
  return !projectId || Boolean(
    db.prepare(`SELECT id FROM projects WHERE id = ? AND user_id = ?`).get(projectId, userId)
  );
}

function ownedRoomIds(userId, roomIds) {
  if (!Array.isArray(roomIds)) return false;
  if (roomIds.length === 0) return true;
  const placeholders = roomIds.map(() => '?').join(', ');
  const rows = db
    .prepare(`SELECT id FROM rooms WHERE user_id = ? AND id IN (${placeholders})`)
    .all(userId, ...roomIds);
  return rows.length === new Set(roomIds).size;
}

function ownedDoorway(userId, doorwayId) {
  return !doorwayId || Boolean(
    db.prepare(`SELECT id FROM doorways WHERE id = ? AND user_id = ?`).get(doorwayId, userId)
  );
}

function parseJsonBody(req) {
  // Express body parser (server.cjs) already consumes the stream and exposes
  // the parsed object as req.body. Prefer it when present so we don't deadlock
  // waiting for 'data'/'end' events that have already fired.
  if (req && req.body !== undefined && req.body !== null && !(req.body instanceof Buffer)) {
    return Promise.resolve(typeof req.body === 'object' ? req.body : {});
  }
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      if (!body.trim()) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

const SPACE_TYPES = ['Bedroom', 'Living Room', 'Apartment', 'Office', 'Corridor', 'Custom'];
const UNITS = ['metres', 'feet'];
const CAPTURE_METHODS = ['Still Photos Loop', 'Walkthrough Video Frames', 'Hybrid Multi-Modal'];
const PROJECT_STATUSES = ['Draft', 'Ready for Upload', 'Processing', 'Completed', 'Failed'];
const ROOM_CATEGORIES = ['Laboratory', 'Office', 'Corridor', 'Workshop', 'Living', 'Control Room', 'Bedroom', 'Kitchen', 'Balcony', 'Dining', 'Entrance', 'Bathroom'];
const COORD_CONVENTIONS = ['Right-Handed Y-Up (Three.js standard)', 'Right-Handed Z-Up (Blender standard)'];
const WALL_LOCATIONS = ['north', 'south', 'east', 'west'];
const PASSES = ['Pass A', 'Pass B', 'Pass C'];
const MODALITIES = ['Still Photograph', 'Extracted Video Frame', 'Sensor Augmented'];
const EXPOSURE_REVIEWS = ['Good', 'Overexposed', 'Underexposed'];
const OVERLAP_REVIEWS = ['Sufficient (>70%)', 'Marginal (50-70%)', 'Insufficient (<50%)'];

function validateProject(body, partial = false) {
  const errors = {};
  if (partial) {
    if (body.name !== undefined && (typeof body.name !== 'string' || !body.name.trim())) errors.name = 'Project name is required';
  } else {
    if (typeof body.name !== 'string' || !body.name.trim()) errors.name = 'Project name is required';
  }
  if (body.description !== undefined && typeof body.description !== 'string') errors.description = 'Description must be a string';
  if (body.spaceType !== undefined && !SPACE_TYPES.includes(body.spaceType)) errors.spaceType = 'Invalid space type';
  if (body.units !== undefined && !UNITS.includes(body.units)) errors.units = 'Invalid unit';
  if (body.floorArea !== undefined && !nonNegativeNumber(body.floorArea)) errors.floorArea = 'Floor area must be a non-negative number';
  if (body.ceilingHeight !== undefined && !nonNegativeNumber(body.ceilingHeight)) errors.ceilingHeight = 'Ceiling height must be a non-negative number';
  if (body.captureMethod !== undefined && !CAPTURE_METHODS.includes(body.captureMethod)) errors.captureMethod = 'Invalid capture method';
  if (body.status !== undefined && !PROJECT_STATUSES.includes(body.status)) errors.status = 'Invalid status';
  if (body.roomCount !== undefined && !Number.isInteger(body.roomCount)) errors.roomCount = 'Room count must be an integer';
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true };
}

function validateRoom(body, partial = false) {
  const errors = {};
  if (partial) {
    if (body.id !== undefined && (typeof body.id !== 'string' || !body.id.trim())) errors.id = 'Room ID is required';
    if (body.name !== undefined && (typeof body.name !== 'string' || !body.name.trim())) errors.name = 'Room name is required';
    if (body.lengthMeters !== undefined && !isPositiveNumber(body.lengthMeters)) errors.lengthMeters = 'Length must be a positive number';
    if (body.widthMeters !== undefined && !isPositiveNumber(body.widthMeters)) errors.widthMeters = 'Width must be a positive number';
    if (body.heightMeters !== undefined && !isPositiveNumber(body.heightMeters)) errors.heightMeters = 'Height must be a positive number';
    if (body.originDescription !== undefined && typeof body.originDescription !== 'string') errors.originDescription = 'Origin description is required';
  } else {
    if (typeof body.id !== 'string' || !body.id.trim()) errors.id = 'Room ID is required';
    if (typeof body.name !== 'string' || !body.name.trim()) errors.name = 'Room name is required';
    if (!isPositiveNumber(body.lengthMeters)) errors.lengthMeters = 'Length must be a positive number';
    if (!isPositiveNumber(body.widthMeters)) errors.widthMeters = 'Width must be a positive number';
    if (!isPositiveNumber(body.heightMeters)) errors.heightMeters = 'Height must be a positive number';
    if (typeof body.originDescription !== 'string') errors.originDescription = 'Origin description is required';
  }
  if (body.category !== undefined && !ROOM_CATEGORIES.includes(body.category)) errors.category = 'Invalid room category';
  if (body.coordinateConvention !== undefined && !COORD_CONVENTIONS.includes(body.coordinateConvention)) errors.coordinateConvention = 'Invalid coordinate convention';
  if (body.connectedDoorwayIds !== undefined && !Array.isArray(body.connectedDoorwayIds)) errors.connectedDoorwayIds = 'connectedDoorwayIds must be an array';
  if (body.features !== undefined && typeof body.features !== 'object') errors.features = 'features must be an object';
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true };
}

function validateDoorway(body, partial = false) {
  const errors = {};
  if (partial) {
    if (body.id !== undefined && (typeof body.id !== 'string' || !body.id.trim())) errors.id = 'Doorway ID is required';
    if (body.name !== undefined && (typeof body.name !== 'string' || !body.name.trim())) errors.name = 'Doorway name is required';
    if (body.connectedRoomIds !== undefined && (!Array.isArray(body.connectedRoomIds) || body.connectedRoomIds.length !== 2)) errors.connectedRoomIds = 'connectedRoomIds must be [Room A, Room B]';
    if (body.widthMeters !== undefined && !isPositiveNumber(body.widthMeters)) errors.widthMeters = 'Width must be a positive number';
    if (body.heightMeters !== undefined && !isPositiveNumber(body.heightMeters)) errors.heightMeters = 'Height must be a positive number';
    if (body.offsetMeters !== undefined && typeof body.offsetMeters !== 'number') errors.offsetMeters = 'Offset must be a number';
    if (body.hasClearLineOfSight !== undefined && typeof body.hasClearLineOfSight !== 'boolean') errors.hasClearLineOfSight = 'hasClearLineOfSight must be a boolean';
  } else {
    if (typeof body.id !== 'string' || !body.id.trim()) errors.id = 'Doorway ID is required';
    if (typeof body.name !== 'string' || !body.name.trim()) errors.name = 'Doorway name is required';
    if (!Array.isArray(body.connectedRoomIds) || body.connectedRoomIds.length !== 2) errors.connectedRoomIds = 'connectedRoomIds must be [Room A, Room B]';
    if (!isPositiveNumber(body.widthMeters)) errors.widthMeters = 'Width must be a positive number';
    if (!isPositiveNumber(body.heightMeters)) errors.heightMeters = 'Height must be a positive number';
    if (typeof body.offsetMeters !== 'number') errors.offsetMeters = 'Offset must be a number';
    if (typeof body.hasClearLineOfSight !== 'boolean') errors.hasClearLineOfSight = 'hasClearLineOfSight must be a boolean';
  }
  if (body.wallLocation !== undefined && !WALL_LOCATIONS.includes(body.wallLocation)) errors.wallLocation = 'Invalid wall location';
  if (body.observations !== undefined && typeof body.observations !== 'object') errors.observations = 'observations must be an object';
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true };
}

function validatePhoto(body, partial = false) {
  const errors = {};
  if (partial) {
    if (body.id !== undefined && (typeof body.id !== 'string' || !body.id.trim())) errors.id = 'Photo ID is required';
    if (body.filename !== undefined && (typeof body.filename !== 'string' || !body.filename.trim())) errors.filename = 'Filename is required';
    if (body.roomId !== undefined && (typeof body.roomId !== 'string' || !body.roomId.trim())) errors.roomId = 'Room ID is required';
    if (body.focalLengthMm !== undefined && typeof body.focalLengthMm !== 'number') errors.focalLengthMm = 'Focal length must be a number';
    if (body.occlusionFlag !== undefined && typeof body.occlusionFlag !== 'boolean') errors.occlusionFlag = 'occlusionFlag must be a boolean';
  } else {
    if (typeof body.id !== 'string' || !body.id.trim()) errors.id = 'Photo ID is required';
    if (typeof body.filename !== 'string' || !body.filename.trim()) errors.filename = 'Filename is required';
    if (typeof body.roomId !== 'string' || !body.roomId.trim()) errors.roomId = 'Room ID is required';
    if (typeof body.focalLengthMm !== 'number') errors.focalLengthMm = 'Focal length must be a number';
    if (typeof body.occlusionFlag !== 'boolean') errors.occlusionFlag = 'occlusionFlag must be a boolean';
  }
  if (body.pass !== undefined && !PASSES.includes(body.pass)) errors.pass = 'Invalid pass';
  if (body.modality !== undefined && !MODALITIES.includes(body.modality)) errors.modality = 'Invalid modality';
  if (body.sharpnessScore !== undefined && (typeof body.sharpnessScore !== 'number' || body.sharpnessScore < 0 || body.sharpnessScore > 100)) errors.sharpnessScore = 'Sharpness score must be 0-100';
  if (body.exposureReview !== undefined && !EXPOSURE_REVIEWS.includes(body.exposureReview)) errors.exposureReview = 'Invalid exposure review';
  if (body.overlapReview !== undefined && !OVERLAP_REVIEWS.includes(body.overlapReview)) errors.overlapReview = 'Invalid overlap review';
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true };
}

function projectRowToProject(row) {
  return {
    id: row.id, name: row.name, description: row.description || '',
    spaceType: row.space_type, roomCount: row.room_count, units: row.units,
    floorArea: row.floor_area, ceilingHeight: row.ceiling_height,
    captureMethod: row.capture_method, status: row.status,
    createdAt: row.created_at, updatedAt: row.updated_at,
    photoCount: row.photo_count, videoCount: row.video_count,
    hasFloorPlan: !!row.has_floor_plan, floorPlanName: row.floor_plan_name,
    startingAnchor: row.starting_anchor, referenceMeasurement: row.reference_measurement,
    reconstructionEngine: row.reconstruction_engine,
    reconstructionProgress: row.reconstruction_progress,
    lastErrorMessage: row.last_error_message,
    reconstructionModelStats: row.reconstruction_model_stats ? JSON.parse(row.reconstruction_model_stats) : undefined,
  };
}

function roomRowToRoom(row) {
  return {
    id: row.id, projectId: row.project_id || undefined, name: row.name, category: row.category,
    lengthMeters: row.length_meters, widthMeters: row.width_meters, heightMeters: row.height_meters,
    originDescription: row.origin_description, coordinateConvention: row.coordinate_convention,
    connectedDoorwayIds: row.connected_doorway_ids ? JSON.parse(row.connected_doorway_ids) : [],
    features: row.features ? JSON.parse(row.features) : {},
    reconstructionDimensionEstimate: row.reconstruction_dimension_estimate ? JSON.parse(row.reconstruction_dimension_estimate) : undefined,
  };
}

function doorwayRowToDoorway(row) {
  return {
    id: row.id, projectId: row.project_id || undefined, name: row.name,
    connectedRoomIds: row.connected_room_ids ? JSON.parse(row.connected_room_ids) : [],
    widthMeters: row.width_meters, heightMeters: row.height_meters,
    wallLocation: row.wall_location, offsetMeters: row.offset_meters,
    hasClearLineOfSight: !!row.has_clear_line_of_sight,
    observations: row.observations ? JSON.parse(row.observations) : {},
  };
}

function photoRowToPhoto(row) {
  return {
    id: row.id, projectId: row.project_id || undefined, filename: row.filename, roomId: row.room_id, pass: row.pass,
    modality: row.modality, cameraPoseTag: row.camera_pose_tag, focalLengthMm: row.focal_length_mm,
    sharpnessScore: row.sharpness_score, exposureReview: row.exposure_review,
    overlapReview: row.overlap_review, occlusionFlag: !!row.occlusion_flag,
    doorwayAnchorId: row.doorway_anchor_id,
    sensorMetadata: row.sensor_metadata ? JSON.parse(row.sensor_metadata) : undefined,
    reviewerNotes: row.reviewer_notes, timestamp: row.timestamp,
    isAutomatedMetric: !!row.is_automated_metric,
    imageUrl: row.image_url, dominantColor: row.dominant_color,
    spatialPose: row.spatial_pose ? JSON.parse(row.spatial_pose) : undefined,
  };
}

function applyMiddleware(handler) {
  return async (req, res) => {
    cookieMiddleware(req, res, () => {});
    authenticate(req, res, () => {});
    if (process.env.ENABLE_AUTH !== 'true' && !req.user) {
      const demoId = ensureDemoUser();
      const token = createSession(demoId);
      req.user = { id: demoId, username: 'demo', role: 'user' };
      setSessionCookie(res, token);
    }
    await handler(req, res);
  };
}

// ---------------------------------------------------------------------------
// Projects routes
// ---------------------------------------------------------------------------

async function handleProjects(req, res) {
  const userId = req.user.id;
  if (req.method === 'GET') {
    const rows = db.prepare(`SELECT * FROM projects WHERE user_id = ? ORDER BY updated_at DESC`).all(userId);
    return ok(res, rows.map(projectRowToProject));
  }
  if (req.method === 'POST') {
    let body;
    try { body = await parseJsonBody(req); } catch { return badRequest(res, 'Invalid JSON body'); }
    const validation = validateProject(body);
    if (!validation.ok) return badRequest(res, 'Validation failed', 'VALIDATION_ERROR', validation.errors);
    const missing = requiredFields(body, ['name']);
    if (missing.length) return badRequest(res, 'Missing required fields', 'MISSING_FIELDS', { missing });
    const id = body.id || `proj_${Date.now()}`;
    const exists = db.prepare(`SELECT id FROM projects WHERE id = ? AND user_id = ?`).get(id, userId);
    if (exists) return badRequest(res, 'A project with this ID already exists', 'DUPLICATE_ID');
    try {
      db.prepare(`INSERT INTO projects (id, user_id, name, description, space_type, units, floor_area, ceiling_height, capture_method, status, room_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        id, userId, body.name.trim(), body.description || '', body.spaceType || 'Custom', body.units || 'metres',
        body.floorArea || null, body.ceilingHeight || null, body.captureMethod || 'Still Photos Loop',
        body.status || 'Ready for Upload', body.roomCount || 0, nowIso(), nowIso()
      );
    } catch (e) { return serverError(res, e); }
    const row = db.prepare(`SELECT * FROM projects WHERE id = ?`).get(id);
    return created(res, projectRowToProject(row));
  }
  return badRequest(res, 'Method not allowed', 'METHOD_NOT_ALLOWED');
}

async function handleProjectById(req, res, id) {
  const userId = req.user.id;
  const row = db.prepare(`SELECT * FROM projects WHERE id = ? AND user_id = ?`).get(id, userId);
  if (!row) return notFound(res, 'Project not found');
  if (req.method === 'GET') return ok(res, projectRowToProject(row));
  if (req.method === 'PATCH') {
    let body;
    try { body = await parseJsonBody(req); } catch { return badRequest(res, 'Invalid JSON body'); }
    const validation = validateProject(body, true);
    if (!validation.ok) return badRequest(res, 'Validation failed', 'VALIDATION_ERROR', validation.errors);
    const updates = [];
    const values = [];
    const allowed = ['name', 'description', 'spaceType', 'units', 'floorArea', 'ceilingHeight', 'captureMethod', 'status', 'roomCount', 'photoCount', 'videoCount', 'hasFloorPlan', 'floorPlanName', 'startingAnchor', 'referenceMeasurement', 'reconstructionEngine', 'reconstructionProgress', 'lastErrorMessage', 'reconstructionModelStats'];
    const colMap = { name: 'name', description: 'description', spaceType: 'space_type', units: 'units', floorArea: 'floor_area', ceilingHeight: 'ceiling_height', captureMethod: 'capture_method', status: 'status', roomCount: 'room_count', photoCount: 'photo_count', videoCount: 'video_count', hasFloorPlan: 'has_floor_plan', floorPlanName: 'floor_plan_name', startingAnchor: 'starting_anchor', referenceMeasurement: 'reference_measurement', reconstructionEngine: 'reconstruction_engine', reconstructionProgress: 'reconstruction_progress', lastErrorMessage: 'last_error_message', reconstructionModelStats: 'reconstruction_model_stats' };
    for (const key of allowed) {
      if (key in body) {
        let val = body[key];
        if (key === 'hasFloorPlan') val = val ? 1 : 0;
        if (key === 'reconstructionModelStats') val = JSON.stringify(val);
        updates.push(`${colMap[key]} = ?`);
        values.push(val);
      }
    }
    if (updates.length === 0) return badRequest(res, 'No updatable fields provided');
    updates.push('updated_at = ?');
    values.push(nowIso(), id, userId);
    try {
      db.prepare(`UPDATE projects SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`).run(...values);
    } catch (e) { return serverError(res, e); }
    const updated = db.prepare(`SELECT * FROM projects WHERE id = ?`).get(id);
    return ok(res, projectRowToProject(updated));
  }
  if (req.method === 'DELETE') {
    try { db.prepare(`DELETE FROM projects WHERE id = ? AND user_id = ?`).run(id, userId); } catch (e) { return serverError(res, e); }
    return ok(res, { id, deleted: true });
  }
  return badRequest(res, 'Method not allowed', 'METHOD_NOT_ALLOWED');
}

// ---------------------------------------------------------------------------
// Rooms routes
// ---------------------------------------------------------------------------

async function handleRooms(req, res) {
  const userId = req.user.id;
  const url = new URL(req.url, `http://${req.headers.host}`);
  const projectId = url.searchParams.get('project_id') || undefined;
  if (req.method === 'GET') {
    if (projectId) {
      const rows = db.prepare(`SELECT * FROM rooms WHERE user_id = ? AND project_id = ? ORDER BY name`).all(userId, projectId);
      return ok(res, rows.map(roomRowToRoom));
    }
    const rows = db.prepare(`SELECT * FROM rooms WHERE user_id = ? ORDER BY name`).all(userId);
    return ok(res, rows.map(roomRowToRoom));
  }
  if (req.method === 'POST') {
    let body;
    try { body = await parseJsonBody(req); } catch { return badRequest(res, 'Invalid JSON body'); }
    const validation = validateRoom(body);
    if (!validation.ok) return badRequest(res, 'Validation failed', 'VALIDATION_ERROR', validation.errors);
    const missing = requiredFields(body, ['id', 'name', 'lengthMeters', 'widthMeters', 'heightMeters']);
    if (missing.length) return badRequest(res, 'Missing required fields', 'MISSING_FIELDS', { missing });
    const linkedProjectId = body.projectId || projectId || null;
    if (!ownedProject(userId, linkedProjectId)) {
      return badRequest(res, 'Referenced project does not exist', 'INVALID_REFERENCE');
    }
    const exists = db.prepare(`SELECT id FROM rooms WHERE id = ? AND user_id = ?`).get(body.id, userId);
    if (exists) return badRequest(res, 'A room with this ID already exists', 'DUPLICATE_ID');
    try {
      db.prepare(`INSERT INTO rooms (id, user_id, project_id, name, category, length_meters, width_meters, height_meters, origin_description, coordinate_convention, connected_doorway_ids, features, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        body.id, userId, linkedProjectId, body.name.trim(), body.category || 'Office', body.lengthMeters, body.widthMeters, body.heightMeters,
        body.originDescription || '', body.coordinateConvention || 'Right-Handed Y-Up (Three.js standard)',
        JSON.stringify(body.connectedDoorwayIds || []), JSON.stringify(body.features || {}), nowIso(), nowIso()
      );
    } catch (e) { return serverError(res, e); }
    const row = db.prepare(`SELECT * FROM rooms WHERE id = ?`).get(body.id);
    return created(res, roomRowToRoom(row));
  }
  return badRequest(res, 'Method not allowed', 'METHOD_NOT_ALLOWED');
}

async function handleRoomById(req, res, id) {
  const userId = req.user.id;
  const row = db.prepare(`SELECT * FROM rooms WHERE id = ? AND user_id = ?`).get(id, userId);
  if (!row) return notFound(res, 'Room not found');
  if (req.method === 'GET') return ok(res, roomRowToRoom(row));
  if (req.method === 'PUT' || req.method === 'PATCH') {
    let body;
    try { body = await parseJsonBody(req); } catch { return badRequest(res, 'Invalid JSON body'); }
    const validation = validateRoom(body, true);
    if (!validation.ok) return badRequest(res, 'Validation failed', 'VALIDATION_ERROR', validation.errors);
    if (
      body.connectedDoorwayIds !== undefined &&
      !body.connectedDoorwayIds.every((doorwayId) => ownedDoorway(userId, doorwayId))
    ) {
      return badRequest(res, 'Referenced doorway does not exist', 'INVALID_REFERENCE');
    }
    const updates = [];
    const values = [];
    const allowed = ['name', 'category', 'lengthMeters', 'widthMeters', 'heightMeters', 'originDescription', 'coordinateConvention', 'connectedDoorwayIds', 'features', 'reconstructionDimensionEstimate'];
    const colMap = { name: 'name', category: 'category', lengthMeters: 'length_meters', widthMeters: 'width_meters', heightMeters: 'height_meters', originDescription: 'origin_description', coordinateConvention: 'coordinate_convention', connectedDoorwayIds: 'connected_doorway_ids', features: 'features', reconstructionDimensionEstimate: 'reconstruction_dimension_estimate' };
    for (const key of allowed) {
      if (key in body) {
        let val = body[key];
        if (['connectedDoorwayIds', 'features', 'reconstructionDimensionEstimate'].includes(key)) val = JSON.stringify(val);
        updates.push(`${colMap[key]} = ?`);
        values.push(val);
      }
    }
    if (updates.length === 0) return badRequest(res, 'No updatable fields provided');
    updates.push('updated_at = ?');
    values.push(nowIso(), id, userId);
    try { db.prepare(`UPDATE rooms SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`).run(...values); } catch (e) { return serverError(res, e); }
    const updated = db.prepare(`SELECT * FROM rooms WHERE id = ?`).get(id);
    return ok(res, roomRowToRoom(updated));
  }
  if (req.method === 'DELETE') {
    try { db.prepare(`DELETE FROM rooms WHERE id = ? AND user_id = ?`).run(id, userId); } catch (e) { return serverError(res, e); }
    return ok(res, { id, deleted: true });
  }
  return badRequest(res, 'Method not allowed', 'METHOD_NOT_ALLOWED');
}

// ---------------------------------------------------------------------------
// Doorways routes
// ---------------------------------------------------------------------------

async function handleDoorways(req, res) {
  const userId = req.user.id;
  const url = new URL(req.url, `http://${req.headers.host}`);
  const projectId = url.searchParams.get('project_id') || undefined;
  if (req.method === 'GET') {
    let rows;
    if (projectId) {
      rows = db.prepare(`SELECT * FROM doorways WHERE user_id = ? AND project_id = ? ORDER BY id`).all(userId, projectId);
    } else {
      rows = db.prepare(`SELECT * FROM doorways WHERE user_id = ? ORDER BY id`).all(userId);
    }
    return ok(res, rows.map(doorwayRowToDoorway));
  }
  if (req.method === 'POST') {
    let body;
    try { body = await parseJsonBody(req); } catch { return badRequest(res, 'Invalid JSON body'); }
    const validation = validateDoorway(body);
    if (!validation.ok) return badRequest(res, 'Validation failed', 'VALIDATION_ERROR', validation.errors);
    const missing = requiredFields(body, ['id', 'name', 'widthMeters', 'heightMeters']);
    if (missing.length) return badRequest(res, 'Missing required fields', 'MISSING_FIELDS', { missing });
    const linkedProjectId = body.projectId || projectId || null;
    if (!ownedProject(userId, linkedProjectId) || !ownedRoomIds(userId, body.connectedRoomIds || [])) {
      return badRequest(res, 'Referenced project or room does not exist', 'INVALID_REFERENCE');
    }
    const exists = db.prepare(`SELECT id FROM doorways WHERE id = ? AND user_id = ?`).get(body.id, userId);
    if (exists) return badRequest(res, 'A doorway with this ID already exists', 'DUPLICATE_ID');
    try {
      db.prepare(`INSERT INTO doorways (id, user_id, project_id, name, connected_room_ids, width_meters, height_meters, wall_location, offset_meters, has_clear_line_of_sight, observations, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        body.id, userId, linkedProjectId, body.name.trim(), JSON.stringify(body.connectedRoomIds || []), body.widthMeters, body.heightMeters,
        body.wallLocation || 'east', body.offsetMeters || 0, body.hasClearLineOfSight ? 1 : 0,
        JSON.stringify(body.observations || {}), nowIso(), nowIso()
      );
    } catch (e) { return serverError(res, e); }
    const row = db.prepare(`SELECT * FROM doorways WHERE id = ?`).get(body.id);
    return created(res, doorwayRowToDoorway(row));
  }
  return badRequest(res, 'Method not allowed', 'METHOD_NOT_ALLOWED');
}

async function handleDoorwayById(req, res, id) {
  const userId = req.user.id;
  const row = db.prepare(`SELECT * FROM doorways WHERE id = ? AND user_id = ?`).get(id, userId);
  if (!row) return notFound(res, 'Doorway not found');
  if (req.method === 'GET') return ok(res, doorwayRowToDoorway(row));
  if (req.method === 'PUT' || req.method === 'PATCH') {
    let body;
    try { body = await parseJsonBody(req); } catch { return badRequest(res, 'Invalid JSON body'); }
    const validation = validateDoorway(body, true);
    if (!validation.ok) return badRequest(res, 'Validation failed', 'VALIDATION_ERROR', validation.errors);
    if (
      body.connectedRoomIds !== undefined &&
      !ownedRoomIds(userId, body.connectedRoomIds)
    ) {
      return badRequest(res, 'Referenced room does not exist', 'INVALID_REFERENCE');
    }
    const updates = [];
    const values = [];
    const allowed = ['name', 'connectedRoomIds', 'widthMeters', 'heightMeters', 'wallLocation', 'offsetMeters', 'hasClearLineOfSight', 'observations'];
    const colMap = { name: 'name', connectedRoomIds: 'connected_room_ids', widthMeters: 'width_meters', heightMeters: 'height_meters', wallLocation: 'wall_location', offsetMeters: 'offset_meters', hasClearLineOfSight: 'has_clear_line_of_sight', observations: 'observations' };
    for (const key of allowed) {
      if (key in body) {
        let val = body[key];
        if (['connectedRoomIds', 'observations'].includes(key)) val = JSON.stringify(val);
        if (key === 'hasClearLineOfSight') val = val ? 1 : 0;
        updates.push(`${colMap[key]} = ?`);
        values.push(val);
      }
    }
    if (updates.length === 0) return badRequest(res, 'No updatable fields provided');
    updates.push('updated_at = ?');
    values.push(nowIso(), id, userId);
    try { db.prepare(`UPDATE doorways SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`).run(...values); } catch (e) { return serverError(res, e); }
    const updated = db.prepare(`SELECT * FROM doorways WHERE id = ?`).get(id);
    return ok(res, doorwayRowToDoorway(updated));
  }
  if (req.method === 'DELETE') {
    try { db.prepare(`DELETE FROM doorways WHERE id = ? AND user_id = ?`).run(id, userId); } catch (e) { return serverError(res, e); }
    return ok(res, { id, deleted: true });
  }
  return badRequest(res, 'Method not allowed', 'METHOD_NOT_ALLOWED');
}

// ---------------------------------------------------------------------------
// Photos routes
// ---------------------------------------------------------------------------

async function handlePhotos(req, res) {
  const userId = req.user.id;
  const url = new URL(req.url, `http://${req.headers.host}`);
  const roomId = url.searchParams.get('room_id') || undefined;
  const pass = url.searchParams.get('pass') || undefined;
  const projectId = url.searchParams.get('project_id') || undefined;
  if (req.method === 'GET') {
    let rows;
    if (roomId) {
      rows = db.prepare(`SELECT * FROM photos WHERE user_id = ? AND room_id = ? ORDER BY timestamp DESC`).all(userId, roomId);
    } else if (pass) {
      rows = db.prepare(`SELECT * FROM photos WHERE user_id = ? AND pass = ? ORDER BY timestamp DESC`).all(userId, pass);
    } else if (projectId) {
      rows = db.prepare(`SELECT * FROM photos WHERE user_id = ? AND project_id = ? ORDER BY timestamp DESC`).all(userId, projectId);
    } else {
      rows = db.prepare(`SELECT * FROM photos WHERE user_id = ? ORDER BY timestamp DESC`).all(userId);
    }
    return ok(res, rows.map(photoRowToPhoto));
  }
  if (req.method === 'POST') {
    let body;
    try { body = await parseJsonBody(req); } catch { return badRequest(res, 'Invalid JSON body'); }
    const validation = validatePhoto(body);
    if (!validation.ok) return badRequest(res, 'Validation failed', 'VALIDATION_ERROR', validation.errors);
    const missing = requiredFields(body, ['id', 'filename', 'roomId']);
    if (missing.length) return badRequest(res, 'Missing required fields', 'MISSING_FIELDS', { missing });
    const linkedProjectId = body.projectId || projectId || null;
    if (
      !ownedProject(userId, linkedProjectId) ||
      !ownedRoomIds(userId, [body.roomId]) ||
      !ownedDoorway(userId, body.doorwayAnchorId)
    ) {
      return badRequest(res, 'Referenced project, room, or doorway does not exist', 'INVALID_REFERENCE');
    }
    const exists = db.prepare(`SELECT id FROM photos WHERE id = ? AND user_id = ?`).get(body.id, userId);
    if (exists) return badRequest(res, 'A photo with this ID already exists', 'DUPLICATE_ID');
    try {
      db.prepare(`INSERT INTO photos (id, user_id, project_id, filename, room_id, pass, modality, camera_pose_tag, focal_length_mm, sharpness_score, exposure_review, overlap_review, occlusion_flag, doorway_anchor_id, reviewer_notes, timestamp, is_automated_metric, image_url, dominant_color, spatial_pose) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        body.id, userId, linkedProjectId, body.filename.trim(), body.roomId, body.pass || 'Pass A', body.modality || 'Still Photograph',
        body.cameraPoseTag || '', body.focalLengthMm || 24, body.sharpnessScore || 0, body.exposureReview || 'Good',
        body.overlapReview || 'Sufficient (>70%)', body.occlusionFlag ? 1 : 0, body.doorwayAnchorId || null,
        body.reviewerNotes || '', body.timestamp || nowIso(), body.isAutomatedMetric !== false ? 1 : 0,
        body.imageUrl || null, body.dominantColor || null, body.spatialPose ? JSON.stringify(body.spatialPose) : null
      );
    } catch (e) { return serverError(res, e); }
    const row = db.prepare(`SELECT * FROM photos WHERE id = ?`).get(body.id);
    return created(res, photoRowToPhoto(row));
  }
  return badRequest(res, 'Method not allowed', 'METHOD_NOT_ALLOWED');
}

async function handlePhotoById(req, res, id) {
  const userId = req.user.id;
  const row = db.prepare(`SELECT * FROM photos WHERE id = ? AND user_id = ?`).get(id, userId);
  if (!row) return notFound(res, 'Photo not found');
  if (req.method === 'GET') return ok(res, photoRowToPhoto(row));
  if (req.method === 'PUT' || req.method === 'PATCH') {
    let body;
    try { body = await parseJsonBody(req); } catch { return badRequest(res, 'Invalid JSON body'); }
    const validation = validatePhoto(body, true);
    if (!validation.ok) return badRequest(res, 'Validation failed', 'VALIDATION_ERROR', validation.errors);
    if (
      (body.roomId !== undefined && !ownedRoomIds(userId, [body.roomId])) ||
      (body.doorwayAnchorId !== undefined && !ownedDoorway(userId, body.doorwayAnchorId))
    ) {
      return badRequest(res, 'Referenced room or doorway does not exist', 'INVALID_REFERENCE');
    }
    const updates = [];
    const values = [];
    const allowed = ['filename', 'roomId', 'pass', 'modality', 'cameraPoseTag', 'focalLengthMm', 'sharpnessScore', 'exposureReview', 'overlapReview', 'occlusionFlag', 'doorwayAnchorId', 'reviewerNotes', 'timestamp', 'isAutomatedMetric', 'imageUrl', 'dominantColor', 'spatialPose'];
    const colMap = { filename: 'filename', roomId: 'room_id', pass: 'pass', modality: 'modality', cameraPoseTag: 'camera_pose_tag', focalLengthMm: 'focal_length_mm', sharpnessScore: 'sharpness_score', exposureReview: 'exposure_review', overlapReview: 'overlap_review', occlusionFlag: 'occlusion_flag', doorwayAnchorId: 'doorway_anchor_id', reviewerNotes: 'reviewer_notes', timestamp: 'timestamp', isAutomatedMetric: 'is_automated_metric', imageUrl: 'image_url', dominantColor: 'dominant_color', spatialPose: 'spatial_pose' };
    for (const key of allowed) {
      if (key in body) {
        let val = body[key];
        if (key === 'occlusionFlag' || key === 'isAutomatedMetric') val = val ? 1 : 0;
        if (key === 'spatialPose') val = JSON.stringify(val);
        updates.push(`${colMap[key]} = ?`);
        values.push(val);
      }
    }
    if (updates.length === 0) return badRequest(res, 'No updatable fields provided');
    updates.push('timestamp = ?');
    values.push(nowIso(), id, userId);
    try { db.prepare(`UPDATE photos SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`).run(...values); } catch (e) { return serverError(res, e); }
    const updated = db.prepare(`SELECT * FROM photos WHERE id = ?`).get(id);
    return ok(res, photoRowToPhoto(updated));
  }
  if (req.method === 'DELETE') {
    try { db.prepare(`DELETE FROM photos WHERE id = ? AND user_id = ?`).run(id, userId); } catch (e) { return serverError(res, e); }
    return ok(res, { id, deleted: true });
  }
  return badRequest(res, 'Method not allowed', 'METHOD_NOT_ALLOWED');
}

// ---------------------------------------------------------------------------
// Manifest validation (server-side referential integrity)
// ---------------------------------------------------------------------------

function handleManifestValidate(req, res) {
  const userId = req.user.id;
  const issues = [];

  const dupProjects = db.prepare(`SELECT id, COUNT(*) as c FROM projects WHERE user_id = ? GROUP BY id HAVING c > 1`).all(userId);
  for (const p of dupProjects) {
    issues.push({ severity: 'error', category: 'manifest', entityId: p.id, message: `Duplicate project ID "${p.id}".`, suggestedFix: 'Use a unique project ID.' });
  }

  const badRooms = db.prepare(`SELECT id, name, length_meters, width_meters, height_meters FROM rooms WHERE user_id = ? AND (length_meters <= 0 OR width_meters <= 0 OR height_meters <= 0)`).all(userId);
  for (const r of badRooms) {
    issues.push({ severity: 'error', category: 'dimension', entityId: r.id, message: `Room "${r.name}" has zero or negative dimensions.`, suggestedFix: 'Enter physical tape measurements.' });
  }

  const allRoomIds = new Set(db.prepare(`SELECT id FROM rooms WHERE user_id = ?`).all(userId).map((r) => r.id));
  const doorways = db.prepare(`SELECT id, name, connected_room_ids FROM doorways WHERE user_id = ?`).all(userId);
  for (const d of doorways) {
    try {
      const ids = JSON.parse(d.connected_room_ids);
      for (const rid of ids) {
        if (!allRoomIds.has(rid)) {
          issues.push({ severity: 'error', category: 'doorway', entityId: d.id, message: `Doorway "${d.name}" references non-existent room "${rid}".`, suggestedFix: 'Link to an existing room.' });
        }
      }
    } catch {
      issues.push({ severity: 'error', category: 'doorway', entityId: d.id, message: `Doorway "${d.name}" has malformed connected_room_ids.`, suggestedFix: 'Repair the doorway record.' });
    }
  }

  const allDoorwayIds = new Set(db.prepare(`SELECT id FROM doorways WHERE user_id = ?`).all(userId).map((d) => d.id));
  const photos = db.prepare(`SELECT id, filename, room_id, doorway_anchor_id FROM photos WHERE user_id = ?`).all(userId);
  for (const p of photos) {
    if (!allRoomIds.has(p.room_id)) {
      issues.push({ severity: 'error', category: 'manifest', entityId: p.filename, message: `Photo "${p.filename}" references non-existent room "${p.room_id}".`, suggestedFix: 'Assign to an existing room.' });
    }
    if (p.doorway_anchor_id && !allDoorwayIds.has(p.doorway_anchor_id)) {
      issues.push({ severity: 'warning', category: 'doorway', entityId: p.filename, message: `Photo "${p.filename}" references invalid doorway "${p.doorway_anchor_id}".`, suggestedFix: 'Link to a valid doorway or clear the anchor.' });
    }
  }

  const rooms = db.prepare(`SELECT id, name FROM rooms WHERE user_id = ?`).all(userId);
  for (const r of rooms) {
    const count = db.prepare(`SELECT COUNT(*) as c FROM photos WHERE user_id = ? AND room_id = ?`).get(userId, r.id).c;
    if (count === 0) {
      issues.push({ severity: 'error', category: 'coverage', entityId: r.id, message: `Room "${r.name}" has 0 photographs registered.`, suggestedFix: 'Register at least Pass A photos.' });
    }
  }

  const errorCount = issues.filter((i) => i.severity === 'error').length;
  const warningCount = issues.filter((i) => i.severity === 'warning').length;
  return ok(res, { isValid: errorCount === 0, errorCount, warningCount, infoCount: 0, issues });
}

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

function handleHealth(req, res) {
  return ok(res, { status: 'ok', service: 'nammatwin-api', timestamp: nowIso(), db: 'sqlite' });
}

// ---------------------------------------------------------------------------
// Auth routes
// ---------------------------------------------------------------------------

async function handleAuthRegister(req, res) {
  let body;
  try { body = await parseJsonBody(req); } catch { return badRequest(res, 'Invalid JSON body'); }
  if (process.env.ENABLE_AUTH !== 'true') {
    return badRequest(res, 'Self-registration is disabled in this mode', 'REGISTRATION_DISABLED');
  }
  const { username, email, password } = body;
  if (!username || !email || !password) return badRequest(res, 'username, email and password are required', 'MISSING_FIELDS');
  if (password.length < 6) return badRequest(res, 'Password must be at least 6 characters', 'WEAK_PASSWORD');
  const existing = db.prepare(`SELECT id FROM users WHERE username = ? OR email = ?`).get(username, email);
  if (existing) return badRequest(res, 'Username or email already exists', 'DUPLICATE_USER');
  const id = `user_${Date.now()}`;
  const hash = hashPassword(password);
  try {
    db.prepare(`INSERT INTO users (id, username, email, password_hash, role) VALUES (?, ?, ?, ?, 'user')`).run(id, username.trim(), email.toLowerCase().trim(), hash);
  } catch (e) { return serverError(res, e); }
  const token = createSession(id);
  setSessionCookie(res, token);
  return created(res, { user: { id, username, email: email.toLowerCase().trim(), role: 'user' } });
}

async function handleAuthLogin(req, res) {
  let body;
  try { body = await parseJsonBody(req); } catch { return badRequest(res, 'Invalid JSON body'); }
  const { username, password } = body;
  if (!username || !password) return badRequest(res, 'Username and password are required', 'MISSING_FIELDS');
  const user = db.prepare(`SELECT * FROM users WHERE username = ?`).get(username);
  if (!user || !verifyPassword(password, user.password_hash)) {
    return badRequest(res, 'Invalid credentials', 'INVALID_CREDENTIALS');
  }
  db.prepare(`UPDATE users SET last_login = datetime('now') WHERE id = ?`).run(user.id);
  const token = createSession(user.id);
  setSessionCookie(res, token);
  return ok(res, { user: { id: user.id, username: user.username, email: user.email, role: user.role } });
}

function handleAuthLogout(req, res) {
  const token = req.cookies && req.cookies.session_token;
  destroySession(token);
  clearSessionCookie(res);
  return ok(res, { ok: true });
}

function handleAuthMe(req, res) {
  if (!req.user) {
    return badRequest(res, 'Not authenticated', 'AUTH_REQUIRED');
  }
  return ok(res, { user: { id: req.user.id, username: req.user.username, role: req.user.role } });
}

// ---------------------------------------------------------------------------
// Route dispatcher
// ---------------------------------------------------------------------------

const ROUTES = [
  // Auth
  { method: 'POST', path: /^\/api\/auth\/register$/, handler: handleAuthRegister },
  { method: 'POST', path: /^\/api\/auth\/login$/, handler: handleAuthLogin },
  { method: 'POST', path: /^\/api\/auth\/logout$/, handler: handleAuthLogout },
  { method: 'GET', path: /^\/api\/auth\/me$/, handler: handleAuthMe },
  // Health
  { method: 'GET', path: /^\/api\/health$/, handler: handleHealth },
  // Manifest validation
  { method: 'GET', path: /^\/api\/manifest\/validate$/, handler: handleManifestValidate },
  { method: 'POST', path: /^\/api\/manifest\/validate$/, handler: handleManifestValidate },
  // Projects
  { method: 'GET', path: /^\/api\/projects$/, handler: handleProjects },
  { method: 'POST', path: /^\/api\/projects$/, handler: handleProjects },
  { method: 'GET', path: /^\/api\/projects\/([^/]+)$/, handler: (req, res) => handleProjectById(req, res, req.params[0]) },
  { method: 'PATCH', path: /^\/api\/projects\/([^/]+)$/, handler: (req, res) => handleProjectById(req, res, req.params[0]) },
  { method: 'DELETE', path: /^\/api\/projects\/([^/]+)$/, handler: (req, res) => handleProjectById(req, res, req.params[0]) },
  // Rooms
  { method: 'GET', path: /^\/api\/rooms$/, handler: handleRooms },
  { method: 'POST', path: /^\/api\/rooms$/, handler: handleRooms },
  { method: 'GET', path: /^\/api\/rooms\/([^/]+)$/, handler: (req, res) => handleRoomById(req, res, req.params[0]) },
  { method: 'PUT', path: /^\/api\/rooms\/([^/]+)$/, handler: (req, res) => handleRoomById(req, res, req.params[0]) },
  { method: 'PATCH', path: /^\/api\/rooms\/([^/]+)$/, handler: (req, res) => handleRoomById(req, res, req.params[0]) },
  { method: 'DELETE', path: /^\/api\/rooms\/([^/]+)$/, handler: (req, res) => handleRoomById(req, res, req.params[0]) },
  // Doorways
  { method: 'GET', path: /^\/api\/doorways$/, handler: handleDoorways },
  { method: 'POST', path: /^\/api\/doorways$/, handler: handleDoorways },
  { method: 'GET', path: /^\/api\/doorways\/([^/]+)$/, handler: (req, res) => handleDoorwayById(req, res, req.params[0]) },
  { method: 'PUT', path: /^\/api\/doorways\/([^/]+)$/, handler: (req, res) => handleDoorwayById(req, res, req.params[0]) },
  { method: 'PATCH', path: /^\/api\/doorways\/([^/]+)$/, handler: (req, res) => handleDoorwayById(req, res, req.params[0]) },
  { method: 'DELETE', path: /^\/api\/doorways\/([^/]+)$/, handler: (req, res) => handleDoorwayById(req, res, req.params[0]) },
  // Photos
  { method: 'GET', path: /^\/api\/photos$/, handler: handlePhotos },
  { method: 'POST', path: /^\/api\/photos$/, handler: handlePhotos },
  { method: 'GET', path: /^\/api\/photos\/([^/]+)$/, handler: (req, res) => handlePhotoById(req, res, req.params[0]) },
  { method: 'PUT', path: /^\/api\/photos\/([^/]+)$/, handler: (req, res) => handlePhotoById(req, res, req.params[0]) },
  { method: 'PATCH', path: /^\/api\/photos\/([^/]+)$/, handler: (req, res) => handlePhotoById(req, res, req.params[0]) },
  { method: 'DELETE', path: /^\/api\/photos\/([^/]+)$/, handler: (req, res) => handlePhotoById(req, res, req.params[0]) },
];

function extractParams(req, route) {
  const m = req.url.split('?')[0].match(route.path);
  req.params = m ? m.slice(1) : [];
}

async function dispatch(req, res) {
  const baseUrl = `http://${req.headers.host}`;
  const url = new URL(req.url, baseUrl);
  const pathname = url.pathname;
  const method = req.method;

  cookieMiddleware(req, res, () => {});
  authenticate(req, res, () => {});
  // Attach implicit demo session when auth is not explicitly required.
  if (process.env.ENABLE_AUTH !== 'true' && !req.user) {
    const demoId = ensureDemoUser();
    const token = createSession(demoId);
    req.user = { id: demoId, username: 'demo', role: 'user' };
    setSessionCookie(res, token);
  }

  for (const route of ROUTES) {
    if (route.method !== method) continue;
    if (!route.path.test(pathname)) continue;
    extractParams(req, route);
    if (process.env.ENABLE_AUTH === 'true' && !req.user) {
      return badRequest(res, 'Authentication required', 'AUTH_REQUIRED');
    }
    return await route.handler(req, res);
  }
  return notFound(res, 'API endpoint not found');
}

module.exports = { dispatch };
