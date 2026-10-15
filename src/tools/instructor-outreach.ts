/**
 * instructor_outreach — the write side of instructor participation.
 *
 * TWO-STEP for anything that emails people: the dry run drafts the outreach on
 * the hub (a DRAFT row — harmless), renders the full email for a sample
 * recipient plus the recipient list, and returns a previewId. Confirming with
 * that previewId approves the outreach and sends the individual emails. The
 * dry-run render IS the per-cycle human approval.
 *
 * Cheap non-email actions (sync, nudge) skip the preview dance:
 *   - sync: upsert CohortInstructor rows from the cohort's assigned instructors.
 *   - nudge: re-send the latest approved outreach to still-PENDING instructors
 *     (hub-side 24h dedupe makes this safe to repeat).
 */

import { z } from "zod";
import { HubError, type HubClient } from "../hub-client.js";
import type { Config } from "../config.js";
import type { PreviewStore } from "../preview-store.js";

export const instructorOutreachSchema = z.object({
  action: z
    .enum(["sync", "send", "nudge"])
    .describe("sync = refresh roster records; send = draft+preview→confirm email cycle; nudge = re-send latest approved outreach to PENDING instructors."),
  cohortId: z.string().optional().describe("Required for every action on the first call."),
  subject: z.string().optional().describe("send only. Merge tokens: {{first_name}} {{cohort_title}} {{cohort_dates}}."),
  body: z
    .string()
    .optional()
    .describe("send only. HTML fragment. Merge tokens: {{first_name}} {{cohort_title}} {{cohort_dates}} {{sessions_html}} {{respond_url}}. A confirm button linking to the response page is appended automatically."),
  force: z.boolean().optional().describe("send/nudge: bypass the 24h re-send dedupe."),
  dryRun: z.boolean().optional().default(true),
  previewId: z.string().optional(),
  confirm: z.boolean().optional(),
});

export type InstructorOutreachInput = z.infer<typeof instructorOutreachSchema>;

export type InstructorOutreachPayload = {
  outreachId: string;
  cohortId: string;
  force?: boolean;
};

export function makeInstructorOutreachHandler(
  hub: HubClient,
  config: Config,
  previews: PreviewStore<InstructorOutreachPayload>
) {
  return async (input: InstructorOutreachInput): Promise<string> => {
    const { action, cohortId, previewId, confirm } = input;

    // ── confirm path: approve + send the previously previewed outreach ──
    if (confirm === true) {
      if (!previewId) {
        return "Refused: confirm requires the previewId from a dry run. Run instructor_outreach with action send first.";
      }
      if (config.readOnly) {
        return "Refused: this MCP server is running with HUB_MCP_READONLY=true.";
      }
      const taken = previews.take(previewId);
      if (!taken.ok) return `Refused: ${taken.reason}`;

      try {
        await hub.instructorParticipationAction({ action: "approve", outreachId: taken.payload.outreachId });
        const sent = await hub.instructorParticipationAction({
          action: "send",
          outreachId: taken.payload.outreachId,
          force: taken.payload.force,
        });
        return [
          `COMMITTED · target: ${config.envLabel}`,
          `outreach ${taken.payload.outreachId} approved and sent.`,
          JSON.stringify(sent.result ?? sent, null, 2),
        ].join("\n");
      } catch (error) {
        if (error instanceof HubError && error.status === 0) {
          previews.restore(previewId, taken.payload);
        }
        throw error;
      }
    }

    if (previewId && input.dryRun !== false) {
      return "Note: previewId was supplied without confirm: true, so nothing was sent. Re-send with confirm: true.";
    }

    if (!cohortId) return "Refused: cohortId is required.";

    // ── no-preview actions ──
    if (action === "sync") {
      if (config.readOnly) return "Refused: this MCP server is running with HUB_MCP_READONLY=true.";
      const result = await hub.instructorParticipationAction({ action: "sync", cohortId });
      return `Synced. ${JSON.stringify(result)}`;
    }

    if (action === "nudge") {
      if (config.readOnly) return "Refused: this MCP server is running with HUB_MCP_READONLY=true.";
      const result = await hub.instructorParticipationAction({ action: "nudge", cohortId, force: input.force });
      return `Nudge result: ${JSON.stringify(result)}`;
    }

    // ── send: draft on the hub, render preview, store previewId ──
    if (!input.subject?.trim() || !input.body?.trim()) {
      return "Refused: send requires subject and body.";
    }
    if (config.readOnly) return "Refused: this MCP server is running with HUB_MCP_READONLY=true.";

    const draft = await hub.instructorParticipationAction({
      action: "draft",
      cohortId,
      subject: input.subject,
      body: input.body,
    });
    const outreachId = String(draft.outreachId ?? "");
    if (!outreachId) return `Draft failed: ${JSON.stringify(draft)}`;

    const preview = await hub.instructorParticipationAction({ action: "preview", outreachId });
    const recipients = Array.isArray(preview.recipients)
      ? (preview.recipients as { email: string; status: string }[])
      : [];

    const { previewId: storedPreviewId, expiresInMinutes } = previews.put({
      outreachId,
      cohortId,
      force: input.force,
    });

    return [
      `PREVIEW · target: ${config.envLabel}`,
      `Outreach drafted (${outreachId}) for cohort ${cohortId} — NOT approved, NOT sent.`,
      "",
      `Recipients (${recipients.length}):`,
      ...recipients.map((r) => `  ${r.status.padEnd(9)} ${r.email}`),
      "",
      `Sample subject: ${preview.sampleSubject ?? "—"}`,
      "Sample email HTML:",
      String(preview.sampleHtml ?? "—"),
      "",
      `previewId: ${storedPreviewId} · expires in ${expiresInMinutes} minutes`,
      "Nothing was emailed.",
      "To approve and send: call instructor_outreach again with previewId and confirm: true",
    ].join("\n");
  };
}
