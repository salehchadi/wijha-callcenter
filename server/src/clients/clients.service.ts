import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import type { CreateClientDto } from './dto/create-client.dto';
import type { UpdateClientDto } from './dto/update-client.dto';
import type { ClientResponseDto } from './dto/client-response.dto';
import type { StatusCountDto } from '@/calls/dto/status-count.dto';
import { ClientType, fromDbType, toDbType } from './dto/client-type.enum';

type ClientWithRelations = {
  id: bigint;
  name?: string | null;
  type?: string | null;
  nextDialAt?: Date | null;
  agentId?: number | null;
  numbers: { number: string }[];
  clientInfo?: { key: string; value: string }[];
  clientProjects?: { projectId: number; status: string | null; attemptCount: number | null; lastDialedAt: Date | null; project: { id: number; name: string } }[];
};

function toClientResponse(client: ClientWithRelations): ClientResponseDto {
  return {
    id: Number(client.id),
    name: client.name ?? undefined,
    type: fromDbType(client.type),
    next_dial_at: client.nextDialAt?.toISOString() ?? null,
    agent_id: client.agentId ?? undefined,
    phones: client.numbers.map((n: { number: string }) => ({ phone: n.number })),
    info: client.clientInfo?.map((i: { key: string; value: string }) => ({ key: i.key, value: i.value })),
    projects: client.clientProjects?.map((cp) => ({
      project_id: cp.projectId,
      project_name: cp.project.name,
      status: cp.status ?? undefined,
      attempt_count: cp.attemptCount ?? 0,
      last_dialed_at: cp.lastDialedAt?.toISOString() ?? null,
    })),
  };
}

@Injectable()
export class ClientsService {
  constructor(private prisma: PrismaService) {}

