import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { UserService } from '../user/user.service.js';
import { ProjectService } from '../project/project.service.js';
import { HocuspocusService } from '../collaboration/hocuspocus.service.js';
import { EventService } from '../activity/event.service.js';
import { AppException } from '../common/errors/app.exception.js';
import { ErrorCode } from '../common/errors/error-codes.js';
import { serialize, serializeArray } from '../common/serialize.js';
import { ArtifactListItemDto, ArtifactResponseDto } from './dto/artifact-response.dto.js';
import type { SaveArtifactDto } from './dto/save-artifact.dto.js';
import { Prisma } from '@prisma/client';
import * as Y from 'yjs';
import { reconcileYamlIntoYDoc } from '../collaboration/lib/reconciliation.js';
import { yDocToYaml } from '../collaboration/lib/ydoc-to-yaml.js';

@Injectable()
export class ArtifactService {
  private readonly logger = new Logger('ArtifactService');

  constructor(
    private prisma: PrismaService,
    private userService: UserService,
    private projectService: ProjectService,
    @Inject(forwardRef(() => HocuspocusService))
    private hocuspocusService: HocuspocusService,
    private eventService: EventService,
  ) {}

  async findAllByWorkspace(workspaceId: string, subjectId: string): Promise<ArtifactListItemDto[]> {
    const userId = await this.userService.resolveUserId(subjectId);
    await this.assertWorkspaceAccess(workspaceId, userId);

    const artifacts = await this.prisma.artifact.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'asc' },
    });

    return serializeArray(
      ArtifactListItemDto,
      artifacts.map((a) => this.toPlain(a)),
    );
  }

  async findByKind(workspaceId: string, kind: string, subjectId: string): Promise<ArtifactResponseDto> {
    const userId = await this.userService.resolveUserId(subjectId);
    await this.assertWorkspaceAccess(workspaceId, userId);

    const artifact = await this.prisma.artifact.findUnique({
      where: { workspaceId_kind: { workspaceId, kind } },
    });

    if (!artifact) {
      throw new AppException(ErrorCode.ARTIFACT_NOT_FOUND, `Artifact "${kind}" not found`, 404);
    }

    return serialize(ArtifactResponseDto, this.toPlain(artifact));
  }

  async save(
    workspaceId: string,
    kind: string,
    subjectId: string,
    dto: SaveArtifactDto,
  ): Promise<ArtifactResponseDto> {
    const userId = await this.userService.resolveUserId(subjectId);
    const projectId = await this.assertWorkspaceAccess(workspaceId, userId);

    // Check for version conflict if expectedVersion is provided
    if (dto.expectedVersion != null) {
      const existing = await this.prisma.artifact.findUnique({
        where: { workspaceId_kind: { workspaceId, kind } },
        select: { version: true, lastEditedBy: true },
      });

      if (existing && existing.version !== dto.expectedVersion) {
        throw new AppException(
          ErrorCode.ARTIFACT_VERSION_CONFLICT,
          `Version conflict: expected ${dto.expectedVersion}, current is ${existing.version}`,
          409,
        );
      }
    }

    try {
      // ─── Build yjsState ───────────────────────────────────────────────
      // Client sends Tiptap-normalized yjsState (context fragment only).
      // Server merges it with structured data (meta, requirements, tasks)
      // and handles comment re-anchoring if comments exist.

      const existing = await this.prisma.artifact.findUnique({
        where: { workspaceId_kind: { workspaceId, kind } },
        select: { yjsState: true, yamlContent: true },
      });

      let yjsState!: Uint8Array<ArrayBuffer>;
      let generatedYaml: string | null = null;

      if (dto.yjsState) {
        const clientState = Uint8Array.from(
          atob(dto.yjsState),
          (c) => c.charCodeAt(0),
        ) as Uint8Array<ArrayBuffer>;

        if (existing?.yjsState) {
          this.logger.log(`[save] Client yjsState received for ${kind}. Reconciling with existing.`);

          const docName = `artifact:${workspaceId}:${kind}`;
          const connection = await this.hocuspocusService
            .getHocuspocus()
            .openDirectConnection(docName);

          await connection.transact((doc) => {
            const result = reconcileYamlIntoYDoc(doc, dto.yamlContent, clientState);
            yjsState = Y.encodeStateAsUpdate(doc) as Uint8Array<ArrayBuffer>;

            generatedYaml = yDocToYaml(doc);
            this.hocuspocusService.updateCachedYaml(docName, generatedYaml!);

            this.logger.log(
              `[save] Reconciliation complete for ${kind}. ` +
              `Context updated: ${result.contextUpdated}, ` +
              `Requirements: ${result.requirementsMatched} matched / ${result.requirementsAdded} added / ${result.requirementsRemoved} removed, ` +
              `Tasks: ${result.tasksMatched} matched / ${result.tasksAdded} added / ${result.tasksRemoved} removed, ` +
              `Comments remapped: ${result.commentsRemapped}, ` +
              `Comments healed: ${result.healingResult.healed}/${result.healingResult.totalComments} ` +
              `(${result.healingResult.outdated} outdated). ` +
              `New yjsState: ${yjsState!.length} bytes.`,
            );
          });

          connection.disconnect();
        } else {
          this.logger.log(`[save] First save for ${kind}. Using client yjsState (${clientState.length} bytes).`);
          yjsState = clientState;

          // Generate canonical yamlContent from the client Y.Doc
          const clientDoc = new Y.Doc();
          Y.applyUpdate(clientDoc, clientState);
          generatedYaml = yDocToYaml(clientDoc);
          clientDoc.destroy();
        }
      } else {
        this.logger.log(`[save] No client yjsState for ${kind}. Server-side conversion.`);

        if (existing?.yjsState) {
          const docName = `artifact:${workspaceId}:${kind}`;
          const connection = await this.hocuspocusService
            .getHocuspocus()
            .openDirectConnection(docName);

          await connection.transact((doc) => {
            const result = reconcileYamlIntoYDoc(doc, dto.yamlContent);
            yjsState = Y.encodeStateAsUpdate(doc) as Uint8Array<ArrayBuffer>;

            generatedYaml = yDocToYaml(doc);
            this.hocuspocusService.updateCachedYaml(docName, generatedYaml!);

            this.logger.log(`[save] Server reconciliation complete for ${kind}. Context: ${result.contextUpdated}`);
          });

          connection.disconnect();
        } else {
          const { yamlToYDoc } = await import('../collaboration/lib/yaml-to-ydoc.js');
          const bootstrapped = yamlToYDoc(dto.yamlContent);
          yjsState = Y.encodeStateAsUpdate(bootstrapped) as Uint8Array<ArrayBuffer>;
          generatedYaml = yDocToYaml(bootstrapped);
          bootstrapped.destroy();
          this.logger.log(`[save] Initial Y.Doc from YAML for ${kind}. ${yjsState.length} bytes.`);
        }
      }

      // Use generated yamlContent (from yDocToYaml) for DB storage.
      const yamlForDb = generatedYaml ?? dto.yamlContent;
      const contentChanged = !existing || existing.yamlContent !== yamlForDb;

      if (!contentChanged) {
        this.logger.log(`[save] Content unchanged for ${kind}. Skipping version increment.`);
      }

      const artifact = await this.prisma.$transaction(async (tx) => {
        const upserted = await tx.artifact.upsert({
          where: { workspaceId_kind: { workspaceId, kind } },
          create: {
            workspaceId,
            kind,
            title: dto.title ?? '',
            yamlContent: yamlForDb,
            ...(yjsState ? { yjsState } : {}),
            lastEditedBy: userId,
            version: 1,
          },
          update: {
            yamlContent: yamlForDb,
            ...(yjsState ? { yjsState } : {}),
            title: dto.title !== undefined ? dto.title : undefined,
            lastEditedBy: userId,
            ...(contentChanged ? { version: { increment: 1 } } : {}),
          },
        });

        // Only create version history entry if content changed
        if (contentChanged) {
          await tx.artifactVersion.create({
            data: {
              artifactId: upserted.id,
              version: upserted.version,
              yamlContent: yamlForDb,
              ...(yjsState ? { yjsState } : {}),
              changedBy: userId,
            },
          });
        }

        return upserted;
      });

      this.logger.log(
        `[save] DB transaction complete for ${kind}. ` +
        `Version: ${artifact.version}, yjsState saved: ${!!yjsState}.`,
      );

      // Fire-and-forget event recording
      this.eventService.recordEvent({
        projectId,
        workspaceId,
        artifactKind: kind,
        actorId: userId,
        action: 'artifact_saved',
        summary: `Saved ${kind} (v${artifact.version})`,
        details: { kind, title: artifact.title, version: artifact.version, contentChanged },
      }).catch((err) => this.logger.error(`[save] Event recording failed: ${err}`));

      return serialize(ArtifactResponseDto, this.toPlain(artifact));
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new AppException(
          ErrorCode.ARTIFACT_KIND_TAKEN,
          `An artifact of kind "${kind}" already exists in this workspace`,
          409,
        );
      }
      this.logger.error(`[save] Error saving artifact ${kind}: ${err}`);
      throw err;
    }
  }

  async updateStatus(
    workspaceId: string,
    kind: string,
    subjectId: string,
    status: string,
  ): Promise<ArtifactResponseDto> {
    const userId = await this.userService.resolveUserId(subjectId);
    const projectId = await this.assertWorkspaceAccess(workspaceId, userId);

    const artifact = await this.prisma.artifact.findUnique({
      where: { workspaceId_kind: { workspaceId, kind } },
    });

    if (!artifact) {
      throw new AppException(ErrorCode.ARTIFACT_NOT_FOUND, `Artifact "${kind}" not found`, 404);
    }

    const previousStatus = artifact.status;

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { firstName: true, lastName: true },
    });

    const updated = await this.prisma.artifact.update({
      where: { id: artifact.id },
      data: {
        status,
        statusChangedBy: userId,
        statusChangedByFirstName: user?.firstName ?? null,
        statusChangedByLastName: user?.lastName ?? null,
        statusChangedAt: new Date(),
      },
    });

    // Fire-and-forget event recording
    this.eventService.recordEvent({
      projectId,
      workspaceId,
      artifactKind: kind,
      actorId: userId,
      action: 'artifact_status_changed',
      summary: `${kind} status: ${previousStatus} → ${status}`,
      details: { kind, from: previousStatus, to: status },
    }).catch((err) => this.logger.error(`[updateStatus] Event recording failed: ${err}`));

    return serialize(ArtifactResponseDto, this.toPlain(updated));
  }

  async delete(workspaceId: string, kind: string, subjectId: string): Promise<void> {
    const userId = await this.userService.resolveUserId(subjectId);
    await this.assertWorkspaceAccess(workspaceId, userId);

    const artifact = await this.prisma.artifact.findUnique({
      where: { workspaceId_kind: { workspaceId, kind } },
    });

    if (!artifact) {
      throw new AppException(ErrorCode.ARTIFACT_NOT_FOUND, `Artifact "${kind}" not found`, 404);
    }

    await this.prisma.artifact.delete({ where: { id: artifact.id } });
  }

  // ─── Private ─────────────────────────────────────────────────────────────

  private async assertWorkspaceAccess(workspaceId: string, userId: string): Promise<string> {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { projectId: true },
    });

    if (!workspace) {
      throw new AppException(ErrorCode.WORKSPACE_NOT_FOUND, 'Workspace not found', 404);
    }

    await this.projectService.assertAccess(workspace.projectId, userId);
    return workspace.projectId;
  }

  private toPlain(artifact: {
    id: string;
    workspaceId: string;
    kind: string;
    title: string;
    status: string;
    statusChangedBy: string | null;
    statusChangedByFirstName: string | null;
    statusChangedByLastName: string | null;
    statusChangedAt: Date | null;
    yamlContent: string;
    version: number;
    lastEditedBy: string | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      kind: artifact.kind,
      title: artifact.title,
      status: artifact.status,
      statusChangedBy: artifact.statusChangedBy,
      statusChangedByFirstName: artifact.statusChangedByFirstName,
      statusChangedByLastName: artifact.statusChangedByLastName,
      statusChangedAt: artifact.statusChangedAt?.toISOString() ?? null,
      version: artifact.version,
      yamlContent: artifact.yamlContent,
      lastEditedBy: artifact.lastEditedBy,
      createdAt: artifact.createdAt.toISOString(),
      updatedAt: artifact.updatedAt.toISOString(),
    };
  }
}
