/**
 * cohort_create — the v1 write surface, in full.
 *
 * Two-beat by construction: the first call previews, the second
 * commits a stored preview. dryRun defaults to true, so the *only* way to
 * write is to have seen the diff first.
 */

import { z } from "zod";
import { HubError, type HubClient } from "../hub-client.js";
import type { Config } from "../config.js";
import type { PreviewStore } from "../preview-store.js";

const isoDate = z
  .string()
  .refine((v) => !Number.isNaN(new Date(v).getTime()), { message: "not a valid date" });

export const cohortCreateSchema = z.object({
  title: z.string().min(1).describe("Cohort title, e.g. 'Web Development Bootcamp — Evening'"),
  description: z.string().optional().describe("Public description. HTML allowed."),
  deliveryMode: z
    .enum(["ONLINE", "INPERSON", "HYBRID"])
    .optional()
    .describe("Defaults to ONLINE."),
  location: z.string().optional().describe("Venue, e.g. '123 Main St, Springfield'"),
  zoomLink: z.string().optional().describe("Zoom join URL. Ignored if createZoomMeeting is true."),
  startDate: isoDate.optional(),
  endDate: isoDate.optional(),
  startTime: z.string().optional().describe("Daily session start, e.g. '6:00 PM'. Required for createZoomMeeting."),
  endTime: z.string().optional().describe("Daily session end, e.g. '9:00 PM'. Required for createZoomMeeting."),
  timezone: z.string().optional().describe("IANA timezone, e.g. 'America/Los_Angeles'. Required for createZoomMeeting."),
  createZoomMeeting: z
    .boolean()
    .optional()
    .describe(
      "If true, the hub creates a REAL recurring Zoom meeting (cloud recording on, no password, " +
        "no registration) and uses it as this cohort's zoomLink. Requires startDate, endDate, " +
        "startTime, endTime, timezone, AND zoomDays. This calls the live Zoom API on confirm — not " +
        "a hub-only draft like the rest of this tool."
    ),
  zoomDays: z
    .array(z.enum(["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"]))
    .optional()
    .describe(
      "REQUIRED if createZoomMeeting is true. Which weekdays sessions recur on — cohort formats " +
        "genuinely differ (e.g. an evening format may be Mon–Thu, NOT Mon–Fri, if there are " +
        "no Friday evening sessions; a daytime intensive is typically Mon–Fri). There is no default " +
        "— verify the real per-format schedule before setting this, don't assume a standard work week."
    ),
  instructorEmails: z
    .array(z.string())
    .optional()
    .describe(
      "Emails of EXISTING hub Users to attach as instructors. Unknown emails are refused, not skipped. " +
        "NOTE: if the target hub environment has User.email deliberately stripped (e.g. some staging " +
        "environments), this will always refuse — omit it there and use it only where real emails exist."
    ),
  programTitles: z
    .array(z.string())
    .optional()
    .describe(
      "Exact names of EXISTING Programs (courses) to link to this cohort. Unknown titles are " +
        "refused, not skipped or auto-created — look them up first if unsure they exist."
    ),
  rawProgramTitle: z
    .string()
    .optional()
    .describe(
      "Exact name of an EXISTING Program to set as this cohort's 1:1 recording-import target " +
        "(distinct from programTitles). Required for cloud recordings from real sessions to " +
        "auto-import as Lessons later. A Program can only be the target for ONE cohort at a " +
        "time — refused if it's already taken by another cohort."
    ),
  groups: z
    .array(
      z.object({
        name: z.string().min(1).describe("Tier name, e.g. 'In Person' or 'Online Group'"),
        price: z.number().nonnegative().optional().describe("USD. 0 or omitted means free."),
        seats: z.number().int().nonnegative().optional(),
        inPerson: z.boolean().optional(),
      })
    )
    .optional()
    .describe("Seat tiers. WITHOUT AT LEAST ONE, THE COHORT CANNOT BE SOLD."),
  dryRun: z
    .boolean()
    .optional()
    .describe("Defaults to true. Returns a preview and a previewId instead of writing."),
  previewId: z.string().optional().describe("The previewId from a prior dry run."),
  confirm: z.boolean().optional().describe("Must be true, with a previewId, to actually write."),
});

export type CohortCreateInput = z.infer<typeof cohortCreateSchema>;

/** The subset we actually send to the hub — control fields stripped. */
type CohortSpec = Omit<CohortCreateInput, "dryRun" | "previewId" | "confirm">;

function fmtDate(v?: string): string {
  if (!v) return "—";
  return new Date(v).toISOString().slice(0, 10);
}

