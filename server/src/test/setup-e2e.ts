/**
 * E2E Test Harness
 *
 * Provides setupE2E() and teardownE2E() functions for bootstrapping and tearing down
 * a full NestJS application instance for end-to-end testing.
 *
 * The harness:
 *   1. Sets required environment variables (DATABASE_URL, JWT_SECRET, etc.)
 *   2. Creates a NestJS TestingModule from AppModule
 *   3. Creates a Nest application with global prefix 'api' and URI versioning (mirrors main.ts)
 *   4. Connects to PostgreSQL via PrismaService
 *   5. Returns a TestApp object containing:
 *      - app: supertest agent for making HTTP requests
 *      - prisma: PrismaService instance for direct DB access (seeding/cleanup)
 *      - module: TestingModule for graceful teardown
 *
 * Usage in test files:
 *   const ctx = await setupE2E();
 *   const { app, prisma, module: testModule } = ctx;
 *   await teardownE2E({ app, prisma, module: testModule });
 */

import { ValidationPipe, VersioningType } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaExceptionFilter } from '@/common/filters/prisma-exception.filter';
import { PrismaService } from '@/prisma/prisma.service';
import { AppModule } from '@/app.module';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import request from 'supertest';

export interface TestApp {
  app: ReturnType<typeof request>;
  prisma: PrismaService;
  module: TestingModule;
}

export async function setupE2E(): Promise<TestApp> {
  process.env.DATABASE_URL = 'postgresql://myuser:mypassword@localhost:5432/mydb';
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
  process.env.JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '1d';
  process.env.PORT = process.env.PORT || '3001';
  process.env.FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
      const adapter = new PrismaPg(pool);
      const tempPrisma = new PrismaClient({ adapter });
      await tempPrisma.$connect();
      await tempPrisma.$queryRaw`SELECT 1`;
      await tempPrisma.$disconnect();
      await pool.end();
      break;
    } catch (error) {
      if (attempt === 3) {
        console.error('Failed to connect to PostgreSQL after 3 attempts.');
        console.error('Make sure PostgreSQL is running at localhost:5432 and database "mydb" exists.');
        console.error('Start it with: docker compose up -d db');
        throw error;
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  const module: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

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

  const prisma = module.get<PrismaService>(PrismaService);
  await prisma.$connect();

  return {
    app: request(app.getHttpServer()),
    prisma,
    module,
  };
}

/**
 * Tears down the E2E test application.
 *
 * Disconnects from the database and closes the NestJS module to prevent
 * open handles and connection leaks. Always pass the real module reference
 * obtained from setupE2E() — never pass an empty object.
 *
 * @param ctx - The TestApp from setupE2E()
 */
export async function teardownE2E(ctx: TestApp): Promise<void> {
  await ctx.prisma.$disconnect();
  await ctx.module.close();
}
