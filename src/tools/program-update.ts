/**
 * program_update — preview then commit, same contract as instructor_profile_update.
 *
 * Edits an EXISTING Program (course): name, description, cover, accessMode,
 * status. No create. PUBLISH GUARDRAIL: status:"open" is refused unless
 * publish:true is set in the same call — the one field here that could put
 * unfinished content in front of real students.
 */

import { z } from "zod";
import { HubError, type HubClient, type ProgramDetailItem, type ProgramField } from "../hub-client.js";
import type { Config } from "../config.js";
import type { PreviewStore } from "../preview-store.js";

const PROGRAM_FIELDS = ["name", "description", "cover", "accessMode", "status"] as const satisfies readonly ProgramField[];
const ACCESS_MODES = ["cohort", "direct", "auth", "public", "member"] as const;
const STATUSES = ["draft", "open", "archived", "raw"] as const;

export const programUpdateSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  description: z.string().optional(),
  cover: z.string().optional(),
  accessMode: z.enum(ACCESS_MODES).optional(),
  status: z.enum(STATUSES).optional(),
  publish: z.boolean().optional(),
  dryRun: z.boolean().optional().default(true),
  previewId: z.string().optional(),
  confirm: z.boolean().optional(),
});

export type ProgramUpdateInput = z.infer<typeof programUpdateSchema>;

export type ProgramUpdatePayload = { id: string; publish?: boolean } & Partial<
  Record<ProgramField, string>
>;

function hasOwn<K extends string>(value: object, key: K): value is Record<K, unknown> {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function renderValue(value: string | null): string {
  if (value === null) return "null";
  if (value === "") return '""';
  const singleLine = value.replace(/\s+/g, " ").trim();
  if (singleLine.length > 200) return `"${singleLine.slice(0, 150)}..." (${value.length} chars)`;
  return `"${singleLine}"`;
}

function warnings(payload: ProgramUpdatePayload, item: ProgramDetailItem): string[] {
  const lines: string[] = [];
  if (payload.status === "open" && item.status !== "open") {
    lines.push(
      `⚠ PUBLISH: status ${item.status} → open. This makes the course reachable by anyone`,
      `⚠ whose accessMode grants them access (accessMode=${payload.accessMode ?? item.accessMode}).`
    );
  }
  if (payload.accessMode && payload.accessMode !== item.accessMode) {
    lines.push(`⚠ ACCESS: ${item.accessMode} → ${payload.accessMode}.`);
  }
  return lines;
}

function renderPreview(
  payload: ProgramUpdatePayload,
  item: ProgramDetailItem,
  config: Config,
  diffLines: string[],
  previewId: string,
  expiresInMinutes: number
): string {
  const warning = warnings(payload, item);
  return [
    `PREVIEW · target: ${config.envLabel}`,
    `UPDATE program "${item.name}"`,
    `id: ${payload.id}`,
    "",
    ...diffLines,
    ...(warning.length ? ["", ...warning] : []),
    "",
    `previewId: ${previewId} · expires in ${expiresInMinutes} minutes`,
    "Nothing was committed.",
    "To commit: call program_update again with previewId and confirm: true",
  ].join("\n");
}

function renderCommit(
  id: string,
  changed: Partial<Record<ProgramField, { from: string | null; to: string | null }>>,
  unchanged: ProgramField[],
  config: Config
): string {
  const changedLines = Object.entries(changed).map(
    ([field, diff]) => `${field}: ${renderValue(diff.from)} → ${renderValue(diff.to)}`
  );
  return [
    `COMMITTED · target: ${config.envLabel}`,
    `id: ${id}`,
    ...(changedLines.length ? changedLines : ["changed: none"]),
    `unchanged: ${unchanged.length ? unchanged.join(", ") : "none"}`,
  ].join("\n");
}

export function makeProgramUpdateHandler(
  hub: HubClient,
  config: Config,
  previews: PreviewStore<ProgramUpdatePayload>
) {
  return async (input: ProgramUpdateInput): Promise<string> => {
    const { id, dryRun, previewId, confirm } = input;

    if (confirm === true) {
      if (!previewId) {
        return "Refused: confirm requires the previewId from a dry run. Run program_update with dryRun first.";
      }
      if (config.readOnly) {
        return "Refused: this MCP server is running with HUB_MCP_READONLY=true.";
      }
      const taken = previews.take(previewId);
      if (!taken.ok) return `Refused: ${taken.reason}`;

      try {
        const committed = await hub.updateProgram(taken.payload);
        return renderCommit(committed.id, committed.changed, committed.unchanged, config);
      } catch (error) {
        if (error instanceof HubError && error.status === 0) {
          previews.restore(previewId, taken.payload);
        }
        throw error;
      }
    }

    if (previewId && dryRun !== false) {
      return "Note: previewId was supplied without confirm: true, so nothing was committed. Re-send with confirm: true.";
    }

    const requestedFields: ProgramField[] = [];
    const payload: ProgramUpdatePayload = { id };
    if (input.publish !== undefined) payload.publish = input.publish;

    for (const field of PROGRAM_FIELDS) {
      if (!hasOwn(input, field)) continue;
      const value = input[field];
      if (value === undefined) continue;
      payload[field] = value;
      requestedFields.push(field);
    }

    if (!requestedFields.length) {
      return "Refused: provide at least one field to update (name, description, cover, accessMode, status).";
    }
    if (payload.status === "open" && payload.publish !== true) {
      return "Refused: setting status to 'open' publishes the course. Pass publish:true in the same call if that's intended.";
    }

    const detail = await hub.getProgram(id);

    const diffLines = requestedFields.map((field) => {
      const currentValue = detail.item[field] ?? null;
      const nextValue = payload[field] ?? null;
      return `${field}: ${renderValue(currentValue)} → ${renderValue(nextValue)}`;
    });

    const { previewId: storedPreviewId, expiresInMinutes } = previews.put(payload);
    return renderPreview(payload, detail.item, config, diffLines, storedPreviewId, expiresInMinutes);
  };
}
