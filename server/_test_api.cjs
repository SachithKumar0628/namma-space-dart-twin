const http = require('http');
const BASE = 'http://localhost:5000';

function request(path, opts = {}) {
  return new Promise((resolve, reject) => {
    const [method, body] = [opts.method || 'GET', opts.body];
    const req = http.request(`${BASE}${path}`, {
      method,
      headers: Object.assign({ 'Content-Type': 'application/json' }, opts.headers),
    });
    let data = '';
    req.on('response', (res) => {
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode, body: data ? JSON.parse(data) : {} }));
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

let passed = 0;
let failed = 0;
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log('PASS:', name); }
  else { failed++; console.log('FAIL:', name, extra); }
}

(async () => {
  // Health
  let r = await request('/api/health');
  check('health', r.status === 200 && r.body.ok, JSON.stringify(r.body));

  // GET projects (implicit demo session)
  r = await request('/api/projects');
  check('GET projects', r.status === 200 && Array.isArray(r.body.data), JSON.stringify(r.body));
  const projCount = r.body.data ? r.body.data.length : 0;
  check('projects has B-804', projCount >= 1, `count=${projCount}`);

  // GET rooms
  r = await request('/api/rooms');
  check('GET rooms', r.status === 200 && Array.isArray(r.body.data), JSON.stringify(r.body));
  check('rooms count 6', r.body.data ? r.body.data.length === 6 : false, `count=${r.body.data ? r.body.data.length : 0}`);

  // GET doorways
  r = await request('/api/doorways');
  check('GET doorways', r.status === 200 && Array.isArray(r.body.data), JSON.stringify(r.body));
  check('doorways count 6', r.body.data ? r.body.data.length === 6 : false, `count=${r.body.data ? r.body.data.length : 0}`);

  // GET photos
  r = await request('/api/photos');
  check('GET photos', r.status === 200 && Array.isArray(r.body.data), JSON.stringify(r.body));
  check('photos count 11', r.body.data ? r.body.data.length === 11 : false, `count=${r.body.data ? r.body.data.length : 0}`);

  // Manifest validate
  r = await request('/api/manifest/validate');
  check('manifest validate', r.status === 200 && typeof r.body.data.isValid === 'boolean', JSON.stringify(r.body));
  check('manifest isValid true', r.body.data ? r.body.data.isValid === true : false, JSON.stringify(r.body.data));

  // POST project (create)
  const newProj = { name: 'Test Project', spaceType: 'Office', units: 'metres', captureMethod: 'Still Photos Loop', status: 'Draft', roomCount: 1 };
  r = await request('/api/projects', { method: 'POST', body: newProj });
  check('POST project', r.status === 201 && r.body.ok, `status=${r.status} body=${JSON.stringify(r.body)}`);
  const createdId = r.body.data ? r.body.data.id : null;

  // GET project by id
  if (createdId) {
    r = await request(`/api/projects/${createdId}`);
    check('GET project by id', r.status === 200 && r.body.data.id === createdId, `status=${r.status}`);

    // PATCH project
    r = await request(`/api/projects/${createdId}`, { method: 'PATCH', body: { status: 'Ready for Upload' } });
    check('PATCH project', r.status === 200 && r.body.data.status === 'Ready for Upload', `status=${r.status}`);

    // DELETE project
    r = await request(`/api/projects/${createdId}`, { method: 'DELETE' });
    check('DELETE project', r.status === 200 && r.body.ok, `status=${r.status}`);

    // Confirm deleted
    r = await request(`/api/projects/${createdId}`);
    check('project deleted (404)', r.status === 404, `status=${r.status}`);
  }

  // POST room
  const newRoom = { id: 'R_TEST', name: 'Test Room', category: 'Office', lengthMeters: 4, widthMeters: 3, heightMeters: 2.8, originDescription: 'test', connectedDoorwayIds: [], features: {} };
  r = await request('/api/rooms', { method: 'POST', body: newRoom });
  check('POST room', r.status === 201 && r.body.ok, `status=${r.status}`);
  if (r.body.ok) {
    r = await request('/api/rooms/R_TEST', { method: 'DELETE' });
    check('DELETE room', r.status === 200 && r.body.ok, `status=${r.status}`);
  }

  // Validation error: missing required field
  r = await request('/api/projects', { method: 'POST', body: {} });
  check('POST project validation (400)', r.status === 400 && !r.body.ok, `status=${r.status}`);

  // Auth: register (disabled in implicit mode)
  r = await request('/api/auth/register', { method: 'POST', body: { username: 'alice', email: 'alice@test.com', password: 'password123' } });
  check('register disabled (400)', r.status === 400, `status=${r.status}`);

  // Auth: me (implicit demo user)
  r = await request('/api/auth/me');
  check('auth me', r.status === 200 && r.body.data.user.username === 'demo', `status=${r.status} user=${JSON.stringify(r.body.data)}`);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
