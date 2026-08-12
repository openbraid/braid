// ─── AuthService ─────────────────────────────────────────────────────────────
// The single place that turns a credential into an `AuthUser`. Both entry
// points into the server use it:
//   • AuthGuard        — HTTP requests (`Authorization: Bearer …`)
//   • HocuspocusService — WebSocket upgrades for collaborative editing
//
// Keeping one implementation matters: two copies of "is this caller allowed in"
// drift, and the copy that drifts is the one that stops checking. Whatever
// AUTH_MODE is set to applies identically to REST and to the Yjs socket.
//
// The auth configuration is resolved in the constructor, which Nest runs during
// bootstrap — so a bad configuration crashes the process at startup with an
// explanatory message rather than 500-ing on the first request.

import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, timingSafeEqual } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { IncomingHttpHeaders } from 'node:http';
import type { AuthUser } from './current-user.decorator.js';
import { AuthMode, resolveAuthConfig, type AuthConfig } from './auth.config.js';

/** Header/query keys a `token`-mode client uses to declare who it is. */
const IDENTITY_EMAIL_KEY = 'x-user-email';
const IDENTITY_NAME_KEY = 'x-user-name';

/** Anything that can supply identity hints: HTTP headers or WS query params. */
type IdentitySource = (key: string) => string | undefined;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly config: AuthConfig;

  /** Only built in oidc mode; jose caches and rotates the key set internally. */
  private readonly jwks?: ReturnType<typeof createRemoteJWKSet>;

  constructor(configService: ConfigService) {
    this.config = resolveAuthConfig(configService);

    if (this.config.mode === AuthMode.Oidc) {
      this.jwks = createRemoteJWKSet(this.config.jwksUrl);
      this.logger.log(`Auth mode: oidc (issuer ${this.config.issuer})`);
    } else {
      // Loud on purpose. An operator who set AUTH_MODE=token without reading
      // the docs should learn about the trade-off from their own logs.
      this.logger.warn(
        'Auth mode: token — identity is SELF-ASSERTED. Any client holding ' +
          'AUTH_TOKEN can claim any email via the x-user-email header. Run this ' +
          'only on a trusted network (localhost, LAN, VPN, tailnet). Use ' +
          'AUTH_MODE=oidc for a publicly reachable server.',
      );
    }
  }

  get mode(): AuthMode {
    return this.config.mode;
  }

  // ─── HTTP ──────────────────────────────────────────────────────────────────

  /** Authenticate an Express request. Throws UnauthorizedException on failure. */
  async authenticateHttp(headers: IncomingHttpHeaders): Promise<AuthUser> {
    const authHeader = headers['authorization'];
    if (typeof authHeader !== 'string' || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing bearer token');
    }

    return this.authenticate(authHeader.slice(7), (key) => {
      const value = headers[key];
      return Array.isArray(value) ? value[0] : value;
    });
  }

  // ─── WebSocket ─────────────────────────────────────────────────────────────

  /**
   * Authenticate a Hocuspocus connection.
   *
   * Browsers cannot set headers on a WebSocket handshake, so in `token` mode
   * the identity hints are read from the connection's query parameters
   * (`?x-user-email=…`) and only fall back to headers for non-browser clients.
   */
  async authenticateWebSocket(
    token: string,
    requestHeaders: IncomingHttpHeaders,
    requestParameters: URLSearchParams,
  ): Promise<AuthUser> {
    if (!token) {
      throw new UnauthorizedException('Missing authentication token');
    }

    return this.authenticate(token, (key) => {
      const fromQuery = requestParameters.get(key);
      if (fromQuery) return fromQuery;
      const value = requestHeaders[key];
      return Array.isArray(value) ? value[0] : value;
    });
  }

  // ─── Shared ────────────────────────────────────────────────────────────────

  private async authenticate(
    token: string,
    identity: IdentitySource,
  ): Promise<AuthUser> {
    const start = Date.now();

    try {
      const user =
        this.config.mode === AuthMode.Token
          ? this.authenticateSharedToken(token, identity)
          : await this.authenticateOidc(token);

      const duration = Date.now() - start;
      if (duration > 500) {
        this.logger.warn(`Slow token verification: ${duration}ms`);
      }
      return user;
    } catch (err) {
      if (err instanceof UnauthorizedException) throw err;
      this.logger.warn(
        `Token verification failed after ${Date.now() - start}ms: ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
      throw new UnauthorizedException('Invalid or expired token');
    }
  }

  /**
   * `token` mode.
   *
   * ⚠️  THE RETURNED IDENTITY IS SELF-ASSERTED. ⚠️
   * The only thing verified here is knowledge of the shared secret. The email
   * and display name are copied verbatim from client-controlled input, so any
   * holder of AUTH_TOKEN can act as any user — including one that does not
   * exist yet. Appropriate for a trusted network only; see auth.config.ts.
   */
  private authenticateSharedToken(
    token: string,
    identity: IdentitySource,
  ): AuthUser {
    if (this.config.mode !== AuthMode.Token) {
      throw new Error('authenticateSharedToken called outside token mode');
    }

    if (!this.constantTimeEquals(token, this.config.token)) {
      throw new UnauthorizedException('Invalid token');
    }

    const email = identity(IDENTITY_EMAIL_KEY)?.trim();
    if (!email) {
      throw new UnauthorizedException(
        `Missing ${IDENTITY_EMAIL_KEY} — AUTH_MODE=token takes the caller's identity from that header.`,
      );
    }

    const { firstName, lastName } = splitName(identity(IDENTITY_NAME_KEY));

    // The email doubles as the subject: token mode has no identity provider and
    // therefore no stable opaque `sub` to key users on. Changing someone's
    // email in this mode creates a new user, which is the honest behaviour —
    // nothing here can prove the two addresses are the same person.
    return { subjectId: email, email, firstName, lastName };
  }

  /** `oidc` mode — verify the JWT against the configured issuer and JWKS. */
  private async authenticateOidc(token: string): Promise<AuthUser> {
    if (this.config.mode !== AuthMode.Oidc || !this.jwks) {
      throw new Error('authenticateOidc called outside oidc mode');
    }

    const { payload } = await jwtVerify(token, this.jwks, {
      issuer: this.config.issuer,
    });

    if (!payload.sub) {
      throw new UnauthorizedException('Token has no subject (`sub`) claim');
    }

    // Providers disagree about name claims: OIDC core specifies `name`,
    // `given_name` and `family_name`; WorkOS emits `first_name`/`last_name`.
    // Accept both rather than requiring a provider-specific guard.
    const explicitFirst =
      (payload.first_name as string | undefined) ??
      (payload.given_name as string | undefined);
    const explicitLast =
      (payload.last_name as string | undefined) ??
      (payload.family_name as string | undefined);
    const fromFullName = splitName(payload.name as string | undefined);

    return {
      subjectId: payload.sub,
      email: payload.email as string | undefined,
      firstName: explicitFirst ?? fromFullName.firstName,
      lastName: explicitLast ?? fromFullName.lastName,
      picture: payload.picture as string | undefined,
    };
  }

  /**
   * Compare a presented token with the configured secret without leaking
   * information through timing. Both sides are hashed first so that
   * `timingSafeEqual` always sees equal-length buffers — comparing raw strings
   * would either throw on a length mismatch or leak the secret's length.
   */
  private constantTimeEquals(presented: string, expected: Buffer): boolean {
    const a = createHash('sha256').update(presented, 'utf8').digest();
    const b = createHash('sha256').update(expected).digest();
    return timingSafeEqual(a, b);
  }
}

/** "Ada Lovelace" → { firstName: 'Ada', lastName: 'Lovelace' }. */
function splitName(full: string | undefined): {
  firstName: string | undefined;
  lastName: string | undefined;
} {
  const trimmed = full?.trim();
  if (!trimmed) return { firstName: undefined, lastName: undefined };
  const [first, ...rest] = trimmed.split(/\s+/);
  return { firstName: first, lastName: rest.join(' ') || undefined };
}
