import { Controller, Get, Post, Patch, Delete, Param, Body } from '@nestjs/common';
import { ProjectService } from './project.service.js';
import { CreateProjectDto } from './dto/create-project.dto.js';
import { AddMonitoredCommandDto } from './dto/add-monitored-command.dto.js';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator.js';

@Controller('projects')
export class ProjectController {
  constructor(private projectService: ProjectService) {}

  @Post()
  async create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateProjectDto,
  ) {
    return this.projectService.create(user.subjectId, dto);
  }

  @Get()
  async findAll(@CurrentUser() user: AuthUser) {
    return this.projectService.findAllForUser(user.subjectId);
  }

  @Get(':id')
  async findOne(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    return this.projectService.findById(id, user.subjectId);
  }

  @Delete(':id')
  async remove(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    return this.projectService.delete(id, user.subjectId);
  }

  // ─── Project Settings ────────────────────────────────────────────────────

  @Get(':id/settings')
  async getSettings(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    return this.projectService.getSettings(id, user.subjectId);
  }

  @Patch(':id/settings')
  async updateSettings(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: { artifactsEnabled?: boolean; selectedAgents?: string[] },
  ) {
    return this.projectService.updateSettings(id, user.subjectId, body);
  }

  // ─── Monitored Commands ──────────────────────────────────────────────────

  @Get(':id/monitored-commands')
  async getMonitoredCommands(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    return this.projectService.getMonitoredCommands(id, user.subjectId);
  }

  @Post(':id/monitored-commands')
  async addMonitoredCommand(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: AddMonitoredCommandDto,
  ) {
    return this.projectService.addMonitoredCommand(id, dto.command, user.subjectId);
  }

  @Delete(':id/monitored-commands/:command')
  async removeMonitoredCommand(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('command') command: string,
  ) {
    return this.projectService.removeMonitoredCommand(id, command, user.subjectId);
  }
}
