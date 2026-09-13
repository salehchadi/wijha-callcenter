#!/usr/bin/env node

/**
 * Standalone integration test script for the Call Center API.
 *
 * Requirements:
 *   - Server running at http://localhost:3000
 *   - Test data seeded: agent1@gmail.com / agent123, admin1@gmail.com / admin123,
 *     project id=1 ('Default Project')
 *
 * Uses built-in fetch (Node 18+). No external dependencies.
 * Self-cleaning: cleans up all created resources via DELETE endpoints.
 *
 * Env:
 *   API_URL      base for v1 (default http://localhost:3000/api/v1)
 *   API_URL_V2   base for v2 (default API_URL with /api/v1 -> /api/v2)
 *   V1_ONLY=1    run v1 blocks only
 *   V2_ONLY=1    run v2 blocks only
 *
 * Covers v1 (/owners path) + v2 (/clients path) + GET /calls/next dispatch
 * on both versions.
 */

const BASE_V1 = process.env.API_URL || 'http://localhost:3000/api/v1';
const BASE_V2 = process.env.API_URL_V2 || BASE_V1.replace('/api/v1', '/api/v2');
const V1_ONLY = process.env.V1_ONLY === '1';
const V2_ONLY = process.env.V2_ONLY === '1';
const RUN_V1 = !V2_ONLY;
const RUN_V2 = !V1_ONLY;

let passed = 0;
let failed = 0;
const testClientIds = [];

function assert(condition, label) {
  if (condition) {
    passed++;
    console.log(`  PASS  ${label}`);
  } else {
    failed++;
    console.error(`  FAIL  ${label}`);
  }
}

function assertEqual(actual, expected, label) {
  assert(actual === expected, `${label} (got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)})`);
}

function assertNotNull(value, label) {
  assert(value !== null && value !== undefined, label);
}

function assertNull(value, label) {
  assert(value === null || value === undefined, label);
}

async function api(base, method, path, { token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // response may be empty (204)
  }

  return { status: res.status, json, ok: res.ok };
}

// ── Login ────────────────────────────────────────────────────────────────────

let agentToken = null;
let adminToken = null;

async function loginTests() {
  console.log('\n=== Login ===');

  const agent = await api(BASE_V1, 'POST', '/login', {
    body: { email: 'agent1@gmail.com', password: 'agent123' },
  });
  assertEqual(agent.status, 200, 'Agent login returns 200');
  assertNotNull(agent.json?.token, 'Agent receives JWT token');
  agentToken = agent.json?.token;

  const admin = await api(BASE_V1, 'POST', '/login', {
    body: { email: 'admin1@gmail.com', password: 'admin123' },
  });
  assertEqual(admin.status, 200, 'Admin login returns 200');
  assertNotNull(admin.json?.token, 'Admin receives JWT token');
  adminToken = admin.json?.token;

  const bad = await api(BASE_V1, 'POST', '/login', {
    body: { email: 'bad@gmail.com', password: 'wrong' },
  });
  assertEqual(bad.status, 401, 'Bad credentials returns 401');
}

// ── Sessions ─────────────────────────────────────────────────────────────────

let sessionFirstBeat = null;

async function sessionTests() {
  console.log('\n=== Sessions ===');

  // Heartbeat creates a new session
  const beat = await api(BASE_V1, 'POST', '/sessions/active', { token: agentToken });
  assertEqual(beat.status, 200, 'Heartbeat returns 200');
  assertEqual(beat.json?.is_active, true, 'Session is active');
  sessionFirstBeat = beat.json?.first_beat;

  // List sessions
  const list = await api(BASE_V1, 'GET', '/sessions', { token: agentToken });
  assertEqual(list.status, 200, 'List sessions returns 200');
  assert(Array.isArray(list.json), 'Sessions response is array');
  assert(list.json.length > 0, 'At least one session exists');

  // Delete session (admin only)
  const del = await api(BASE_V1, 'DELETE', `/sessions/${beat.json.agent_id}/${sessionFirstBeat}`, { token: adminToken });
  assertEqual(del.status, 204, 'Delete session returns 204');

  // Verify deleted
  const list2 = await api(BASE_V1, 'GET', '/sessions', { token: agentToken });
  const stillExists = list2.json?.some(
    (s) => s.agent_id === beat.json.agent_id && s.first_beat === sessionFirstBeat,
  );
  assert(!stillExists, 'Deleted session no longer in list');
}

// ── Setup & Cleanup ──────────────────────────────────────────────────────────

let testClientId = null;
let dispatchClientId = null;

