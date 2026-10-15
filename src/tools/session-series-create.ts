/**
 * session_series_create — safely stage and create one shared session series.
 *
 * Two-beat by construction: the first call normalizes and previews the schedule,
 * and the second commits only that stored preview. Zoom provisioning is excluded:
 * changing only the DB schedule could desync it from the live recurring meeting,
 * so the admin UI remains the sole place to provision the meeting and join link.
 */

import { z } from "zod";
import type { Config } from "../config.js";
import { HubError, type HubClient } from "../hub-client.js";
import type { PreviewStore } from "../preview-store.js";
import { normalizeSeriesDays, type SeriesWeekday } from "./series-shared.js";

const dateSchema = z.string().min(1).describe("Date accepted by the hub, normally YYYY-MM-DD.");

export const sessionSeriesCreateSchema = z
  .object({
    title: z.string().min(1).describe("Shared series title, e.g. 'Daily Check-in'."),
    kind: z.enum(["CHECKIN", "ONBOARDING"]).optional().describe("Defaults to CHECKIN."),
    status: z
      .enum(["ACTIVE", "PAUSED", "ARCHIVED"])
      .optional()
      .describe("Defaults to ACTIVE."),
    description: z.string().optional(),
    location: z
      .string()
      .optional()
      .describe('In-person place for a hybrid call, e.g. "123 Main St, Springfield". Omit for Zoom only.'),
    days: z
      .union([z.string(), z.array(z.string())])
      .describe("Required CSV or array of weekdays. Long names are accepted by 3-letter prefix."),
    startTime: z.string().min(1).describe('Wall-clock start time, e.g. "11:00 AM".'),
    endTime: z.string().min(1).describe('Wall-clock end time, e.g. "11:30 AM".'),
    timezone: z
      .string()
      .min(1)
      .optional()
      .describe("Defaults to HUB_DEFAULT_TIMEZONE (America/Los_Angeles if unset)."),
    startDate: dateSchema,
    endDate: dateSchema.nullable().optional().describe("Null or omitted means rolling."),
    instructorId: z.string().min(1).optional(),
    dryRun: z
      .boolean()
      .optional()
      .describe("Defaults to true. Returns a preview and previewId without writing."),
    previewId: z.string().optional().describe("The previewId from a prior dry run."),
    confirm: z.boolean().optional().describe("Must be true with previewId to write."),
  })
  .strict();

export type SessionSeriesCreateInput = z.infer<typeof sessionSeriesCreateSchema>;

export type SessionSeriesCreateSpec = Omit<
  SessionSeriesCreateInput,
  "days" | "dryRun" | "previewId" | "confirm"
> & {
  days: SeriesWeekday[];
};

function renderPreview(
  spec: SessionSeriesCreateSpec,
  config: Config,
  previewId: string,
  expiresInMinutes: number
): string {
  const kind = spec.kind ?? "CHECKIN";
  const status = spec.status ?? "ACTIVE";
  const timezone = spec.timezone ?? config.defaultTimezone;
  const end = spec.endDate ?? "rolling (no end date)";

  return [
    `PREVIEW · target: ${config.envLabel}`,
    "",
    `CREATE SessionSeries "${spec.title}" · ${kind} · ${status}`,
    `days: ${spec.days.join(", ")}`,
    `time: ${spec.startTime}–${spec.endTime} ${timezone}`,
    `dates: ${spec.startDate} → ${end}`,
    ...(spec.instructorId ? [`instructor id: ${spec.instructorId}`] : []),
    ...(spec.location?.trim() ? [`in person: ${spec.location.trim()} (plus Zoom)`] : []),
    "",
    "⚠ NO Zoom meeting is created. This series will have no join link until it is provisioned in the admin UI.",
    "  Zoom stays admin-only because a wrong DB write would desync the live recurring meeting.",
    "",
    `previewId: ${previewId} · expires in ${expiresInMinutes} minutes`,
    "Nothing was committed.",
    "To commit: call session_series_create again with previewId and confirm: true",
  ].join("\n");
}

export function makeSessionSeriesCreateHandler(
  hub: HubClient,
  config: Config,
  previews: PreviewStore<SessionSeriesCreateSpec>
) {
  return async (input: SessionSeriesCreateInput): Promise<string> => {
    const { dryRun, previewId, confirm, days, ...rest } = input;

    if (confirm === true) {
      if (!previewId) {
        return "Refused: confirm requires the previewId from a dry run. Run session_series_create with dryRun first.";
      }
      if (config.readOnly) {
        return "Refused: this MCP server is running with HUB_MCP_READONLY=true.";
      }

      const taken = previews.take(previewId);
      if (!taken.ok) return `Refused: ${taken.reason}`;

      try {
        const committed = await hub.createSessionSeries(taken.payload);
        return [
          `COMMITTED · target: ${config.envLabel}`,
          `${committed.series.title} · ${committed.series.kind} · ${committed.series.status}`,
          `series id: ${committed.series.id}`,
          "Zoom meeting: not created · provision the recurring meeting in the admin UI",
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

    let normalizedDays: SeriesWeekday[];
    try {
      normalizedDays = normalizeSeriesDays(days);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return `Refused: ${message}`;
    }

    const spec: SessionSeriesCreateSpec = {
      ...rest,
      timezone: rest.timezone ?? config.defaultTimezone,
      days: normalizedDays,
    };
    const stored = previews.put(spec);
    return renderPreview(spec, config, stored.previewId, stored.expiresInMinutes);
  };
}
