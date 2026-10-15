/**
 * zoom_meeting_delete — cleanup for test/throwaway cohorts created via
 * cohort_create with createZoomMeeting: true.
 *
 * Same two-beat contract as cohort_create: dryRun (default) previews, a second
 * call with the previewId and confirm: true actually deletes. This is genuinely
 * destructive on a live third-party service (cancels the whole recurring series,
 * including any future occurrences and their cloud recordings), so it gets the
 * same guardrail as every write in this server, not a shortcut.
 */

import { z } from "zod";
import { HubError, type HubClient } from "../hub-client.js";
import type { Config } from "../config.js";
import type { PreviewStore } from "../preview-store.js";

export const zoomMeetingDeleteSchema = z.object({
  zoomMeetingId: z.string().min(1).describe("The numeric Zoom meeting ID, e.g. from a cohort_create COMMITTED response."),
  dryRun: z.boolean().optional().describe("Defaults to true. Returns a preview and a previewId instead of deleting."),
  previewId: z.string().optional().describe("The previewId from a prior dry run."),
  confirm: z.boolean().optional().describe("Must be true, with a previewId, to actually delete."),
});

export type ZoomMeetingDeleteInput = z.infer<typeof zoomMeetingDeleteSchema>;

export function makeZoomMeetingDeleteHandler(
  hub: HubClient,
  config: Config,
  previews: PreviewStore<{ zoomMeetingId: string }>
) {
  return async (input: ZoomMeetingDeleteInput): Promise<string> => {
    const { dryRun, previewId, confirm, zoomMeetingId } = input;

    if (confirm === true) {
      if (!previewId) {
        return "Refused: confirm requires the previewId from a dry run. Run zoom_meeting_delete with dryRun first.";
      }
      if (config.readOnly) {
        return "Refused: this MCP server is running with HUB_MCP_READONLY=true.";
      }
      const taken = previews.take(previewId);
      if (!taken.ok) return `Refused: ${taken.reason}`;

      let result;
      try {
        result = await hub.deleteZoomMeeting(taken.payload.zoomMeetingId);
      } catch (err) {
        if (err instanceof HubError && err.status === 0) {
          previews.restore(previewId, taken.payload);
        }
        throw err;
      }
      return [
        `DELETED · target: ${config.envLabel}`,
        `Zoom meeting ${result.zoomMeetingId} deleted (whole recurring series, cannot be undone)`,
        result.cohortsCleared > 0
          ? `Cleared zoomLink/zoomMeetingId on ${result.cohortsCleared} cohort row(s)`
          : "No cohort row referenced this meeting id — nothing to clear",
      ].join("\n");
    }

    if (previewId && dryRun !== false) {
      return "Note: previewId was supplied without confirm: true, so nothing was deleted. Re-send with confirm: true.";
    }
    const { previewId: id, expiresInMinutes } = previews.put({ zoomMeetingId });
    return [
      `PREVIEW · target: ${config.envLabel}`,
      "",
      `DELETE Zoom meeting ${zoomMeetingId}`,
      "  ⚠ cancels the WHOLE recurring series, including all future occurrences and cloud recordings",
      "  ⚠ this calls the LIVE Zoom API on confirm — irreversible",
      "  · if a Cohort references this meeting, its zoomLink/zoomMeetingId will be cleared (the Cohort row itself is not deleted)",
      "",
      `previewId: ${id} · expires in ${expiresInMinutes} minutes`,
      `To commit: call zoom_meeting_delete again with previewId and confirm: true`,
    ].join("\n");
  };
}