async function setup() {
  console.log('\n=== Setup ===');

  const res = await api(BASE_V1, 'POST', '/owners', {
    token: adminToken,
    body: {
      name: 'Integration Test Client',
      project_id: 1,
      phones: [{ phone: '+201012345678' }],
    },
  });
  assertEqual(res.status, 201, 'Create test client returns 201');
  assertNotNull(res.json?.id, 'Test client has an id');
  testClientId = res.json.id;
  testClientIds.push({ base: BASE_V1, path: `/owners/${res.json.id}` });

  const dispatch = await api(BASE_V1, 'POST', '/owners', {
    token: adminToken,
    body: {
      name: 'Dispatch Test Client',
      project_id: 1,
      phones: [{ phone: '+201098765432' }],
    },
  });
  assertEqual(dispatch.status, 201, 'Create dispatch client returns 201');
  dispatchClientId = dispatch.json.id;
  testClientIds.push({ base: BASE_V1, path: `/owners/${dispatch.json.id}` });
}

async function cleanup() {
  console.log('\n=== Cleanup ===');

  for (const { base, path } of testClientIds) {
    const del = await api(base, 'DELETE', path, { token: adminToken });
    assert(del.status === 204, `Delete test client ${base}${path} returns 204`);
  }
  testClientIds.length = 0;
}

// ── v1: owners path + legacy bulk alias ──────────────────────────────────────

async function v1Tests() {
  console.log('\n=== v1: owners path ===');

  const bulk = await api(BASE_V1, 'POST', '/owners/bulk', {
    token: adminToken,
    body: {
      clients: [{ name: 'Bulk One', project_id: 1, phones: [{ phone: '+201011111111' }] }],
    },
  });
  assertEqual(bulk.status, 201, 'v1 bulk with clients[] returns 201');
  if (Array.isArray(bulk.json)) {
    for (const c of bulk.json) testClientIds.push({ base: BASE_V1, path: `/owners/${c.id}` });
  }

  const legacy = await api(BASE_V1, 'POST', '/owners/bulk', {
    token: adminToken,
    body: {
      owners: [{ name: 'Bulk Legacy', project_id: 1, phones: [{ phone: '+201022222222' }] }],
    },
  });
  assertEqual(legacy.status, 201, 'v1 bulk with deprecated owners[] returns 201');
  if (Array.isArray(legacy.json)) {
    for (const c of legacy.json) testClientIds.push({ base: BASE_V1, path: `/owners/${c.id}` });
  }

  const get = await api(BASE_V1, 'GET', `/owners/${testClientId}`, { token: agentToken });
  assertEqual(get.status, 200, 'v1 GET /owners/:clientId returns 200');
  assertEqual(get.json?.id, testClientId, 'v1 client id matches');
}

// ── v2: clients path ─────────────────────────────────────────────────────────

let v2ClientId = null;

async function v2Tests() {
  console.log('\n=== v2: clients path ===');

  const projects = await api(BASE_V1, 'GET', '/projects', { token: adminToken });
  const projectName = projects.json?.[0]?.name || 'Default Project';

  const create = await api(BASE_V2, 'POST', '/clients', {
    token: adminToken,
    body: {
      name: 'V2 Test Client',
      project_id: 1,
      phones: [{ phone: '+201033333333' }],
    },
  });
  assertEqual(create.status, 201, 'v2 create client returns 201');
  assertEqual(create.json?.type, 'UNKNOWN', 'v2 default type is UNKNOWN');
  v2ClientId = create.json?.id;
  assertNotNull(v2ClientId, 'v2 client has an id');
  testClientIds.push({ base: BASE_V2, path: `/clients/${v2ClientId}` });

  const get = await api(BASE_V2, 'GET', `/clients/${v2ClientId}`, { token: agentToken });
  assertEqual(get.status, 200, 'v2 GET /clients/:clientId returns 200');

  const patch = await api(BASE_V2, 'PATCH', `/clients/${v2ClientId}`, {
    token: adminToken,
    body: { type: 'LEAD' },
  });
  assertEqual(patch.status, 200, 'v2 PATCH type returns 200');
  assertEqual(patch.json?.type, 'LEAD', 'v2 type updated to LEAD');

  const assign = await api(BASE_V2, 'POST', `/clients/${v2ClientId}/projects`, {
    token: adminToken,
    body: { project_name: projectName },
  });
  if (assign.status !== 200) {
    console.error(`  INFO  assign body: ${JSON.stringify(assign.json)} (project: ${projectName})`);
  }
  assertEqual(assign.status, 200, 'v2 assign to project returns 200');

  const list = await api(BASE_V2, 'GET', '/clients?type=LEAD', { token: agentToken });
  assertEqual(list.status, 200, 'v2 list with type filter returns 200');
  assert(Array.isArray(list.json?.data), 'v2 list has data array');
}

