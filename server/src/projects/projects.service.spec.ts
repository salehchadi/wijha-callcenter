import { Test, TestingModule } from '@nestjs/testing';
import { mockDeep, DeepMockProxy } from 'jest-mock-extended';
import { Prisma } from '@prisma/client';
import { NotFoundException, ConflictException } from '@nestjs/common';
import { ProjectsService } from './projects.service';
import { PrismaService } from '@/prisma/prisma.service';
import { mockProject } from '@/prisma/mock-data';

describe('ProjectsService', () => {
  let service: ProjectsService;
  let prisma: DeepMockProxy<PrismaService>;

  beforeEach(async () => {
    prisma = mockDeep<PrismaService>();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProjectsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<ProjectsService>(ProjectsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findAll', () => {
    it('should return all projects', async () => {
      prisma.project.findMany.mockResolvedValue([mockProject()]);
      const result = await service.findAll();
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Default Project');
    });
  });

  describe('findById', () => {
    it('should return project by id', async () => {
      prisma.project.findUnique.mockResolvedValue(mockProject({ name: 'Test', description: null }));
      const project = await service.findById(1);
      expect(project).not.toBeNull();
      expect(project!.name).toBe('Test');
    });

    it('should return null for non-existent id', async () => {
      prisma.project.findUnique.mockResolvedValue(null);
      expect(await service.findById(999)).toBeNull();
    });
  });

  describe('create', () => {
    it('should create a project', async () => {
      prisma.project.create.mockResolvedValue(mockProject({ name: 'New Project', description: 'Desc' }));

      const result = await service.create({ name: 'New Project', description: 'Desc' });
      expect(result.name).toBe('New Project');
      expect(result.description).toBe('Desc');
    });

    it('should throw ConflictException when name already exists', async () => {
      prisma.project.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: '7.8.0',
        }),
      );

      await expect(service.create({ name: 'Duplicate' })).rejects.toThrow(ConflictException);
    });
  });

  describe('update', () => {
    it('should update a project', async () => {
      prisma.project.findUnique.mockResolvedValue(mockProject());
      prisma.project.update.mockResolvedValue(mockProject({ name: 'Renamed' }));

      const result = await service.update(1, { name: 'Renamed' });
      expect(result.name).toBe('Renamed');
    });

    it('should propagate P2025 for non-existent id (mapped to 404 by PrismaExceptionFilter)', async () => {
      prisma.project.update.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('No record was found for an update.', {
          code: 'P2025',
          clientVersion: '7.8.0',
        }),
      );
      await expect(service.update(999, { name: 'X' })).rejects.toMatchObject({ code: 'P2025' });
    });

    it('should throw ConflictException when renaming to an existing name', async () => {
      prisma.project.findUnique.mockResolvedValue(mockProject());
      prisma.project.update.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: '7.8.0',
        }),
      );

      await expect(service.update(1, { name: 'Taken' })).rejects.toThrow(ConflictException);
    });
  });

  describe('remove', () => {
    it('should delete an existing project', async () => {
      prisma.project.findUnique.mockResolvedValue(mockProject());
      prisma.project.delete.mockResolvedValue(mockProject());

      await expect(service.remove(1)).resolves.toBeUndefined();
      expect(prisma.project.delete).toHaveBeenCalledWith({ where: { id: 1 } });
    });

    it('should propagate P2025 for non-existent id (mapped to 404 by PrismaExceptionFilter)', async () => {
      prisma.project.delete.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('No record was found for a delete.', {
          code: 'P2025',
          clientVersion: '7.8.0',
        }),
      );
      await expect(service.remove(999)).rejects.toMatchObject({ code: 'P2025' });
    });
  });

  describe('createProject', () => {
    it('should create a project with name only', async () => {
      prisma.project.create.mockResolvedValue(mockProject({ name: 'New', description: null }));
      const result = await service.createProject('New');
      expect(result.name).toBe('New');
    });

    it('should create a project with name and description', async () => {
      prisma.project.create.mockResolvedValue(mockProject({ name: 'New', description: 'Desc' }));
      const result = await service.createProject('New', 'Desc');
      expect(result.name).toBe('New');
      expect(result.description).toBe('Desc');
    });
  });

  describe('updateProject', () => {
    it('should update an existing project name', async () => {
      prisma.project.findUnique.mockResolvedValue(mockProject());
      prisma.project.update.mockResolvedValue(mockProject({ name: 'Updated' }));
      const result = await service.updateProject(1, { name: 'Updated' });
      expect(result.name).toBe('Updated');
    });

    it('should update an existing project description', async () => {
      prisma.project.findUnique.mockResolvedValue(mockProject());
      prisma.project.update.mockResolvedValue(mockProject({ description: 'New Desc' }));
      const result = await service.updateProject(1, { description: 'New Desc' });
      expect(result.description).toBe('New Desc');
    });

    it('should throw NotFoundException for non-existent project', async () => {
      prisma.project.findUnique.mockResolvedValue(null);
      await expect(service.updateProject(999, { name: 'X' })).rejects.toThrow(NotFoundException);
    });
  });

  describe('deleteProject', () => {
    it('should delete an existing project', async () => {
      prisma.project.findUnique.mockResolvedValue(mockProject());
      prisma.project.delete.mockResolvedValue(mockProject());
      await expect(service.deleteProject(1)).resolves.toBeUndefined();
      expect(prisma.project.delete).toHaveBeenCalledWith({ where: { id: 1 } });
    });

    it('should throw NotFoundException for non-existent project', async () => {
      prisma.project.findUnique.mockResolvedValue(null);
      await expect(service.deleteProject(999)).rejects.toThrow(NotFoundException);
    });
  });

  describe('create error handling', () => {
    it('should re-throw non-P2002 errors', async () => {
      prisma.project.create.mockRejectedValue(new Error('Database error'));
      await expect(service.create({ name: 'Test' })).rejects.toThrow('Database error');
    });
  });

  describe('update error handling', () => {
    it('should re-throw non-P2002 errors', async () => {
      prisma.project.findUnique.mockResolvedValue(mockProject());
      prisma.project.update.mockRejectedValue(new Error('Database error'));
      await expect(service.update(1, { name: 'Test' })).rejects.toThrow('Database error');
    });
  });
});
