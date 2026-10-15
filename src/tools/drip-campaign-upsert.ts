/**
 * drip_campaign_upsert — author a drip campaign remotely, preview first.
 *
 * Draft-only by design: this tool cannot set `status`, so it cannot start mail
 * flowing. Activation stays a deliberate human step in the admin UI. What it
 * CAN do is stage the audience and the copy that activation would then send,
 * which is why the preview leads with the audience count rather than the diff.
 *
 * `steps` is a FULL REPLACEMENT and the hub refuses it on any non-DRAFT
 * campaign: re-ordering steps under live enrollments breaks the runner's
 * `lastStepOrder + 1` walk and can skip or re-send messages.
 */

import { z } from "zod";
import {
  HubError,
  type HubClient,
  type DripCampaignCreatePayload,
  type DripCampaignDetailItem,
  type DripCampaignPatchPayload,
  type DripCampaignSettingsFields,
  type DripSegment,
} from "../hub-client.js";
import type { Config } from "../config.js";
import type { PreviewStore } from "../preview-store.js";
import {
  campaignTriggerSchema,
  describeSegmentInput,
  isUnboundedSegment,
  renderStepTimeline,
  segmentSchema,
  stepSchema,
} from "./drip-shared.js";

const SETTINGS_FIELDS = [
  "name",
  "description",
  "trigger",
  "priority",
  "timezone",
  "sendWindowStartHour",
  "sendWindowEndHour",
  "skipWeekends",
  "exitOnStatuses",
  "testEmail",
  "autoEnroll",
] as const;

export const dripCampaignUpsertSchema = z.object({
  id: z.string().optional().describe("Existing campaign to patch. Omit both id and slug to create."),
  slug: z.string().optional().describe("Existing campaign to patch. Omit both id and slug to create."),
  name: z.string().min(1).max(120).optional().describe("Required when creating."),
  description: z.union([z.string().max(1000), z.null()]).optional().describe("Internal note, not sent."),
  trigger: campaignTriggerSchema.optional(),
  priority: z
    .number()
    .int()
    .min(1)
    .max(999)
    .optional()
    .describe("Lower wins. A lead matching several campaigns joins only the lowest-priority one."),
  timezone: z.string().max(64).optional().describe("IANA, e.g. America/Los_Angeles."),
  sendWindowStartHour: z.number().int().min(0).max(23).optional(),
  sendWindowEndHour: z.number().int().min(1).max(24).optional(),
  skipWeekends: z.boolean().optional(),
  exitOnStatuses: z
    .array(z.enum(["NEW", "CONTACTED", "QUALIFIED", "WON", "LOST"]))
    .max(5)
    .optional()
    .describe("Lead statuses that end an active enrollment. Full replacement set."),
  testEmail: z
    .union([z.string().email().max(200), z.null()])
    .optional()
    .describe(
      "Staff inbox for the admin UI's per-step 'Send test' button. Never mailed as part of the" +
        " campaign; pass null to clear."
    ),
  autoEnroll: z
    .boolean()
    .optional()
    .describe("Whether the tick sweep enrolls matching leads automatically once ACTIVE."),
  segment: segmentSchema.optional().describe("Audience rules. Full replacement."),
  steps: z
    .array(stepSchema)
    .max(50)
    .optional()
    .describe("FULL REPLACEMENT of the sequence, in order. DRAFT campaigns only."),
  dryRun: z.boolean().optional().default(true),
  previewId: z.string().optional(),
  confirm: z.boolean().optional(),
});

export type DripCampaignUpsertInput = z.infer<typeof dripCampaignUpsertSchema>;

export type DripUpsertPayload =
  | { mode: "create"; payload: DripCampaignCreatePayload }
  | { mode: "patch"; payload: DripCampaignPatchPayload };

/**
 * Render the hub's per-step normalisation warnings.
 *
 * These matter more than they look. When the hub's sanitizer refuses a CTA URL
 * it nulls BOTH ctaLabel and ctaUrl and still reports the write as successful,
 * so "steps replaced: 7" is not evidence that seven buttons exist. Four
 * production campaigns shipped with every CTA silently missing before this
 * channel existed. Never let these be swallowed.
 */
function renderStepWarnings(warnings: string[] | undefined): string[] {
  if (!warnings?.length) return [];
  return ["", "\u26a0 STEP WARNINGS \u2014 the write succeeded but content was dropped:", ...warnings.map((w) => `  \u2022 ${w}`)];
}

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function renderValue(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) return value.length ? `[${value.join(", ")}]` : "[]";
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  const singleLine = String(value).replace(/\s+/g, " ").trim();
  return singleLine.length > 200 ? `"${singleLine.slice(0, 140)}..."` : `"${singleLine}"`;
}