  async findAll(
    project_id?: number,
    type?: ClientType | string,
    status?: string,
    page = 1,
    limit = 20,
    agent_id?: number,
  ): Promise<{ data: ClientResponseDto[]; meta: { total: number; page: number; limit: number } }> {
    const where: {
      type?: string | null;
      agentId?: number;
      clientProjects?: { some: { projectId?: number; status?: string } };
    } = {};
    if (type) {
      const dbType: string | null = toDbType(type);
      if (dbType === null) where.type = null;
      else where.type = dbType;
    }
    if (agent_id) where.agentId = agent_id;
    if (project_id) where.clientProjects = { some: { projectId: project_id } };
    if (status) {
      const existingClause: { projectId?: number; status?: string } = where.clientProjects?.some ?? {};
      where.clientProjects = { some: { ...existingClause, status } };
    }

    const [clients, total] = await Promise.all([
      this.prisma.client.findMany({
        where,
        include: { numbers: true, clientInfo: true, clientProjects: { include: { project: true } } },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.client.count({ where }),
    ]);

    return {
      data: clients.map(toClientResponse),
      meta: { total, page, limit },
    };
  }

  async findById(id: number): Promise<ClientResponseDto | null> {
    const client = await this.prisma.client.findUnique({
      where: { id },
      include: { numbers: true, clientInfo: true, clientProjects: { include: { project: true } } },
    });
    if (!client) return null;
    return toClientResponse(client);
  }

  async create(dto: CreateClientDto): Promise<ClientResponseDto> {
    return this.upsertClient(this.prisma, dto);
  }

  async createBulk(dtos: CreateClientDto[]): Promise<ClientResponseDto[]> {
    return this.prisma.$transaction(async (tx) => {
      const results: ClientResponseDto[] = [];
      for (const dto of dtos) {
        results.push(await this.upsertClient(tx, dto));
      }
      return results;
    });
  }

  private async upsertClient(client: Pick<PrismaService, 'number' | 'client' | 'clientInfo' | 'clientProject'>, dto: CreateClientDto): Promise<ClientResponseDto> {
    const phoneNumbers: string[] = dto.phones.map((n) => n.phone);
    const existingNumber = await client.number.findFirst({
      where: { number: { in: phoneNumbers } },
      include: { client: { include: { numbers: true, clientInfo: true } } },
    });

    if (existingNumber) {
      const existingClient = existingNumber.client;
      const existingPhoneValues: string[] = existingClient.numbers.map((n: { number: string }) => n.number);
      const newNumbers: string[] = phoneNumbers.filter((n: string) => !existingPhoneValues.includes(n));
      const existingInfoKeys: string[] = (existingClient.clientInfo ?? []).map((i: { key: string }) => i.key);
      const newInfo = (dto.info ?? []).filter(
        (i) => i.key != null && i.value != null && !existingInfoKeys.includes(i.key!),
      );

      const mergedName: string | undefined =
        dto.name !== undefined
          ? !existingClient.name || dto.name.length > existingClient.name.length
            ? dto.name
            : undefined
          : undefined;

      const updated = await client.client.update({
        where: { id: existingClient.id },
        data: {
          ...(mergedName !== undefined ? { name: mergedName } : {}),
          ...(dto.type !== undefined ? { type: toDbType(dto.type) } : {}),
          ...(dto.agent_id !== undefined ? { agentId: dto.agent_id } : {}),
          ...(newNumbers.length > 0
            ? { numbers: { create: newNumbers.map((n: string) => ({ number: n })) } }
            : {}),
          ...(newInfo.length > 0
            ? {
                clientInfo: {
                  create: newInfo.map((i) => ({ key: i.key!, value: i.value! })),
                },
              }
            : {}),
          ...(dto.project_id
            ? {
                clientProjects: {
                  upsert: {
                    where: {
                      clientId_projectId: {
                        clientId: existingClient.id,
                        projectId: dto.project_id,
                      },
                    },
                    create: { projectId: dto.project_id, status: 'dial', attemptCount: 0 },
                    update: {},
                  },
                },
              }
            : {}),
        },
        include: { numbers: true, clientInfo: true },
      });

      return toClientResponse(updated);
    }

    const created = await client.client.create({
      data: {
        name: dto.name,
        type: toDbType(dto.type),
        agentId: dto.agent_id ?? null,
        numbers: {
          create: dto.phones.map((n) => ({ number: n.phone })),
        },
        clientInfo: dto.info?.length
          ? {
              create: dto.info
                .filter((i) => i.key != null && i.value != null)
                .map((i) => ({ key: i.key!, value: i.value! })),
            }
          : undefined,
        clientProjects: dto.project_id
          ? { create: { projectId: dto.project_id, status: 'dial', attemptCount: 0 } }
          : undefined,
      },
      include: { numbers: true, clientInfo: true },
    });

    return toClientResponse(created);
  }

  async update(id: number, dto: UpdateClientDto): Promise<ClientResponseDto> {
    const existing = await this.prisma.client.findUnique({
      where: { id },
      include: { numbers: true },
    });
    if (!existing) {
      throw new NotFoundException('Client not found');
    }

    const existingPhoneValues: string[] = (existing.numbers ?? []).map((n) => n.number);
    const newPhoneValues: string[] | null = dto.phones?.map((p) => p.phone) ?? null;
    const phonesToRemove: string[] = newPhoneValues
      ? existingPhoneValues.filter((p: string) => !newPhoneValues.includes(p))
      : [];
    const phonesToCreate: { number: string }[] = newPhoneValues
      ? newPhoneValues.filter((p: string) => !existingPhoneValues.includes(p)).map((p: string) => ({ number: p }))
      : [];

    const client = await this.prisma.client.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.type !== undefined ? { type: toDbType(dto.type) } : {}),
        ...(dto.agent_id !== undefined ? { agentId: dto.agent_id } : {}),
        ...(dto.next_dial_at !== undefined ? { nextDialAt: dto.next_dial_at ? new Date(dto.next_dial_at).toISOString() : null } : {}),
        ...(phonesToRemove.length > 0 || phonesToCreate.length > 0
          ? {
              numbers: {
                ...(phonesToRemove.length > 0 ? { deleteMany: { number: { in: phonesToRemove } } } : {}),
                ...(phonesToCreate.length > 0 ? { create: phonesToCreate } : {}),
              },
            }
          : {}),
      },
      include: { numbers: true, clientInfo: true },
    });

    if (dto.info !== undefined) {
      await this.prisma.clientInfo.deleteMany({ where: { clientId: id } });
      if (dto.info.length > 0) {
        await this.prisma.clientInfo.createMany({
          data: dto.info
            .filter((i) => i.key != null && i.value != null)
            .map((i) => ({ clientId: id, key: i.key!, value: i.value! })),
        });
      }
      return toClientResponse({
        ...client,
        clientInfo: dto.info
          .filter((i) => i.key != null && i.value != null)
          .map((i) => ({ key: i.key!, value: i.value! })),
      });
    }

    return toClientResponse(client);
  }

  async getNextClient(args: { projectId?: number; date?: Date; agentId?: number; type?: ClientType | string }): Promise<ClientResponseDto | null> {
    const { projectId, agentId, type } = args;

    const effectiveProjectId: number | undefined = projectId && projectId !== 0 ? projectId : undefined;

    const projectClause = effectiveProjectId !== undefined && effectiveProjectId !== null
      ? Prisma.sql`AND cp.project_id = ${effectiveProjectId}`
      : Prisma.empty;

    const agentClause = agentId !== undefined && agentId !== null
      ? Prisma.sql`AND c.agent_id = ${agentId}`
      : Prisma.empty;

    const dbType: string | null | undefined = type !== undefined && type !== null ? toDbType(type) : undefined;
    const typeClause = dbType === undefined
      ? Prisma.empty
      : dbType === null
        ? Prisma.sql`AND c.type IS NULL`
        : Prisma.sql`AND c.type = ${dbType}`;

    const rows = await this.prisma.$queryRaw<{ id: bigint }[]>`
      SELECT c.id
      FROM client c
      LEFT JOIN client_project cp ON cp.client_id = c.id
      WHERE (cp.status IN ('dial', 'callback', 'not_answered') OR cp.status IS NULL)
        AND (c.next_dial_at IS NULL OR c.next_dial_at <= NOW())
        ${projectClause}
        ${agentClause}
        ${typeClause}
      ORDER BY c.next_dial_at ASC NULLS FIRST
      LIMIT 1
    `;

    if (rows.length === 0) return null;

    const client = await this.prisma.client.findUnique({
      where: { id: rows[0].id },
      include: { numbers: true, clientInfo: true },
    });

    if (!client) return null;
    return toClientResponse(client);
  }

  /** @deprecated use getNextClient */
  async getNextOwner(args: { projectId?: number; date?: Date; agentId?: number; type?: ClientType | string }): Promise<ClientResponseDto | null> {
    return this.getNextClient(args);
  }

  async getStatusCounts(): Promise<StatusCountDto[]> {
    return this.prisma.$queryRaw<StatusCountDto[]>`
      SELECT LOWER(TRIM(status)) as status, COUNT(*)::int as count
      FROM client_project
      WHERE status IS NOT NULL
      GROUP BY LOWER(TRIM(status))
      ORDER BY status
    `;
  }

  async assignToProject(clientId: number, projectName: string): Promise<ClientResponseDto> {
    const existingClient = await this.prisma.client.findUnique({ where: { id: clientId } });
    if (!existingClient) throw new NotFoundException('Client not found');

    const project = await this.prisma.project.findFirst({ where: { name: projectName } });
    if (!project) throw new NotFoundException(`Project "${projectName}" not found`);

    await this.prisma.clientProject.upsert({
      where: { clientId_projectId: { clientId, projectId: project.id } },
      create: { clientId, projectId: project.id, status: 'dial', attemptCount: 0 },
      update: {},
    });

    const updated = await this.prisma.client.findUnique({
      where: { id: clientId },
      include: { numbers: true, clientInfo: true },
    });
    if (!updated) {
      throw new NotFoundException('Client not found');
    }
    return toClientResponse(updated);
  }

  async remove(id: number): Promise<void> {
    const existing = await this.prisma.client.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('Client not found');
    }

    await this.prisma.number.deleteMany({ where: { clientId: id } });
    await this.prisma.clientInfo.deleteMany({ where: { clientId: id } });
    await this.prisma.clientProject.deleteMany({ where: { clientId: id } });
    await this.prisma.callDetailRecord.deleteMany({ where: { clientId: id } });
    await this.prisma.client.delete({ where: { id } });
  }
}
