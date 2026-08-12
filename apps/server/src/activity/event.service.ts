import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import type { Prisma } from '@prisma/client';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RecordEventParams {
  projectId: string;
  workspaceId: string;
  artifactKind?: string;
  actorId?: string;
  action: string;
  summary: string;
  details?: Record<string, unknown>;
}

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class EventService {
  private readonly logger = new Logger('EventService');

  constructor(private prisma: PrismaService) {}

  /**
   * Record an activity event. Fire-and-forget — callers should .catch() errors
   * so event recording never blocks or fails the parent operation.
   */
  async recordEvent(params: RecordEventParams): Promise<void> {
    await this.prisma.activityEvent.create({
      data: {
        projectId: params.projectId,
        workspaceId: params.workspaceId,
        artifactKind: params.artifactKind ?? null,
        actorId: params.actorId ?? null,
        action: params.action,
        summary: params.summary,
        details: (params.details ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });
  }

  /**
   * Get events for a workspace within a time window.
   * Used to build activity feeds for a workspace.
   */
  async getWorkspaceEvents(workspaceId: string, since: Date, until: Date) {
    return this.prisma.activityEvent.findMany({
      where: {
        workspaceId,
        createdAt: { gte: since, lte: until },
      },
      orderBy: { createdAt: 'asc' },
      include: {
        actor: { select: { id: true, firstName: true, lastName: true } },
      },
    });
  }

  /**
   * Get events for a project within a time window.
   * Used by the activity feed on the project page.
   */
  async getProjectEvents(projectId: string, since: Date, until: Date, limit = 50) {
    return this.prisma.activityEvent.findMany({
      where: {
        projectId,
        createdAt: { gte: since, lte: until },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        actor: { select: { id: true, firstName: true, lastName: true } },
      },
    });
  }
}
