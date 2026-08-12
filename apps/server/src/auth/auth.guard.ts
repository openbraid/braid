// ─── AuthGuard ───────────────────────────────────────────────────────────────
// Global guard (registered via APP_GUARD in auth.module.ts). Every route is
// protected unless it carries @Public().
//
// The guard itself is mode-agnostic — it delegates to AuthService and only owns
// the Nest-specific parts: honouring @Public() and attaching the resolved
// AuthUser to the request so @CurrentUser() can read it. That contract is what
// every controller depends on; do not change the request property name.

import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { AuthUser } from './current-user.decorator.js';
import { AuthService } from './auth.service.js';
import { AuthMode } from './auth.config.js';
import { UserService } from '../user/user.service.js';
import { IS_PUBLIC_KEY } from './public.decorator.js';

@Injectable()
export class AuthGuard implements CanActivate {
  // subjectIds already provisioned in this process. Token mode has no sign-in
  // step, so the first authenticated request is also the account's creation —
  // but that must not mean a database write on every subsequent request.
  private readonly provisioned = new Set<string>();

  constructor(
    private readonly authService: AuthService,
    private readonly userService: UserService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthUser }>();

    const user = await this.authService.authenticateHttp(request.headers);
    if (!user.subjectId) {
      // Defensive: AuthService already rejects this, but an empty subject would
      // silently resolve to "some user" downstream, so never let one through.
      throw new UnauthorizedException('Authenticated principal has no subject');
    }

    // OIDC mode provisions the account through POST /users/me after sign-in.
    // Token mode has no sign-in, so without this the very first request from a
    // new member fails with USER_NOT_FOUND and the server is unusable in its
    // default configuration.
    //
    // This grants no access that the shared token did not already grant: in
    // token mode identity is self-asserted by design, and it is documented as
    // only appropriate on a trusted network.
    if (
      this.authService.mode === AuthMode.Token &&
      !this.provisioned.has(user.subjectId)
    ) {
      await this.userService.findOrCreate(user, 'shared-token');
      this.provisioned.add(user.subjectId);
    }

    request.user = user;
    return true;
  }
}
