# Contributing

Thanks for helping. Issues and pull requests are welcome on
[GitHub](https://github.com/AiStartAcademy/hub-mcp).

## Setup

You need [Bun](https://bun.sh) for development (the published package runs on plain Node 18+).

```bash
bun install
bun run typecheck
bun test
bun run build
```

## Ground rules

- **The hub owns the logic.** This server only translates MCP calls into requests to the hub's
  `/api/internal/mcp/v1/*` API, and `src/hub-client.ts` is the only file that talks to the hub.
  If a change needs new data or a new rule, it belongs in the hub first.
- **Writes are two-step.** Any tool that changes data defaults to a dry run, returns a
  `previewId`, and commits only the stored preview on `confirm: true`. Respect
  `HUB_MCP_READONLY`. A one-step write needs a written reason in the PR.
- **No hard deletes.** Archive through status fields.
- **stdout is the protocol.** Diagnostics go to stderr only.
- **Tests first.** Add or change a test in `tests/` that fails before your change and passes
  after it. Every PR must pass typecheck, tests and build.
- **Keep the README in sync.** After adding, removing or re-describing a tool, run
  `bun run build && bun run docs:tools` and commit the README change; CI checks it.
- Keep tool descriptions generic: no organisation names, addresses or people.

## Security issues

Please report vulnerabilities privately through GitHub security advisories, not public issues.
