/**
 * Integration Test Helpers
 *
 * Provides setup/teardown functions for integration tests that boot a full
 * NestJS application with mocked PrismaService (no real database needed).
 *
 * Unlike unit tests (which test individual classes with mocked deps) or E2E
 * tests (which use a real database), integration tests exercise the full
 * HTTP request/response cycle — guards, pipes, interceptors, routing —
 * while keeping the data layer mocked for speed and isolation.
 *
 * The helper sets up a dynamic token store so that the login → validate
 * flow works end-to-end: after AuthService.login() stores a JWT in the
 * mock, JwtStrategy.validate() can read it back to authenticate subsequent
 * requests.
 */

import { ValidationPipe, VersioningType } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaExceptionFilter } from '@/common/filters/prisma-exception.filter';
import { mockDeep, DeepMockProxy } from 'jest-mock-extended';
import request from 'supertest';
import { AppModule } from '@/app.module';
import { PrismaService } from '@/prisma/prisma.service';
import { mockUser } from '@/prisma/mock-data';

const TEST_JWT_SECRET = 'test-secret';

// bcrypt hash for 'admin123' — matches the seeded admin user password
const ADMIN123_HASH = '$2a$12$bAQZI.kF9xu2mh7aNQJ6Z.96wdjWbr1cNxUalOVnSd5/Ds4cfSzkm';
// bcrypt hash for 'agent123' — matches the seeded agent user password
const AGENT123_HASH = '$2a$12$iTAykiIcy2J.pDxlrffJ1ODdHFi.vDARoL5BI2qpgStbqYylLJyEq';

/** In-memory user store for the mock PrismaService */
const mockUsers = new Map<number, Record<string, unknown>>();
/** Tracks the current session token for login→validate flow */
let sessionToken: string | null = null;
let nextUserId = 3;

/**
 * Initializes the mock PrismaService with known users and dynamic token storage.
 *
 * After AuthService.login() calls user.update({ data: { jwtToken: token } }),
 * the sessionToken is stored. Subsequent user.findUnique() calls return the
 * user with that token, so JwtStrategy.validate() can authenticate requests.
 *
 * @param prisma - DeepMockProxy<PrismaService> returned by mockDeep()
 */
export function seedMockPrisma(prisma: DeepMockProxy<PrismaService>): void {
  mockUsers.clear();
  sessionToken = null;
  nextUserId = 3;

  mockUsers.set(1, { ...mockUser({ id: 1, email: 'admin1@gmail.com', role: 'admin', passwordHash: ADMIN123_HASH }) });
  mockUsers.set(2, { ...mockUser({ id: 2, email: 'agent1@gmail.com', role: 'user', passwordHash: AGENT123_HASH }) });

  // $transaction: pass the prisma mock itself as the tx parameter
  prisma.$transaction.mockImplementation(async (cb: (tx: DeepMockProxy<PrismaService>) => Promise<unknown>) => {
    return cb(prisma);
  });

  // user.findUnique: used by AuthService.login() and JwtStrategy.validate()
  // Uses dynamic token storage: returns the user with the current sessionToken
  (prisma.user.findUnique as jest.Mock).mockImplementation(async (args: { where: { email?: string; id?: number } }) => {
    const { where } = args;
    if (where.email) {
      for (const u of mockUsers.values()) {
        if (u.email === where.email) {
          return { ...u, jwtToken: sessionToken };
        }
      }
      return null;
    }
    if (where.id) {
      const user = mockUsers.get(where.id);
      return user ? { ...user, jwtToken: sessionToken } : null;
    }
    return null;
  });

  // user.update: used by AuthService.login() to store the JWT token
  (prisma.user.update as jest.Mock).mockImplementation(async (args: { where: { id: number }; data: Record<string, unknown> }) => {
    const { where, data } = args;
    const user = mockUsers.get(where.id);
    if (user) {
      if (data.jwtToken !== undefined) {
        sessionToken = data.jwtToken as string;
      }
      const updated = { ...user, ...data };
      mockUsers.set(where.id, updated);
      return updated;
    }
    return null;
  });

  // user.create: used by AuthService.register() and UsersService.create()
  (prisma.user.create as jest.Mock).mockImplementation(async (args: { data: Record<string, unknown> }) => {
    const user = { ...mockUser({ id: nextUserId++ }), ...args.data };
    mockUsers.set(user.id as number, user);
    return user;
  });

  // user.findMany: used by UsersService.findAll() to list users
  (prisma.user.findMany as jest.Mock).mockImplementation(async () => {
    return Array.from(mockUsers.values()).map((u) => ({ ...u, jwtToken: sessionToken, passwordHash: undefined }));
  });
  prisma.project.findMany.mockResolvedValue([
    { id: 1, name: 'Default Project', description: 'Main project' },
  ]);
  prisma.project.findUnique.mockResolvedValue({ id: 1, name: 'Default Project', description: 'Main project' });
  prisma.project.findFirst.mockResolvedValue({ id: 1, name: 'Default Project', description: 'Main project' });

  prisma.client.findMany.mockResolvedValue([]);
  prisma.client.findUnique.mockResolvedValue(null);
  prisma.client.count.mockResolvedValue(0);

  prisma.callDetailRecord.findMany.mockResolvedValue([]);
  prisma.callDetailRecord.count.mockResolvedValue(0);
  prisma.callDetailRecord.findUnique.mockResolvedValue(null);
  (prisma.callDetailRecord.create as jest.Mock).mockResolvedValue(null);

  prisma.activeSession.findMany.mockResolvedValue([]);

  prisma.userSession.findMany.mockResolvedValue([]);
  prisma.userSession.findFirst.mockResolvedValue(null);
  (prisma.userSession.create as jest.Mock).mockResolvedValue(null);

  (prisma.$queryRaw as jest.Mock).mockResolvedValue([{ version: 'PostgreSQL 16' }]);
}

/**
 * Bootstraps a NestJS application for integration testing.
 *
 * Uses the full AppModule (all controllers, guards, strategies, pipes)
 * but overrides PrismaService with a mock — no real database is needed.
 * The app gets the global prefix 'api' with URI versioning (mirrors main.ts)
 * and a ValidationPipe identical
 * to production configuration.
 *
 * @returns Object with supertest agent, prisma mock, and module for teardown
 */
export async function setupIntegrationTest() {
  process.env.JWT_SECRET = TEST_JWT_SECRET;
  process.env.JWT_EXPIRES_IN = '1d';
  process.env.FRONTEND_URL = 'http://localhost:5173';

  const prisma = mockDeep<PrismaService>();
  seedMockPrisma(prisma);

  const module: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(PrismaService)
    .useValue(prisma)
    .compile();

  const app = module.createNestApplication();
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.useGlobalFilters(new PrismaExceptionFilter());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  await app.init();

  return {
    app: request(app.getHttpServer()) as ReturnType<typeof request>,
    prisma,
    module,
    appInstance: app,
  };
}

/**
 * Tears down the integration test application.
 * Must be called after each test to prevent open handles.
 */
export async function teardownIntegrationTest(module: TestingModule, appInstance: { close: () => Promise<void> }): Promise<void> {
  await appInstance.close();
  await module.close();
}
