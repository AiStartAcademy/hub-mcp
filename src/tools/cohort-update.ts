/**
 * cohort_update — preview first, then commit the stored payload.
 *
 * cohort_create is create-only by design (see cohort-create.ts header); this
 * fills the gap for fixing fields after the fact (a bad description, a wrong
 * instructor list, a title typo) without hand-editing in the admin UI.
 *
 * Deliberately excludes: status, zoomLink/zoomMeetingId/createZoomMeeting, groups —
 * same reasoning as the hub route (hub/src/app/api/internal/mcp/v1/cohorts/route.ts
 * PATCH handler): those touch live external state or payments/bookings and are out
 * of scope for a v1 field-patch tool. Use the admin UI for those.
 */

import { z } from "zod";
import { HubError, type HubClient, type CohortDetailItem } from "../hub-client.js";
import type { Config } from "../config.js";
import type { PreviewStore } from "../preview-store.js";

const PATCH_FIELDS = [
  "title",
  "description",
  "deliveryMode",
  "location",
  "startDate",
  "endDate",
  "startTime",
  "endTime",
  "timezone",
  "instructorEmails",
  "programTitles",
] as const;

const isoDate = z
  .string()
  .refine((v) => !Number.isNaN(new Date(v).getTime()), { message: "not a valid date" });
const nullableString = z.union([z.string(), z.null()]);

export const cohortUpdateSchema = z.object({
  id: z.string().optional().describe("Cohort id to update. Provide exactly one of id or slug."),
  slug: z.string().optional().describe("Cohort slug to update. Provide exactly one of id or slug."),
  title: z.string().min(1).optional(),
  description: nullableString.optional().describe("Public description. HTML allowed, stored raw."),
  deliveryMode: z.enum(["ONLINE", "INPERSON", "HYBRID"]).optional(),
  location: nullableString.optional(),
  startDate: z.union([isoDate, z.null()]).optional(),
  endDate: z.union([isoDate, z.null()]).optional(),
  startTime: nullableString.optional().describe("e.g. '6:00 PM'"),
  endTime: nullableString.optional().describe("e.g. '9:00 PM'"),
  timezone: nullableString.optional().describe("IANA, e.g. 'America/Los_Angeles'"),
  instructorEmails: z
    .array(z.string())
    .optional()
    .describe("Full replacement set of existing hub User emails. Unknown emails refuse the whole request."),
  programTitles: z
    .array(z.string())
    .optional()
    .describe("Full replacement set of existing Program names. Unknown titles refuse the whole request."),
  dryRun: z.boolean().optional().default(true),
  previewId: z.string().optional(),
  confirm: z.boolean().optional(),
});

export type CohortUpdateInput = z.infer<typeof cohortUpdateSchema>;

export type CohortUpdatePayload = {
  id: string;
} & Partial<Record<(typeof PATCH_FIELDS)[number], unknown>>;

function hasOwn<K extends string>(value: object, key: K): value is Record<K, unknown> {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function renderValue(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) return value.length ? `[${value.join(", ")}]` : "[]";
  const str = String(value);
  const singleLine = str.replace(/\s+/g, " ").trim();
  if (singleLine.length > 200) {
    return `"${singleLine.slice(0, 140)}..." (${str.length} chars)`;
  }
  return `"${singleLine}"`;
}

function currentValueOf(item: CohortDetailItem, field: (typeof PATCH_FIELDS)[number]): unknown {
  if (field === "instructorEmails") return item.instructors.map((i) => i.email).sort();
  if (field === "programTitles") return item.programs.map((p) => p.name).sort();
  if (field === "startDate" || field === "endDate") {
    const v = item[field];
    return v ? new Date(v).toISOString() : null;
  }
  return item[field as keyof CohortDetailItem] ?? null;
}

function renderPreview(
  item: CohortDetailItem,
  diffLines: string[],
  config: Config,
  previewId: string,
  expiresInMinutes: number
): string {
  return [
    `PREVIEW · target: ${config.envLabel}`,
    `UPDATE cohort "${item.title}" (${item.slug ?? item.id})`,
    "",
    ...diffLines,
    "",
    `⚠ Cannot touch status, zoomLink, or groups via this tool — use the admin UI for those.`,
    "",
    `previewId: ${previewId} · expires in ${expiresInMinutes} minutes`,
    "Nothing was committed.",
    "To commit: call cohort_update again with previewId and confirm: true",
  ].join("\n");
}

export function makeCohortUpdateHandler(
  hub: HubClient,
  config: Config,
  previews: PreviewStore<CohortUpdatePayload>
) {
  return async (input: CohortUpdateInput): Promise<string> => {
    const { id, slug, dryRun, previewId, confirm } = input;

    if (confirm === true) {
      if (!previewId) {
        return "Refused: confirm requires the previewId from a dry run. Run cohort_update with dryRun first.";
      }
      if (config.readOnly) {
        return "Refused: this MCP server is running with HUB_MCP_READONLY=true.";
      }
      const taken = previews.take(previewId);
      if (!taken.ok) return `Refused: ${taken.reason}`;

      try {
        const committed = await hub.updateCohort(taken.payload);
        const changedLines = Object.entries(committed.changed).map(
          ([field, diff]) => `${field}: ${renderValue(diff.from)} → ${renderValue(diff.to)}`
        );
        return [
          `COMMITTED · target: ${config.envLabel}`,
          `cohort: ${committed.id}`,
          ...(changedLines.length ? changedLines : ["changed: none"]),
          `unchanged: ${committed.unchanged.length ? committed.unchanged.join(", ") : "none"}`,
        ].join("\n");
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

    const targetCount = [id, slug].filter((v) => typeof v === "string" && v.trim().length > 0).length;
    if (targetCount !== 1) {
      return "Refused: provide exactly one of id or slug.";
    }

    const requestedFields: (typeof PATCH_FIELDS)[number][] = [];
    for (const field of PATCH_FIELDS) {
      if (hasOwn(input, field)) requestedFields.push(field);
    }
    if (!requestedFields.length) {
      return "Refused: provide at least one field to update.";
    }

    const detail = await hub.getCohort(id ? { id } : { slug });
    const item = detail.item;

    const payload: CohortUpdatePayload = { id: item.id };
    for (const field of requestedFields) {
      payload[field] = input[field];
    }

    const diffLines = requestedFields.map((field) => {
      const currentValue = currentValueOf(item, field);
      const nextValue = payload[field] ?? null;
      return `${field}: ${renderValue(currentValue)} → ${renderValue(nextValue)}`;
    });

    const { previewId: storedPreviewId, expiresInMinutes } = previews.put(payload);
    return renderPreview(item, diffLines, config, storedPreviewId, expiresInMinutes);
  };
}
