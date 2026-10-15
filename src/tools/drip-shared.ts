/**
 * Shared pieces for the drip tools.
 *
 * The segment schema is strict on purpose. The hub's parseSegment() drops
 * unknown keys and malformed values, and a segment that degrades to {} means
 * "match every lead" — so a typo like `status` for `statuses` would silently
 * widen the audience to the whole CRM instead of failing. Refusing unknown
 * keys here is what keeps that from reaching the hub.
 */

import { z } from "zod";
import type { DripSegment, DripStepItem } from "../hub-client.js";

const tagList = z.array(z.string().min(1).max(60)).max(50);

/**
 * Mirror of the hub's CAMPAIGN_TRIGGERS (hub/src/lib/drip/constants.ts). The
 * hub route re-validates against its own list, so a drift here fails loudly
 * at the hub rather than writing a bad trigger — but keep the two in step.
 */
export const CAMPAIGN_TRIGGERS = [
  "LEAD_SEGMENT",
  "COHORT_SCHEDULE",
  "BROADCAST",
  "CERTIFICATE_ISSUED",
] as const;

export const campaignTriggerSchema = z
  .enum(CAMPAIGN_TRIGGERS)
  .describe(
    "How contacts enter the campaign. LEAD_SEGMENT (default): the tick sweep enrolls leads" +
      " matching the segment. COHORT_SCHEDULE: reminders to registrants of upcoming cohorts;" +
      " segment, priority, exit statuses and send window are ignored. CERTIFICATE_ISSUED:" +
      " enrolls graduates when certificates are sent (certificate_notify); only the" +
      " lowest-priority ACTIVE one is used. BROADCAST: one-off send to the current audience via" +
      " broadcast_send; never auto-enrolled. Omit on a patch to leave the stored trigger as is."
  );

export const segmentSchema = z
  .object({
    sources: z
      .array(z.string().min(1).max(120))
      .max(50)
      .optional()
      .describe('Contact.source values. "onboarding:*" matches any onboarding slug.'),
    statuses: z
      .array(z.enum(["NEW", "CONTACTED", "QUALIFIED", "WON", "LOST"]))
      .max(5)
      .optional(),
    anyTags: tagList.optional().describe("Lead has at least one of these tags."),
    allTags: tagList.optional().describe("Lead has every one of these tags."),
    noneTags: tagList.optional().describe("Lead is excluded if it has any of these tags."),
    minAgeHours: z.number().int().positive().max(24 * 365).optional(),
    maxAgeDays: z.number().int().positive().max(3650).optional(),
    inactiveForDays: z.number().int().positive().max(3650).optional(),
    callable: z
      .boolean()
      .optional()
      .describe(
        "Lead can receive an automated call (phone + call consent + not do-not-call). Set on campaigns with CALL steps."
      ),
    cohorts: z
      .union([z.literal("any"), z.array(z.string().min(1).max(191)).max(200)])
      .optional()
      .describe('Cohort ids or slugs; "any" means ever enrolled in any cohort.'),
    products: z
      .array(z.enum(["self-paced", "membership"]))
      .max(2)
      .optional()
      .describe("Paid buyers of those products."),
    includeUsers: z
      .boolean()
      .optional()
      .describe("Reach hub Users, not only CRM leads."),
  })
  .strict();

export const stepSchema = z.object({
  delayHours: z
    .number()
    .int()
    .min(0)
    .max(24 * 365)
    .describe("Hours to wait after the PREVIOUS step (not since enrollment)."),
  channel: z
    .enum(["EMAIL", "TASK", "CALL", "SMS"])
    .default("EMAIL")
    .describe(
      "TASK is an internal reminder — no mail. CALL places an AI voice call (Vapi) to consented leads; subject becomes the internal step label. SMS texts consented leads with a phone number (Twilio); body is plain text, subject is the internal label."
    ),
  subject: z.string().min(1).max(200),
  body: z.string().min(1).max(20000).describe("HTML. Sanitized by the hub against an allowlist. Ignored for CALL steps."),
  ctaLabel: z.string().max(60).nullish().describe("Button text. Needs ctaUrl too or neither renders."),
  ctaUrl: z.string().max(500).nullish().describe("https:, mailto:, or a site-relative /path."),
  callAssistantId: z
    .string()
    .max(100)
    .nullish()
    .describe("CALL only: Vapi assistant override (blank = hub default assistant)."),
  callFirstMessage: z
    .string()
    .max(500)
    .nullish()
    .describe("CALL only: opening-line override for the voice assistant."),
});

/** True when the segment carries no constraints — i.e. it would match every lead. */
export function isUnboundedSegment(segment: DripSegment | undefined): boolean {
  if (!segment) return true;
  return Object.entries(segment).every(([key, value]) => {
    if (value === undefined) return true;
    // The broadcast fields reach a real, finite audience, so they BOUND a
    // segment — but only when actually set to something. `includeUsers: false`
    // or an empty cohort list constrains nothing, and treating those as
    // bounding would suppress the very "matches EVERY lead" warning they need.
    if (key === "cohorts") return value !== "any" && (!Array.isArray(value) || value.length === 0);
    if (key === "products") return !Array.isArray(value) || value.length === 0;
    if (key === "includeUsers") return value !== true;
    return Array.isArray(value) && value.length === 0;
  });
}

export function describeSegmentInput(segment: DripSegment): string {
  const parts: string[] = [];
  if (segment.sources?.length) parts.push(`source in [${segment.sources.join(", ")}]`);
  if (segment.statuses?.length) parts.push(`status in [${segment.statuses.join(", ")}]`);
  if (segment.anyTags?.length) parts.push(`any tag [${segment.anyTags.join(", ")}]`);
  if (segment.allTags?.length) parts.push(`all tags [${segment.allTags.join(", ")}]`);
  if (segment.noneTags?.length) parts.push(`no tag [${segment.noneTags.join(", ")}]`);
  if (segment.minAgeHours) parts.push(`at least ${segment.minAgeHours}h old`);
  if (segment.maxAgeDays) parts.push(`at most ${segment.maxAgeDays}d old`);
  if (segment.inactiveForDays) parts.push(`inactive ${segment.inactiveForDays}d+`);
  if (segment.cohorts === "any") parts.push("ever enrolled in any cohort");
  else if (segment.cohorts?.length) parts.push(`cohort in [${segment.cohorts.join(", ")}]`);
  if (segment.products?.length) parts.push(`paid product in [${segment.products.join(", ")}]`);
  if (segment.includeUsers !== undefined) {
    parts.push(segment.includeUsers ? "includes hub Users" : "CRM leads only");
  }
  return parts.length ? parts.join(" · ") : "no constraints (matches every lead)";
}

/** Cumulative timing, so the operator can see when each step actually lands. */
export function renderStepTimeline(
  steps: ReadonlyArray<Pick<DripStepItem, "delayHours" | "channel" | "subject">>
): string[] {
  let cumulativeHours = 0;
  return steps.map((step, index) => {
    cumulativeHours += step.delayHours;
    const day = Math.floor(cumulativeHours / 24) + 1;
    const tag =
      step.channel === "TASK"
        ? " [TASK — no mail]"
        : step.channel === "CALL"
          ? " [CALL — AI voice call]"
          : step.channel === "SMS"
            ? " [SMS — text message]"
            : "";
    return `  ${index + 1}. +${step.delayHours}h (day ${day}) · ${step.subject}${tag}`;
  });
}
