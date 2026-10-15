# AGENTS.md

Guide for AI coding agents (Claude Code, Codex, Cursor and others) working on hub-mcp. Humans:
see [CONTRIBUTING.md](./CONTRIBUTING.md). Overview: [README.md](./README.md).

## What this is

A stdio MCP server (TypeScript, `@modelcontextprotocol/sdk` + `zod`) that lets an AI assistant
operate an academy [hub](https://github.com/AiStartAcademy/hub) through the hub's authenticated
internal API (`/api/internal/mcp/v1/*`). It is a thin adapter: no business logic and no database
access live here. The hub enforces every rule; this server shapes requests and readable results.

## Setup

```bash
bun install
bun run typecheck
bun test
bun run build        # dist/index.js, runs under plain Node 18+
```

Run against a hub: `HUB_BASE_URL=http://localhost:3000 HUB_MCP_TOKEN=... bun run dev`.

## Layout

- `src/index.ts`: builds the server and registers every tool (`server.tool(name, description, schema, handler)`).
- `src/tools/<tool-name>.ts`: one file per tool, exporting a zod schema and a `make…Handler(hub)` factory.
- `src/hub-client.ts`: the only place that talks HTTP to the hub (one method per endpoint).
- `src/preview-store.ts`: single-use, expiring dry-run previews for writes.
- `src/config.ts`: env parsing and validation at startup.
- `tests/`: `bun test` suites; `scripts/readme-tools.ts` regenerates the README tool table.

## Rules

- **Writes are two-step.** A write tool first runs with `dryRun` (the default) and returns a `previewId`; the
  commit call passes `previewId` and `confirm: true` and consumes it (single-use, expires). Never add a
  write that skips the preview.
- **Respect both kill switches.** `HUB_MCP_READONLY=true` here refuses commits; the hub's
  `HUB_MCP_WRITES_ENABLED` refuses writes server-side. Don't bypass either.
- **Every hub call goes through `hub-client.ts`**, and every endpoint you add must exist on the
  hub (`src/app/api/internal/mcp/v1/**` there). Check before you wire a tool to it.
- **No secrets or real data** in code, tests or fixtures. Use `hub.example.com` and fake ids.
- **No academy-specific wording** in tool descriptions: say "the hub" and use generic examples.
- **Tool descriptions are prompts.** They reach the client model verbatim: be precise about
  what the tool does, its side effects, and when not to use it.

## Recipe: add a tool

1. Confirm the hub endpoint and method exist.
2. Add a typed method to `src/hub-client.ts`.
3. Create `src/tools/<name>.ts` with a zod schema and a `make<Name>Handler(hub)` that returns a
   readable string (follow `src/tools/lead-get.ts` for reads, an existing `*-update` tool for writes).
4. Register it in `src/index.ts` with a clear description.
5. Add tests in `tests/`, then run `bun scripts/readme-tools.ts` to refresh the README table.

## Before you open a PR

```bash
bun run typecheck && bun test && bun run build && bun scripts/readme-tools.ts --check
```

CI runs the same, plus a `tools/list` smoke test of `dist/index.js` under Node 18, 20 and 22.
