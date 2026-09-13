import { Injectable, ConflictException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import type { CreateUserDto } from './dto/create-user.dto';
import type { UpdateUserDto } from './dto/update-user.dto';
import type { UserResponseDto } from './dto/user-response.dto';
import type { UserStatsDto } from './dto/user-stats.dto';
import { CallsService } from '@/calls/calls.service';
import { SessionsService } from '@/sessions/sessions.service';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService, private sessionService: SessionsService) {}

  private toResponse(user: {
    id: number;
    email: string;
    name?: string | null;
    phoneNumber?: string | null;
    role: string;
    profileImage?: Uint8Array | null;
  }, isOnline = false): UserResponseDto {
    return {
      id: user.id,
      email: user.email,
      name: user.name ?? null,
      phone: user.phoneNumber ?? null,
      role: user.role,
      has_profile_image: !!user.profileImage,
      is_online: isOnline,
    };
  }

  async findAll(role?: string, online?: string): Promise<UserResponseDto[]> {
    try {
      const users = await this.prisma.user.findMany({
        where: role ? { role } : undefined,
        omit: { passwordHash: true },
      });

      const agentIds = users.map(u => u.id);
      let activeAgentIds: number[] = [];
      if (agentIds.length > 0) {
        const activeSessions = await this.prisma.activeSession.findMany({
          where: { agentId: { in: agentIds } },
          select: { agentId: true },
        });
        activeAgentIds = activeSessions.map(a => a.agentId);
      }

      let filtered = users.map(u => ({
        ...this.toResponse(u, activeAgentIds.includes(u.id)),
      }));

      if (online === 'true') {
        filtered = filtered.filter(u => u.is_online);
      } else if (online === 'false') {
        filtered = filtered.filter(u => !u.is_online);
      }

      return filtered;
    } catch (error) {
      throw error;
    }
  }

  async findById(id: number): Promise<UserResponseDto | null> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id },
        omit: { passwordHash: true },
      });
      if (!user) return null;

      const activeSession = await this.prisma.activeSession.findUnique({
        where: { agentId: id },
      });

      return this.toResponse(user, !!activeSession);
    } catch (error) {
      throw error;
    }
  }

  async create(dto: CreateUserDto): Promise<UserResponseDto> {
    try {
      const passwordHash = await bcrypt.hash(dto.password, 10);
      const user = await this.prisma.user.create({
        data: {
          email: dto.email,
          passwordHash,
            phoneNumber: dto.phone ?? null,
          name: dto.name ?? null,
          role: dto.role,
        },
        omit: { passwordHash: true },
      });
      return this.toResponse(user);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('Email already exists');
      }
      throw err;
    }
  }

  async update(id: number, dto: UpdateUserDto, allowRoleChange = true): Promise<UserResponseDto> {
    try {
      const passwordHash = dto.password
        ? await bcrypt.hash(dto.password, 10)
        : undefined;

      const user = await this.prisma.user.update({
        where: { id },
        data: {
          ...(dto.email !== undefined ? { email: dto.email } : {}),
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.phone !== undefined ? { phoneNumber: dto.phone } : {}),
          ...(dto.role !== undefined && allowRoleChange ? { role: dto.role } : {}),
          ...(passwordHash !== undefined ? { passwordHash } : {}),
        },
        omit: { passwordHash: true },
      });
      return this.toResponse(user);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('Email already exists');
      }
      throw err;
    }
  }

async deactivate(id: number): Promise<UserResponseDto> {
    try {
      const user = await this.prisma.user.update({
        where: { id },
        data: { role: 'deactivated', passwordHash: '!deactivated!' },
        omit: { passwordHash: true },
      });
      return this.toResponse(user);
    } catch (error) {
      throw error;
    }
  }

  async createBulk(dtos: CreateUserDto[]): Promise<UserResponseDto[]> {
    const emails = dtos.map(d => d.email);

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.user.findMany({
        where: { email: { in: emails } },
        select: { email: true },
      });

      if (existing.length > 0) {
        throw new ConflictException(
          `Duplicate emails: ${existing.map(e => e.email).join(', ')}`,
        );
      }

      const users: UserResponseDto[] = [];
      for (const dto of dtos) {
        const passwordHash = await bcrypt.hash(dto.password, 10);
        const user = await tx.user.create({
          data: {
            email: dto.email,
            passwordHash,
          phoneNumber: dto.phone ?? null,
            name: dto.name ?? null,
            role: dto.role,
          },
          omit: { passwordHash: true },
        });
        users.push(this.toResponse(user));
      }

      return users;
    });
  }

  async uploadProfileImage(userId: number, buffer: Buffer, mime: string): Promise<UserResponseDto> {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { profileImage: new Uint8Array(buffer) as unknown as Uint8Array<ArrayBuffer>, profileMime: mime },
      omit: { passwordHash: true },
    });

    const activeSession = await this.prisma.activeSession.findUnique({
      where: { agentId: userId },
    });

    return this.toResponse(user, !!activeSession);
  }

  async deleteProfileImage(userId: number): Promise<UserResponseDto> {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { profileImage: null, profileMime: null },
      omit: { passwordHash: true },
    });

    const activeSession = await this.prisma.activeSession.findUnique({
      where: { agentId: userId },
    });

    return this.toResponse(user, !!activeSession);
  }

  async getProfileImage(userId: number): Promise<{ data: Buffer; mime: string } | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { profileImage: true, profileMime: true },
    });

    if (!user?.profileImage || !user?.profileMime) return null;

    return { data: Buffer.from(user.profileImage), mime: user.profileMime };
  }

  async getStats(userId: number, _from?: string, _to?: string): Promise<UserStatsDto | null> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) return null;

    const where: { agentId: number; time?: { gte?: Date; lte?: Date } } = { agentId: userId };
    if (_from || _to) {
      where.time = {};
      if (_from) where.time.gte = new Date(_from);
      if (_to) where.time.lte = new Date(_to);
    }

    const calls = await this.prisma.callDetailRecord.findMany({ where });

    const total_calls = calls.length;
    const answered = calls.filter(c => c.status === 'completed').length;
    const no_answer = calls.filter(c => c.status === 'no_answer').length;
    const busy = calls.filter(c => c.status === 'busy').length;
    const failed = calls.filter(c => c.status === 'failed').length;
    const callback = calls.filter(c => c.status === 'callback').length;
    const totalDuration = calls.reduce((sum, c) => sum + (c.duration ?? 0), 0);
    const avg_duration_seconds = total_calls > 0 ? Math.round(totalDuration / total_calls) : 0;

    const sessions = await this.sessionService.findAll(
      { user_id: String(userId), from: _from, to: _to },
      { id: userId, email: user.email, role: user.role },
    );
    const total_session_time_seconds = sessions.reduce((sum, s) => sum + (new Date(s.last_beat).getTime() - new Date(s.first_beat).getTime())/1000, 0);

    return {
      total_calls,
      answered,
      no_answer,
      busy,
      failed,
      callback,
      avg_duration_seconds,
      total_session_time_seconds,
    };
  }
}
