import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import type { SubmitCallDto } from '@/calls/dto/submit-call.dto';
import type { NotifyCallingDto } from '@/calls/dto/notify-calling.dto';
import type { CallResponseDto } from '@/calls/dto/call-response.dto';
import type { NextClientResponseDto } from '@/calls/dto/next-client-response.dto';
import type { StatusCountDto } from '@/calls/dto/status-count.dto';
import { ClientsService } from '@/clients/clients.service';
import type { ClientType } from '@/clients/dto/client-type.enum';
import { DEFAULT_PAGE_LIMIT } from './config';

const callWithProjects = Prisma.validator<Prisma.CallDetailRecordDefaultArgs>()({
  include: {
    client: {
      include: {
        clientProjects: {
          include: { project: true },
        },
      },
    },
  },
});

type CallWithProjects = Prisma.CallDetailRecordGetPayload<typeof callWithProjects>;

@Injectable()
export class CallsService {
  constructor(
    private prisma: PrismaService,
    private clientsService: ClientsService,
  ) {}

  private toCallResponse(call: CallWithProjects): CallResponseDto {
    return {
      id: Number(call.id),
      client_id: Number(call.clientId),
      agent_id: call.agentId ?? 0,
      status: call.status ?? '',
      time: call.time.toISOString(),
      duration: call.duration,
      agent_notes: call.agentNotes,
      projects: call.client?.clientProjects.map(cp => ({
        id: cp.project.id,
        name: cp.project.name,
      })) ?? [],
    };
  }

  async findAll(filters: {
    client_id?: number;
    agent_id?: number;
    status?: string;
    page?: number;
    limit?: number;
    from?: Date;
    to?: Date;
    project_id?: number;
  }): Promise<{ data: CallResponseDto[]; meta: { total: number; page: number; limit: number } }> {
    const where: {
      clientId?: number;
      agentId?: number;
      status?: string;
      time?: { gte?: Date; lte?: Date };
      client?: { clientProjects: { some: { projectId: number } } };
    } = {};
    if (filters.client_id !== undefined) where.clientId = filters.client_id;
    if (filters.agent_id !== undefined) where.agentId = filters.agent_id;
    if (filters.status) where.status = filters.status;
    if (filters.from) where.time = { ...where.time, gte: filters.from };
    if (filters.to) where.time = { ...where.time, lte: filters.to };
    if (filters.project_id !== undefined) {
      where.client = { clientProjects: { some: { projectId: filters.project_id } } };
    }

    const page = filters.page ?? 1;
    const limit = filters.limit ?? DEFAULT_PAGE_LIMIT;
    const include = callWithProjects.include;

    try {
      const [calls, total] = await Promise.all([
        this.prisma.callDetailRecord.findMany({
          where,
          skip: (page - 1) * limit,
          take: limit,
          orderBy: { time: 'desc' },
          include,
        }),
        this.prisma.callDetailRecord.count({ where }),
      ]);

      return {
        data: calls.map(c => this.toCallResponse(c)),
        meta: { total, page, limit },
      };
    } catch (error) {
      console.error('Error occurred while fetching calls:', error);
      throw error;
    }
    return { data: [], meta: { total: 0, page, limit } };
  }

  async findById(id: number): Promise<CallResponseDto | null> {
    const call = await this.prisma.callDetailRecord.findUnique({
      where: { id },
      include: callWithProjects.include,
    });
    if (!call) return null;
    return this.toCallResponse(call);
  }

  async remove(id: number): Promise<void> {
    const call = await this.prisma.callDetailRecord.findUnique({ where: { id } });
    if (!call) {
      throw new NotFoundException(`Call ${id} not found`);
    }

    await this.prisma.projectCallDetailRecord.deleteMany({ where: { callDetailRecordId: id } });
    await this.prisma.callDetailRecord.delete({ where: { id } });
  }

  private async assertProjectExists(projectId: number): Promise<void> {
    const project = await this.prisma.project.findFirst({ where: { id: projectId } });
    if (!project) {
      throw new BadRequestException(`Project ${projectId} not found`);
    }
  }

