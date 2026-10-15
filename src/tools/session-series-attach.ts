/**
 * session_series_attach — replace the full cohort attachment set for a series.
 *
 * The current series is fetched before previewing so removals cannot hide inside
 * a full-set replacement. Detaching is student-visible: the shared call disappears
 * from those students' schedules. Zoom fields are excluded because changing DB
 * associations must never mutate or desync the live recurring meeting.
 */

import { z } from "zod";
import type { Config } from "../config.js";
import { HubError, type HubClient, type SessionSeriesDetailItem } from "../hub-client.js";
import type { PreviewStore } from "../preview-store.js";

export const sessionSeriesAttachSchema = z
  .object({
    id: z.string().min(1).describe("Session series id."),
    cohortIds: z
      .array(z.string().min(1))
      .describe("Required FULL desired cohort-id set, not a delta. Empty detaches every cohort."),
    dryRun: z
      .boolean()
      .optional()
      .describe("Defaults to true. Returns a preview and previewId without writing."),
    previewId: z.string().optional().describe("The previewId from a prior dry run."),
    confirm: z.boolean().optional().describe("Must be true with previewId to write."),
  })
  .strict();

export type SessionSeriesAttachInput = z.infer<typeof sessionSeriesAttachSchema>;

// A type alias, not an interface: HubClient.updateSessionSeries takes
// `{ id: string } & Record<string, unknown>`, and only type aliases get the
// implicit index signature that makes them assignable to it.
export type SessionSeriesAttachPayload = {
  id: string;
  cohortIds: string[];
};

function cohortLabel(id: string, current: Map<string, string>): string {
  const title = current.get(id);
  return title ? `${id} (${title})` : id;
}

function renderGroup(label: string, ids: string[], current: Map<string, string>): string {
  return `${label}: ${ids.length ? ids.map((id) => cohortLabel(id, current)).join(", ") : "none"}`;
}

function renderPreview(
  series: SessionSeriesDetailItem,
  payload: SessionSeriesAttachPayload,
  config: Config,
  previewId: string,
  expiresInMinutes: number
): string {
  const current = new Map(series.cohorts.map(({ cohort }) => [cohort.id, cohort.title]));
  const requested = new Set(payload.cohortIds);
  const attach = payload.cohortIds.filter((id) => !current.has(id));
  const detach = [...current.keys()].filter((id) => !requested.has(id));
  const unchanged = [...current.keys()].filter((id) => requested.has(id));

  return [
    `PREVIEW · target: ${config.envLabel}`,
    `REPLACE cohort attachments for "${series.title}" (${series.id})`,
    "",
    renderGroup("ATTACH", attach, current),
    renderGroup("DETACH", detach, current),
    renderGroup("unchanged", unchanged, current),
    ...(detach.length
      ? [
          "",
          "⚠ DETACH WARNING: detaching removes the call from those students' schedules.",
        ]
      : []),
    "",
    "cohortIds is the FULL desired set, not a delta; the commit sends only this replacement set.",
    `previewId: ${previewId} · expires in ${expiresInMinutes} minutes`,
    "Nothing was committed.",
    "To commit: call session_series_attach again with previewId and confirm: true",
  ].join("\n");
}

export function makeSessionSeriesAttachHandler(
  hub: HubClient,
  config: Config,
  previews: PreviewStore<SessionSeriesAttachPayload>
) {
  return async (input: SessionSeriesAttachInput): Promise<string> => {
    const { id, cohortIds, dryRun, previewId, confirm } = input;

    if (confirm === true) {
      if (!previewId) {
        return "Refused: confirm requires the previewId from a dry run. Run session_series_attach with dryRun first.";
      }
      if (config.readOnly) {
        return "Refused: this MCP server is running with HUB_MCP_READONLY=true.";
      }

      const taken = previews.take(previewId);
      if (!taken.ok) return `Refused: ${taken.reason}`;

      try {
        const committed = await hub.updateSessionSeries(taken.payload);
        if (committed.cohorts === undefined) {
          throw new Error("Hub session-series attach response omitted cohorts.");
        }
        const attached = committed.cohorts.length
          ? committed.cohorts.map((cohort) => `${cohort.title} (${cohort.id})`).join(", ")
          : "none";
        return [
          `COMMITTED · target: ${config.envLabel}`,
          `series id: ${taken.payload.id}`,
          `attached cohorts: ${attached}`,
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

    const detail = await hub.getSessionSeries(id);
    const payload: SessionSeriesAttachPayload = {
      id: detail.series.id,
      cohortIds: [...new Set(cohortIds)],
    };
    const stored = previews.put(payload);
    return renderPreview(
      detail.series,
      payload,
      config,
      stored.previewId,
      stored.expiresInMinutes
    );
  };
}
