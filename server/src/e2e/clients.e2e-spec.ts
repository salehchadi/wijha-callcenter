/**
 * Clients (Client) E2E — main coverage layer.
 * Boots the full app against real Postgres and sends real HTTP requests.
 */

import { setupE2E, teardownE2E, TestApp } from '@/test/setup-e2e';
import { seedTestData } from '@/test/seed';
import { cleanupTestData } from '@/test/cleanup';
import { login } from '@/test/e2e-helpers';

describe('Clients E2E', () => {
  let app: TestApp['app'];
  let prisma: TestApp['prisma'];
  let testModule: TestApp['module'];
  let adminToken: string;
  let projectId: number;
  let adminId: number;
  let counter = 0;
  const phone = () => `+2010${(90000000 + counter++).toString().padStart(8, '0')}`;

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
    const admin = await prisma.user.findFirst({ where: { email: 'admin1@gmail.com' } });
    if (!admin) throw new Error('Seed data missing: admin user not found');
    adminId = admin.id;
  });

  afterAll(async () => {
    if (prisma) await cleanupTestData(prisma);
    await teardownE2E({ app, prisma, module: testModule });
  });

  it('POST /clients creates a full client (201)', async () => {
    const res = await app
      .post('/api/v1/clients')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Mohamed Ali',
        project_id: projectId,
        type: 'OWNER',
        agent_id: adminId,
        phones: [{ phone: phone() }],
        info: [{ key: 'city', value: 'Cairo' }],
      })
      .expect(201);
    expect(res.body.name).toBe('Mohamed Ali');
    expect(res.body.type).toBe('OWNER');
    expect(res.body.phones).toHaveLength(1);
    // projects are populated on GET, not on the create response
    const got = await app
      .get(`/api/v1/owners/${res.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(got.body.projects).toHaveLength(1);
    expect(got.body.projects[0].project_id).toBe(projectId);
  });

  it('POST /clients defaults type to UNKNOWN when omitted (201)', async () => {
    const res = await app
      .post('/api/v1/clients')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ phones: [{ phone: phone() }] })
      .expect(201);
    expect(res.body.type).toBe('UNKNOWN');
  });

  it('POST /clients with explicit LEAD type (201)', async () => {
    const res = await app
      .post('/api/v1/clients')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Lead X', type: 'LEAD', phones: [{ phone: phone() }] })
      .expect(201);
    expect(res.body.type).toBe('LEAD');
  });

  it('POST /clients missing phones returns 400', async () => {
    await app
      .post('/api/v1/clients')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'No Phones' })
      .expect(400);
  });

  it('POST /clients invalid EG phone returns 400', async () => {
    await app
      .post('/api/v1/clients')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ phones: [{ phone: '12345' }] })
      .expect(400);
  });

  it('POST /owners/bulk creates many (201)', async () => {
    const res = await app
      .post('/api/v1/owners/bulk')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        clients: [
          { name: 'Bulk A', phones: [{ phone: phone() }] },
          { name: 'Bulk B', phones: [{ phone: phone() }] },
        ],
      })
      .expect(201);
    expect(res.body).toHaveLength(2);
  });

  it('POST /owners/bulk empty array returns 400', async () => {
    await app
      .post('/api/v1/owners/bulk')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ clients: [] })
      .expect(400);
  });

  it('GET /clients returns paginated meta (200)', async () => {
    const res = await app
      .get('/api/v1/clients')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(res.body).toHaveProperty('data');
    expect(res.body).toHaveProperty('meta');
    expect(res.body.meta).toHaveProperty('total');
  });

  it('GET /clients?type=LEAD filters by type (200)', async () => {
    const res = await app
      .get('/api/v1/clients?type=LEAD')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(res.body.data.every((o: any) => o.type === 'LEAD')).toBe(true);
  });

  it('GET /clients?status=dial filters by project status (200)', async () => {
    const res = await app
      .get('/api/v1/clients?status=dial')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
  });

  it('GET /clients?limit=999 caps limit at 100 (200)', async () => {
    const res = await app
      .get('/api/v1/clients?limit=999')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(res.body.meta.limit).toBeLessThanOrEqual(100);
  });

  it('GET /owners/:id returns the client (200)', async () => {
    const created = await app
      .post('/api/v1/clients')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Find Me', phones: [{ phone: phone() }] })
      .expect(201);
    const res = await app
      .get(`/api/v1/owners/${created.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(res.body.id).toBe(created.body.id);
  });

  it('GET /owners/:id not found returns empty body (200)', async () => {
    const res = await app
      .get('/api/v1/owners/999999999')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(res.body).toEqual({});
  });

  it('PATCH /owners/:id updates fields (200)', async () => {
    const created = await app
      .post('/api/v1/clients')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Before', phones: [{ phone: phone() }] })
      .expect(201);
    const res = await app
      .patch(`/api/v1/owners/${created.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'After', type: 'BOTH' })
      .expect(200);
    expect(res.body.name).toBe('After');
    expect(res.body.type).toBe('BOTH');
  });

  it('PATCH /owners/:id not found returns 404', async () => {
    await app
      .patch('/api/v1/owners/999999999')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'X' })
      .expect(404);
  });

  it('POST /owners/:id/projects assigns to project (200)', async () => {
    const created = await app
      .post('/api/v1/clients')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Assignee', phones: [{ phone: phone() }] })
      .expect(201);
    await app
      .post(`/api/v1/owners/${created.body.id}/projects`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ project_name: 'Default Project' })
      .expect(200);
    const got = await app
      .get(`/api/v1/owners/${created.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(got.body.projects.some((p: any) => p.project_name === 'Default Project')).toBe(true);
  });

  it('POST /owners/:id/projects client not found returns 404', async () => {
    await app
      .post('/api/v1/owners/999999999/projects')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ project_name: 'Default Project' })
      .expect(404);
  });

  it('POST /owners/:id/projects project not found returns 404', async () => {
    const created = await app
      .post('/api/v1/clients')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'NoProj', phones: [{ phone: phone() }] })
      .expect(201);
    await app
      .post(`/api/v1/owners/${created.body.id}/projects`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ project_name: 'NoSuchProject' })
      .expect(404);
  });

  it('GET /owners/statuses returns aggregated counts (200)', async () => {
    const res = await app
      .get('/api/v1/owners/statuses')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('duplicate phone merges into existing client (no new row)', async () => {
    const p = phone();
    const first = await app
      .post('/api/v1/clients')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Short', phones: [{ phone: p }] })
      .expect(201);
    const second = await app
      .post('/api/v1/clients')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Much Longer Name', phones: [{ phone: p }] })
      .expect(201);
    // Merged: same id, longer name wins
    expect(second.body.id).toBe(first.body.id);
    expect(second.body.name).toBe('Much Longer Name');
  });

  it('DELETE /owners/:id removes the client (204)', async () => {
    const created = await app
      .post('/api/v1/clients')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Delete Me', phones: [{ phone: phone() }] })
      .expect(201);
    await app
      .delete(`/api/v1/owners/${created.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(204);
    const res = await app
      .get(`/api/v1/owners/${created.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(res.body).toEqual({});
  });

  it('DELETE /owners/:id not found returns 404', async () => {
    await app
      .delete('/api/v1/owners/999999999')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(404);
  });

  it('GET /clients without token returns 401', async () => {
    await app.get('/api/v1/clients').expect(401);
  });
});
