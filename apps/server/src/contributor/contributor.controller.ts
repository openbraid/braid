import { Controller, Get, Post, Delete, Param, Body } from '@nestjs/common';
import { ContributorService } from './contributor.service.js';
import { InviteContributorDto } from './dto/invite-contributor.dto.js';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator.js';

@Controller('projects/:projectId/contributors')
export class ContributorController {
  constructor(private contributorService: ContributorService) {}

  @Post()
  async invite(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
    @Body() dto: InviteContributorDto,
  ) {
    return this.contributorService.invite(projectId, dto.email, user.subjectId);
  }

  @Get()
  async list(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
  ) {
    return this.contributorService.getContributors(projectId, user.subjectId);
  }

  @Delete(':userId')
  async remove(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
    @Param('userId') userId: string,
  ) {
    return this.contributorService.remove(projectId, userId, user.subjectId);
  }
}
