// ─── Auth configuration ──────────────────────────────────────────────────────
// Resolves AUTH_MODE and its mode-specific variables into a validated,
// discriminated union. Resolution happens once, in AuthService's constructor,
// so a misconfigured server fails at boot rather than at the first request.
//
// The two modes exist because self-hosters are not all the same deployment:
//   token — a shared secret. Zero external dependencies, works on a laptop, a
//           LAN box or a Tailscale tailnet. This is the default.
//   oidc  — a real identity provider (WorkOS, Auth0, Keycloak, Okta, Dex, …).
//           Provider-neutral: it needs an issuer and a JWKS URL, nothing more.
//
// There is deliberately no third "off" mode. A server that accepts every
// request is a data breach with extra steps, so the absence of configuration
// is an error, never a silent bypass.

import type { ConfigService } from '@nestjs/config';

export const AuthMode = {
  Token: 'token',
  Oidc: 'oidc',
} as const;

export type AuthMode = (typeof AuthMode)[keyof typeof AuthMode];

/**
 * Shared-secret mode.
 *
 * ⚠️  IDENTITY IN THIS MODE IS SELF-ASSERTED. ⚠️
 * The bearer token proves only that the caller knows AUTH_TOKEN. It says
 * nothing about *who* the caller is — the email and name come from the
 * `x-user-email` / `x-user-name` request headers, which any client can set to
 * anything. Every holder of AUTH_TOKEN can therefore act as every user in the
 * database, including ones they invent.
 *
 * That is an acceptable trade-off on a trusted network (localhost, a home LAN,
 * a Tailscale tailnet, a private VPC) where the set of people who can reach the
 * port is already the set of people you trust. It is NOT acceptable on a
 * server exposed to the public internet. Use `oidc` there.
 */
export interface TokenAuthConfig {
  mode: typeof AuthMode.Token;
  /** Raw secret bytes, pre-encoded so the hot path only does the comparison. */
  token: Buffer;
}

/** OIDC mode — any provider that publishes a JWKS endpoint. */
export interface OidcAuthConfig {
  mode: typeof AuthMode.Oidc;
  issuer: string;
  jwksUrl: URL;
}

export type AuthConfig = TokenAuthConfig | OidcAuthConfig;

/** Thrown at startup when the auth configuration is unusable. */
export class AuthConfigError extends Error {
  readonly code = 'AUTH_CONFIG_INVALID';

  constructor(message: string) {
    super(message);
    this.name = 'AuthConfigError';
  }
}

function required(config: ConfigService, key: string, because: string): string {
  const value = config.get<string>(key)?.trim();
  if (!value) {
    throw new AuthConfigError(
      `${key} is not set. ${because}\n` +
        `See .env.example and the "Authentication" section of README.md.`,
    );
  }
  return value;
}

export function resolveAuthConfig(config: ConfigService): AuthConfig {
  // Default to `token`: it is the mode that works with no external service, so
  // it is what a first-time self-hoster gets from `docker compose up`.
  const raw = (
    config.get<string>('AUTH_MODE')?.trim() || AuthMode.Token
  ).toLowerCase();

  if (raw !== AuthMode.Token && raw !== AuthMode.Oidc) {
    throw new AuthConfigError(
      `AUTH_MODE="${raw}" is not recognised. Expected "${AuthMode.Token}" or "${AuthMode.Oidc}".`,
    );
  }

  if (raw === AuthMode.Token) {
    const token = required(
      config,
      'AUTH_TOKEN',
      'AUTH_MODE=token requires a shared secret for clients to present as a bearer token.',
    );
    return { mode: AuthMode.Token, token: Buffer.from(token, 'utf8') };
  }

  const issuer = required(
    config,
    'OIDC_ISSUER',
    'AUTH_MODE=oidc requires the issuer (the `iss` claim) that tokens must carry.',
  );
  const jwksUrlRaw = required(
    config,
    'OIDC_JWKS_URL',
    'AUTH_MODE=oidc requires the URL of the provider’s JSON Web Key Set.',
  );

  let jwksUrl: URL;
  try {
    jwksUrl = new URL(jwksUrlRaw);
  } catch {
    throw new AuthConfigError(
      `OIDC_JWKS_URL="${jwksUrlRaw}" is not a valid URL.`,
    );
  }

  return { mode: AuthMode.Oidc, issuer, jwksUrl };
}
