import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * The authenticated principal, attached to the request by AuthGuard.
 *
 * `subjectId` is the stable identifier for the caller and is provider-neutral:
 * in `oidc` mode it is the JWT `sub` claim; in `token` mode it is the
 * self-asserted email. It maps to `User.subjectId` in Prisma (column
 * `workos_id`, kept for backwards compatibility with existing databases).
 *
 * Note that in `token` mode every field here is client-supplied — see the
 * warning in auth.config.ts before exposing such a server publicly.
 */
export interface AuthUser {
  subjectId: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  picture?: string;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    const request = ctx.switchToHttp().getRequest<{ user: AuthUser }>();
    return request.user;
  },
);