  async submit(dto: SubmitCallDto, agentId: number): Promise<CallResponseDto> {
    const client = await this.prisma.client.findUnique({ where: { id: dto.client_id } });
    if (!client) {
      throw new NotFoundException(`Client ${dto.client_id} not found`);
    }

    if (dto.project_id) {
      await this.assertProjectExists(dto.project_id);
    }

    const call = await this.prisma.callDetailRecord.create({
      data: {
        clientId: dto.client_id,
        agentId,
        status: dto.status,
        time: new Date(dto.time),
        duration: dto.duration ?? null,
        agentNotes: dto.agent_notes ?? null,
      },
    });

    if (dto.project_id) {
      await this.prisma.clientProject.upsert({
        where: { clientId_projectId: { clientId: dto.client_id, projectId: dto.project_id } },
        create: {
          clientId: dto.client_id,
          projectId: dto.project_id,
          status: dto.status,
          lastDialedAt: new Date(),
        },
        update: { status: dto.status, lastDialedAt: new Date() },
      });
    }

    await this.prisma.client.update({
      where: { id: dto.client_id },
      data: {
        nextDialAt: dto.next_dial_at ? new Date(dto.next_dial_at) : null,
      },
    });
    return {
      id: Number(call.id),
      client_id: Number(call.clientId),
      agent_id: call.agentId ?? 0,
      status: call.status ?? '',
      time: call.time.toISOString(),
      duration: call.duration,
      agent_notes: call.agentNotes,
      projects: [],
    };
  }

  async getNextClient(args: { projectId?: number; date?: Date; agentId?: number; type?: ClientType | string }): Promise<NextClientResponseDto | null> {
    const client = await this.clientsService.getNextClient(args);
    if (!client) return null;

    try {
      const calls = await this.prisma.callDetailRecord.findMany({
        where: { clientId: client.id },
        orderBy: { time: 'desc' },
        include: callWithProjects.include,
      });

      return {
        client,
        owner: client,
        calls: calls.map((c) => this.toCallResponse(c)),
      };
    } catch (error) {
      console.error('Error occurred while fetching next client calls:', error);
      throw error;
    }
  }

  /** @deprecated use getNextClient */
  async getNextOwner(args: { projectId?: number; date?: Date; agentId?: number; type?: ClientType | string }): Promise<NextClientResponseDto | null> {
    return this.getNextClient(args);
  }

  async getStatusCounts(from?: Date, to?: Date): Promise<StatusCountDto[]> {
    const timeFilter: { gte?: Date; lte?: Date } = {};
    if (from) timeFilter.gte = from;
    if (to) timeFilter.lte = to;

    try {

      const allStatuses = await this.prisma.callDetailRecord.findMany({
        where: { status: { not: null } },
        distinct: ['status'],
        select: { status: true },
      });

      const statusSet = new Set<string>();
      for (const r of allStatuses) {
        statusSet.add(r.status!.trim().toLowerCase());
      }

      const counts = await this.prisma.callDetailRecord.groupBy({
        by: ['status'],
        _count: true,
        where: {
          status: { not: null },
          ...(Object.keys(timeFilter).length ? { time: timeFilter } : {}),
        },
      });

      const countMap = new Map<string, number>();
      for (const c of counts) {
        const key = c.status!.trim().toLowerCase();
        countMap.set(key, (countMap.get(key) ?? 0) + c._count);
      }

      return [...statusSet].sort().map(status => ({ status, count: countMap.get(status) ?? 0 }));
    } catch (error) {
      console.error('Error occurred while fetching status counts:', error);
      throw error;
    }
  }

  async notifyCalling(dto: NotifyCallingDto): Promise<void> {
    await this.prisma.client.update({
      where: { id: dto.client_id },
      data: { nextDialAt: new Date() },
    });

    if (dto.project_id) {
      await this.assertProjectExists(dto.project_id);

      await this.prisma.clientProject.upsert({
        where: { clientId_projectId: { clientId: dto.client_id, projectId: dto.project_id } },
        create: {
          clientId: dto.client_id,
          projectId: dto.project_id,
          status: 'dial',
          attemptCount: 1,
          lastDialedAt: new Date(),
        },
        update: { lastDialedAt: new Date(), attemptCount: { increment: 1 } },
      });
    }
  }
}