// ── calls/next dispatch (v1 + v2) ────────────────────────────────────────────

async function nextDispatchTests(base, label) {
  console.log(`\n=== ${label}: calls/next ===`);

  const next = await api(base, 'GET', '/calls/next?project_id=1', { token: agentToken });
  assertEqual(next.status, 200, `${label} next returns 200 when clients dialable`);
  assertNotNull(next.json?.client?.id, `${label} next has client.id`);
  assertEqual(next.json?.owner?.id, next.json?.client?.id, `${label} owner alias matches client.id`);
  assert(Array.isArray(next.json?.calls), `${label} next has calls array`);

  const filtered = await api(base, 'GET', '/calls/next?project_id=1&type=UNKNOWN', { token: agentToken });
  assert([200, 204].includes(filtered.status), `${label} next with type=UNKNOWN returns 200 or 204`);

  const calling = await api(base, 'POST', '/calls/calling', {
    token: agentToken,
    body: { client_id: next.json.client.id, project_id: 1 },
  });
  assertEqual(calling.status, 200, `${label} calling notification returns 200`);

  const submit = await api(base, 'POST', '/calls', {
    token: agentToken,
    body: {
      client_id: next.json.client.id,
      project_id: 1,
      status: 'answered',
      time: new Date().toISOString(),
      duration: 45,
    },
  });
  assertEqual(submit.status, 201, `${label} submit answered call returns 201`);

  const after = await api(base, 'GET', '/calls/next?project_id=1', { token: agentToken });
  assert([200, 204].includes(after.status), `${label} next after answered returns 200 or 204`);
}

// ── Calls ────────────────────────────────────────────────────────────────────

let callId = null;

async function callTests() {
  console.log('\n=== Calls ===');

  // Submit a call using the test client
  const submit = await api(BASE_V1, 'POST', '/calls', {
    token: agentToken,
    body: {
      client_id: testClientId,
      status: 'answered',
      time: new Date().toISOString(),
      duration: 45,
    },
  });
  assertEqual(submit.status, 201, 'Submit call returns 201');
  assertNotNull(submit.json?.id, 'Created call has an id');
  callId = submit.json.id;

  // Fetch the created call
  const get = await api(BASE_V1, 'GET', `/calls/${callId}`, { token: agentToken });
  assertEqual(get.status, 200, 'Get call returns 200');
  assertEqual(get.json?.status, 'answered', 'Call status matches');

  // List calls
  const list = await api(BASE_V1, 'GET', '/calls', { token: agentToken });
  assertEqual(list.status, 200, 'List calls returns 200');
  assert(list.json?.data?.length > 0, 'Calls list is not empty');

  // Status counts
  const statuses = await api(BASE_V1, 'GET', '/calls/statuses', { token: agentToken });
  assertEqual(statuses.status, 200, 'Statuses returns 200');
  assert(Array.isArray(statuses.json), 'Statuses response is array');

  // Delete call (admin only)
  const del = await api(BASE_V1, 'DELETE', `/calls/${callId}`, { token: adminToken });
  assertEqual(del.status, 204, 'Delete call returns 204');

  // Verify deleted
  const get2 = await api(BASE_V1, 'GET', `/calls/${callId}`, { token: agentToken });
  assertNull(get2.json, 'Deleted call returns null');
}

// ── Auth guards ──────────────────────────────────────────────────────────────

async function authGuardTests() {
  console.log('\n=== Auth Guards ===');

  const noToken = await api(BASE_V1, 'GET', '/calls');
  assertEqual(noToken.status, 401, 'No token returns 401');

  const noTokenSessions = await api(BASE_V1, 'GET', '/sessions');
  assertEqual(noTokenSessions.status, 401, 'No token sessions returns 401');
}

// ── Run ──────────────────────────────────────────────────────────────────────

async function run() {
  console.log(`\nIntegration tests against ${BASE_V1} + ${BASE_V2}`);

  try {
    await loginTests();
    await authGuardTests();
    await setup();
    await sessionTests();
    if (RUN_V1) {
      await v1Tests();
      await nextDispatchTests(BASE_V1, 'v1');
    }
    if (RUN_V2) {
      await v2Tests();
      await nextDispatchTests(BASE_V2, 'v2');
    }
    await callTests();
    await cleanup();
  } catch (err) {
    failed++;
    console.error(`\n  FATAL  ${err.message}`);
    console.error(err.stack);
  }

  console.log(`\nResults: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

run();
