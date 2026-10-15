/**
 * Regenerates the tool table in README.md from the tools the built server
 * actually registers, so the docs cannot drift from the code.
 *
 *   bun run build && bun run docs:tools          # rewrite README.md
 *   bun run build && bun run docs:tools --check  # exit 1 if README.md is stale (CI)
 *
 * Spawns `node dist/index.js` (the published artifact, under plain Node) with
 * placeholder env, sends initialize + tools/list over stdio, and replaces the
 * block between the README markers. Nothing contacts a hub: tools/list is local.
 */

import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const START = "<!-- tools:start -->";
const END = "<!-- tools:end -->";
const TIMEOUT_MS = 15_000;

interface ListedTool {
  name: string;
  description: string;
}

/** Display order and grouping. A tool matching no group fails the run. */
const GROUPS: ReadonlyArray<{ title: string; match: (name: string) => boolean }> = [
  { title: "Cohorts & sessions", match: (n) => /^(cohort_|session_series_|zoom_meeting_)/.test(n) },
  { title: "Instructors", match: (n) => n.startsWith("instructor_") },
  { title: "Courses, lessons & media", match: (n) => /^(program_|lesson_|media_)/.test(n) },
  { title: "Leads (CRM)", match: (n) => n.startsWith("lead_") },
  { title: "Email & messaging", match: (n) => /^(drip_|broadcast_|certificate_)/.test(n) },
  { title: "Memberships", match: (n) => n.startsWith("membership_") },
  { title: "Venue events", match: (n) => n.startsWith("venue_") },
];

function isListedTool(value: unknown): value is ListedTool {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { name?: unknown }).name === "string" &&
    typeof (value as { description?: unknown }).description === "string"
  );
}

function listTools(): Promise<ListedTool[]> {
  return new Promise((resolve, reject) => {
    const proc = spawn("node", ["dist/index.js"], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, HUB_BASE_URL: "https://hub.example.com", HUB_MCP_TOKEN: "placeholder" },
    });
    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      reject(new Error(`tools/list did not answer within ${TIMEOUT_MS} ms`));
    }, TIMEOUT_MS);
    let stderr = "";
    let buffer = "";
    proc.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    proc.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    proc.on("exit", (code) => {
      clearTimeout(timer);
      if (code !== 0 && code !== null) reject(new Error(`server exited ${code}: ${stderr.trim()}`));
    });
    proc.stdout.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      for (let nl = buffer.indexOf("\n"); nl >= 0; nl = buffer.indexOf("\n")) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        const msg = JSON.parse(line) as { id?: number; result?: { tools?: unknown }; error?: unknown };
        if (msg.id !== 2) continue;
        clearTimeout(timer);
        proc.kill();
        const tools = msg.result?.tools;
        if (!Array.isArray(tools) || !tools.every(isListedTool)) {
          reject(new Error(`unexpected tools/list response: ${line}`));
          return;
        }
        resolve(tools);
      }
    });
    const send = (m: object) => proc.stdin.write(`${JSON.stringify(m)}\n`);
    send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "readme-tools", version: "0" } },
    });
    send({ jsonrpc: "2.0", method: "notifications/initialized" });
    send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  });
}

/** First sentence of the description's first paragraph, on one line. */
function summarize(description: string): string {
  const paragraph = (description.split(/\n\s*\n/)[0] ?? "").replace(/-\n\s*/g, "-").replace(/\s*\n\s*/g, " ").trim();
  const sentence = paragraph.match(/^.+?[.!?](?=\s|$)/)?.[0] ?? paragraph;
  return sentence.replace(/\|/g, "\\|");
}

function render(tools: ListedTool[]): string {
  const lines: string[] = [`${tools.length} tools.`, ""];
  const placed = new Set<string>();
  for (const group of GROUPS) {
    const members = tools.filter((t) => group.match(t.name));
    if (members.length === 0) continue;
    lines.push(`### ${group.title}`, "", "| Tool | What it does |", "|---|---|");
    for (const t of members) {
      lines.push(`| \`${t.name}\` | ${summarize(t.description)} |`);
      placed.add(t.name);
    }
    lines.push("");
  }
  const orphans = tools.filter((t) => !placed.has(t.name)).map((t) => t.name);
  if (orphans.length > 0) throw new Error(`tools with no README group: ${orphans.join(", ")}`);
  return lines.join("\n").trimEnd();
}

const tools = await listTools();
const readme = readFileSync("README.md", "utf8");
const start = readme.indexOf(START);
const end = readme.indexOf(END);
if (start < 0 || end < start) throw new Error(`README.md is missing the ${START} / ${END} markers`);
const next = `${readme.slice(0, start + START.length)}\n${render(tools)}\n${readme.slice(end)}`;

if (process.argv.includes("--check")) {
  if (next !== readme) {
    console.error("README.md tool table is stale — run: bun run build && bun run docs:tools");
    process.exit(1);
  }
  console.error(`README.md tool table is current (${tools.length} tools).`);
} else {
  writeFileSync("README.md", next);
  console.error(`README.md tool table rewritten (${tools.length} tools).`);
}
