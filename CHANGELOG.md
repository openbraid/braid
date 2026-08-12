# Changelog

Notable changes to Braid. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Braid's first public release. It was previously a closed-source product called
Tracigo with a mandatory cloud backend; that dependency is gone and it now runs
fully offline by default.

### Added
- **Local mode**, the default — SQLite is the source of truth, with no account,
  no login and no network. Identity comes from `git config`.
- **Optional self-hosted server** (`apps/server/`) for live co-editing,
  comments, presence and invites, with shared-token or OIDC authentication.
- Capability registry so server-backed features degrade cleanly when no server
  is configured, instead of failing with network errors.
- Migration from the pre-rename `~/.tracigo` directory and `tracigo.db`, and
  continued support for reading `.tracigo/` artifact directories on older
  branches.

### Changed
- Telemetry is opt-in and off unless explicitly enabled.
- Artifact directories are now named `.braid/`.

### Removed
- The mandatory cloud backend and the daily digest feature.
