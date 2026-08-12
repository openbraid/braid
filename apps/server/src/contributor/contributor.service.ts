import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { UserService } from '../user/user.service.js';
import { ProjectService } from '../project/project.service.js';
import { AppException } from '../common/errors/app.exception.js';
import { ErrorCode } from '../common/errors/error-codes.js';
import { serialize, serializeArray } from '../common/serialize.js';
import { ContributorResponseDto } from './dto/contributor-response.dto.js';

@Injectable()
export class ContributorService {
  constructor(
    private prisma: PrismaService,
    private userService: UserService,
    private projectService: ProjectService,
  ) {}

  async invite(projectId: string, email: string, inviterSubjectId: string): Promise<ContributorResponseDto> {
    const inviterUserId = await this.userService.resolveUserId(inviterSubjectId);
    await this.projectService.assertAccess(projectId, inviterUserId);

    const targetUser = await this.prisma.user.findUnique({ where: { email } });
    if (!targetUser) {
      throw new AppException(
        ErrorCode.USER_NOT_FOUND,
        'No user found with that email address',
        404,
      );
    }

    const existing = await this.prisma.projectContributor.findUnique({
      where: { projectId_userId: { projectId, userId: targetUser.id } },
    });
    if (existing) {
      throw new AppException(
        ErrorCode.ALREADY_CONTRIBUTOR,
        'This user is already a contributor to this project',
        409,
      );
    }

    const contributor = await this.prisma.projectContributor.create({
      data: { projectId, userId: targetUser.id, role: 'contributor' },
      include: { user: { select: { id: true, email: true, firstName: true, lastName: true, picture: true } } },
    });

    return serialize(ContributorResponseDto, {
      userId: contributor.user.id,
      email: contributor.user.email,
      firstName: contributor.user.firstName,
      lastName: contributor.user.lastName,
      picture: contributor.user.picture,
      role: contributor.role,
      addedAt: contributor.addedAt.toISOString(),
    });
  }

  async getContributors(projectId: string, subjectId: string): Promise<ContributorResponseDto[]> {
    const userId = await this.userService.resolveUserId(subjectId);
    await this.projectService.assertAccess(projectId, userId);

    const contributors = await this.prisma.projectContributor.findMany({
      where: { projectId },
      include: {
        user: { select: { id: true, email: true, firstName: true, lastName: true, picture: true } },
      },
      orderBy: { addedAt: 'asc' },
    });

    return serializeArray(
      ContributorResponseDto,
      contributors.map((c) => ({
        userId: c.user.id,
        email: c.user.email,
        firstName: c.user.firstName,
        lastName: c.user.lastName,
        picture: c.user.picture,
        role: c.role,
        addedAt: c.addedAt.toISOString(),
      })),
    );
  }

  async remove(projectId: string, targetUserId: string, removerSubjectId: string): Promise<void> {
    const removerUserId = await this.userService.resolveUserId(removerSubjectId);
    await this.projectService.assertAccess(projectId, removerUserId);

    const target = await this.prisma.projectContributor.findUnique({
      where: { projectId_userId: { projectId, userId: targetUserId } },
    });

    if (!target) {
      throw new AppException(ErrorCode.NOT_FOUND, 'Contributor not found', 404);
    }

    if (target.role === 'owner') {
      throw new AppException(ErrorCode.CANNOT_REMOVE_OWNER, 'Cannot remove the project owner', 403);
    }

    await this.prisma.projectContributor.delete({
      where: { projectId_userId: { projectId, userId: targetUserId } },
    });
  }
}
