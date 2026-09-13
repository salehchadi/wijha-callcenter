import { Test, TestingModule } from '@nestjs/testing';
import { mockDeep, DeepMockProxy } from 'jest-mock-extended';
import { ClientsController } from './clients.controller';
import { ClientsService } from './clients.service';
import { ClientType } from './dto/client-type.enum';
import { PrismaService } from '@/prisma/prisma.service';
import { mockClient, mockNumber, mockClientInfo, mockProject } from '@/prisma/mock-data';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';

describe('ClientsController', () => {
  let controller: ClientsController;
  let prisma: DeepMockProxy<PrismaService>;

  beforeEach(async () => {
    prisma = mockDeep<PrismaService>();
    prisma.$transaction.mockImplementation(async (cb: any) => cb(prisma));
    prisma.client.findMany.mockResolvedValue([
      mockClient({
        name: 'John Doe',
        numbers: [mockNumber({ number: '555-0100' })],
        clientInfo: [mockClientInfo({ key: 'email', value: 'john@example.com' })],
      }),
      mockClient({ id: 2n, name: 'Jane Smith', numbers: [], clientInfo: [] }),
    ]);
    prisma.client.count.mockResolvedValue(2);
    prisma.client.create.mockResolvedValue(
      mockClient({ id: 3n, name: 'New Client', type: 'LEAD', numbers: [mockNumber({ number: '555-9999' })], clientInfo: [mockClientInfo()] }),
    );
    prisma.client.findUnique.mockResolvedValue(
      mockClient({
        numbers: [mockNumber({ number: '555-0100' })],
        clientInfo: [mockClientInfo({ key: 'email', value: 'john@example.com' })],
      }),
    );
    prisma.client.update.mockResolvedValue(
      mockClient({ type: 'BOTH', numbers: [], clientInfo: [] }),
    );
    prisma.client.findFirst.mockResolvedValue(
      mockClient({
        numbers: [mockNumber({ number: '555-0100' })],
        clientInfo: [mockClientInfo({ key: 'email', value: 'john@example.com' })],
      }),
    );

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ClientsController],
      providers: [
        ClientsService,
        { provide: PrismaService, useValue: prisma },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<ClientsController>(ClientsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('GET /clients', () => {
    it('should return paginated clients', async () => {
      const result = await controller.findAll({});
      expect(result.data).toHaveLength(2);
      expect(result.meta).toHaveProperty('total');
    });

    it('should filter by status', async () => {
      const result = await controller.findAll({ status: 'active' });
      expect(result.data).toHaveLength(2);
    });

    it('should respect pagination params', async () => {
      prisma.client.findMany.mockResolvedValue([
        mockClient({ numbers: [], clientInfo: [] }),
      ]);
      prisma.client.count.mockResolvedValue(1);
      const result = await controller.findAll({ limit: '1', page: '1' });
      expect(result.data).toHaveLength(1);
      expect(result.meta.limit).toBe(1);
    });

    it('should forward agent_id to the service', async () => {
      prisma.client.findMany.mockResolvedValue([]);
      prisma.client.count.mockResolvedValue(0);

      await controller.findAll({ agent_id: '5' });
      expect(prisma.client.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ agentId: 5 }) }),
      );
    });

    it('should not filter by agent when agent_id omitted', async () => {
      await controller.findAll({});
      expect(prisma.client.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.not.objectContaining({ agentId: expect.anything() }) }),
      );
    });
  });

  describe('POST /clients', () => {
    it('should create an client with nested data', async () => {
      const result = await controller.create({
        name: 'New Client',
        project_id: 1,
        phones: [{ phone: '555-9999' }],
        info: [{ key: 'city', value: 'NYC' }],
      });

      expect(result.name).toBe('New Client');
      expect(result.phones).toHaveLength(1);
      expect(result.info).toHaveLength(1);
    });

    it('should create an client with explicit type', async () => {
      prisma.client.create.mockResolvedValue(
        mockClient({ id: 4n, name: 'Lead Client', type: 'LEAD', numbers: [mockNumber({ number: '555-8888' })], clientInfo: [] }),
      );

      const result = await controller.create({
        name: 'Lead Client',
        type: ClientType.LEAD,
        project_id: 1,
        phones: [{ phone: '555-8888' }],
      });

      expect(result.type).toBe('LEAD');
    });

    it('should throw on duplicate create', async () => {
      const { Prisma } = await import('@prisma/client');
      prisma.number.findFirst.mockResolvedValue(null);
      prisma.client.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: '7.8.0',
        }),
      );

      await expect(
        controller.create({
          name: 'Dup Client',
          project_id: 1,
          phones: [{ phone: '555-9999' }],
        }),
      ).rejects.toThrow();
    });
  });

  describe('POST /owners/bulk', () => {
    it('should create multiple clients', async () => {
      prisma.number.findFirst.mockResolvedValue(null);
      prisma.client.create
        .mockResolvedValueOnce(
          mockClient({ id: 3n, name: 'Alice', numbers: [mockNumber({ number: '555-1111' })], clientInfo: [] }),
        )
        .mockResolvedValueOnce(
          mockClient({ id: 4n, name: 'Bob', numbers: [mockNumber({ number: '555-2222' })], clientInfo: [] }),
        );

      const result = await controller.createBulk({
        clients: [
          { name: 'Alice', phones: [{ phone: '555-1111' }], project_id: 1 },
          { name: 'Bob', agent_id: 3, phones: [{ phone: '555-2222' }], project_id: 1 },
        ],
      });

      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('Alice');
      expect(result[1].name).toBe('Bob');
      expect(prisma.client.create).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ data: expect.objectContaining({ agentId: 3 }) }),
      );
    });

    it('should accept deprecated owners alias', async () => {
      prisma.number.findFirst.mockResolvedValue(null);
      prisma.client.create.mockResolvedValue(
        mockClient({ id: 5n, name: 'Alias', numbers: [], clientInfo: [] }),
      );

      const result = await controller.createBulk({
        owners: [{ name: 'Alias', phones: [{ phone: '555-3333' }], project_id: 1 }],
      });

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Alias');
    });

    it('should reject empty bulk payload', async () => {
      await expect(controller.createBulk({})).rejects.toThrow('Provide a non-empty clients array');
    });
  });

  describe('GET /owners/:clientId', () => {
    it('should return client by id', async () => {
      const result = await controller.findOne(1);
      expect(result).not.toBeNull();
      expect(result!.name).toBe('John Doe');
    });

    it('should return null for non-existent', async () => {
      prisma.client.findUnique.mockResolvedValue(null);
      const result = await controller.findOne(999);
      expect(result).toBeNull();
    });
  });

  describe('PATCH /owners/:clientId', () => {
    it('should update client type', async () => {
      prisma.client.findUnique.mockResolvedValue(
        mockClient({ type: 'BOTH', numbers: [], clientInfo: [] }),
      );
      const result = await controller.patch(1, { type: ClientType.BOTH });
      expect(result.type).toBe('BOTH');
    });
  });

  describe('POST /owners/:clientId/projects', () => {
    it('should assign client to a project', async () => {
      prisma.client.findUnique.mockResolvedValue(mockClient({ name: 'John', numbers: [], clientInfo: [] }));
      prisma.project.findFirst.mockResolvedValue(mockProject({ name: 'Default Project' }));
      prisma.clientProject.upsert.mockResolvedValue({ clientId: 1n, projectId: 1, status: 'dial', lastDialedAt: null, attemptCount: 0 });

      const result = await controller.assignProject(1, { project_name: 'Default Project' });
      expect(result).toHaveProperty('id');
      expect(result.name).toBe('John');
    });
  });

  describe('GET /owners/statuses', () => {
    it('should return status counts', async () => {
      (prisma.$queryRaw as jest.Mock).mockResolvedValue([
        { status: 'active', count: 3 },
        { status: 'inactive', count: 1 },
      ]);

      const result = await controller.getStatuses();
      expect(result).toEqual([
        { status: 'active', count: 3 },
        { status: 'inactive', count: 1 },
      ]);
    });
  });

  describe('DELETE /owners/:clientId', () => {
    it('should delete an client', async () => {
      prisma.client.findUnique.mockResolvedValue(mockClient({ name: 'John', numbers: [], clientInfo: [] }));
      prisma.client.delete.mockResolvedValue(mockClient({ name: 'John', numbers: [], clientInfo: [] }));

      await expect(controller.remove(1)).resolves.toBeUndefined();
      expect(prisma.client.delete).toHaveBeenCalledWith({ where: { id: 1 } });
    });
  });
});
