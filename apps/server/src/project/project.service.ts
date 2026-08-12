import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { UserService } from '../user/user.service.js';
import { AppException } from '../common/errors/app.exception.js';
import { ErrorCode } from '../common/errors/error-codes.js';
import { serialize, serializeArray } from '../common/serialize.js';
import { ProjectResponseDto } from './dto/project-response.dto.js';
import type { CreateProjectDto } from './dto/create-project.dto.js';

// Prisma include pattern reused across queries
const PROJECT_WITH_REPOS = {
  repositories: { include: { repository: true } },
} as const;

@Injectable()
export class ProjectService {
  constructor(
    private prisma: PrismaService,
    private userService: UserService,
  ) {}

  async create(subjectId: string, dto: CreateProjectDto): Promise<ProjectResponseDto> {
    const userId = await this.userService.resolveUserId(subjectId);

    // Check for duplicate name across all projects the user has access to
    const contributions = await this.prisma.projectContributor.findMany({
      where: { userId },
      select: { project: { select: { name: true } } },
    });
    const nameTaken = contributions.some(
      (c) => c.project.name.toLowerCase() === dto.name.trim().toLowerCase(),
    );
    if (nameTaken) {
      throw new AppException(
        ErrorCode.PROJECT_NAME_TAKEN,
        `A project named "${dto.name}" already exists`,
        409,
      );
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const project = await tx.project.create({
        data: { name: dto.name, createdBy: userId },
      });

      const repos: Array<{ id: string; name: string; remoteUrl: string }> = [];

      for (const repoDto of dto.repos) {
        const repo = await tx.repository.upsert({
          where: { remoteUrl: repoDto.remoteUrl },
          create: { name: repoDto.name, remoteUrl: repoDto.remoteUrl },
          update: { name: repoDto.name },
        });

        await tx.projectRepository.create({
          data: { projectId: project.id, repoId: repo.id },
        });

        repos.push({ id: repo.id, name: repo.name, remoteUrl: repo.remoteUrl });
      }

      await tx.projectContributor.create({
        data: { projectId: project.id, userId, role: 'owner' },
      });

      return {
        id: project.id,
        name: project.name,
        createdBy: project.createdBy,
        createdAt: project.createdAt.toISOString(),
        updatedAt: project.updatedAt.toISOString(),
        repos,
      };
    });

    return serialize(ProjectResponseDto, result);
  }

  async findAllForUser(subjectId: string): Promise<ProjectResponseDto[]> {
    const userId = await this.userService.resolveUserId(subjectId);

    const contributions = await this.prisma.projectContributor.findMany({
      where: { userId },
      select: { projectId: true },
    });

    const projectIds = contributions.map((c) => c.projectId);
    if (projectIds.length === 0) return [];

    const projects = await this.prisma.project.findMany({
      where: { id: { in: projectIds } },
      include: PROJECT_WITH_REPOS,
      orderBy: { updatedAt: 'desc' },
    });

    return serializeArray(ProjectResponseDto, projects.map((p) => this.toPlain(p)));
  }

  async findById(projectId: string, subjectId: string): Promise<ProjectResponseDto> {
    const userId = await this.userService.resolveUserId(subjectId);
    await this.assertAccess(projectId, userId);

    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      include: PROJECT_WITH_REPOS,
    });

    if (!project) {
      throw new AppException(ErrorCode.PROJECT_NOT_FOUND, 'Project not found', 404);
    }

    return serialize(ProjectResponseDto, this.toPlain(project));
  }

  async delete(projectId: string, subjectId: string): Promise<void> {
    const userId = await this.userService.resolveUserId(subjectId);

    const contributor = await this.prisma.projectContributor.findUnique({
      where: { projectId_userId: { projectId, userId } },
    });

    if (!contributor || contributor.role !== 'owner') {
      throw new AppException(ErrorCode.ACCESS_DENIED, 'Only the project owner can delete a project', 403);
    }

    await this.prisma.project.delete({ where: { id: projectId } });
  }

  async assertAccess(projectId: string, userId: string): Promise<void> {
    const contributor = await this.prisma.projectContributor.findUnique({
      where: { projectId_userId: { projectId, userId } },
    });

    if (!contributor) {
      throw new AppException(ErrorCode.ACCESS_DENIED, 'You do not have access to this project', 403);
    }
  }

  // ─── Project Settings ────────────────────────────────────────────────────

  async getSettings(projectId: string, subjectId: string) {
    const userId = await this.userService.resolveUserId(subjectId);
    await this.assertAccess(projectId, userId);

    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { artifactsEnabled: true, selectedAgents: true },
    });

    if (!project) {
      throw new AppException(ErrorCode.PROJECT_NOT_FOUND, 'Project not found', 404);
    }

    return {
      artifactsEnabled: project.artifactsEnabled,
      selectedAgents: JSON.parse(project.selectedAgents) as string[],
    };
  }

  async updateSettings(
    projectId: string,
    subjectId: string,
    dto: { artifactsEnabled?: boolean; selectedAgents?: string[] },
  ) {
    const userId = await this.userService.resolveUserId(subjectId);
    await this.assertAccess(projectId, userId);

    const data: Record<string, unknown> = {};
    if (dto.artifactsEnabled !== undefined) data.artifactsEnabled = dto.artifactsEnabled;
    if (dto.selectedAgents !== undefined) data.selectedAgents = JSON.stringify(dto.selectedAgents);

    await this.prisma.project.update({
      where: { id: projectId },
      data,
    });

    return this.getSettings(projectId, subjectId);
  }

  // ─── Monitored Commands ──────────────────────────────────────────────────

  async getMonitoredCommands(projectId: string, subjectId: string): Promise<string[]> {
    const userId = await this.userService.resolveUserId(subjectId);
    await this.assertAccess(projectId, userId);

    const rows = await this.prisma.projectMonitoredCommand.findMany({
      where: { projectId },
      select: { command: true },
    });
    return rows.map((r) => r.command);
  }

  async addMonitoredCommand(projectId: string, command: string, subjectId: string): Promise<void> {
    const userId = await this.userService.resolveUserId(subjectId);
    await this.assertAccess(projectId, userId);

    try {
      await this.prisma.projectMonitoredCommand.create({
        data: { projectId, command },
      });
    } catch (err) {
      if (err instanceof Object && 'code' in err && err.code === 'P2002') return;
      throw err;
    }
  }

  async removeMonitoredCommand(projectId: string, command: string, subjectId: string): Promise<void> {
    const userId = await this.userService.resolveUserId(subjectId);
    await this.assertAccess(projectId, userId);

    await this.prisma.projectMonitoredCommand.deleteMany({
      where: { projectId, command },
    });
  }

  // ─── Private ─────────────────────────────────────────────────────────────

  /** Convert a Prisma project (with included repos) to a plain object for serialization */
  private toPlain(p: {
    id: string;
    name: string;
    createdBy: string;
    createdAt: Date;
    updatedAt: Date;
    repositories: Array<{ repository: { id: string; name: string; remoteUrl: string } }>;
  }) {
    return {
      id: p.id,
      name: p.name,
      createdBy: p.createdBy,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
      repos: p.repositories.map((pr) => ({
        id: pr.repository.id,
        name: pr.repository.name,
        remoteUrl: pr.repository.remoteUrl,
      })),
    };
  }
}
