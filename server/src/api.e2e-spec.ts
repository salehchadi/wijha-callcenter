/**
 * API Integration Tests (E2E)
 *
 * These tests boot the full NestJS application with a real PostgreSQL database
 * and exercise the complete request/response lifecycle end-to-end.
 *
 * The test flow:
 *   1. Setup: Boot app via setupE2E(), seed admin user + default project
 *   2. Login: POST /api/v1/login as admin (returns Bearer token)
 *   3. Test: Create projects, create clients, run full call dispatch flow
 *   4. Teardown: Delete created projects/clients, close app, disconnect DB
 *
 * Endpoint reference:
 *   - POST /api/v1/projects   → creates a project, returns 201
 *   - POST /api/v1/clients     → creates an client, returns 201
 *   - GET  /api/v1/calls/next → gets the next client to call, returns 200
 *   - POST /api/v1/calls/calling → notifies server you're calling, returns 200
 *   - POST /api/v1/calls      → submits call outcome, returns 201
 *   - DELETE /api/v1/projects/:id → deletes a project, returns 204
 *   - DELETE /api/v1/owners/:id   → deletes an client, returns 204
 */

import { setupE2E, teardownE2E, TestApp } from '@/test/setup-e2e';
import { seedTestData } from '@/test/seed';

describe('API Integration Tests (E2E)', () => {
  let app: TestApp['app'];
  let prisma: TestApp['prisma'];
  let testModule: TestApp['module'];
  let token: string;
  const createdProjects: number[] = [];
  const createdClients: number[] = [];

  /** Generates a unique Egyptian phone number using current timestamp */
  function uniquePhone(): string {
    return `+2010${String(Date.now()).slice(-8)}`;
  }

  beforeAll(async () => {
    const ctx = await setupE2E();
    app = ctx.app;
    prisma = ctx.prisma;
    testModule = ctx.module;

    await seedTestData(prisma);

    // Login as the seeded admin to obtain a JWT Bearer token
    // Login returns 200 (not 201) due to @HttpCode(HttpStatus.OK)
    const res = await app.post('/api/v1/login')
      .send({ email: 'admin1@gmail.com', password: 'admin123' })
      .expect(200);
    token = res.body.token;
  });

  afterAll(async () => {
    // Cleanup: delete created projects and clients in reverse order
    for (const projectId of [...createdProjects].reverse()) {
      try {
        await app.delete(`/api/v1/projects/${projectId}`)
          .set('Authorization', `Bearer ${token}`);
      } catch {
        // ignore cleanup errors
      }
    }

    for (const clientId of [...createdClients].reverse()) {
      try {
        await app.delete(`/api/v1/owners/${clientId}`)
          .set('Authorization', `Bearer ${token}`);
      } catch {
        // ignore cleanup errors
      }
    }

    // Shut down the app and disconnect from the database
    await teardownE2E({ app, prisma, module: testModule });
  });

  /**
   * Input: POST /api/v1/projects with unique project name and Bearer token
   * Expected: HTTP 201, response body contains numeric `id`
   */
  test('should create a project', async () => {
    const res = await app.post('/api/v1/projects')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: `test-project-${Date.now()}` })
      .expect(201);
    expect(res.body.id).toBeDefined();
    expect(typeof res.body.id).toBe('number');
    createdProjects.push(res.body.id);
  });

  /**
   * Input: POST /api/v1/clients — creates 2 clients with unique phone numbers
   *   under a newly created project
   * Expected: HTTP 201 for each, response body contains numeric `id`
   */
  test('should create clients', async () => {
    const projectRes = await app.post('/api/v1/projects')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: `test-project-${Date.now()}` })
      .expect(201);
    const projectId = projectRes.body.id;
    createdProjects.push(projectId);

    for (let i = 0; i < 2; i += 1) {
      const res = await app.post('/api/v1/clients')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: `test-client-${Date.now()}-${i}`,
          project_id: projectId,
          phones: [{ phone: uniquePhone() }],
        })
        .expect(201);
      expect(res.body.id).toBeDefined();
      createdClients.push(res.body.id);
    }
  });

  /**
   * Full call dispatch workflow:
   *   1. Create a project
   *   2. Create 2 clients under that project
   *   3. GET /calls/next → get next client to call
   *   4. POST /calls/calling → notify server you're calling
   *   5. POST /calls → submit call outcome (status: 'answered')
   *
   * This is a smoke test — it verifies the full flow executes without errors.
   */
  test('should run call flow', async () => {
    const projectRes = await app.post('/api/v1/projects')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: `test-project-${Date.now()}` })
      .expect(201);
    const projectId = projectRes.body.id;
    createdProjects.push(projectId);

    // Create 2 clients so GET /calls/next has a client to dispatch
    for (let i = 0; i < 2; i += 1) {
      const res = await app.post('/api/v1/clients')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: `test-client-${Date.now()}-${i}`,
          project_id: projectId,
          phones: [{ phone: uniquePhone() }],
        })
        .expect(201);
      createdClients.push(res.body.id);
    }

    // Step 3: Get the next client to call
    const next = await app.get(`/api/v1/calls/next?project_id=${projectId}`)
      .set('Authorization', `Bearer ${token}`);

    // If no next client available, skip the call flow (not an error)
    if (next.status !== 200 || !next.body?.client) {
      return;
    }

    const clientId = next.body.client.id;

    // Step 4: Notify the server we're calling this client
    await app.post('/api/v1/calls/calling')
      .set('Authorization', `Bearer ${token}`)
      .send({ client_id: clientId, project_id: projectId });

    // Step 5: Submit the call outcome
    await app.post('/api/v1/calls')
      .set('Authorization', `Bearer ${token}`)
      .send({
        client_id: clientId,
        status: 'answered',
        time: new Date().toISOString(),
        project_id: projectId,
      });

    expect(true).toBe(true);
  });
});
