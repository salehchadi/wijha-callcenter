import { Test, TestingModule } from '@nestjs/testing';
import { mockDeep, DeepMockProxy } from 'jest-mock-extended';
import { CallsController } from './calls.controller';
import { CallsService } from './calls.service';
import { ClientsService } from '@/clients/clients.service';
import { ClientType } from '@/clients/dto/client-type.enum';
import { PrismaService } from '@/prisma/prisma.service';
import { mockClient, mockNumber, mockClientInfo, mockCallRecord, mockProject } from '@/prisma/mock-data';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';

const recordWithClient = (overrides: Record<string, unknown> = {}) => ({
  id: 1n,
  clientId: 1n,
  agentId: 1,
  status: 'completed',
  time: new Date('2024-06-01T12:00:00Z'),
  duration: 60,
  agentNotes: null,
  client: {
    id: 1n,
    name: 'John Doe',
    clientProjects: [{ project: { id: 1, name: 'Default Project' } }],
  },
  ...overrides,
});

describe('CallsController', () => {
  let controller: CallsController;
  let prisma: DeepMockProxy<PrismaService>;

  beforeEach(async () => {
    prisma = mockDeep<PrismaService>();

    prisma.callDetailRecord.findMany.mockResolvedValue([
      recordWithClient(),
      recordWithClient({ id: 2n, clientId: 2n, status: 'completed', duration: null, client: { id: 2n, name: 'Jane Smith', clientProjects: [{ project: { id: 2, name: 'Other Project' } }] } }),
      recordWithClient({ id: 3n, clientId: 3n, status: 'pending', duration: null, client: { id: 3n, name: 'Bob Wilson', clientProjects: [] } }),
    ]);
    prisma.callDetailRecord.count.mockResolvedValue(3);
    prisma.callDetailRecord.findUnique.mockResolvedValue(recordWithClient());

    prisma.client.findMany.mockResolvedValue([
      mockClient({
        numbers: [mockNumber({ number: '555-0100' })],
        clientInfo: [mockClientInfo({ key: 'email', value: 'john@example.com' })],
      }),
    ]);

    prisma.callDetailRecord.create.mockResolvedValue(recordWithClient({ id: 4n }));
    prisma.project.findFirst.mockResolvedValue(mockProject());

    (prisma.$transaction as jest.Mock).mockImplementation(async (cb: any) => cb(prisma));

    prisma.$queryRaw.mockResolvedValue([{ id: 1n }]);
    prisma.client.findUnique.mockResolvedValue(
      mockClient({
        numbers: [mockNumber({ number: '555-0100' })],
        clientInfo: [mockClientInfo({ key: 'email', value: 'john@example.com' })],
      }),
    );
    prisma.client.findFirst.mockResolvedValue(
      mockClient({
        numbers: [mockNumber({ number: '555-0100' })],
        clientInfo: [mockClientInfo({ key: 'email', value: 'john@example.com' })],
      }),
    );

    const module: TestingModule = await Test.createTestingModule({
      controllers: [CallsController],
      providers: [
        CallsService,
        ClientsService,
        { provide: PrismaService, useValue: prisma },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<CallsController>(CallsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('GET /calls', () => {
    it('should return all calls', async () => {
      const result = await controller.findAll({});
      expect(result.data).toHaveLength(3);
    });

    it('should filter by client_id', async () => {
      const result = await controller.findAll({ client_id: '1' });
      expect(result.data).toHaveLength(3);
    });

    it('should filter by status', async () => {
      const result = await controller.findAll({ status: 'completed' });
      expect(result.data).toHaveLength(3);
    });

    it('should filter by agent_id', async () => {
      const result = await controller.findAll({ agent_id: '1' });
      expect(result.data).toHaveLength(3);
    });
  });

  describe('POST /calls', () => {
    it('should submit a call', async () => {
      const user = { id: 1, email: 'agent', role: 'user' as const };
      const result = await controller.submit(
        {
          client_id: 1,
          status: 'completed',
          time: '2024-06-01T12:00:00Z',
          duration: 60,
          project_id: 1,
        },
        user,
      );

      expect(result.client_id).toBe(1);
      expect(result.agent_id).toBe(1);
      expect(result.status).toBe('completed');
    });
  });

  describe('GET /calls/next', () => {
    it('should return next client with past calls', async () => {
      prisma.callDetailRecord.findMany.mockResolvedValue([
        mockCallRecord({ id: 1n, clientId: 1n, status: 'completed', time: new Date('2024-05-01T10:00:00Z'), client: { clientProjects: [{ project: { id: 1, name: 'Default Project' } }] } }),
        mockCallRecord({ id: 2n, clientId: 1n, status: 'no_answer', time: new Date('2024-05-02T14:00:00Z'), client: { clientProjects: [{ project: { id: 1, name: 'Default Project' } }] } }),
      ]);

      const result = await controller.getNext({ project_id: '1' }, { id: 1, email: 'a@b.com', role: 'user' });
      expect(result).not.toBeNull();
      expect(result!.client.id).toBe(1);
      expect(result!.client.name).toBe('John Doe');
      expect(result!.client.phones).toHaveLength(1);
      expect(result!.calls).toHaveLength(2);
      expect(result!.calls[0].status).toBe('completed');
    });

    it('should pass date query param to service', async () => {
      prisma.callDetailRecord.findMany.mockResolvedValue([]);

      const result = await controller.getNext({ project_id: '1', date: '2024-06-01' }, { id: 1, email: 'a@b.com', role: 'user' });
      expect(result).not.toBeNull();
    });

    it('should pass requesting agent id when assigned_only=true', async () => {
      const spy = jest.spyOn(ClientsService.prototype, 'getNextClient');

      await controller.getNext(
        { project_id: '1', assigned_only: 'true' },
        { id: 5, email: 'agent@example.com', role: 'user' },
      );

      expect(spy).toHaveBeenCalledWith(expect.objectContaining({ agentId: 5 }));
      spy.mockRestore();
    });

    it('should not scope to agent when assigned_only is absent', async () => {
      const spy = jest.spyOn(ClientsService.prototype, 'getNextClient');

      await controller.getNext(
        { project_id: '1' },
        { id: 5, email: 'agent@example.com', role: 'user' },
      );

      expect(spy).toHaveBeenCalledWith(expect.objectContaining({ agentId: undefined }));
      spy.mockRestore();
    });

    it('should pass type query param to service', async () => {
      const spy = jest.spyOn(ClientsService.prototype, 'getNextClient');

      await controller.getNext(
        { project_id: '1', type: ClientType.OWNER },
        { id: 1, email: 'a@b.com', role: 'user' },
      );

      expect(spy).toHaveBeenCalledWith(expect.objectContaining({ type: ClientType.OWNER }));
      spy.mockRestore();
    });
  });

  describe('GET /calls/statuses', () => {
    it('should return status counts', async () => {
      prisma.callDetailRecord.findMany.mockResolvedValue([
        { status: 'completed' } as any,
        { status: 'no_answer' } as any,
      ]);
      (prisma.callDetailRecord.groupBy as jest.Mock).mockResolvedValue([
        { status: 'completed', _count: 3 },
        { status: 'no_answer', _count: 1 },
      ]);

      const result = await controller.getStatuses({});
      expect(result).toEqual([
        { status: 'completed', count: 3 },
        { status: 'no_answer', count: 1 },
      ]);
    });

    it('should pass from/to query params', async () => {
      prisma.callDetailRecord.findMany.mockResolvedValue([
        { status: 'completed' } as any,
      ]);
      (prisma.callDetailRecord.groupBy as jest.Mock).mockResolvedValue([
        { status: 'completed', _count: 2 },
      ]);

      const result = await controller.getStatuses({ from: '2024-01-01T00:00:00Z', to: '2024-12-31T23:59:59Z' });
      expect(result).toHaveLength(1);
      expect(result[0].status).toBe('completed');
      expect(result[0].count).toBe(2);
    });
  });

  describe('POST /calls/calling', () => {
    it('should notify calling', async () => {
      await expect(
        controller.notifyCalling({ client_id: 1, project_id: 1 }),
      ).resolves.toBeUndefined();
    });

    it('should notify calling with client_number', async () => {
      await expect(
        controller.notifyCalling({ client_id: 1, client_number: '555-0100', project_id: 1 }),
      ).resolves.toBeUndefined();
    });
  });

  describe('GET /calls/:callId', () => {
    it('should return call by id', async () => {
      const result = await controller.findOne(1);
      expect(result).not.toBeNull();
      expect(result!.status).toBe('completed');
    });

    it('should return null for non-existent', async () => {
      prisma.callDetailRecord.findUnique.mockResolvedValue(null);
      const result = await controller.findOne(999);
      expect(result).toBeNull();
    });
  });

  describe('DELETE /calls/:callId', () => {
    it('should delete a call record', async () => {
      prisma.callDetailRecord.findUnique.mockResolvedValue({ id: 1n } as any);
      prisma.projectCallDetailRecord.deleteMany.mockResolvedValue({ count: 0 });
      prisma.callDetailRecord.delete.mockResolvedValue({ id: 1n } as any);

      await expect(controller.remove(1)).resolves.toBeUndefined();
      expect(prisma.projectCallDetailRecord.deleteMany).toHaveBeenCalledWith({ where: { callDetailRecordId: 1 } });
      expect(prisma.callDetailRecord.delete).toHaveBeenCalledWith({ where: { id: 1 } });
    });

    it('should throw NotFoundException for non-existent call', async () => {
      prisma.callDetailRecord.findUnique.mockResolvedValue(null);
      await expect(controller.remove(999)).rejects.toThrow('Call 999 not found');
    });
  });
});
