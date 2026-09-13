import { Test, TestingModule } from '@nestjs/testing';
import { mockDeep, DeepMockProxy } from 'jest-mock-extended';
import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CallsService } from './calls.service';
import { ClientsService } from '@/clients/clients.service';
import { PrismaService } from '@/prisma/prisma.service';
import { mockCallRecord, mockProject, mockClient } from '@/prisma/mock-data';

const withProjects = (overrides: Record<string, unknown> = {}) => ({
  client: {
    clientProjects: [
      { project: { id: 1, name: 'Default Project' } },
    ],
  },
  ...overrides,
});

describe('CallsService', () => {
  let service: CallsService;
  let prisma: DeepMockProxy<PrismaService>;
  let clientsService: ClientsService;

  beforeEach(async () => {
    prisma = mockDeep<PrismaService>();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CallsService,
        { provide: PrismaService, useValue: prisma },
        ClientsService,
      ],
    }).compile();

    service = module.get<CallsService>(CallsService);
    prisma = module.get(PrismaService);
    clientsService = module.get<ClientsService>(ClientsService);

    prisma.project.findFirst.mockResolvedValue(mockProject());
    prisma.client.findUnique.mockResolvedValue(mockClient({ id: 1n }));
    prisma.client.findFirst.mockResolvedValue(mockClient({ id: 1n }));
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findAll', () => {
    it('should return all calls', async () => {
      prisma.callDetailRecord.findMany.mockResolvedValue([
        mockCallRecord({ duration: 120, ...withProjects() }),
        mockCallRecord({ id: 2n, status: 'no_answer', duration: null, ...withProjects() }),
      ]);
      prisma.callDetailRecord.count.mockResolvedValue(2);

      const result = await service.findAll({});
      expect(result.data).toHaveLength(2);
      expect(result.meta.total).toBe(2);
      expect(result.data[0].projects).toEqual([{ id: 1, name: 'Default Project' }]);
    });

    it('should filter by client_id', async () => {
      prisma.callDetailRecord.findMany.mockResolvedValue([
        mockCallRecord({ ...withProjects() }),
      ]);
      prisma.callDetailRecord.count.mockResolvedValue(1);

      const result = await service.findAll({ client_id: 1 });
      expect(result.data).toHaveLength(1);
      expect(result.data[0].client_id).toBe(1);
    });

    it('should filter by status', async () => {
      prisma.callDetailRecord.findMany.mockResolvedValue([]);
      prisma.callDetailRecord.count.mockResolvedValue(0);

      const result = await service.findAll({ status: 'busy' });
      expect(result.data).toHaveLength(0);
    });

    it('should filter by from/to date range', async () => {
      const from = new Date('2024-01-01');
      const to = new Date('2024-12-31');
      prisma.callDetailRecord.findMany.mockResolvedValue([mockCallRecord({ ...withProjects() })]);
      prisma.callDetailRecord.count.mockResolvedValue(1);

      const result = await service.findAll({ from, to });
      expect(result.data).toHaveLength(1);
      expect(prisma.callDetailRecord.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            time: { gte: from, lte: to },
          }),
        }),
      );
    });

    it('should filter by agent_id', async () => {
      prisma.callDetailRecord.findMany.mockResolvedValue([
        mockCallRecord({ agentId: 2, ...withProjects() }),
      ]);
      prisma.callDetailRecord.count.mockResolvedValue(1);

      const result = await service.findAll({ agent_id: 2 });
      expect(result.data).toHaveLength(1);
      expect(prisma.callDetailRecord.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ agentId: 2 }),
        }),
      );
    });

    it('should filter by project_id through client projects', async () => {
      prisma.callDetailRecord.findMany.mockResolvedValue([mockCallRecord({ ...withProjects() })]);
      prisma.callDetailRecord.count.mockResolvedValue(1);

      const result = await service.findAll({ project_id: 1 });
      expect(result.data).toHaveLength(1);
      expect(prisma.callDetailRecord.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            client: { clientProjects: { some: { projectId: 1 } } },
          }),
        }),
      );
    });
  });

  describe('findById', () => {
    it('should return call by id', async () => {
      prisma.callDetailRecord.findUnique.mockResolvedValue(mockCallRecord({ ...withProjects() }));
      const call = await service.findById(1);
      expect(call).not.toBeNull();
      expect(call!.status).toBe('completed');
      expect(call!.projects).toEqual([{ id: 1, name: 'Default Project' }]);
    });

    it('should return null for non-existent id', async () => {
      prisma.callDetailRecord.findUnique.mockResolvedValue(null);
      expect(await service.findById(999)).toBeNull();
    });
  });

  describe('submit', () => {
    it('should create a new call record', async () => {
      prisma.callDetailRecord.create.mockResolvedValue(
        mockCallRecord({ id: 4n, status: 'busy', duration: 30 }),
      );

      const call = await service.submit(
        { client_id: 1, status: 'busy', time: '2024-06-01T12:00:00Z', duration: 30, agent_notes: 'Line busy', project_id: 1 },
        1,
      );
      expect(call.status).toBe('busy');
      expect(call.agent_id).toBe(1);
      expect(call.projects).toEqual([]);
    });

    it('should throw BadRequestException when project does not exist', async () => {
      prisma.project.findFirst.mockResolvedValue(null);
      const createSpy = jest.spyOn(prisma.callDetailRecord, 'create');

      await expect(
        service.submit(
          { client_id: 1, status: 'done', time: '2026-08-12T11:56:47.216Z', project_id: 1 },
          1,
        ),
      ).rejects.toThrow(BadRequestException);

      expect(createSpy).not.toHaveBeenCalled();
    });

    it('should handle optional fields', async () => {
      prisma.callDetailRecord.create.mockResolvedValue(
        mockCallRecord({ id: 5n, clientId: 2n, agentId: 2, status: 'no_answer', duration: null }),
      );

      const call = await service.submit(
        { client_id: 2, status: 'no_answer', time: '2024-06-01T12:00:00Z', project_id: 1 },
        2,
      );
      expect(call.duration).toBeNull();
      expect(call.agent_notes).toBeNull();
      expect(call.projects).toEqual([]);
    });

    it('should update ClientProject status and lastDialedAt', async () => {
      prisma.callDetailRecord.create.mockResolvedValue(
        mockCallRecord({ id: 6n, status: 'answered' }),
      );

      await service.submit(
        { client_id: 1, status: 'answered', time: '2024-06-01T12:00:00Z', project_id: 1 },
        1,
      );

      expect(prisma.clientProject.upsert).toHaveBeenCalledWith({
        where: { clientId_projectId: { clientId: 1, projectId: 1 } },
        create: {
          clientId: 1,
          projectId: 1,
          status: 'answered',
          lastDialedAt: expect.any(Date),
        },
        update: { status: 'answered', lastDialedAt: expect.any(Date) },
      });
    });

    it('should create ClientProject when none exists for the client/project pair', async () => {
      prisma.callDetailRecord.create.mockResolvedValue(
        mockCallRecord({ id: 15n, status: 'done' }),
      );

      await service.submit(
        { client_id: 1, status: 'done', time: '2024-06-01T12:00:00Z', project_id: 1 },
        1,
      );

      expect(prisma.clientProject.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { clientId_projectId: { clientId: 1, projectId: 1 } },
          create: expect.objectContaining({ status: 'done' }),
        }),
      );
    });

    it('should set Client.nextDialAt to null for non-callback status without next_dial_at', async () => {
      prisma.callDetailRecord.create.mockResolvedValue(
        mockCallRecord({ id: 7n, status: 'no_answer' }),
      );

      await service.submit(
        { client_id: 1, status: 'no_answer', time: '2024-06-01T12:00:00Z', project_id: 1 },
        1,
      );

      expect(prisma.client.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { nextDialAt: null },
      });
    });

    it('should set Client.nextDialAt to callback time when status is callback', async () => {
      prisma.callDetailRecord.create.mockResolvedValue(
        mockCallRecord({ id: 8n, status: 'callback' }),
      );
      const callbackTime = '2024-06-05T14:00:00Z';

      await service.submit(
        { client_id: 1, status: 'callback', time: '2024-06-01T12:00:00Z', project_id: 1, next_dial_at: callbackTime },
        1,
      );

      expect(prisma.client.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { nextDialAt: new Date(callbackTime) },
      });
    });

    it('should remove client from dispatch pool when status is not_interested', async () => {
      prisma.callDetailRecord.create.mockResolvedValue(
        mockCallRecord({ id: 9n, status: 'not_interested' }),
      );
      const updateSpy = jest.spyOn(clientsService, 'update');

      await service.submit(
        { client_id: 1, status: 'not_interested', time: '2024-06-01T12:00:00Z', project_id: 1 },
        1,
      );

      expect(prisma.clientProject.upsert).toHaveBeenCalledWith({
        where: { clientId_projectId: { clientId: 1, projectId: 1 } },
        create: {
          clientId: 1,
          projectId: 1,
          status: 'not_interested',
          lastDialedAt: expect.any(Date),
        },
        update: { status: 'not_interested', lastDialedAt: expect.any(Date) },
      });
      expect(updateSpy).not.toHaveBeenCalled();
    });

    it('should remove client from dispatch pool when status is contacted', async () => {
      prisma.callDetailRecord.create.mockResolvedValue(
        mockCallRecord({ id: 10n, status: 'contacted' }),
      );
      const updateSpy = jest.spyOn(clientsService, 'update');

      await service.submit(
        { client_id: 1, status: 'contacted', time: '2024-06-01T12:00:00Z', project_id: 1 },
        1,
      );

      expect(prisma.clientProject.upsert).toHaveBeenCalledWith({
        where: { clientId_projectId: { clientId: 1, projectId: 1 } },
        create: {
          clientId: 1,
          projectId: 1,
          status: 'contacted',
          lastDialedAt: expect.any(Date),
        },
        update: { status: 'contacted', lastDialedAt: expect.any(Date) },
      });
      expect(updateSpy).not.toHaveBeenCalled();
    });

    it('should NOT mark client inactive for other statuses', async () => {
      prisma.callDetailRecord.create.mockResolvedValue(
        mockCallRecord({ id: 11n, status: 'busy' }),
      );
      const updateSpy = jest.spyOn(clientsService, 'update');

      await service.submit(
        { client_id: 1, status: 'busy', time: '2024-06-01T12:00:00Z', project_id: 1 },
        1,
      );

      expect(updateSpy).not.toHaveBeenCalled();
    });

    it('should submit without project_id', async () => {
      prisma.callDetailRecord.create.mockResolvedValue(
        mockCallRecord({ id: 12n, status: 'answered' }),
      );

      const call = await service.submit(
        { client_id: 1, status: 'answered', time: '2024-06-01T12:00:00Z' },
        1,
      );
      expect(call.status).toBe('answered');
      expect(prisma.project.findFirst).not.toHaveBeenCalled();
      expect(prisma.clientProject.upsert).not.toHaveBeenCalled();
    });

    it('should set Client.nextDialAt to null when next_dial_at is not provided', async () => {
      prisma.callDetailRecord.create.mockResolvedValue(
        mockCallRecord({ id: 13n, status: 'busy' }),
      );

      await service.submit(
        { client_id: 1, status: 'busy', time: '2024-06-01T12:00:00Z' },
        1,
      );

      expect(prisma.client.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { nextDialAt: null },
      });
    });

    it('should set Client.nextDialAt to provided next_dial_at value', async () => {
      prisma.callDetailRecord.create.mockResolvedValue(
        mockCallRecord({ id: 14n, status: 'callback' }),
      );
      const callbackTime = '2024-06-05T14:00:00Z';

      await service.submit(
        { client_id: 1, status: 'callback', time: '2024-06-01T12:00:00Z', next_dial_at: callbackTime },
        1,
      );

      expect(prisma.client.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { nextDialAt: new Date(callbackTime) },
      });
    });
  });

  describe('getNextClient', () => {
    it('should return client with past calls', async () => {
      jest.spyOn(clientsService, 'getNextClient').mockResolvedValue({
        id: 1,
        name: 'John Doe',
        next_dial_at: null,
        phones: [{ phone: '555-0100' }],
        info: [{ key: 'email', value: 'john@example.com' }],
      });

      prisma.callDetailRecord.findMany.mockResolvedValue([
        mockCallRecord({ id: 1n, clientId: 1n, status: 'completed', time: new Date('2024-05-01T10:00:00Z'), ...withProjects() }),
      ]);

      const result = await service.getNextClient({ projectId: 1 });
      expect(result).not.toBeNull();
      expect(result!.client.name).toBe('John Doe');
      expect(result!.calls).toHaveLength(1);
      expect(result!.calls[0].status).toBe('completed');
      expect(result!.calls[0].projects).toEqual([{ id: 1, name: 'Default Project' }]);
    });

    it('should return null when no client available', async () => {
      jest.spyOn(clientsService, 'getNextClient').mockResolvedValue(null);
      const result = await service.getNextClient({ projectId: 1 });
      expect(result).toBeNull();
    });

    it('should pass date filter to clientsService', async () => {
      const date = new Date('2024-06-01');
      const getNextClientSpy = jest.spyOn(clientsService, 'getNextClient').mockResolvedValue({
        id: 1,
        name: 'Scheduled Client',
        next_dial_at: date.toISOString(),
        phones: [],
        info: [],
      });

      prisma.callDetailRecord.findMany.mockResolvedValue([]);

      const result = await service.getNextClient({ projectId: 1, date });
      expect(result).not.toBeNull();
      expect(getNextClientSpy).toHaveBeenCalledWith({ projectId: 1, date });
    });

    it('should forward agentId to clientsService', async () => {
      const getNextClientSpy = jest.spyOn(clientsService, 'getNextClient').mockResolvedValue({
        id: 1,
        name: 'Assigned Client',
        next_dial_at: null,
        agent_id: 4,
        phones: [],
        info: [],
      });

      prisma.callDetailRecord.findMany.mockResolvedValue([]);

      const result = await service.getNextClient({ projectId: 1, agentId: 4 });
      expect(result).not.toBeNull();
      expect(getNextClientSpy).toHaveBeenCalledWith({ projectId: 1, agentId: 4 });
    });

    it('should forward type to clientsService', async () => {
      const getNextClientSpy = jest.spyOn(clientsService, 'getNextClient').mockResolvedValue({
        id: 1,
        name: 'Client Client',
        next_dial_at: null,
        phones: [],
        info: [],
      });

      prisma.callDetailRecord.findMany.mockResolvedValue([]);

      const result = await service.getNextClient({ projectId: 1, type: 'OWNER' });
      expect(result).not.toBeNull();
      expect(getNextClientSpy).toHaveBeenCalledWith({ projectId: 1, type: 'OWNER' });
    });
  });

  describe('getStatusCounts', () => {
    it('should return distinct normalized statuses with counts', async () => {
      prisma.callDetailRecord.findMany.mockResolvedValue([
        { status: 'completed' } as any,
        { status: 'no_answer' } as any,
        { status: ' busy ' } as any,
        { status: 'COMPLETED' } as any,
      ]);
      (prisma.callDetailRecord.groupBy as jest.Mock).mockResolvedValue([
        { status: 'completed', _count: 5 },
        { status: 'no_answer', _count: 3 },
        { status: ' busy ', _count: 2 },
        { status: 'COMPLETED', _count: 1 },
      ]);

      const result = await service.getStatusCounts();
      expect(result).toEqual([
        { status: 'busy', count: 2 },
        { status: 'completed', count: 6 },
        { status: 'no_answer', count: 3 },
      ]);
    });

    it('should filter counts by time range', async () => {
      prisma.callDetailRecord.findMany.mockResolvedValue([
        { status: 'completed' } as any,
        { status: 'no_answer' } as any,
      ]);
      (prisma.callDetailRecord.groupBy as jest.Mock).mockResolvedValue([
        { status: 'completed', _count: 2 },
      ]);

      const from = new Date('2024-01-01');
      const to = new Date('2024-12-31');
      const result = await service.getStatusCounts(from, to);

      expect(result).toEqual([
        { status: 'completed', count: 2 },
        { status: 'no_answer', count: 0 },
      ]);
      expect(prisma.callDetailRecord.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            time: { gte: from, lte: to },
          }),
        }),
      );
    });

    it('should return empty array when no records exist', async () => {
      prisma.callDetailRecord.findMany.mockResolvedValue([] as any);
      (prisma.callDetailRecord.groupBy as jest.Mock).mockResolvedValue([]);

      const result = await service.getStatusCounts();
      expect(result).toEqual([]);
    });
  });

  describe('notifyCalling', () => {
    it('should not throw', async () => {
      await expect(
        service.notifyCalling({ client_id: 1, client_number: '555-0100', project_id: 1 }),
      ).resolves.toBeUndefined();
    });

    it('should throw BadRequestException when project does not exist', async () => {
      prisma.project.findFirst.mockResolvedValue(null);
      const createSpy = jest.spyOn(prisma.callDetailRecord, 'create');
      const upsertSpy = jest.spyOn(prisma.clientProject, 'upsert');

      await expect(
        service.notifyCalling({ client_id: 1, project_id: 1 }),
      ).rejects.toThrow(BadRequestException);

      expect(upsertSpy).not.toHaveBeenCalled();
    });

    it('should update Client.nextDialAt', async () => {
      await service.notifyCalling({ client_id: 1, project_id: 1 });

      expect(prisma.client.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { nextDialAt: expect.any(Date) },
      });
    });

    it('should update ClientProject lastDialedAt and increment attemptCount', async () => {
      await service.notifyCalling({ client_id: 1, project_id: 1 });

      expect(prisma.clientProject.upsert).toHaveBeenCalledWith({
        where: { clientId_projectId: { clientId: 1, projectId: 1 } },
        create: {
          clientId: 1,
          projectId: 1,
          status: 'dial',
          attemptCount: 1,
          lastDialedAt: expect.any(Date),
        },
        update: { lastDialedAt: expect.any(Date), attemptCount: { increment: 1 } },
      });
    });

    it('should ignore client_number and update by client_id directly', async () => {
      await service.notifyCalling({ client_id: 1, client_number: '555-0100', project_id: 1 });

      expect(prisma.client.findFirst).not.toHaveBeenCalled();
      expect(prisma.client.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { nextDialAt: expect.any(Date) },
      });
    });

    it('should propagate P2025 for non-existent client (mapped to 404 by PrismaExceptionFilter)', async () => {
      prisma.client.update.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('No record was found for an update.', {
          code: 'P2025',
          clientVersion: '7.8.0',
        }),
      );

      await expect(service.notifyCalling({ client_id: 999 })).rejects.toMatchObject({ code: 'P2025' });
    });

    it('should notify calling without project_id', async () => {
      await service.notifyCalling({ client_id: 1 });

      expect(prisma.client.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { nextDialAt: expect.any(Date) },
      });
      expect(prisma.project.findFirst).not.toHaveBeenCalled();
      expect(prisma.clientProject.upsert).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('should delete a call record and its project associations', async () => {
      prisma.callDetailRecord.findUnique.mockResolvedValue({ id: 1n } as any);
      prisma.projectCallDetailRecord.deleteMany.mockResolvedValue({ count: 0 });
      prisma.callDetailRecord.delete.mockResolvedValue({ id: 1n } as any);

      await service.remove(1);

      expect(prisma.projectCallDetailRecord.deleteMany).toHaveBeenCalledWith({ where: { callDetailRecordId: 1 } });
      expect(prisma.callDetailRecord.delete).toHaveBeenCalledWith({ where: { id: 1 } });
    });

    it('should throw NotFoundException for non-existent call', async () => {
      prisma.callDetailRecord.findUnique.mockResolvedValue(null);
      await expect(service.remove(999)).rejects.toThrow('Call 999 not found');
    });

    it('should delete call even when it has no project associations', async () => {
      prisma.callDetailRecord.findUnique.mockResolvedValue({ id: 2n } as any);
      prisma.projectCallDetailRecord.deleteMany.mockResolvedValue({ count: 0 });
      prisma.callDetailRecord.delete.mockResolvedValue({ id: 2n } as any);

      await service.remove(2);

      expect(prisma.projectCallDetailRecord.deleteMany).toHaveBeenCalledWith({ where: { callDetailRecordId: 2 } });
      expect(prisma.callDetailRecord.delete).toHaveBeenCalledWith({ where: { id: 2 } });
    });
  });
});
