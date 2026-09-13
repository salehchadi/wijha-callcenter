/**
 * Calls E2E — main coverage layer.
 * Exercises the real DB including the raw-SQL next-client dispatch query.
 */

import { setupE2E, teardownE2E, TestApp } from '@/test/setup-e2e';
import { seedTestData } from '@/test/seed';
import { cleanupTestData } from '@/test/cleanup';
import { login } from '@/test/e2e-helpers';

describe('Calls E2E', () => {
  let app: TestApp['app'];
  let prisma: TestApp['prisma'];
  let testModule: TestApp['module'];
  let adminToken: string;
  let projectId: number;
  let clientId: number;
  let clientPhone: string;
  let counter = 0;
  const phone = () => `+2011${(90000000 + counter++).toString().padStart(8, '0')}`;

  beforeAll(async () => {
    const ctx = await setupE2E();
    app = ctx.app;
    prisma = ctx.prisma;
    testModule = ctx.module;
    await seedTestData(prisma);
    adminToken = await login(app, 'admin1@gmail.com', 'admin123');
    const project = await prisma.project.findFirst({ where: { name: 'Default Project' } });
    if (!project) throw new Error('Seed data missing: Default Project not found');
    projectId = project.id;
    clientPhone = phone();
    const client = await app
      .post('/api/v1/owners')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Call Client',
        project_id: projectId,
        phones: [{ phone: clientPhone }],
      })
      .expect(201);
    clientId = client.body.id;
  });

  afterAll(async () => {
    if (prisma) await cleanupTestData(prisma);
    await teardownE2E({ app, prisma, module: testModule });
  });

  it('GET /calls returns list with meta (200)', async () => {
    const res = await app
      .get('/api/v1/calls')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(res.body).toHaveProperty('data');
    expect(res.body).toHaveProperty('meta');
  });

  it('GET /calls?client_id filters (200)', async () => {
    await app
      .get(`/api/v1/calls?client_id=${clientId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
  });

  it('GET /calls?status filters (200)', async () => {
    await app
      .get('/api/v1/calls?status=completed')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
  });

  it('GET /calls?project_id filters via client projects (200)', async () => {
    await app
      .get(`/api/v1/calls?project_id=${projectId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
  });

  it('GET /calls?from&to date range (200)', async () => {
    await app
      .get('/api/v1/calls?from=2026-01-01T00:00:00Z&to=2026-12-31T23:59:59Z')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
  });

  it('POST /calls submits a call and updates pipeline (201)', async () => {
    const res = await app
      .post('/api/v1/calls')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        client_id: clientId,
        status: 'completed',
        time: '2026-08-28T10:00:00Z',
        project_id: projectId,
        duration: 120,
        agent_notes: 'Left voicemail',
      })
      .expect(201);
    expect(res.body.client_id).toBe(clientId);
    expect(res.body.status).toBe('completed');

    const client = await app
      .get(`/api/v1/owners/${clientId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(client.body.projects[0].status).toBe('completed');
  });

  it('POST /calls with unknown project returns 400', async () => {
    await app
      .post('/api/v1/calls')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        client_id: clientId,
        status: 'busy',
        time: '2026-08-28T10:00:00Z',
        project_id: 999999,
      })
      .expect(400);
  });

  it('POST /calls missing required fields returns 400', async () => {
    await app
      .post('/api/v1/calls')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'busy' })
      .expect(400);
  });

  it('POST /calls invalid time returns 400', async () => {
    await app
      .post('/api/v1/calls')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ client_id: clientId, status: 'busy', time: 'not-a-date' })
      .expect(400);
  });

  it('POST /calls with non-existent client returns 404', async () => {
    await app
      .post('/api/v1/calls')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ client_id: 999999, status: 'busy', time: '2026-08-28T10:00:00Z' })
      .expect(404);
  });

  it('POST /calls/calling with non-existent client returns 404', async () => {
    await app
      .post('/api/v1/calls/calling')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ client_id: 999999 })
      .expect(404);
  });

  it('POST /calls/calling ignores client_number and updates by client_id (200)', async () => {
    await app
      .post('/api/v1/calls/calling')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ client_id: clientId, client_number: '+201000000000' })
      .expect(200);
  });

  it('GET /calls/next returns the next dialable client (200)', async () => {
    // Create a fresh dialable client (status 'dial', next_dial_at null)
    const dialPhone = phone();
    const client = await app
      .post('/api/v1/owners')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Dialable', project_id: projectId, phones: [{ phone: dialPhone }] })
      .expect(201);

    const res = await app
      .get(`/api/v1/calls/next?project_id=${projectId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(res.body).not.toBeNull();
    expect(res.body.client.id).toBe(client.body.id);
    expect(Array.isArray(res.body.calls)).toBe(true);
  });

  it('GET /calls/next?project_id with no match returns empty body (200)', async () => {
    const res = await app
      .get('/api/v1/calls/next?project_id=999999')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(res.body).toEqual({});
  });

  it('GET /calls/next?assigned_only=true restricts to agent (200)', async () => {
    await app
      .get(`/api/v1/calls/next?assigned_only=true&project_id=${projectId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
  });

  it('GET /calls/statuses aggregates (200)', async () => {
    const res = await app
      .get('/api/v1/calls/statuses')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('GET /calls/statuses?from&to filters range (200)', async () => {
    await app
      .get('/api/v1/calls/statuses?from=2026-01-01T00:00:00Z&to=2026-12-31T23:59:59Z')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
  });

  it('POST /calls/calling notifies and increments attempts (200)', async () => {
    await app
      .post('/api/v1/calls/calling')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ client_id: clientId, project_id: projectId })
      .expect(200);
    const client = await app
      .get(`/api/v1/owners/${clientId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(client.body.projects[0].attempt_count).toBeGreaterThanOrEqual(1);
  });

  it('POST /calls/calling with client_number (200)', async () => {
    await app
      .post('/api/v1/calls/calling')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ client_id: clientId, client_number: clientPhone })
      .expect(200);
  });

  it('GET /calls/:id returns a call (200)', async () => {
    const list = await app
      .get('/api/v1/calls')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    if (list.body.data.length > 0) {
      const id = list.body.data[0].id;
      const res = await app
        .get(`/api/v1/calls/${id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(res.body.id).toBe(id);
    }
  });

  it('GET /calls/:id not found returns empty body (200)', async () => {
    const res = await app
      .get('/api/v1/calls/999999999')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(res.body).toEqual({});
  });

  it('GET /calls without token returns 401', async () => {
    await app.get('/api/v1/calls').expect(401);
  });
});
