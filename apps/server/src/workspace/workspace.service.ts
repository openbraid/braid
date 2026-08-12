import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service.js';
import { UserService } from '../user/user.service.js';
import { ProjectService } from '../project/project.service.js';
import { AppException } from '../common/errors/app.exception.js';
import { ErrorCode } from '../common/errors/error-codes.js';
import { generateWithLLM } from '../common/llm-client.js';
import { serialize, serializeArray } from '../common/serialize.js';
import { WorkspaceResponseDto } from './dto/workspace-response.dto.js';
import type { CreateWorkspaceDto } from './dto/create-workspace.dto.js';
import { Prisma } from '@prisma/client';

/**
 * Sanitize workspace name for use as a folder name on disk.
 * Computed once on creation, stored permanently — never recomputed.
 */
function sanitizeWorkspaceName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);
}

// Prisma include pattern reused across queries
const WORKSPACE_WITH_CREATOR_AND_REPOS = {
  creator: { select: { firstName: true, lastName: true, email: true } },
  repos: { include: { repository: true } },
} as const;

@Injectable()
export class WorkspaceService {
  private readonly logger = new Logger(WorkspaceService.name);

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private userService: UserService,
    private projectService: ProjectService,
  ) {}

  async create(subjectId: string, dto: CreateWorkspaceDto): Promise<WorkspaceResponseDto> {
    const userId = await this.userService.resolveUserId(subjectId);
    await this.projectService.assertAccess(dto.projectId, userId);

    try {
      const workspace = await this.prisma.$transaction(async (tx) => {
        const sanitizedName = sanitizeWorkspaceName(dto.name);
        const ws = await tx.workspace.create({
          data: {
            projectId: dto.projectId,
            name: dto.name,
            sanitizedName,
            branchName: dto.branchName,
            sourceBranch: dto.sourceBranch,
            createdBy: userId,
          },
        });

        // Link repos: if specific repos provided, use those; otherwise link all project repos
        const projectRepos = await tx.projectRepository.findMany({
          where: { projectId: dto.projectId },
        });
        const projectRepoIds = new Set(projectRepos.map((pr) => pr.repoId));

        if (dto.repos && dto.repos.length > 0) {
          for (const r of dto.repos) {
            if (!projectRepoIds.has(r.repoId)) {
              throw new AppException(
                ErrorCode.VALIDATION_ERROR,
                `Repository ${r.repoId} does not belong to project ${dto.projectId}`,
                400,
              );
            }
          }
          await tx.workspaceRepo.createMany({
            data: dto.repos.map((r) => ({
              workspaceId: ws.id,
              repoId: r.repoId,
              sourceBranch: r.sourceBranch ?? dto.sourceBranch,
            })),
          });
        } else {
          if (projectRepos.length > 0) {
            await tx.workspaceRepo.createMany({
              data: projectRepos.map((pr) => ({
                workspaceId: ws.id,
                repoId: pr.repoId,
                sourceBranch: dto.sourceBranch,
              })),
            });
          }
        }

        return tx.workspace.findUniqueOrThrow({
          where: { id: ws.id },
          include: WORKSPACE_WITH_CREATOR_AND_REPOS,
        });
      });

      return serialize(WorkspaceResponseDto, this.toPlain(workspace));
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const target = (err.meta?.target as string[]) ?? [];
        if (target.includes('name')) {
          throw new AppException(
            ErrorCode.WORKSPACE_NAME_TAKEN,
            `A workspace named "${dto.name}" already exists in this project`,
            409,
          );
        }
        if (target.includes('sanitized_name')) {
          throw new AppException(
            ErrorCode.WORKSPACE_NAME_TAKEN,
            `A workspace with a similar name already exists in this project (folder name conflict)`,
            409,
          );
        }
        if (target.includes('branch_name')) {
          throw new AppException(
            ErrorCode.BRANCH_NAME_TAKEN,
            `Branch "${dto.branchName}" is already used by another workspace in this project`,
            409,
          );
        }
      }
      throw err;
    }
  }

  async findAll(subjectId: string): Promise<WorkspaceResponseDto[]> {
    const userId = await this.userService.resolveUserId(subjectId);

    const contributions = await this.prisma.projectContributor.findMany({
      where: { userId },
      select: { projectId: true },
    });

    const projectIds = contributions.map((c) => c.projectId);
    if (projectIds.length === 0) return [];

    const workspaces = await this.prisma.workspace.findMany({
      where: { projectId: { in: projectIds } },
      include: WORKSPACE_WITH_CREATOR_AND_REPOS,
      orderBy: { updatedAt: 'desc' },
    });

    return serializeArray(WorkspaceResponseDto, workspaces.map((ws) => this.toPlain(ws)));
  }

  async findByProject(projectId: string, subjectId: string): Promise<WorkspaceResponseDto[]> {
    const userId = await this.userService.resolveUserId(subjectId);
    await this.projectService.assertAccess(projectId, userId);

    const workspaces = await this.prisma.workspace.findMany({
      where: { projectId },
      include: WORKSPACE_WITH_CREATOR_AND_REPOS,
      orderBy: { updatedAt: 'desc' },
    });

    return serializeArray(WorkspaceResponseDto, workspaces.map((ws) => this.toPlain(ws)));
  }

  async findById(workspaceId: string, subjectId: string): Promise<WorkspaceResponseDto> {
    const userId = await this.userService.resolveUserId(subjectId);

    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      include: WORKSPACE_WITH_CREATOR_AND_REPOS,
    });

    if (!workspace) {
      throw new AppException(ErrorCode.WORKSPACE_NOT_FOUND, 'Workspace not found', 404);
    }

    await this.projectService.assertAccess(workspace.projectId, userId);
    return serialize(WorkspaceResponseDto, this.toPlain(workspace));
  }

  async updateLifecycleStatus(
    workspaceId: string,
    subjectId: string,
    lifecycleStatus: string,
  ): Promise<WorkspaceResponseDto> {
    const userId = await this.userService.resolveUserId(subjectId);

    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
    });

    if (!workspace) {
      throw new AppException(ErrorCode.WORKSPACE_NOT_FOUND, 'Workspace not found', 404);
    }

    await this.projectService.assertAccess(workspace.projectId, userId);

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { firstName: true, lastName: true },
    });

    const updated = await this.prisma.workspace.update({
      where: { id: workspaceId },
      data: {
        lifecycleStatus,
        lifecycleStatusChangedBy: userId,
        lifecycleStatusChangedByFirstName: user?.firstName ?? null,
        lifecycleStatusChangedByLastName: user?.lastName ?? null,
        lifecycleStatusChangedAt: new Date(),
      },
      include: WORKSPACE_WITH_CREATOR_AND_REPOS,
    });

    return serialize(WorkspaceResponseDto, this.toPlain(updated));
  }

  async delete(workspaceId: string, subjectId: string): Promise<void> {
    const userId = await this.userService.resolveUserId(subjectId);

    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
    });

    if (!workspace) {
      throw new AppException(ErrorCode.WORKSPACE_NOT_FOUND, 'Workspace not found', 404);
    }

    await this.projectService.assertAccess(workspace.projectId, userId);
    await this.prisma.workspace.delete({ where: { id: workspaceId } });
  }

  async addRepo(
    workspaceId: string,
    repoId: string,
    subjectId: string,
  ): Promise<WorkspaceResponseDto> {
    const userId = await this.userService.resolveUserId(subjectId);

    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
    });

    if (!workspace) {
      throw new AppException(ErrorCode.WORKSPACE_NOT_FOUND, 'Workspace not found', 404);
    }

    await this.projectService.assertAccess(workspace.projectId, userId);

    // Validate repo belongs to this project
    const projectRepo = await this.prisma.projectRepository.findFirst({
      where: { projectId: workspace.projectId, repoId },
    });

    if (!projectRepo) {
      throw new AppException(
        ErrorCode.VALIDATION_ERROR,
        `Repository does not belong to this project`,
        400,
      );
    }

    // Check if already linked
    const existing = await this.prisma.workspaceRepo.findUnique({
      where: { workspaceId_repoId: { workspaceId, repoId } },
    });

    if (existing) {
      throw new AppException(
        ErrorCode.VALIDATION_ERROR,
        `Repository is already linked to this workspace`,
        409,
      );
    }

    await this.prisma.workspaceRepo.create({
      data: { workspaceId, repoId, sourceBranch: workspace.sourceBranch },
    });

    const updated = await this.prisma.workspace.findUniqueOrThrow({
      where: { id: workspaceId },
      include: WORKSPACE_WITH_CREATOR_AND_REPOS,
    });

    return serialize(WorkspaceResponseDto, this.toPlain(updated));
  }

  async suggestName(text: string): Promise<{ name: string }> {
    const apiKey = this.config.get<string>('GEMINI_API_KEY');
    if (!apiKey) {
      return { name: '' };
    }

    try {
      const result = await generateWithLLM({
        provider: 'gemini',
        systemPrompt:
          'You are a workspace naming assistant. Given a block of text describing a task or feature, suggest a short human-friendly workspace name (2-5 words, title case, spaces between words). The name should capture the core intent. Return ONLY the name, nothing else. No quotes, no explanation.',
        userMessage: text,
        model: 'gemini-3.1-flash-lite-preview',
        maxTokens: 50,
        apiKey,
      });

      const name = result.trim().replace(/['"]/g, '').slice(0, 100);
      return { name };
    } catch (err) {
      this.logger.error('suggestName: LLM error', err instanceof Error ? err.message : err);
      return { name: '' };
    }
  }

  // ─── Private ─────────────────────────────────────────────────────────────

  private toPlain(ws: {
    id: string;
    projectId: string;
    name: string;
    sanitizedName: string;
    branchName: string;
    sourceBranch: string;
    createdBy: string;
    lifecycleStatus: string;
    lifecycleStatusChangedByFirstName: string | null;
    lifecycleStatusChangedByLastName: string | null;
    lifecycleStatusChangedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    creator: { firstName: string | null; lastName: string | null; email: string } | null;
    repos: Array<{ sourceBranch: string | null; repository: { id: string; name: string; remoteUrl: string } }>;
  }) {
    return {
      id: ws.id,
      projectId: ws.projectId,
      name: ws.name,
      sanitizedName: ws.sanitizedName,
      branchName: ws.branchName,
      sourceBranch: ws.sourceBranch,
      createdBy: ws.createdBy,
      ownerName: [ws.creator?.firstName, ws.creator?.lastName].filter(Boolean).join(' ') || ws.creator?.email || 'Unknown',
      ownerEmail: ws.creator?.email ?? null,
      lifecycleStatus: ws.lifecycleStatus,
      lifecycleStatusChangedByFirstName: ws.lifecycleStatusChangedByFirstName,
      lifecycleStatusChangedByLastName: ws.lifecycleStatusChangedByLastName,
      lifecycleStatusChangedAt: ws.lifecycleStatusChangedAt?.toISOString() ?? null,
      createdAt: ws.createdAt.toISOString(),
      updatedAt: ws.updatedAt.toISOString(),
      repos: ws.repos.map((wr) => ({
        id: wr.repository.id,
        name: wr.repository.name,
        remoteUrl: wr.repository.remoteUrl,
        sourceBranch: wr.sourceBranch ?? ws.sourceBranch,
      })),
    };
  }
}
