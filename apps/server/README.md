# Braid server

The optional Braid backend: a NestJS + Prisma + PostgreSQL API, plus a WebSocket
endpoint for real-time collaborative editing.

It is built to be self-hosted. The default setup is one command, runs entirely
on your own machine, and talks to nothing on the internet.

- REST API — `http://<host>:3003/v1`
- Health check — `http://<host>:3003/health` (unauthenticated)
- Collaboration WebSocket — `ws://<host>:3003/collaboration/{workspaceId}/{kind}`

---

## Quick start

```bash
cp .env.example .env
# set AUTH_TOKEN (openssl rand -hex 32) and POSTGRES_PASSWORD
docker compose up -d

curl http://localhost:3003/health   # {"status":"ok"}
```

That's it. You get the API and a PostgreSQL container with a named volume, so
your data survives restarts, rebuilds and `docker compose down`. Database
migrations run automatically when the API container starts.

To upgrade later: `git pull && docker compose up -d --build`.
To stop: `docker compose down` (add `-v` only if you also want the database
deleted).

---

## Choosing a setup

**You do not need a domain name, and you do not need HTTPS.** Plain HTTP over a
network you control is a supported, first-class configuration — pick the first
of these that describes you.

### 1. Just me, on this machine

The quick start above. Nothing is exposed beyond your computer if you set
`API_BIND=127.0.0.1` in `.env`; leave it at the default `0.0.0.0` if you also
want to reach it from other devices on your LAN.

```
AUTH_MODE=token
AUTH_TOKEN=<openssl rand -hex 32>
POSTGRES_PASSWORD=<anything>
```

### 2. A small team, over Tailscale

