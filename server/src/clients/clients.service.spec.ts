import { Test, TestingModule } from '@nestjs/testing';
import { mockDeep, DeepMockProxy } from 'jest-mock-extended';
import { ClientsService } from './clients.service';
import { ClientType } from './dto/client-type.enum';
import { PrismaService } from '@/prisma/prisma.service';
import { mockClient, mockNumber, mockClientInfo, mockProject } from '@/prisma/mock-data';

describe('ClientsService', () => {
  let service: ClientsService;
  let prisma: DeepMockProxy<PrismaService>;

  beforeEach(async () => {
    prisma = mockDeep<PrismaService>();
    prisma.$transaction.mockImplementation(async (cb: any) => cb(prisma));
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClientsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<ClientsService>(ClientsService);
    prisma = module.get(PrismaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findAll', () => {
    it('should return paginated clients', async () => {
      prisma.client.findMany.mockResolvedValue([
        mockClient({ name: 'John', numbers: [mockNumber()], clientInfo: [mockClientInfo({ key: 'city', value: 'NYC' })] }),
      ]);
      prisma.client.count.mockResolvedValue(1);

      const result = await service.findAll();
      expect(result.data).toHaveLength(1);
      expect(result.meta.total).toBe(1);
    });

    it('should filter by type', async () => {
      prisma.client.findMany.mockResolvedValue([]);
      prisma.client.count.mockResolvedValue(0);

      const result = await service.findAll(undefined, 'OWNER');
      expect(result.data).toHaveLength(0);
      expect(result.meta.total).toBe(0);
    });

    it('should filter by type and project_id combined', async () => {
      prisma.client.findMany.mockResolvedValue([]);
      prisma.client.count.mockResolvedValue(0);

      const result = await service.findAll(1, 'LEAD');
      expect(result.data).toHaveLength(0);
      expect(prisma.client.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { type: 'LEAD', clientProjects: { some: { projectId: 1 } } },
        }),
      );
    });

    it('should filter by project_id', async () => {
      prisma.client.findMany.mockResolvedValue([
        mockClient({ name: 'Project Client', numbers: [], clientInfo: [] }),
      ]);
      prisma.client.count.mockResolvedValue(1);

      const result = await service.findAll(1);
      expect(result.data).toHaveLength(1);
      expect(prisma.client.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            clientProjects: { some: { projectId: 1 } },
          }),
        }),
      );
    });

    it('should filter by agent_id', async () => {
      prisma.client.findMany.mockResolvedValue([]);
      prisma.client.count.mockResolvedValue(0);

      const result = await service.findAll(undefined, undefined, undefined, 1, 20, 5);
      expect(result.data).toHaveLength(0);
      expect(prisma.client.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ agentId: 5 }),
        }),
      );
    });

    it('should omit agent filter when agent_id is not provided', async () => {
      prisma.client.findMany.mockResolvedValue([]);
      prisma.client.count.mockResolvedValue(0);

      await service.findAll();
      expect(prisma.client.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.not.objectContaining({ agentId: expect.anything() }),
        }),
      );
    });
  });

  describe('findById', () => {
    it('should return client with nested relations', async () => {
      prisma.client.findUnique.mockResolvedValue(
        mockClient({
          name: 'John Doe',
          numbers: [mockNumber({ number: '555-0100' }), mockNumber({ number: '555-0101' })],
          clientInfo: [mockClientInfo({ key: 'company', value: 'Acme Corp' })],
        }),
      );

      const client = await service.findById(1);
      expect(client).not.toBeNull();
      expect(client!.name).toBe('John Doe');
      expect(client!.phones).toHaveLength(2);
      expect(client!.info).toHaveLength(1);
    });

    it('should return null for non-existent id', async () => {
      prisma.client.findUnique.mockResolvedValue(null);
      expect(await service.findById(999)).toBeNull();
    });
  });

  describe('create', () => {
    it('should create client with numbers and info', async () => {
      prisma.number.findFirst.mockResolvedValue(null);
      prisma.client.create.mockResolvedValue(
        mockClient({
          id: 3n, name: 'Test Client',
          numbers: [mockNumber({ number: '555-9999' })],
          clientInfo: [mockClientInfo({ key: 'city', value: 'NYC' })],
        }),
      );

      const client = await service.create({
        name: 'Test Client',
        project_id: 1,
        phones: [{ phone: '555-9999' }],
        info: [{ key: 'city', value: 'NYC' }],
      });
      expect(client.name).toBe('Test Client');
      expect(client.phones).toEqual([{ phone: '555-9999' }]);
      expect(client.info).toEqual([{ key: 'city', value: 'NYC' }]);
    });

    it('should default type to UNKNOWN', async () => {
      prisma.number.findFirst.mockResolvedValue(null);
      prisma.client.create.mockResolvedValue(mockClient({ id: 3n, name: 'No Status', type: null as unknown as string, numbers: [], clientInfo: [] }));

      const client = await service.create({
        name: 'No Status', project_id: 1, phones: [{ phone: '555-0000' }],
      });
      expect(client.type).toBe(ClientType.UNKNOWN);
      expect(prisma.client.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ type: null }) }),
      );
    });

    it('should accept explicit type LEAD', async () => {
      prisma.number.findFirst.mockResolvedValue(null);
      prisma.client.create.mockResolvedValue(
        mockClient({ id: 4n, name: 'Lead Client', type: ClientType.LEAD, numbers: [mockNumber({ number: '555-1111' })], clientInfo: [] }),
      );

      const client = await service.create({
        name: 'Lead Client', type: ClientType.LEAD, project_id: 1, phones: [{ phone: '555-1111' }],
      });
      expect(client.type).toBe('LEAD');
    });

    it('should accept explicit type BOTH', async () => {
      prisma.number.findFirst.mockResolvedValue(null);
      prisma.client.create.mockResolvedValue(
        mockClient({ id: 5n, name: 'Both Client', type: ClientType.BOTH, numbers: [mockNumber({ number: '555-2222' })], clientInfo: [] }),
      );

      const client = await service.create({
        name: 'Both Client', type: ClientType.BOTH, project_id: 1, phones: [{ phone: '555-2222' }],
      });
      expect(client.type).toBe('BOTH');
    });

    it('should merge into existing client when number already exists (longer name wins)', async () => {
      const existingClient = mockClient({
        id: 2n, name: 'Existing Jane',
        numbers: [mockNumber({ number: '555-9999' })],
        clientInfo: [],
      });
      prisma.number.findFirst.mockResolvedValue({
        number: '555-9999',
        clientId: 2n,
        client: existingClient,
      } as any);
      prisma.client.update.mockResolvedValue(
        mockClient({
          id: 2n, name: 'Existing Jane',
          numbers: [mockNumber({ number: '555-9999' })],
          clientInfo: [],
        }),
      );

      const result = await service.create({
        name: 'New Guy',
        project_id: 1,
        phones: [{ phone: '555-9999' }],
      });

      expect(result.name).toBe('Existing Jane');
      expect(prisma.client.create).not.toHaveBeenCalled();
      expect(prisma.client.update).toHaveBeenCalled();
    });

    it('should replace name when new name is longer', async () => {
      const existingClient = mockClient({
        id: 2n, name: 'Short',
        numbers: [mockNumber({ number: '555-9999' })],
        clientInfo: [],
      });
      prisma.number.findFirst.mockResolvedValue({
        number: '555-9999',
        clientId: 2n,
        client: existingClient,
      } as any);
      prisma.client.update.mockResolvedValue(
        mockClient({
          id: 2n, name: 'Much Longer Name',
          numbers: [mockNumber({ number: '555-9999' })],
          clientInfo: [],
        }),
      );

      const result = await service.create({
        name: 'Much Longer Name',
        project_id: 1,
        phones: [{ phone: '555-9999' }],
      });

      expect(result.name).toBe('Much Longer Name');
      expect(prisma.client.update).toHaveBeenCalled();
    });

    it('should fill name when existing name is null', async () => {
      const existingClient = mockClient({
        id: 2n, name: null,
        numbers: [mockNumber({ number: '555-9999' })],
        clientInfo: [],
      });
      prisma.number.findFirst.mockResolvedValue({
        number: '555-9999',
        clientId: 2n,
        client: existingClient,
      } as any);
      prisma.client.update.mockResolvedValue(
        mockClient({
          id: 2n, name: 'New Name',
          numbers: [mockNumber({ number: '555-9999' })],
          clientInfo: [],
        }),
      );

      const result = await service.create({
        name: 'New Name',
        project_id: 1,
        phones: [{ phone: '555-9999' }],
      });

      expect(result.name).toBe('New Name');
    });

    it('should add new numbers and info when merging', async () => {
      const existingClient = mockClient({
        id: 2n, name: 'Existing',
        numbers: [mockNumber({ number: '555-0001' })],
        clientInfo: [mockClientInfo({ key: 'city', value: 'NYC' })],
      });
      prisma.number.findFirst.mockResolvedValue({
        number: '555-0001',
        clientId: 2n,
        client: existingClient,
      } as any);
      prisma.client.update.mockResolvedValue(
        mockClient({
          id: 2n, name: 'Existing',
          numbers: [
            mockNumber({ number: '555-0001' }),
            mockNumber({ number: '555-0002' }),
          ],
          clientInfo: [
            mockClientInfo({ key: 'city', value: 'NYC' }),
            mockClientInfo({ key: 'email', value: 'a@b.com' }),
          ],
        }),
      );

      const result = await service.create({
        name: 'Existing',
        project_id: 1,
        phones: [{ phone: '555-0001' }, { phone: '555-0002' }],
        info: [{ key: 'email', value: 'a@b.com' }],
      });

      expect(result.phones).toHaveLength(2);
      expect(result.info).toHaveLength(2);
    });

    it('should assign agent_id on create', async () => {
      prisma.number.findFirst.mockResolvedValue(null);
      prisma.client.create.mockResolvedValue(
        mockClient({ id: 8n, name: 'Assigned', agentId: 5, numbers: [mockNumber({ number: '555-5555' })], clientInfo: [] }),
      );

      await service.create({
        name: 'Assigned',
        agent_id: 5,
        phones: [{ phone: '555-5555' }],
      });

      expect(prisma.client.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ agentId: 5 }),
        }),
      );
    });

    it('should set agent_id when merging an existing client', async () => {
      const existingClient = mockClient({
        id: 2n, name: 'Existing',
        numbers: [mockNumber({ number: '555-9999' })],
        clientInfo: [],
      });
      prisma.number.findFirst.mockResolvedValue({
        number: '555-9999',
        clientId: 2n,
        client: existingClient,
      } as any);
      prisma.client.update.mockResolvedValue(
        mockClient({
          id: 2n, name: 'Existing', agentId: 7,
          numbers: [mockNumber({ number: '555-9999' })],
          clientInfo: [],
        }),
      );

      await service.create({
        name: 'Existing',
        agent_id: 7,
        phones: [{ phone: '555-9999' }],
      });

      expect(prisma.client.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ agentId: 7 }),
        }),
      );
      expect(prisma.client.create).not.toHaveBeenCalled();
    });
  });

  describe('createBulk', () => {
    it('should create multiple clients', async () => {
      prisma.number.findFirst.mockResolvedValue(null);
      prisma.client.create
        .mockResolvedValueOnce(
          mockClient({ id: 3n, name: 'Alice', numbers: [mockNumber({ number: '555-1111' })], clientInfo: [] }),
        )
        .mockResolvedValueOnce(
          mockClient({ id: 4n, name: 'Bob', numbers: [mockNumber({ number: '555-2222' })], clientInfo: [] }),
        );

      const results = await service.createBulk([
        { name: 'Alice', phones: [{ phone: '555-1111' }], project_id: 1 },
        { name: 'Bob', phones: [{ phone: '555-2222' }], project_id: 1 },
      ]);

      expect(results).toHaveLength(2);
      expect(results[0].name).toBe('Alice');
      expect(results[1].name).toBe('Bob');
    });

    it('should merge when duplicate number appears later in bulk', async () => {
      prisma.number.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          number: '555-1111',
          clientId: 3n,
          client: mockClient({ id: 3n, name: 'Alice', numbers: [mockNumber({ number: '555-1111' })], clientInfo: [] }),
        } as any);

      prisma.client.create.mockResolvedValue(
        mockClient({ id: 3n, name: 'Alice', numbers: [mockNumber({ number: '555-1111' })], clientInfo: [] }),
      );
      prisma.client.update.mockResolvedValue(
        mockClient({
          id: 3n, name: 'Alice',
          numbers: [mockNumber({ number: '555-1111' }), mockNumber({ number: '555-3333' })],
          clientInfo: [],
        }),
      );

      const results = await service.createBulk([
        { name: 'Alice', phones: [{ phone: '555-1111' }], project_id: 1 },
        { name: 'Alice Extended', phones: [{ phone: '555-1111' }, { phone: '555-3333' }], project_id: 1 },
      ]);

      expect(results).toHaveLength(2);
      expect(results[1].name).toBe('Alice');
      expect(results[1].phones).toHaveLength(2);
    });

    it('should rollback when an error occurs', async () => {
      prisma.number.findFirst.mockResolvedValue(null);
      prisma.client.create
        .mockResolvedValueOnce(
          mockClient({ id: 3n, name: 'Alice', numbers: [mockNumber({ number: '555-1111' })], clientInfo: [] }),
        )
        .mockRejectedValueOnce(new Error('DB error'));

      await expect(
        service.createBulk([
          { name: 'Alice', phones: [{ phone: '555-1111' }], project_id: 1 },
          { name: 'Bob', phones: [{ phone: '555-2222' }], project_id: 1 },
        ]),
      ).rejects.toThrow('DB error');
    });

    it('should accept type field in each entry', async () => {
      prisma.number.findFirst.mockResolvedValue(null);
      prisma.client.create
        .mockResolvedValueOnce(
          mockClient({ id: 6n, name: 'Lead One', type: 'LEAD', numbers: [mockNumber({ number: '555-3333' })], clientInfo: [] }),
        )
        .mockResolvedValueOnce(
          mockClient({ id: 7n, name: 'Client One', type: 'OWNER', numbers: [mockNumber({ number: '555-4444' })], clientInfo: [] }),
        );

      const results = await service.createBulk([
        { name: 'Lead One', type: ClientType.LEAD, phones: [{ phone: '555-3333' }], project_id: 1 },
        { name: 'Client One', phones: [{ phone: '555-4444' }], project_id: 1 },
      ]);

      expect(results).toHaveLength(2);
      expect(results[0].type).toBe('LEAD');
      expect(results[1].type).toBe('OWNER');
    });

    it('should assign agent_id per client in bulk', async () => {
      prisma.number.findFirst.mockResolvedValue(null);
      prisma.client.create
        .mockResolvedValueOnce(
          mockClient({ id: 3n, name: 'Alice', agentId: 1, numbers: [mockNumber({ number: '555-1111' })], clientInfo: [] }),
        )
        .mockResolvedValueOnce(
          mockClient({ id: 4n, name: 'Bob', agentId: 2, numbers: [mockNumber({ number: '555-2222' })], clientInfo: [] }),
        );

      await service.createBulk([
        { name: 'Alice', agent_id: 1, phones: [{ phone: '555-1111' }], project_id: 1 },
        { name: 'Bob', agent_id: 2, phones: [{ phone: '555-2222' }], project_id: 1 },
      ]);

      expect(prisma.client.create).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ data: expect.objectContaining({ agentId: 1 }) }),
      );
      expect(prisma.client.create).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ data: expect.objectContaining({ agentId: 2 }) }),
      );
    });
  });

  describe('assignToProject', () => {
    it('should assign client to a project', async () => {
      const client = mockClient({ name: 'John', numbers: [], clientInfo: [] });
      prisma.client.findUnique.mockResolvedValue(client);
      prisma.project.findFirst.mockResolvedValue(mockProject({ name: 'Default Project' }));
      prisma.clientProject.upsert.mockResolvedValue({ clientId: 1n, projectId: 1, status: 'dial', lastDialedAt: null, attemptCount: 0 });

      const result = await service.assignToProject(1, 'Default Project');
      expect(result.name).toBe('John');
    });

    it('should throw NotFoundException when client does not exist', async () => {
      prisma.client.findUnique.mockResolvedValue(null);

      await expect(service.assignToProject(999, 'Default Project')).rejects.toThrow('Client not found');
    });

    it('should throw NotFoundException when project does not exist', async () => {
      prisma.client.findUnique.mockResolvedValue(mockClient({ name: 'John', numbers: [], clientInfo: [] }));
      prisma.project.findFirst.mockResolvedValue(null);

      await expect(service.assignToProject(1, 'NoProject')).rejects.toThrow('Project "NoProject" not found');
    });

    it('should upsert ClientProject with default status and attemptCount', async () => {
      prisma.client.findUnique.mockResolvedValue(mockClient({ name: 'John', numbers: [], clientInfo: [] }));
      prisma.project.findFirst.mockResolvedValue(mockProject({ name: 'Default Project' }));
      prisma.clientProject.upsert.mockResolvedValue({ clientId: 1n, projectId: 1, status: 'dial', lastDialedAt: null, attemptCount: 0 });

      await service.assignToProject(1, 'Default Project');

      expect(prisma.clientProject.upsert).toHaveBeenCalledWith({
        where: { clientId_projectId: { clientId: 1, projectId: 1 } },
        create: { clientId: 1, projectId: 1, status: 'dial', attemptCount: 0 },
        update: {},
      });
    });
  });

  describe('update', () => {
    it('should update client fields', async () => {
      prisma.client.findUnique.mockResolvedValue(mockClient({ name: 'John', numbers: [], clientInfo: [] }));
      prisma.client.update.mockResolvedValue(mockClient({ name: 'John', type: 'LEAD', numbers: [], clientInfo: [] }));

      const updated = await service.update(1, { type: ClientType.LEAD });
      expect(updated.type).toBe('LEAD');
    });

    it('should update next_dial_at', async () => {
      const futureDate = '2024-07-01T12:00:00Z';
      prisma.client.findUnique.mockResolvedValue(mockClient({ name: 'John', numbers: [], clientInfo: [] }));
      prisma.client.update.mockResolvedValue(
        mockClient({ name: 'John', nextDialAt: new Date(futureDate), numbers: [], clientInfo: [] }),
      );

      const updated = await service.update(1, { next_dial_at: futureDate });
      expect(updated.next_dial_at).toBe(new Date(futureDate).toISOString());
      expect(prisma.client.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { nextDialAt: expect.any(String) },
        include: { numbers: true, clientInfo: true },
      });
    });

    it('should reassign agent_id', async () => {
      prisma.client.findUnique.mockResolvedValue(mockClient({ name: 'John', numbers: [], clientInfo: [] }));
      prisma.client.update.mockResolvedValue(
        mockClient({ name: 'John', agentId: 9, numbers: [], clientInfo: [] }),
      );

      const updated = await service.update(1, { agent_id: 9 });
      expect(updated.agent_id).toBe(9);
      expect(prisma.client.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ agentId: 9 }),
        }),
      );
    });

    it('should clear next_dial_at when set to null', async () => {
      prisma.client.findUnique.mockResolvedValue(
        mockClient({ name: 'John', nextDialAt: new Date(), numbers: [], clientInfo: [] }),
      );
      prisma.client.update.mockResolvedValue(
        mockClient({ name: 'John', nextDialAt: null, numbers: [], clientInfo: [] }),
      );

      const updated = await service.update(1, { next_dial_at: null });
      expect(updated.next_dial_at).toBeNull();
    });

    it('should add new phone numbers and remove missing ones', async () => {
      prisma.client.findUnique.mockResolvedValue(
        mockClient({
          name: 'John',
          numbers: [{ number: '555-0100', clientId: 1n }, { number: '555-0200', clientId: 1n }],
          clientInfo: [],
        }),
      );
      prisma.client.update.mockResolvedValue(
        mockClient({
          name: 'John',
          numbers: [{ number: '555-0100', clientId: 1n }, { number: '555-0300', clientId: 1n }],
          clientInfo: [],
        }),
      );

      const updated = await service.update(1, {
        phones: [{ phone: '555-0100' }, { phone: '555-0300' }],
      });

      expect(updated.phones).toEqual([
        { phone: '555-0100' },
        { phone: '555-0300' },
      ]);
      expect(prisma.client.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: {
          numbers: {
            deleteMany: { number: { in: ['555-0200'] } },
            create: [{ number: '555-0300' }],
          },
        },
        include: { numbers: true, clientInfo: true },
      });
    });

    it('should skip number changes when phones are not provided', async () => {
      prisma.client.findUnique.mockResolvedValue(
        mockClient({
          name: 'John',
          numbers: [{ number: '555-0100', clientId: 1n }],
          clientInfo: [],
        }),
      );
      prisma.client.update.mockResolvedValue(
        mockClient({
          name: 'John',
          type: 'LEAD',
          numbers: [{ number: '555-0100', clientId: 1n }],
          clientInfo: [],
        }),
      );

      const updated = await service.update(1, { type: ClientType.LEAD });

      expect(updated.type).toBe('LEAD');
      expect(prisma.client.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { type: 'LEAD' },
        include: { numbers: true, clientInfo: true },
      });
    });

    it('should throw NotFoundException for non-existent id', async () => {
      prisma.client.findUnique.mockResolvedValue(null);
      await expect(service.update(999, { type: 'done' as ClientType })).rejects.toThrow('Client not found');
    });
  });

  describe('remove', () => {
    it('should delete an existing client', async () => {
      prisma.client.findUnique.mockResolvedValue(mockClient({ name: 'John', numbers: [], clientInfo: [] }));
      prisma.client.delete.mockResolvedValue(mockClient({ name: 'John', numbers: [], clientInfo: [] }));

      await service.remove(1);
      expect(prisma.client.delete).toHaveBeenCalledWith({ where: { id: 1 } });
    });

    it('should throw NotFoundException for non-existent id', async () => {
      prisma.client.findUnique.mockResolvedValue(null);
      await expect(service.remove(999)).rejects.toThrow('Client not found');
    });
  });

  describe('getStatusCounts', () => {
    it('should return distinct normalized statuses with counts', async () => {
      (prisma.$queryRaw as jest.Mock).mockResolvedValue([
        { status: 'active', count: 5 },
        { status: 'inactive', count: 3 },
      ]);

      const result = await service.getStatusCounts();
      expect(result).toEqual([
        { status: 'active', count: 5 },
        { status: 'inactive', count: 3 },
      ]);
    });

    it('should return empty array when no clients exist', async () => {
      (prisma.$queryRaw as jest.Mock).mockResolvedValue([]);
      const result = await service.getStatusCounts();
      expect(result).toEqual([]);
    });
  });

  describe('getNextClient', () => {
    it('should return client with lowest attempt_count', async () => {
      prisma.$queryRaw.mockResolvedValue([{ id: 1n }]);
      prisma.client.findUnique.mockResolvedValue(mockClient({ name: 'John', numbers: [], clientInfo: [] }));

      const next = await service.getNextClient({ projectId: 1 });
      expect(next).not.toBeNull();
      expect(next!.name).toBe('John');
    });

    it('should return null when no client available', async () => {
      prisma.$queryRaw.mockResolvedValue([]);
      const next = await service.getNextClient({ projectId: 1 });
      expect(next).toBeNull();
    });

    it('should scope query to agent when agentId provided', async () => {
      prisma.$queryRaw.mockResolvedValue([{ id: 1n }]);
      prisma.client.findUnique.mockResolvedValue(mockClient({ name: 'John', numbers: [], clientInfo: [] }));

      const next = await service.getNextClient({ projectId: 1, agentId: 5 });
      expect(next).not.toBeNull();

      const agentClause = (prisma.$queryRaw as jest.Mock).mock.calls[0][2];
      expect(agentClause.strings.join('')).toContain('c.agent_id');
      expect(agentClause.values).toContain(5);
    });

    it('should not add agent clause when agentId is omitted', async () => {
      prisma.$queryRaw.mockResolvedValue([{ id: 1n }]);
      prisma.client.findUnique.mockResolvedValue(mockClient({ name: 'John', numbers: [], clientInfo: [] }));

      const next = await service.getNextClient({ projectId: 1 });
      expect(next).not.toBeNull();

      const agentClause = (prisma.$queryRaw as jest.Mock).mock.calls[0][2];
      expect(agentClause.strings.join('')).not.toContain('c.agent_id');
    });

    it('should add project clause when projectId provided', async () => {
      prisma.$queryRaw.mockResolvedValue([{ id: 1n }]);
      prisma.client.findUnique.mockResolvedValue(mockClient({ name: 'John', numbers: [], clientInfo: [] }));

      const next = await service.getNextClient({ projectId: 3 });
      expect(next).not.toBeNull();

      const projectClause = (prisma.$queryRaw as jest.Mock).mock.calls[0][1];
      expect(projectClause.strings.join('')).toContain('cp.project_id');
      expect(projectClause.values).toContain(3);
    });

    it('should return next client without project clause when projectId omitted', async () => {
      prisma.$queryRaw.mockResolvedValue([{ id: 1n }]);
      prisma.client.findUnique.mockResolvedValue(mockClient({ name: 'John', numbers: [], clientInfo: [] }));

      const next = await service.getNextClient({});
      expect(next).not.toBeNull();

      const firstCall = (prisma.$queryRaw as jest.Mock).mock.calls[0];
      const sqlText = firstCall
        .map((arg: unknown) =>
          Array.isArray(arg)
            ? arg.join('')
            : arg && typeof arg === 'object' && Array.isArray((arg as { strings: string[] }).strings)
              ? (arg as { strings: string[] }).strings.join('')
              : '',
        )
        .join('');
      expect(sqlText).not.toContain('cp.project_id');
      expect(sqlText).toContain('cp.status');
    });
  });
});
