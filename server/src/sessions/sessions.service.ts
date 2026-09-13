import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import type { CreateSessionDto } from './dto/create-session.dto';
import type { SessionResponseDto } from './dto/session-response.dto';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import { ACTIVE_TIMEOUT_MS } from './config';

@Injectable()
export class SessionsService {
  constructor(private prisma: PrismaService) {}

  async findAll(
    query: {
      from?: string;
      to?: string;
      user_id?: string;
      time?: string;
    },
    user: AuthenticatedUser,
  ): Promise<SessionResponseDto[]> {
    const where: { agentId?: number; lastBeat?: { gte?: Date }; firstBeat?: { gte?: Date; lte?: Date } } = {};

    if (user.role === 'user') {
      where.agentId = user.id;
    } else if (query.user_id) {
      where.agentId = Number(query.user_id);
    }

    const firstBeatFilter: { gte?: Date; lte?: Date } = {};
    if (query.from) firstBeatFilter.gte = new Date(query.from);
    if (query.to) firstBeatFilter.lte = new Date(query.to);

    if (query.time) {
      const t = new Date(query.time);
      firstBeatFilter.lte = t;
      where.lastBeat = { gte: t };
    }

    if (Object.keys(firstBeatFilter).length > 0) {
      where.firstBeat = firstBeatFilter;
    }

    const sessions = await this.prisma.userSession.findMany({
      where,
      orderBy: { firstBeat: 'desc' },
    });

    const agentIds = [...new Set(sessions.map(s => s.agentId))];
    let activeSessions: { agentId: number; firstBeat: Date }[] = [];
    if (agentIds.length > 0) {
      activeSessions = await this.prisma.activeSession.findMany({
        where: { agentId: { in: agentIds } },
      });
    }
    const activeMap = new Map<string, boolean>();
    for (const a of activeSessions) {
      activeMap.set(`${a.agentId}:${a.firstBeat.getTime()}`, true);
    }

    return sessions.map(s => ({
      agent_id: s.agentId,
      first_beat: s.firstBeat.toISOString(),
      last_beat: s.lastBeat.toISOString(),
      is_active: activeMap.has(`${s.agentId}:${s.firstBeat.getTime()}`),
      duration: s.duration,
    }));
  }

  async create(dto: CreateSessionDto, agentId: number): Promise<SessionResponseDto> {
    const first = new Date(dto.first_beat);
    const last = new Date(dto.last_beat);

    try {

      return this.prisma.$transaction(async (tx) => {
        const overlapping = await tx.userSession.findMany({
          where: {
            agentId,
            firstBeat: { lte: last },
            lastBeat: { gte: first },
          },
          orderBy: { firstBeat: 'asc' },
        });

        if (overlapping.length > 0) {
          const mergedFirst = overlapping.reduce(
            (min, s) => s.firstBeat < min ? s.firstBeat : min,
            first,
          );
          const mergedLast = overlapping.reduce(
            (max, s) => s.lastBeat > max ? s.lastBeat : max,
            last,
          );

          const active = await tx.activeSession.findUnique({ where: { agentId } });
          const wasActive = active && overlapping.some(
            s => s.firstBeat.getTime() === active.firstBeat.getTime(),
          );

          await tx.userSession.deleteMany({
            where: {
              agentId,
              firstBeat: { in: overlapping.map(s => s.firstBeat) },
            },
          });

          const duration = Math.round((mergedLast.getTime() - mergedFirst.getTime()) / 1000);
          await tx.userSession.create({
            data: { agentId, firstBeat: mergedFirst, lastBeat: mergedLast, duration },
          });

          if (wasActive) {
            await tx.activeSession.upsert({
              where: { agentId },
              create: { agentId, firstBeat: mergedFirst },
              update: { firstBeat: mergedFirst },
            });
          }

          return {
            agent_id: agentId,
            first_beat: mergedFirst.toISOString(),
            last_beat: mergedLast.toISOString(),
            is_active: !!wasActive,
            duration,
          };
        }

        const duration = Math.round((last.getTime() - first.getTime()) / 1000);
        await tx.userSession.create({
          data: { agentId, firstBeat: first, lastBeat: last, duration },
        });

        return {
          agent_id: agentId,
          first_beat: first.toISOString(),
          last_beat: last.toISOString(),
          is_active: false,
          duration,
        };
      });
    } catch (error) {
      console.error('Error occurred while creating session:', error);
      throw error;
    }
  }

  async beat(agentId: number): Promise<SessionResponseDto> {
    const cutoff = new Date(Date.now() - ACTIVE_TIMEOUT_MS);
    const existing = await this.prisma.userSession.findFirst({
      where: {
        agentId,
        lastBeat: { gte: cutoff },
      },
      orderBy: { lastBeat: 'desc' },
    });

    if (existing) {
      try {
        const now = new Date();
        const duration = Math.round((now.getTime() - existing.firstBeat.getTime()) / 1000);
        const updated = await this.prisma.userSession.update({
          where: {
            agentId_firstBeat: { agentId, firstBeat: existing.firstBeat },
          },
          data: { lastBeat: now, duration },
        });

        return {
          agent_id: updated.agentId,
          first_beat: updated.firstBeat.toISOString(),
          last_beat: updated.lastBeat.toISOString(),
          is_active: true,
          duration: updated.duration,
        };
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025')) {
          throw error;
        }
      }
    }

    const now = new Date();
    const created = await this.prisma.$transaction(async (tx) => {
      const s = await tx.userSession.create({
        data: { agentId, firstBeat: now, lastBeat: now, duration: 0 },
      });
      await tx.activeSession.upsert({
        where: { agentId },
        create: { agentId, firstBeat: now },
        update: { firstBeat: now },
      });
      return s;
    });

    return {
      agent_id: created.agentId,
      first_beat: created.firstBeat.toISOString(),
      last_beat: created.lastBeat.toISOString(),
      is_active: true,
      duration: 0,
    };
  }

  async remove(agentId: number, firstBeat: Date): Promise<void> {
    const session = await this.prisma.userSession.findUnique({
      where: { agentId_firstBeat: { agentId, firstBeat } },
    });
    if (!session) {
      throw new NotFoundException(`Session for agent ${agentId} at ${firstBeat.toISOString()} not found`);
    }

    await this.prisma.activeSession.deleteMany({ where: { agentId } });
    await this.prisma.userSession.delete({
      where: { agentId_firstBeat: { agentId, firstBeat } },
    });
  }
}
