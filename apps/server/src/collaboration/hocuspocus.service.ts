// ─── Hocuspocus WebSocket Server ──────────────────────────────────────────────
// Wraps Hocuspocus as a NestJS service. Handles:
//   onAuthenticate — authenticates via AuthService (honouring AUTH_MODE),
//                    resolves the user, checks workspace access
//   onLoadDocument — loads yjsState from PostgreSQL (or bootstraps from YAML)
//   onStoreDocument — saves yjsState + exported YAML to PostgreSQL

import {
  Injectable,
  Logger,
  type OnModuleInit,
  type OnModuleDestroy,
} from '@nestjs/common';
import { Hocuspocus } from '@hocuspocus/server';
import { WebSocketServer } from 'ws';
import * as Y from 'yjs';
import type { IncomingHttpHeaders } from 'node:http';
import { AuthService } from '../auth/auth.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { UserService } from '../user/user.service.js';
import { ProjectService } from '../project/project.service.js';
import { yamlToYDoc } from './lib/yaml-to-ydoc.js';
import { yDocToYaml } from './lib/ydoc-to-yaml.js';

@Injectable()
export class HocuspocusService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('HocuspocusService');
  private hocuspocus: Hocuspocus;
  private wss: WebSocketServer;

  // In-memory cached yamlContent per document. Used to detect real content
  // changes in onStoreDocument (vs comment/cursor changes).
  private lastYamlContent = new Map<string, string>();

  /**
   * Called by ArtifactService after reconciliation. Updates the cached
   * yamlContent so that onStoreDocument (triggered by disconnect) sees
   * matching content and skips version increment.
   */
  updateCachedYaml(documentName: string, yamlContent: string): void {
    this.lastYamlContent.set(documentName, yamlContent);
  }

  constructor(
    private authService: AuthService,
    private prisma: PrismaService,
    private userService: UserService,
    private projectService: ProjectService,
  ) {
    this.hocuspocus = new Hocuspocus({
      debounce: 3000,
      maxDebounce: 10000,
      quiet: true,
      unloadImmediately: true, // Unload document when last client disconnects — next connection loads fresh from DB

      onAuthenticate: async ({
        token,
        documentName,
        requestHeaders,
        requestParameters,
      }) => {
        return this.handleAuthenticate(
          token,
          documentName,
          requestHeaders,
          requestParameters,
        );
      },

      onLoadDocument: async ({ document, documentName }) => {
        return this.handleLoadDocument(document, documentName);
      },

      onStoreDocument: async ({ document, documentName }) => {
        return this.handleStoreDocument(document, documentName);
      },
    });

    // WebSocket server with noServer mode — upgrades handled in main.ts
    this.wss = new WebSocketServer({ noServer: true });
  }

  onModuleInit() {
    // Server is configured but doesn't listen on its own port —
    // we handle HTTP upgrades in main.ts
  }

  onModuleDestroy() {
    this.wss.close();
    this.hocuspocus.closeConnections();
  }

  /** Expose the Hocuspocus instance for direct connections (reconciliation) */
  getHocuspocus(): Hocuspocus {
    return this.hocuspocus;
  }

  /** Handle HTTP upgrade — create WebSocket and pass to Hocuspocus */
  handleUpgrade(
    request: import('http').IncomingMessage,
    socket: import('stream').Duplex,
    head: Buffer,
  ): void {
    this.wss.handleUpgrade(request, socket, head, (ws) => {
      this.hocuspocus.handleConnection(ws, request);
    });
  }

  // ─── Hooks ──────────────────────────────────────────────────────────────────

  private async handleAuthenticate(
    token: string,
    documentName: string,
    requestHeaders: IncomingHttpHeaders,
    requestParameters: URLSearchParams,
  ): Promise<{ userId: string; subjectId: string }> {
    // Delegated to AuthService so the socket honours AUTH_MODE exactly as the
    // HTTP guard does. A WebSocket that authenticates differently from the REST
    // API is a bypass waiting to be found.
    const { subjectId } = await this.authService.authenticateWebSocket(
      token,
      requestHeaders,
      requestParameters,
    );

    // Resolve internal user ID
    const userId = await this.userService.resolveUserId(subjectId);

    // Parse document name: "artifact:{workspaceId}:{kind}"
    const { workspaceId } = this.parseDocumentName(documentName);

    // Check workspace access
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { projectId: true },
    });

    if (!workspace) {
      throw new Error('Workspace not found');
    }

    await this.projectService.assertAccess(workspace.projectId, userId);

    return { userId, subjectId };
  }

  private async handleLoadDocument(
    document: Y.Doc,
    documentName: string,
  ): Promise<void> {
    const { workspaceId, kind } = this.parseDocumentName(documentName);

    const artifact = await this.prisma.artifact.findUnique({
      where: { workspaceId_kind: { workspaceId, kind } },
      select: { yjsState: true, yamlContent: true },
    });

    if (!artifact) {
      this.logger.log(
        `[onLoadDocument] No artifact found for ${documentName}. Returning empty doc.`,
      );
      return;
    }

    if (artifact.yjsState) {
      this.logger.log(
        `[onLoadDocument] Loading yjsState for ${documentName} (${artifact.yjsState.length} bytes).`,
      );
      Y.applyUpdate(document, artifact.yjsState);
    } else if (artifact.yamlContent) {
      this.logger.log(
        `[onLoadDocument] No yjsState — bootstrapping from YAML for ${documentName} ` +
          `(${artifact.yamlContent.length} chars).`,
      );
      const bootstrapped = yamlToYDoc(artifact.yamlContent);
      const state = Y.encodeStateAsUpdate(bootstrapped);
      Y.applyUpdate(document, state);
      bootstrapped.destroy();
    } else {
      this.logger.log(
        `[onLoadDocument] Artifact exists but no yjsState or yamlContent for ${documentName}.`,
      );
    }

    // Cache the canonical yamlContent for change detection in onStoreDocument.
    // Generate from the loaded Y.Doc so comparisons are apples-to-apples.
    const baselineYaml = yDocToYaml(document);
    this.lastYamlContent.set(documentName, baselineYaml);
    this.logger.log(
      `[onLoadDocument] Baseline for ${documentName}: yamlContent=${baselineYaml.length} chars`,
    );
  }

  private async handleStoreDocument(
    document: Y.Doc,
    documentName: string,
  ): Promise<void> {
    const { workspaceId, kind } = this.parseDocumentName(documentName);

    const yjsState = Y.encodeStateAsUpdate(document) as Uint8Array<ArrayBuffer>;

    // Generate yamlContent from Y.Doc and compare with cached version.
    // This detects ALL content changes — context edits, priority changes,
    // title changes, description edits — not just context fragment text.
    const currentYaml = yDocToYaml(document);
    const previousYaml = this.lastYamlContent.get(documentName);
    const contentChanged =
      previousYaml !== undefined && currentYaml !== previousYaml;

    if (contentChanged) {
      this.lastYamlContent.set(documentName, currentYaml);
      this.logger.log(
        `[onStoreDocument] CONTENT CHANGED for ${documentName}. ` +
          `prevLen=${previousYaml?.length} currLen=${currentYaml.length}`,
      );

      await this.prisma.artifact.update({
        where: { workspaceId_kind: { workspaceId, kind } },
        data: {
          yjsState,
          yamlContent: currentYaml,
          version: { increment: 1 },
        },
      });
    } else {
      this.logger.log(
        `[onStoreDocument] No content change for ${documentName}. Saving yjsState only.`,
      );

      await this.prisma.artifact.update({
        where: { workspaceId_kind: { workspaceId, kind } },
        data: {
          yjsState,
        },
      });
    }
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────

  private parseDocumentName(name: string): {
    workspaceId: string;
    kind: string;
  } {
    // Format: "artifact:{workspaceId}:{kind}"
    const parts = name.split(':');
    if (parts.length !== 3 || parts[0] !== 'artifact') {
      throw new Error(`Invalid document name: ${name}`);
    }
    return { workspaceId: parts[1], kind: parts[2] };
  }
}
