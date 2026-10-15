# Changelog

All notable changes to this package are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [1.0.0] - 2026-10-13

First public release as `@aistartacademy/hub-mcp`, alongside the open-source hub.

### Added

- 40 tools over stdio covering cohorts and session series, instructors, courses, lessons and
  media, leads, drip email and broadcasts, certificates, memberships, and venue events.
  Every write is a two-step preview → confirm with single-use, 10-minute previews.
- `hub-mcp` binary (runs under plain Node.js 18+; build from source for now, npm package to follow). The
  previous `aisa-hub-mcp` binary name is kept as an alias.
- `HUB_DEFAULT_TIMEZONE` to set the timezone used when a call omits one (default
  `America/Los_Angeles`, unchanged from before), validated at startup.
- README tool table generated from the registered tools (`bun run docs:tools`, `--check` in CI).

### Changed

- Tool descriptions and messages are generic ("the hub") instead of naming one academy.
- MCP server identity is `hub-mcp` 1.0.0.

### Removed

- `drip_campaign_duplicate`. It called `POST /api/internal/mcp/v1/drip/duplicate`, which the
  public hub v1 does not expose. It may return once the hub ships that route.

### Known limitations

- `session_series_create`'s optional `location` is ignored by hubs without session-series
  location support.
- `cohort_create` and `zoom_meeting_delete` still use the hub's pre-v1 routes
  (`/api/internal/mcp/cohort`, `/api/internal/mcp/cohort/zoom`).
- stdio transport only.
