import { Controller, Get, Post, Patch, Delete, Param, Body, Query } from '@nestjs/common';
import { WorkspaceService } from './workspace.service.js';
import { CreateWorkspaceDto } from './dto/create-workspace.dto.js';
import { UpdateLifecycleStatusDto } from './dto/update-lifecycle-status.dto.js';
import { SuggestNameDto } from './dto/suggest-name.dto.js';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator.js';

@Controller('workspaces')
export class WorkspaceController {
  constructor(private workspaceService: WorkspaceService) {}

  @Post('suggest-name')
  async suggestName(@Body() dto: SuggestNameDto) {
    return this.workspaceService.suggestName(dto.text);
  }

  @Post()
  async create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateWorkspaceDto,
  ) {
    return this.workspaceService.create(user.subjectId, dto);
  }

  @Get()
  async findAll(
    @CurrentUser() user: AuthUser,
    @Query('projectId') projectId?: string,
  ) {
    if (projectId) {
      return this.workspaceService.findByProject(projectId, user.subjectId);
    }
    return this.workspaceService.findAll(user.subjectId);
  }

  @Get(':id')
  async findOne(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    return this.workspaceService.findById(id, user.subjectId);
  }

  @Patch(':id/lifecycle-status')
  async updateLifecycleStatus(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateLifecycleStatusDto,
  ) {
    return this.workspaceService.updateLifecycleStatus(id, user.subjectId, dto.lifecycleStatus);
  }

  @Post(':id/repos')
  async addRepo(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: { repoId: string },
  ) {
    return this.workspaceService.addRepo(id, body.repoId, user.subjectId);
  }

  @Delete(':id')
  async remove(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    return this.workspaceService.delete(id, user.subjectId);
  }
}