function renderPreview(spec: CohortSpec, config: Config, previewId: string, expires: number): string {
  const lines: string[] = [];
  lines.push(`PREVIEW · target: ${config.envLabel}`);
  lines.push("");
  lines.push(`CREATE Cohort "${spec.title}" (status DRAFT)`);
  lines.push(`  ${fmtDate(spec.startDate)} → ${fmtDate(spec.endDate)} · ${spec.deliveryMode ?? "ONLINE"}`);
  if (spec.location) lines.push(`  location: ${spec.location}`);
  if (spec.startTime || spec.endTime) {
    lines.push(`  sessions: ${spec.startTime ?? "?"}–${spec.endTime ?? "?"} ${spec.timezone ?? ""}`.trimEnd());
  }
  if (spec.createZoomMeeting) {
    const days = spec.zoomDays?.length ? spec.zoomDays.join(", ") : "⚠ NO zoomDays SET — the hub will refuse this";
    lines.push(`CREATE real Zoom meeting · recurs on: ${days} · cloud recording on · no password · no registration`);
    lines.push(`  ⚠ this calls the LIVE Zoom API on confirm — not a hub-only draft like the rest of this tool`);
  } else if (spec.zoomLink) {
    lines.push(`  zoom: ${spec.zoomLink}`);
  }
  if (spec.instructorEmails?.length) {
    lines.push(`ATTACH instructors: ${spec.instructorEmails.join(", ")}`);
    lines.push(`  ⚠ refused (whole request) if any email isn't an existing hub User`);
  }
  if (spec.programTitles?.length) {
    lines.push(`LINK courses: ${spec.programTitles.join(", ")}`);
    lines.push(`  ⚠ refused (whole request) if any title isn't an existing Program`);
  }
  if (spec.rawProgramTitle) {
    lines.push(`SET recording-import target: ${spec.rawProgramTitle}`);
    lines.push(`  ⚠ refused if that Program doesn't exist, or is already another cohort's target`);
  }

  for (const g of spec.groups ?? []) {
    const price = g.price ? `$${g.price}` : "Free";
    const seats = g.seats !== undefined ? `${g.seats} seats` : "default cap (50 — hub schema default, not unlimited)";
    lines.push(`CREATE Group "${g.name}" · ${price} · ${seats}${g.inPerson ? " · in-person" : ""}`);
  }

  lines.push("");
  // P3: name the absences that make the result unusable.
  if (!spec.groups?.length) {
    lines.push("⚠ no seat tiers — nothing to buy; the cohort cannot be sold until you add one");
  }
  if (!spec.startDate) {
    lines.push("⚠ no startDate — the cohort card will render 'Dates TBA'");
  }
  if (!spec.zoomLink && !spec.createZoomMeeting) {
    lines.push("⚠ no zoomLink — no sessions can be synced, so there will be no schedule");
  }
  // P2: name the side effect the caller didn't ask for.
  lines.push("· slug is auto-generated from the title and de-duplicated if it collides");
  lines.push("· status is DRAFT and cannot be set by this tool — publish in the admin UI");
  lines.push("");
  lines.push(`previewId: ${previewId} · expires in ${expires} minutes`);
  lines.push(`To commit: call cohort_create again with previewId and confirm: true`);
  return lines.join("\n");
}

export function makeCohortCreateHandler(
  hub: HubClient,
  config: Config,
  previews: PreviewStore<CohortSpec>
) {
  return async (input: CohortCreateInput): Promise<string> => {
    const { dryRun, previewId, confirm, ...spec } = input;

    // ---- Beat 2: commit ----
    if (confirm === true) {
      if (!previewId) {
        return "Refused: confirm requires the previewId from a dry run. Run cohort_create with dryRun first.";
      }
      if (config.readOnly) {
        return "Refused: this MCP server is running with HUB_MCP_READONLY=true.";
      }
      const taken = previews.take(previewId);
      if (!taken.ok) return `Refused: ${taken.reason}`;

      // P6: commit the stored preview, never the arguments resent alongside it.
      let created;
      try {
        created = await hub.createCohort(taken.payload);
      } catch (err) {
        // status 0 means the request never left — nothing was written, so the
        // preview is still valid and we hand it back rather than making the
        // operator re-preview. Any other failure is ambiguous: the write may
        // have landed, so the preview stays consumed and they must look.
        if (err instanceof HubError && err.status === 0) {
          previews.restore(previewId, taken.payload);
        }
        throw err;
      }
      const url = `${config.hubBaseUrl}/cohorts/${created.slug ?? created.id}`;
      const notes = created.slugWasAdjusted ? "⚠ slug was de-duplicated — check it reads well" : "";
      const zoomLine = created.zoomWarning
        ? `⚠ ${created.zoomWarning}`
        : created.zoomLink
          ? `Zoom: ${created.zoomLink}`
          : null;
      const instructorsLine = created.instructors.length
        ? `Instructors: ${created.instructors.map((i) => i.name ?? i.email).join(", ")}`
        : null;
      const programsLine = created.programs.length
        ? `Courses: ${created.programs.map((p) => p.name).join(", ")}`
        : null;
      const rawProgramLine = created.rawProgram
        ? `Recording-import target: ${created.rawProgram.name} (recordings appear here after real sessions happen)`
        : null;
      const sessionsLine = created.sessionsNote
        ? `⚠ ${created.sessionsNote}`
        : created.sessionsCreated !== null
          ? `${created.sessionsCreated} session(s) created from Zoom occurrences`
          : null;
      return [
        `COMMITTED · target: ${config.envLabel}`,
        `${created.title} · status ${created.status}`,
        `${created.groups.length} seat tier(s) created`,
        zoomLine,
        sessionsLine,
        instructorsLine,
        programsLine,
        rawProgramLine,
        url,
        notes,
      ]
        .filter(Boolean)
        .join("\n");
    }

    // ---- Beat 1: preview (default) ----
    if (previewId && dryRun !== false) {
      return "Note: previewId was supplied without confirm: true, so nothing was committed. Re-send with confirm: true.";
    }
    const { previewId: id, expiresInMinutes } = previews.put(spec);
    return renderPreview(spec, config, id, expiresInMinutes);
  };
}
