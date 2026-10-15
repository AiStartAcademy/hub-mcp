/**
 * instructor_schedule — the v2 scheduling surface.
 *
 * Read actions (list_changes, schedule) run immediately. Write actions are split by
 * blast radius:
 *   - propose: creates PROPOSED session assignments. Nothing is emailed, nothing on
 *     anyone's calendar yet, so it runs directly.
 *   - respond_change / confirm: these move real sessions and push Google Calendar
 *     invites to instructors, so they are TWO-STEP — preview, then confirm.
 *   - gcal_sync: re-pushes already-confirmed sessions; safe to run directly.
 *
 * Emailing instructors stays in instructor_outreach.
 */

import { z } from "zod";
import { HubError, type HubClient, type ChangeRequestRow } from "../hub-client.js";
import type { Config } from "../config.js";
import type { PreviewStore } from "../preview-store.js";

export const instructorScheduleSchema = z.object({
  action: z
    .enum(["list_changes", "schedule", "propose", "respond_change", "gcal_sync"])
    .describe(
      "list_changes = pending instructor change requests; schedule = one instructor's full cross-cohort schedule; propose = create session assignments for a cohort; respond_change = accept/counter/confirm one assignment (two-step); gcal_sync = re-push confirmed sessions to Google Calendar."
    ),
  cohortId: z.string().optional(),
  instructorId: z.string().optional().describe("Required for action schedule."),
  instructorIds: z.array(z.string()).optional().describe("propose: limit to these instructors."),
  assignmentId: z.string().optional().describe("Required for respond_change."),
  decision: z
    .enum(["accept", "counter", "confirm"])
    .optional()
    .describe("respond_change: accept moves the session to the instructor's proposed slot and confirms it; counter keeps the session and sends the ask back; confirm locks in an already-accepted assignment."),
  adminNote: z.string().optional().describe("respond_change + counter: what you can offer instead."),
  sessionId: z.string().optional().describe("gcal_sync: one session; omit to sync the whole cohort."),
  dryRun: z.boolean().optional().default(true),
  previewId: z.string().optional(),
  confirm: z.boolean().optional(),
});

export type InstructorScheduleInput = z.infer<typeof instructorScheduleSchema>;

export type InstructorSchedulePayload = {
  assignmentId: string;
  decision: "accept" | "counter" | "confirm";
  adminNote?: string;
  summary: string;
};

function renderChangeRequests(rows: ChangeRequestRow[]): string {
  if (!rows.length) return "No pending change requests.";
  return rows
    .map((r) =>
      [
        `${r.instructor} · ${r.cohortTitle} — ${r.sessionTitle}`,
        `  assignmentId: ${r.assignmentId}`,
        `  currently: ${r.currentDate.slice(0, 10)} ${r.currentTime}`,
        `  asking for: ${r.proposedDate?.slice(0, 10) ?? "same date"}${r.proposedTime ? ` ${r.proposedTime}` : " (no time given)"}`,
        r.note ? `  note: "${r.note}"` : null,
      ]
        .filter(Boolean)
        .join("\n")
    )
    .join("\n\n");
}

export function makeInstructorScheduleHandler(
  hub: HubClient,
  config: Config,
  previews: PreviewStore<InstructorSchedulePayload>
) {
  return async (input: InstructorScheduleInput): Promise<string> => {
    const { action, previewId, confirm } = input;

    if (confirm === true) {
      if (!previewId) return "Refused: confirm requires the previewId from a dry run.";
      if (config.readOnly) return "Refused: this MCP server is running with HUB_MCP_READONLY=true.";
      const taken = previews.take(previewId);
      if (!taken.ok) return `Refused: ${taken.reason}`;
      try {
        const result = await hub.instructorParticipationAction({
          action: "respond_change",
          assignmentId: taken.payload.assignmentId,
          decision: taken.payload.decision,
          adminNote: taken.payload.adminNote,
        });
        return [
          `COMMITTED · target: ${config.envLabel}`,
          taken.payload.summary,
          JSON.stringify(result, null, 2),
        ].join("\n");
      } catch (error) {
        if (error instanceof HubError && error.status === 0) previews.restore(previewId, taken.payload);
        throw error;
      }
    }

    if (previewId && input.dryRun !== false) {
      return "Note: previewId was supplied without confirm: true, so nothing was committed.";
    }

    if (action === "list_changes") {
      const result = await hub.instructorParticipationAction({ action: "list_changes" });
      return renderChangeRequests((result.changeRequests as ChangeRequestRow[]) ?? []);
    }

    if (action === "schedule") {
      if (!input.instructorId) return "Refused: instructorId is required for action schedule.";
      const result = await hub.instructorParticipationAction({
        action: "schedule",
        instructorId: input.instructorId,
      });
      return JSON.stringify(result, null, 2);
    }

    if (config.readOnly) return "Refused: this MCP server is running with HUB_MCP_READONLY=true.";

    if (action === "propose") {
      if (!input.cohortId) return "Refused: cohortId is required for action propose.";
      const result = await hub.instructorParticipationAction({
        action: "propose",
        cohortId: input.cohortId,
        instructorIds: input.instructorIds,
      });
      return `Proposed sessions. ${JSON.stringify(result)}`;
    }

    if (action === "gcal_sync") {
      const result = await hub.instructorParticipationAction({
        action: "gcal_sync",
        sessionId: input.sessionId,
        cohortId: input.cohortId,
      });
      return `Google Calendar sync: ${JSON.stringify(result)}`;
    }

    // respond_change — two-step, because accept/confirm both touch real calendars.
    if (!input.assignmentId || !input.decision) {
      return "Refused: respond_change requires assignmentId and decision.";
    }
    if (input.decision === "counter" && !input.adminNote?.trim()) {
      return "Refused: countering requires adminNote — the instructor sees it on their schedule page.";
    }

    const changes = await hub.instructorParticipationAction({ action: "list_changes" });
    const row = ((changes.changeRequests as ChangeRequestRow[]) ?? []).find(
      (r) => r.assignmentId === input.assignmentId
    );

    const summary =
      input.decision === "accept"
        ? `ACCEPT — move ${row ? `"${row.sessionTitle}" (${row.cohortTitle})` : "the session"} to ${row?.proposedDate?.slice(0, 10) ?? "the proposed date"} ${row?.proposedTime ?? ""}, confirm it, and update Google Calendar for every confirmed instructor.`
        : input.decision === "counter"
          ? `COUNTER — keep the session where it is and send ${row?.instructor ?? "the instructor"} this note: "${input.adminNote}"`
          : `CONFIRM — lock in this assignment and send the Google Calendar invite.`;

    const { previewId: storedPreviewId, expiresInMinutes } = previews.put({
      assignmentId: input.assignmentId,
      decision: input.decision,
      adminNote: input.adminNote,
      summary,
    });

    return [
      `PREVIEW · target: ${config.envLabel}`,
      summary,
      row ? `\nInstructor: ${row.instructor} <${row.email}>\nTheir note: ${row.note ?? "—"}` : "",
      input.decision !== "counter"
        ? "\n⚠ This emails a calendar invite/update to every confirmed instructor on the session."
        : "",
      "",
      `previewId: ${storedPreviewId} · expires in ${expiresInMinutes} minutes`,
      "Nothing was committed.",
      "To commit: call instructor_schedule again with previewId and confirm: true",
    ]
      .filter(Boolean)
      .join("\n");
  };
}
