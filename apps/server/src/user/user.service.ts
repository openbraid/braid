import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AppException } from '../common/errors/app.exception.js';
import { ErrorCode } from '../common/errors/error-codes.js';
import type { User } from '@prisma/client';
import type { AuthUser } from '../auth/current-user.decorator.js';

@Injectable()
export class UserService {
  constructor(private prisma: PrismaService) {}

  /**
   * Resolve a subjectId (from JWT) to the internal User table ID.
   * Throws if the user hasn't been provisioned yet.
   * This is the single source of truth — all services should use this
   * instead of duplicating the lookup.
   */
  async resolveUserId(subjectId: string): Promise<string> {
    const user = await this.prisma.user.findUnique({ where: { subjectId } });
    if (!user) {
      throw new AppException(ErrorCode.USER_NOT_FOUND, 'Authenticated user not found in database', 401);
    }
    return user.id;
  }

  async findOrCreate(
    authUser: AuthUser,
    provider: string,
  ): Promise<User> {
    const existing = await this.prisma.user.findUnique({
      where: { subjectId: authUser.subjectId },
    });

    if (existing) {
      return this.prisma.user.update({
        where: { id: existing.id },
        data: {
          lastLoginAt: new Date(),
          firstName: authUser.firstName ?? existing.firstName,
          lastName: authUser.lastName ?? existing.lastName,
          picture: authUser.picture ?? existing.picture,
        },
      });
    }

    return this.prisma.user.create({
      data: {
        subjectId: authUser.subjectId,
        email: authUser.email!,
        firstName: authUser.firstName ?? null,
        lastName: authUser.lastName ?? null,
        picture: authUser.picture ?? null,
        provider,
        lastLoginAt: new Date(),
      },
    });
  }

  async findBySubjectId(subjectId: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { subjectId },
    });
  }
}
