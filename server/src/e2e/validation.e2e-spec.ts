/**
 * Validation E2E Tests
 *
 * End-to-end tests for input validation via the global ValidationPipe.
 * The pipe is configured with `whitelist: true`, `forbidNonWhitelisted: true`,
 * and `transform: true`, meaning:
 *   - Unknown properties are stripped (whitelist) and rejected (forbidNonWhitelisted)
 *   - Payload is transformed to match DTO types (transform)
 *
 * Prerequisites:
 *   - Same as auth.e2e-spec.ts (PostgreSQL + seed data)
 *   - Login with admin1@gmail.com / admin123 to obtain Bearer token
 *
 * Test coverage:
 *   - POST /owners without phones (required field) → 400
 *   - PATCH /owners/:id with invalid type (non-string) → 400
 *   - GET /calls/next with type=BOTH → 200
 *   - POST /calls without required client_id → 400
 *   - POST /users with duplicate email → 409
 */

import { setupE2E, teardownE2E, TestApp } from '@/test/setup-e2e';
import { seedTestData } from '@/test/seed';
import { cleanupTestData } from '@/test/cleanup';

describe('Validation E2E', () => {
  let app: TestApp['app'];
  let prisma: TestApp['prisma'];
  let testModule: TestApp['module'];
  let token: string;

  beforeAll(async () => {
    const ctx = await setupE2E();
    app = ctx.app;
    prisma = ctx.prisma;
    testModule = ctx.module;
    await seedTestData(prisma);

    // Login as admin to get a Bearer token for authenticated requests
    // Login endpoint returns 200 (NOT 201) due to @HttpCode(HttpStatus.OK)
    const res = await app.post('/api/v1/login')
      .send({ email: 'admin1@gmail.com', password: 'admin123' })
      .expect(200);
    token = res.body.token;
  });

  afterAll(async () => {
    if (prisma) await cleanupTestData(prisma);
    await teardownE2E({ app, prisma, module: testModule });
  });

  /**
   * Input: POST /api/v1/owners with body missing required 'phones' field
   *   (CreateClientDto requires phones with @ArrayMinSize(1))
   * Expected: HTTP 400 — ValidationPipe rejects missing required field
   */
  it('POST /api/v1/owners without phones returns 400', async () => {
    await app.post('/api/v1/owners')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'No Phones' })
      .expect(400);
  });

  /**
   * Input: PATCH /api/v1/owners/:id with body { type: 123 }
   *   (UpdateClientDto.type expects @IsString, number fails validation)
   * Expected: HTTP 400 — ValidationPipe rejects non-string type
   */
  it('PATCH /api/v1/owners/:id with invalid type returns 400', async () => {
    // First, create a client to have a valid ID for the PATCH
    const clientRes = await app.post('/api/v1/owners')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Test Client',
        project_id: 1,
        phones: [{ phone: '+201012345678' }],
      })
      .expect(201);
    const clientId = clientRes.body.id;

    // Send invalid type (number instead of string) — should be rejected by ValidationPipe
    await app.patch(`/api/v1/owners/${clientId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 123 })
      .expect(400);
  });

  /**
   * Input: GET /api/v1/calls/next?project_id=1&type=BOTH with valid Bearer token
   * Expected: HTTP 200 — valid query params, returns next client to call
   */
  it('GET /api/v1/calls/next with type=BOTH returns 200', async () => {
    await app.get('/api/v1/calls/next?project_id=1&type=BOTH')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
  });

  /**
   * Input: POST /api/v1/calls with body { status: 'completed' }
   *   (SubmitCallDto requires client_id and time fields)
   * Expected: HTTP 400 — ValidationPipe rejects missing required fields
   */
  it('POST /api/v1/calls without client_id returns 400', async () => {
    await app.post('/api/v1/calls')
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'completed' })
      .expect(400);
  });

  /**
   * Input: POST /api/v1/users with duplicate email 'admin1@gmail.com' (already seeded)
   *   and password of 8 characters (meets @MinLength(6) requirement)
   * Expected: HTTP 409 — Prisma unique constraint violation on email field
   */
  it('POST /api/v1/users with duplicate email returns 409', async () => {
    await app.post('/api/v1/users')
      .set('Authorization', `Bearer ${token}`)
      .send({ email: 'admin1@gmail.com', password: 'password', role: 'user' })
      .expect(409);
  });
});
