/**
 * cohort_instructor_status — read-only rollup of instructor participation for
 * published/upcoming cohorts: who is PENDING / CONFIRMED / DECLINED, per-session
 * availability, and the outreach history. Pass cohortId to narrow to one cohort.
 */

import { z } from "zod";
import type { HubClient, ParticipationCohort, ParticipationOutreach } from "../hub-client.js";

export const cohortInstructorStatusSchema = z.object({
  cohortId: z.string().optional().describe("Narrow to one cohort. Omit for all ENROLLMENT/IN_PROGRESS cohorts."),
});

export type CohortInstructorStatusInput = z.infer<typeof cohortInstructorStatusSchema>;

const AVAIL_MARK: Record<string, string> = {
  AVAILABLE: "✓",
  TENTATIVE: "~",
  UNAVAILABLE: "✗",
  UNKNOWN: "·",
};

function renderCohort(cohort: ParticipationCohort, outreaches: ParticipationOutreach[]): string {
  const lines = [
    `${cohort.title} [${cohort.status}] · ${cohort.startDate?.slice(0, 10) ?? "TBD"} → ${cohort.endDate?.slice(0, 10) ?? "TBD"} · ${cohort.sessionCount} sessions · ${
      cohort.unconfirmedCount ? `⚠ ${cohort.unconfirmedCount} unconfirmed` : "all confirmed"
    }`,
    `  cohortId: ${cohort.cohortId}`,
  ];
  for (const instructor of cohort.instructors) {
    const availability = instructor.sessionResponses.length
      ? instructor.sessionResponses.map((s) => AVAIL_MARK[s.availability] ?? "·").join("")
      : "no session responses";
    lines.push(
      `  ${instructor.status.padEnd(9)} ${instructor.name ?? instructor.email} <${instructor.email}> · invited: ${
        instructor.invitedAt?.slice(0, 10) ?? "never"
      } · sessions: ${availability}${instructor.notes ? ` · note: "${instructor.notes}"` : ""}`
    );
    const flagged = instructor.sessionResponses.filter((s) => s.availability !== "AVAILABLE" && s.availability !== "UNKNOWN");
    for (const s of flagged) {
      lines.push(`      ${s.availability}: ${s.title} (${s.date.slice(0, 10)})${s.note ? ` — "${s.note}"` : ""}`);
    }
  }
  if (!cohort.instructors.length) {
    lines.push("  (no instructor records — run instructor_outreach with action sync)");
  }
  const cohortOutreaches = outreaches.filter((o) => o.cohortId === cohort.cohortId);
  for (const o of cohortOutreaches) {
    lines.push(`  outreach ${o.id} · ${o.status} · "${o.subject}" · ${o._count.sends} send(s)`);
  }
  return lines.join("\n");
}

export function makeCohortInstructorStatusHandler(hub: HubClient) {
  return async (input: CohortInstructorStatusInput): Promise<string> => {
    const response = await hub.getInstructorParticipation(input.cohortId);
    if (!response.items.length) return "No tracked cohorts (ENROLLMENT/IN_PROGRESS) found.";
    return response.items.map((c) => renderCohort(c, response.outreaches)).join("\n\n");
  };
}
