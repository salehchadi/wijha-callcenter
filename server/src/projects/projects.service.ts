import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import type { ProjectResponseDto } from './dto/project-response.dto';
import type { CreateProjectDto } from './dto/create-project.dto';
import type { UpdateProjectDto } from './dto/update-project.dto';

@Injectable()
export class ProjectsService {
  constructor(private prisma: PrismaService) {}

  async findAll(): Promise<ProjectResponseDto[]> {
    return this.prisma.project.findMany();
  }

  async findById(id: number): Promise<ProjectResponseDto | null> {
    const project = await this.prisma.project.findUnique({ where: { id } });
    return project ?? null;
  }

  async createProject(name: string, description?: string): Promise<ProjectResponseDto> {
    return this.prisma.project.create({
      data: { name, description }
    });
  }

  async updateProject(id: number, data: { name?: string; description?: string }): Promise<ProjectResponseDto> {
    const existing = await this.findById(id);
    if (!existing) throw new NotFoundException('Project not found');
    return this.prisma.project.update({
      where: { id },
      data
    });
  }

  async deleteProject(id: number): Promise<void> {
    const existing = await this.findById(id);
    if (!existing) throw new NotFoundException('Project not found');
    await this.prisma.project.delete({ where: { id } });
  }

  async create(dto: CreateProjectDto): Promise<ProjectResponseDto> {
    try {
      return await this.prisma.project.create({ data: dto });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Project name already exists');
      }
      throw error;
    }
  }

  async update(id: number, dto: UpdateProjectDto): Promise<ProjectResponseDto> {
    try {
      return await this.prisma.project.update({ where: { id }, data: dto });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Project name already exists');
      }
      throw error;
    }
  }

  async remove(id: number): Promise<void> {
    await this.prisma.project.delete({ where: { id } });
  }
}
