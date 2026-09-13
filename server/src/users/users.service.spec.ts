import { Test, TestingModule } from '@nestjs/testing';
import { mockDeep, DeepMockProxy } from 'jest-mock-extended';
import { Prisma } from '@prisma/client';
import { UsersService } from './users.service';
import { PrismaService } from '@/prisma/prisma.service';
import { SessionsService } from '@/sessions/sessions.service';
import { mockUser, mockCallRecord } from '@/prisma/mock-data';

describe('UsersService', () => {
  let service: UsersService;
  let prisma: DeepMockProxy<PrismaService>;
  let sessionsService: DeepMockProxy<SessionsService>;

  beforeEach(async () => {
    prisma = mockDeep<PrismaService>();
    sessionsService = mockDeep<SessionsService>();
    prisma.$transaction.mockImplementation(async (cb: any) => cb(prisma));
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: prisma },
        { provide: SessionsService, useValue: sessionsService },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
    prisma = module.get(PrismaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findAll', () => {
    it('should return all users when no role filter', async () => {
      prisma.user.findMany.mockResolvedValue([
        mockUser({ id: 1, email: 'agent', name: 'Agent' }),
        mockUser({ id: 2, email: 'admin', name: 'Admin', role: 'admin' }),
      ]);
      prisma.activeSession.findMany.mockResolvedValue([
        { agentId: 1, firstBeat: new Date() },
      ]);
      const users = await service.findAll();
      expect(users).toHaveLength(2);
      expect(users[0].is_online).toBe(true);
      expect(users[1].is_online).toBe(false);
    });

    it('should filter by role', async () => {
      prisma.user.findMany.mockResolvedValue([
        mockUser({ id: 2, email: 'admin', name: 'Admin', role: 'admin' }),
      ]);
      prisma.activeSession.findMany.mockResolvedValue([]);
      const admins = await service.findAll('admin');
      expect(admins).toHaveLength(1);
      expect(admins[0].role).toBe('admin');
      expect(admins[0].is_online).toBe(false);
    });

    it('should filter by online=true', async () => {
      prisma.user.findMany.mockResolvedValue([
        mockUser({ id: 1, email: 'agent', name: 'Agent' }),
        mockUser({ id: 2, email: 'admin', name: 'Admin', role: 'admin' }),
      ]);
      prisma.activeSession.findMany.mockResolvedValue([
        { agentId: 1, firstBeat: new Date() },
      ]);
      const users = await service.findAll(undefined, 'true');
      expect(users).toHaveLength(1);
      expect(users[0].id).toBe(1);
      expect(users[0].is_online).toBe(true);
    });

    it('should filter by online=false', async () => {
      prisma.user.findMany.mockResolvedValue([
        mockUser({ id: 1, email: 'agent', name: 'Agent' }),
        mockUser({ id: 2, email: 'admin', name: 'Admin', role: 'admin' }),
      ]);
      prisma.activeSession.findMany.mockResolvedValue([
        { agentId: 1, firstBeat: new Date() },
      ]);
      const users = await service.findAll(undefined, 'false');
      expect(users).toHaveLength(1);
      expect(users[0].id).toBe(2);
      expect(users[0].is_online).toBe(false);
    });
  });

  describe('findById', () => {
    it('should return user by id', async () => {
      prisma.user.findUnique.mockResolvedValue(mockUser({ email: 'agent', name: 'Agent' }));
      prisma.activeSession.findUnique.mockResolvedValue({ agentId: 1, firstBeat: new Date() });
      const user = await service.findById(1);
      expect(user).not.toBeNull();
      expect(user!.email).toBe('agent');
      expect(user!.is_online).toBe(true);
    });

    it('should return null for non-existent id', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      expect(await service.findById(999)).toBeNull();
    });
  });

  describe('create', () => {
    it('should create a new user', async () => {
      prisma.user.create.mockResolvedValue(mockUser({ id: 3, email: 'newuser@test.com', name: 'New User', phoneNumber: '555-0000' }));
      const user = await service.create({
        email: 'newuser@test.com',
        password: 'password123',
        name: 'New User',
        phone: '555-0000',
        role: 'user',
      });
      expect(user.id).toBe(3);
      expect(user.email).toBe('newuser@test.com');
      expect(user.is_online).toBe(false);
    });

    it('should throw ConflictException for duplicate email', async () => {
      const prismaError = new (require('@prisma/client').Prisma.PrismaClientKnownRequestError)(
        'Unique constraint failed', { code: 'P2002', clientVersion: '7.8.0' },
      );
      prisma.user.create.mockRejectedValue(prismaError);

      await expect(
        service.create({ email: 'agent', password: 'password123', role: 'user' }),
      ).rejects.toThrow('Email already exists');
    });
  });

  describe('createBulk', () => {
    it('should create multiple users', async () => {
      prisma.user.findMany.mockResolvedValue([]);
      prisma.user.create
        .mockResolvedValueOnce(
          mockUser({ id: 3, email: 'alice@test.com', name: 'Alice' }),
        )
        .mockResolvedValueOnce(
          mockUser({ id: 4, email: 'bob@test.com', name: 'Bob' }),
        );

      const users = await service.createBulk([
        { email: 'alice@test.com', password: 'pass123', name: 'Alice', role: 'user' },
        { email: 'bob@test.com', password: 'pass456', name: 'Bob', role: 'user' },
      ]);

      expect(users).toHaveLength(2);
      expect(users[0].email).toBe('alice@test.com');
      expect(users[0].is_online).toBe(false);
      expect(users[1].email).toBe('bob@test.com');
      expect(users[1].is_online).toBe(false);
    });

    it('should throw ConflictException when any email is duplicate', async () => {
      prisma.user.findMany.mockResolvedValue([
        { email: 'alice@test.com' } as any,
      ]);

      await expect(
        service.createBulk([
          { email: 'alice@test.com', password: 'pass123', name: 'Alice', role: 'user' },
          { email: 'bob@test.com', password: 'pass456', name: 'Bob', role: 'user' },
        ]),
      ).rejects.toThrow('Duplicate emails: alice@test.com');
    });

    it('should not create any users when duplicate email exists', async () => {
      prisma.user.findMany.mockResolvedValue([
        { email: 'alice@test.com' } as any,
      ]);

      await expect(
        service.createBulk([
          { email: 'alice@test.com', password: 'pass123', name: 'Alice', role: 'user' },
          { email: 'bob@test.com', password: 'pass456', name: 'Bob', role: 'user' },
        ]),
      ).rejects.toThrow('Duplicate emails');

      expect(prisma.user.create).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('should update user fields', async () => {
      prisma.user.findUnique.mockResolvedValue(mockUser({ email: 'agent', name: 'Agent' }));
      prisma.user.update.mockResolvedValue(mockUser({ email: 'agent', name: 'Updated Name' }));
      const updated = await service.update(1, { name: 'Updated Name' });
      expect(updated.name).toBe('Updated Name');
      expect(updated.is_online).toBe(false);
    });

    it('should propagate P2025 for non-existent id (mapped to 404 by PrismaExceptionFilter)', async () => {
      prisma.user.update.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('No record was found for an update.', {
          code: 'P2025',
          clientVersion: '7.8.0',
        }),
      );
      await expect(service.update(999, { name: 'Nope' })).rejects.toMatchObject({ code: 'P2025' });
    });

    it('should update role when allowRoleChange is true (admin)', async () => {
      prisma.user.findUnique.mockResolvedValue(mockUser());
      prisma.user.update.mockResolvedValue(mockUser({ role: 'admin' }));

      await service.update(1, { role: 'admin' }, true);

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ role: 'admin' }),
        }),
      );
    });

    it('should ignore role when allowRoleChange is false (self)', async () => {
      prisma.user.findUnique.mockResolvedValue(mockUser());
      prisma.user.update.mockResolvedValue(mockUser());

      await service.update(1, { role: 'admin', name: 'Self' }, false);

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.not.objectContaining({ role: 'admin' }),
        }),
      );
    });
  });

  describe('deactivate', () => {
    it('should deactivate existing user', async () => {
      prisma.user.findUnique.mockResolvedValue(mockUser());
      prisma.user.update.mockResolvedValue(mockUser({ role: 'deactivated' }));
      const result = await service.deactivate(1);
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 1 },
          data: { role: 'deactivated', passwordHash: '!deactivated!' },
        }),
      );
      expect(result.role).toBe('deactivated');
      expect(result.is_online).toBe(false);
    });

    it('should propagate P2025 for non-existent user (mapped to 404 by PrismaExceptionFilter)', async () => {
      prisma.user.update.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('No record was found for an update.', {
          code: 'P2025',
          clientVersion: '7.8.0',
        }),
      );
      await expect(service.deactivate(999)).rejects.toMatchObject({ code: 'P2025' });
    });
  });

  describe('getStats', () => {
    it('should return stats for existing user', async () => {
      prisma.user.findUnique.mockResolvedValue(mockUser({ email: 'agent', name: 'Agent' }));
      prisma.callDetailRecord.findMany.mockResolvedValue([
        mockCallRecord({ status: 'completed', duration: 120 }),
        mockCallRecord({ id: 2n, status: 'no_answer', duration: null }),
      ]);
      sessionsService.findAll.mockResolvedValue([
        {
          agent_id: 1,
          first_beat: '2024-06-01T09:00:00.000Z',
          last_beat: '2024-06-01T10:00:00.000Z',
          is_active: false,
          duration: 3600,
        },
      ]);

      const stats = await service.getStats(1);
      expect(stats).not.toBeNull();
      expect(stats!.total_calls).toBe(2);
      expect(stats!.answered).toBe(1);
      expect(stats!.no_answer).toBe(1);
      expect(stats!.avg_duration_seconds).toBe(60);
      expect(stats!.total_session_time_seconds).toBe(3600);
    });

    it('should return null for non-existent user', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      expect(await service.getStats(999)).toBeNull();
    });
  });

  describe('uploadProfileImage', () => {
    it('should upload image and set has_profile_image to true', async () => {
      const buffer = Buffer.from('fake-image-data');
      const mime = 'image/jpeg';
      prisma.user.findUnique.mockResolvedValue(mockUser());
      prisma.user.update.mockResolvedValue(mockUser({ profileImage: buffer, profileMime: mime }));
      prisma.activeSession.findUnique.mockResolvedValue(null);

      const result = await service.uploadProfileImage(1, buffer, mime);
      expect(result.has_profile_image).toBe(true);
    });

    it('should propagate P2025 for non-existent user (mapped to 404 by PrismaExceptionFilter)', async () => {
      prisma.user.update.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('No record was found for an update.', {
          code: 'P2025',
          clientVersion: '7.8.0',
        }),
      );
      await expect(
        service.uploadProfileImage(999, Buffer.from('x'), 'image/jpeg'),
      ).rejects.toMatchObject({ code: 'P2025' });
    });
  });

  describe('getProfileImage', () => {
    it('should return image data and mime type', async () => {
      const buffer = Buffer.from('fake-image-data');
      prisma.user.findUnique.mockResolvedValue({ profileImage: buffer, profileMime: 'image/jpeg' } as any);

      const result = await service.getProfileImage(1);
      expect(result).not.toBeNull();
      expect(result!.data).toEqual(buffer);
      expect(result!.mime).toBe('image/jpeg');
    });

    it('should return null when user has no image', async () => {
      prisma.user.findUnique.mockResolvedValue({ profileImage: null, profileMime: null } as any);
      expect(await service.getProfileImage(1)).toBeNull();
    });

    it('should return null when profileImage exists but profileMime is null', async () => {
      prisma.user.findUnique.mockResolvedValue({ profileImage: Buffer.from('x'), profileMime: null } as any);
      expect(await service.getProfileImage(1)).toBeNull();
    });
  });

  describe('deleteProfileImage', () => {
    it('should delete image and set has_profile_image to false', async () => {
      prisma.user.findUnique.mockResolvedValue(mockUser({ profileImage: Buffer.from('x'), profileMime: 'image/jpeg' }));
      prisma.user.update.mockResolvedValue(mockUser({ profileImage: null, profileMime: null }));
      prisma.activeSession.findUnique.mockResolvedValue(null);

      const result = await service.deleteProfileImage(1);
      expect(result.has_profile_image).toBe(false);
    });

    it('should propagate P2025 for non-existent user (mapped to 404 by PrismaExceptionFilter)', async () => {
      prisma.user.update.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('No record was found for an update.', {
          code: 'P2025',
          clientVersion: '7.8.0',
        }),
      );
      await expect(service.deleteProfileImage(999)).rejects.toMatchObject({ code: 'P2025' });
    });
  });
});

