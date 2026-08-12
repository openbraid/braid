import { Controller, Get, Put, Patch, Delete, Param, Body } from '@nestjs/common';
import { ArtifactService } from './artifact.service.js';
import { SaveArtifactDto, UpdateStatusDto } from './dto/save-artifact.dto.js';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator.js';

@Controller('workspaces/:workspaceId/artifacts')
export class ArtifactController {
  constructor(private artifactService: ArtifactService) {}

  @Get()
  async findAll(
    @CurrentUser() user: AuthUser,
    @Param('workspaceId') workspaceId: string,
  ) {
    return this.artifactService.findAllByWorkspace(workspaceId, user.subjectId);
  }

  @Get(':kind')
  async findByKind(
    @CurrentUser() user: AuthUser,
    @Param('workspaceId') workspaceId: string,
    @Param('kind') kind: string,
  ) {
    return this.artifactService.findByKind(workspaceId, kind, user.subjectId);
  }

  @Put(':kind')
  async save(
    @CurrentUser() user: AuthUser,
    @Param('workspaceId') workspaceId: string,
    @Param('kind') kind: string,
    @Body() dto: SaveArtifactDto,
  ) {
    return this.artifactService.save(workspaceId, kind, user.subjectId, dto);
  }

  @Patch(':kind/status')
  async updateStatus(
    @CurrentUser() user: AuthUser,
    @Param('workspaceId') workspaceId: string,
    @Param('kind') kind: string,
    @Body() dto: UpdateStatusDto,
  ) {
    return this.artifactService.updateStatus(workspaceId, kind, user.subjectId, dto.status);
  }

  @Delete(':kind')
  async remove(
    @CurrentUser() user: AuthUser,
    @Param('workspaceId') workspaceId: string,
    @Param('kind') kind: string,
  ) {
    return this.artifactService.delete(workspaceId, kind, user.subjectId);
  }
}
