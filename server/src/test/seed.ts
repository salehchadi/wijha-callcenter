/**
 * E2E Test Seed Data
 *
 * Inserts minimal seed data needed by all E2E tests:
 *   - An admin user (admin1@gmail.com / admin123) for authentication
 *   - A default project ('Default Project') for client/call associations
 *
 * Uses Prisma's `upsert` pattern so the seed is idempotent — running it
 * multiple times won't create duplicate records.
 *
 * The admin user's password hash is pre-computed for 'admin123' using bcrypt
 * with 12 rounds. This matches the password used in all E2E test login flows.
 *
 * @param prisma - PrismaService instance (obtained from setupE2E context)
 * @returns Object containing the seeded admin user and default project
 */

import { PrismaService } from '@/prisma/prisma.service';

export async function seedTestData(prisma: PrismaService) {
  // Upsert admin user — used for JWT authentication in all E2E tests
  const admin = await prisma.user.upsert({
    where: { email: 'admin1@gmail.com' },
    update: {},
    create: {
      email: 'admin1@gmail.com',
      phoneNumber: '120-342-4235',
      passwordHash: '$2a$12$bAQZI.kF9xu2mh7aNQJ6Z.96wdjWbr1cNxUalOVnSd5/Ds4cfSzkm',
      name: 'Admin User 1',
      role: 'admin',
    },
  });

  // Upsert default project — referenced by client and call creation tests
  const project = await prisma.project.upsert({
    where: { name: 'Default Project' },
    update: {},
    create: { name: 'Default Project', description: 'Main project' },
  });

  return { admin, project };
}