The simplest way to share the server with a few people without a domain,
certificates, or opening a port to the internet. [Tailscale](https://tailscale.com)
puts everyone on one encrypted private network; the traffic is encrypted by
WireGuard, so HTTP over the tailnet is not plaintext on the wire.

1. Install Tailscale on the server and on each teammate's machine, all signed
   into the same tailnet.
2. Run the quick start on the server with `API_BIND=0.0.0.0`.
3. Teammates point their client at `http://<server-tailscale-name>:3003`.

Firewall the port to the tailnet if the host is also on a public network —
`AUTH_MODE=token` is the right choice here, but only because everyone who can
reach the port is already someone you trust. Read the caveat under
[Authentication](#authentication) before you deploy it anywhere wider.

A LAN-only box or a private VPC subnet is the same shape of deployment and gets
the same configuration.

### 3. A public domain, with HTTPS

Only worth doing if the server must be reachable from the open internet. The
`tls` profile adds a [Caddy](https://caddyserver.com) container that obtains and
renews a Let's Encrypt certificate automatically.

Prerequisites: `DOMAIN` already resolves to this host, and ports 80 and 443 are
reachable (Caddy needs 80 for the ACME challenge and the HTTPS redirect).

```bash
# in .env
DOMAIN=api.example.com
AUTH_MODE=oidc          # see below — do not expose token mode publicly
OIDC_ISSUER=...
OIDC_JWKS_URL=...

docker compose --profile tls up -d
```

Clients then use `https://api.example.com/v1` and
`wss://api.example.com/collaboration/...`. Caddy proxies WebSocket upgrades
without any extra configuration.

The profile is opt-in because most deployments do not want it: on localhost,
a LAN, a tailnet, or behind a platform load balancer that already terminates
TLS, a second proxy adds a moving part and a certificate that cannot be issued.

If you already run your own reverse proxy (nginx, Traefik, a cloud load
balancer), skip the profile entirely and point it at port 3003.

---

## Authentication

Every route requires authentication except `/health`. Two modes, selected with
`AUTH_MODE`.

### `token` (default)

Clients send the shared secret as a bearer token, and state who they are in
headers:

```
Authorization: Bearer $AUTH_TOKEN
x-user-email: ada@example.com
x-user-name: Ada Lovelace
```

For the collaboration WebSocket the same values go in the query string
(`?x-user-email=…&x-user-name=…`), because browsers cannot set headers on a
WebSocket handshake.

> **Identity in this mode is self-asserted.** The token proves only that the
> caller knows `AUTH_TOKEN`. The email is taken from a client-supplied header
> and believed as-is, so anyone holding the token can act as any user —
> including one they invent on the spot. There is exactly one trust boundary:
> who can reach the port.
>
> That is a reasonable trade for a server on localhost, a home or office LAN, a
> VPN, or a Tailscale tailnet, where the set of people who can reach it is
> already the set of people you trust. **Do not use it on a server the public
> internet can reach.** Use `oidc` there.

The server refuses to start if `AUTH_MODE=token` and `AUTH_TOKEN` is empty. It
will never fall back to accepting unauthenticated requests.

### `oidc`

Clients send a JWT from an identity provider. The server verifies the
signature against the provider's JWKS and checks the issuer; identity comes
from the verified `sub`, `email`, `name`/`given_name`/`family_name` and
`picture` claims. Any standards-compliant provider works — WorkOS, Auth0,
Keycloak, Okta, Dex, Google.

```
AUTH_MODE=oidc
OIDC_ISSUER=https://api.workos.com/user_management/<client_id>
OIDC_JWKS_URL=https://api.workos.com/sso/jwks/<client_id>
```

(WorkOS is shown because it is what the hosted deployment happens to use. It is
one possible configuration, not a dependency — substitute your provider's
issuer and JWKS URL.)

The server refuses to start if either variable is missing.

---

## Configuration

All variables live in `.env`. See `.env.example`, which carries the same list
with inline comments.

### Authentication

| Variable | Default | Notes |
|---|---|---|
| `AUTH_MODE` | `token` | `token` or `oidc`. |
| `AUTH_TOKEN` | — | Shared secret. **Required** when `AUTH_MODE=token`. |
| `OIDC_ISSUER` | — | Expected `iss` claim. **Required** when `AUTH_MODE=oidc`. |
| `OIDC_JWKS_URL` | — | Provider's JWKS endpoint. **Required** when `AUTH_MODE=oidc`. |

### Database

| Variable | Default | Notes |
|---|---|---|
| `POSTGRES_PASSWORD` | — | **Required** for the bundled Postgres container. |
| `POSTGRES_USER` | `coreapi` | Bundled Postgres username. |
| `POSTGRES_DB` | `coreapi` | Bundled Postgres database name. |
| `DATABASE_URL` | derived | Full connection string. Under docker compose it is derived from the `POSTGRES_*` values; set it explicitly to use an external or managed database, or when running outside Docker. |
| `DIRECT_URL` | `DATABASE_URL` | Only for hosted Postgres (Supabase, Neon, …) whose runtime connection goes through a pooler that cannot run DDL. Set to the direct connection string; `prisma migrate` uses it. |

### Networking

| Variable | Default | Notes |
|---|---|---|
| `PORT` | `3003` | Port the API listens on inside the container. |
| `API_PORT` | `3003` | Host port the API is published on. |
| `API_BIND` | `0.0.0.0` | Host interface to publish on. `127.0.0.1` restricts to this machine. |
| `DOMAIN` | — | Public hostname for Caddy. **Required only** with `--profile tls`. |

### Optional

| Variable | Default | Notes |
|---|---|---|
| `GEMINI_API_KEY` | — | Enables AI-suggested workspace names. Without it that endpoint returns an empty suggestion and nothing is sent anywhere. |

---

## Running without Docker

You need Node.js 22+ and a PostgreSQL you manage yourself.

```bash
npm install
cp .env.example .env        # set DATABASE_URL, AUTH_TOKEN
npx prisma migrate deploy   # or `npx prisma migrate dev` while developing
npm run start:dev
```

The API listens on `http://localhost:3003`.

## Development

```bash
npm run build       # compile
npm test            # unit tests
npm run lint        # eslint --fix
```

Prisma:

```bash
npx prisma generate                       # regenerate the client after schema edits
npx prisma migrate dev --name <change>    # create a migration (needs a live database)
npx prisma studio                         # browse the data
```

Read generated migration SQL before committing it. An additive-looking
migration that drops a column typechecks fine and loses data all the same.