type SettingsField = (typeof SETTINGS_FIELDS)[number];

function pickSettings(
  input: DripCampaignUpsertInput,
  fields: ReadonlyArray<SettingsField>
): DripCampaignSettingsFields {
  const out: Record<string, unknown> = {};
  for (const field of fields) out[field] = input[field];
  // Safe: SETTINGS_FIELDS are exactly the keys both types share, and the zod
  // schema already narrowed each value to its target type.
  return out as DripCampaignSettingsFields;
}

function currentSettingValue(item: DripCampaignDetailItem, field: string): unknown {
  if (field === "exitOnStatuses") return [...item.exitOnStatuses].sort();
  return (item as unknown as Record<string, unknown>)[field] ?? null;
}

export function makeDripCampaignUpsertHandler(
  hub: HubClient,
  config: Config,
  previews: PreviewStore<DripUpsertPayload>
) {
  return async (input: DripCampaignUpsertInput): Promise<string> => {
    const { id, slug, dryRun, previewId, confirm } = input;

    if (confirm === true) {
      if (!previewId) {
        return "Refused: confirm requires the previewId from a dry run. Call again with dryRun first.";
      }
      if (config.readOnly) {
        return "Refused: this MCP server is running with HUB_MCP_READONLY=true.";
      }
      const taken = previews.take(previewId);
      if (!taken.ok) return `Refused: ${taken.reason}`;

      try {
        if (taken.payload.mode === "create") {
          const created = await hub.createDripCampaign(taken.payload.payload);
          return [
            `COMMITTED · target: ${config.envLabel}`,
            `CREATED drip campaign "${created.name}" (${created.slug})`,
            `id: ${created.id} · status: ${created.status}`,
            `steps created: ${created.stepsCreated}`,
            `audience right now: ${created.segmentMatchCount} leads`,
            created.slugWasAdjusted ? "note: slug was adjusted to avoid a collision" : "",
            ...renderStepWarnings(created.warnings),
            "",
            "Status is DRAFT — nothing will send. Activate it in the admin UI when you're ready.",
          ]
            .filter(Boolean)
            .join("\n");
        }

        const patched = await hub.updateDripCampaign(taken.payload.payload);
        const changedLines = Object.entries(patched.changed).map(
          ([field, diff]) => `${field}: ${renderValue(diff.from)} → ${renderValue(diff.to)}`
        );
        return [
          `COMMITTED · target: ${config.envLabel}`,
          `campaign: ${patched.id}`,
          ...(changedLines.length ? changedLines : ["changed: none"]),
          patched.stepsReplaced === null ? "" : `steps replaced: ${patched.stepsReplaced}`,
          `unchanged: ${patched.unchanged.length ? patched.unchanged.join(", ") : "none"}`,
          `audience right now: ${patched.segmentMatchCount} leads`,
          patched.isLiveEdit ? "⚠ This campaign is not DRAFT — the edit is live." : "",
          ...renderStepWarnings(patched.warnings),
        ]
          .filter(Boolean)
          .join("\n");
      } catch (error) {
        // Only a never-reached hub provably wrote nothing, so only then is the
        // preview safe to hand back for a retry.
        if (error instanceof HubError && error.status === 0) {
          previews.restore(previewId, taken.payload);
        }
        throw error;
      }
    }

    if (previewId && dryRun !== false) {
      return "Note: previewId was supplied without confirm: true, so nothing was committed. Re-send with confirm: true.";
    }

    const targetCount = [id, slug].filter(
      (value) => typeof value === "string" && value.trim().length > 0
    ).length;
    if (targetCount > 1) return "Refused: provide at most one of id or slug.";

    const requestedSettings = SETTINGS_FIELDS.filter((field) => hasOwn(input, field));
    const wantsSegment = hasOwn(input, "segment");
    const wantsSteps = hasOwn(input, "steps");

    const startHour = input.sendWindowStartHour;
    const endHour = input.sendWindowEndHour;
    if (startHour !== undefined && endHour !== undefined && endHour <= startHour) {
      return `Refused: sendWindowEndHour (${endHour}) must be after sendWindowStartHour (${startHour}).`;
    }

    const isCreate = targetCount === 0;
    const warnings: string[] = [];

    if (isUnboundedSegment(input.segment) && wantsSegment) {
      warnings.push("⚠ AUDIENCE: this segment has no constraints — it matches EVERY lead in the CRM.");
    }
    if (input.autoEnroll === true) {
      warnings.push(
        "⚠ AUTO-ENROLL: once this campaign is ACTIVE, the tick sweep will enroll matching leads automatically."
      );
    }

    if (isCreate) {
      if (!input.name) return "Refused: creating a campaign requires a name.";

      const payload: DripCampaignCreatePayload = {
        ...pickSettings(input, requestedSettings),
        name: input.name,
      };
      if (wantsSegment) payload.segment = input.segment;
      if (wantsSteps) payload.steps = input.steps;

      const audience = await hub.previewDripAudience(input.segment ?? {});
      const { previewId: storedId, expiresInMinutes } = previews.put({ mode: "create", payload });

      return [
        `PREVIEW · target: ${config.envLabel}`,
        `CREATE drip campaign "${input.name}" as DRAFT`,
        "",
        `audience: ${describeSegmentInput(input.segment ?? {})}`,
        `matching leads right now: ${audience.count}`,
        "",
        `steps (${input.steps?.length ?? 0}):`,
        ...(input.steps?.length
          ? renderStepTimeline(input.steps)
          : ["  (none — add steps before this can ever be activated)"]),
        "",
        ...(requestedSettings.length
          ? ["settings:", ...requestedSettings.map((f) => `  ${f}: ${renderValue(input[f])}`), ""]
          : []),
        ...(warnings.length ? [...warnings, ""] : []),
        "Created as DRAFT — no mail sends until a human activates it in the admin UI.",
        `previewId: ${storedId} · expires in ${expiresInMinutes} minutes`,
        "Nothing was committed.",
        "To commit: call drip_campaign_upsert again with previewId and confirm: true",
      ].join("\n");
    }

    if (!requestedSettings.length && !wantsSegment && !wantsSteps) {
      return "Refused: provide at least one field to update.";
    }

    const { item } = await hub.getDripCampaign(id ? { id } : { slug });

    if (wantsSteps && item.status !== "DRAFT") {
      return [
        `Refused: cannot replace steps on a ${item.status} campaign ("${item.name}").`,
        "",
        "Re-ordering steps under live enrollments breaks the runner's step walk and can skip or",
        "re-send messages. Pause and duplicate the campaign in the admin UI, or edit settings",
        "and segment only (those are allowed on a live campaign).",
      ].join("\n");
    }

    const payload: DripCampaignPatchPayload = { id: item.id, ...pickSettings(input, requestedSettings) };
    if (wantsSegment) payload.segment = input.segment;
    if (wantsSteps) payload.steps = input.steps;

    // Window validation again, this time against the campaign's stored values —
    // patching one half of the window can invert it just as easily as both.
    const effectiveStart = startHour ?? item.sendWindowStartHour;
    const effectiveEnd = endHour ?? item.sendWindowEndHour;
    if (effectiveEnd <= effectiveStart) {
      return `Refused: the resulting send window ${effectiveStart}:00-${effectiveEnd}:00 is invalid — end must be after start.`;
    }

    if (item.status !== "DRAFT") {
      warnings.push(
        `⚠ LIVE: this campaign is ${item.status} with ${item.enrollmentCounts.active} active enrollment(s). Changes take effect on the next tick.`
      );
      if (input.autoEnroll === true && isUnboundedSegment(input.segment ?? item.segment)) {
        return [
          `Refused: turning on autoEnroll for a ${item.status} campaign whose segment matches every lead`,
          "would start mailing the entire CRM on the next tick. Narrow the segment first.",
        ].join("\n");
      }
    }

    const diffLines = requestedSettings.map((field) => {
      const before = currentSettingValue(item, field);
      const after = input[field] ?? null;
      return `${field}: ${renderValue(before)} → ${renderValue(after)}`;
    });

    const segmentForCount: DripSegment = wantsSegment ? input.segment ?? {} : item.segment;
    const audience = await hub.previewDripAudience(segmentForCount);
    const { previewId: storedId, expiresInMinutes } = previews.put({ mode: "patch", payload });

    return [
      `PREVIEW · target: ${config.envLabel}`,
      `UPDATE drip campaign "${item.name}" (${item.slug}) · status ${item.status}`,
      "",
      ...(diffLines.length ? [...diffLines, ""] : []),
      ...(wantsSegment
        ? [
            `segment: ${describeSegmentInput(item.segment)}`,
            `      → ${describeSegmentInput(input.segment ?? {})}`,
            "",
          ]
        : []),
      `matching leads right now: ${audience.count}`,
      "",
      ...(wantsSteps
        ? [
            `steps: REPLACING all ${item.steps.length} with ${input.steps?.length ?? 0}:`,
            ...renderStepTimeline(input.steps ?? []),
            "",
          ]
        : []),
      ...(warnings.length ? [...warnings, ""] : []),
      `previewId: ${storedId} · expires in ${expiresInMinutes} minutes`,
      "Nothing was committed.",
      "To commit: call drip_campaign_upsert again with previewId and confirm: true",
    ].join("\n");
  };
}
