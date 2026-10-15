/**
 * venue_event_set_status — set the status of a venue event in the hub.
 *
 * Two-beat by construction: the first call previews, the second
 * commits a stored preview. dryRun defaults to true, so the *only* way to
 * write is to have seen the diff first.
 */

import { z } from "zod";
import {
  HubError,
  type GcalSyncResult,
  type HubClient,
  type VenueEventRecord,
  type VenueEventStatus,
} from "../hub-client.js";
import type { Config } from "../config.js";
import type { PreviewStore } from "../preview-store.js";

const venueEventStatusSchema = z.enum(["PENDING", "APPROVED", "DECLINED", "CANCELLED"]);

export const venueEventSetStatusSchema = z
  .object({
    id: z.string().min(1).optional().describe("Venue event id. Provide exactly one of id or slug."),
    slug: z.string().min(1).optional().describe("Venue event slug. Provide exactly one of id or slug."),
    status: venueEventStatusSchema.describe("New event status."),
    dryRun: z
      .boolean()
      .optional()
      .describe("Defaults to true. Returns a preview and a previewId instead of writing."),
    previewId: z.string().optional().describe("The previewId from a prior dry run."),
    confirm: z.boolean().optional().describe("Must be true, with a previewId, to actually write."),
  })
  .strict();

export type VenueEventSetStatusInput = z.infer<typeof venueEventSetStatusSchema>;

/** The subset we actually send to the hub — control fields stripped. */
type VenueEventSetStatusSpec = {
  id?: string;
  slug?: string;
  status: VenueEventStatus;
};

function renderVenueEventUrl(config: Config, slug: string): string {
  return new URL(`/events/${encodeURIComponent(slug)}`, config.hubBaseUrl).toString();
}

function getLookupError(spec: VenueEventSetStatusSpec): string | null {
  const hasId = typeof spec.id === "string" && spec.id.length > 0;
  const hasSlug = typeof spec.slug === "string" && spec.slug.length > 0;
  if (!hasId && !hasSlug) {
    return "Refused: provide exactly one of id or slug.";
  }
  if (hasId && hasSlug) {
    return "Refused: provide exactly one of id or slug, not both.";
  }
  return null;
}

function renderStatusEffect(nextStatus: VenueEventStatus, statusChanges: boolean): string {
  if (!statusChanges) {
    return "· no Google Calendar sync will fire because status would not change";
  }

  switch (nextStatus) {
    case "APPROVED":
      return "· status APPROVED emails the organizer a confirmation + Google Calendar invite";
    case "DECLINED":
      return "· status DECLINED cancels the Google Calendar hold";
    case "CANCELLED":
    case "PENDING":
      return "· changing status triggers a Google Calendar re-sync";
    default: {
      const neverStatus: never = nextStatus;
      return neverStatus;
    }
  }
}

function renderSyncLine(syncResult: GcalSyncResult | null): string {
  if (syncResult === null) {
    return "No calendar sync was triggered.";
  }
  if (syncResult.outcome === "failed") {
    return `⚠ Calendar sync failed: ${syncResult.error ?? "unknown error"}`;
  }
  return `Calendar sync: ${syncResult.outcome}${syncResult.eventId ? ` (${syncResult.eventId})` : ""}`;
}

function renderPreview(
  current: VenueEventRecord,
  spec: VenueEventSetStatusSpec,
  config: Config,
  previewId: string,
  expires: number
): string {
  const statusChanges = current.status !== spec.status;
  const lines: string[] = [];
  lines.push(`PREVIEW · target: ${config.envLabel}`);
  lines.push("");
  lines.push(
    `SET VenueEvent status for "${current.title}" (${spec.id ? `id ${spec.id}` : `slug ${spec.slug as string}`})`
  );
  lines.push("");
  lines.push(`status: ${current.status} → ${spec.status}`);
  lines.push("");
  if (!statusChanges) {
    lines.push("⚠ Status is already set to that value; no status change would occur.");
  }
  lines.push(renderStatusEffect(spec.status, statusChanges));
  lines.push("");
  lines.push(`previewId: ${previewId} · expires in ${expires} minutes`);
  lines.push("To commit: call venue_event_set_status again with previewId and confirm: true");
  return lines.join("\n");
}

export function makeVenueEventSetStatusHandler(
  hub: HubClient,
  config: Config,
  previews: PreviewStore<VenueEventSetStatusSpec>
) {
  return async (input: VenueEventSetStatusInput): Promise<string> => {
    const { dryRun, previewId, confirm, ...spec } = input;

    // ---- Beat 2: commit ----
    if (confirm === true) {
      if (!previewId) {
        return "Refused: confirm requires the previewId from a dry run. Run venue_event_set_status with dryRun first.";
      }
      if (config.readOnly) {
        return "Refused: this MCP server is running with HUB_MCP_READONLY=true.";
      }
      const taken = previews.take(previewId);
      if (!taken.ok) return `Refused: ${taken.reason}`;

      let result;
      try {
        result = await hub.updateVenueEvent(taken.payload);
      } catch (err) {
        if (err instanceof HubError && err.status === 0) {
          previews.restore(previewId, taken.payload);
        }
        throw err;
      }

      return [
        `COMMITTED · target: ${config.envLabel}`,
        `Updated: ${result.event.title}`,
        `Status: ${result.event.status}`,
        renderSyncLine(result.syncResult),
        renderVenueEventUrl(config, result.event.slug),
      ]
        .filter(Boolean)
        .join("\n");
    }

    // ---- Beat 1: preview (default) ----
    if (previewId && dryRun !== false) {
      return "Note: previewId was supplied without confirm: true, so nothing was committed. Re-send with confirm: true.";
    }

    const lookupError = getLookupError(spec);
    if (lookupError) {
      return lookupError;
    }

    let current;
    try {
      current = await hub.getVenueEvent(spec.id ? { id: spec.id } : { slug: spec.slug as string });
    } catch (err) {
      if (err instanceof HubError && err.status === 404) {
        return spec.id
          ? `Refused: venue event not found for id ${spec.id}.`
          : `Refused: venue event not found for slug ${spec.slug as string}.`;
      }
      throw err;
    }

    const { previewId: id, expiresInMinutes } = previews.put(spec);
    return renderPreview(current, spec, config, id, expiresInMinutes);
  };
}
