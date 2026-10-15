/**
 * lead_update — batch-edit CRM contacts without granting purchase status.
 *
 * The first call stores an exact normalized payload and returns a preview. The
 * confirm call consumes that stored payload, never the resent arguments.
 */

import { z } from "zod";
import type { Config } from "../config.js";
import {
  HubError,
  type HubClient,
  type LeadUpdatePayload,
  type LeadUpdateResponse,
} from "../hub-client.js";
import type { PreviewStore } from "../preview-store.js";

const writableStatuses = ["NEW", "CONTACTED", "QUALIFIED", "LOST"] as const;
const currentStatuses = [...writableStatuses, "WON"] as const;
const appliedFields = ["status", "excludeFromPipeline", "tags"] as const;

const writableStatusSchema = z
  .string()
  .transform((status) => status.trim().toUpperCase())
  .superRefine((status, ctx) => {
    if (status === "WON") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Status WON is reserved for verified purchases and cannot be set by lead_update.",
      });
      return;
    }
    if (!writableStatuses.includes(status as (typeof writableStatuses)[number])) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `status must be one of ${writableStatuses.join(", ")}; WON is reserved for verified purchases.`,
      });
    }
  })
  .transform((status) => status as (typeof writableStatuses)[number]);

const currentStatusSchema = z
  .string()
  .transform((status) => status.trim().toUpperCase())
  .pipe(z.enum(currentStatuses));

const tagsSchema = z
  .array(
    z
      .string()
      .transform((tag) => tag.trim())
      .refine((tag) => tag.length <= 100, "Each tag must be at most 100 trimmed characters.")
  )
  .max(100, "tags must contain at most 100 entries.")
  .transform((tags) => [...new Set(tags.filter((tag) => tag.length > 0))]);

export const leadUpdateItemSchema = z
  .object({
    id: z
      .string()
      .transform((id) => id.trim())
      .pipe(z.string().min(1, "id is required.").max(128, "id must be at most 128 characters.")),
    status: writableStatusSchema.optional(),
    expectedCurrentStatus: currentStatusSchema
      .optional()
      .describe("Optional compare-and-swap precondition; requires status."),
    excludeFromPipeline: z.boolean().optional(),
    tags: tagsSchema.optional(),
    tagMode: z
      .enum(["add", "remove", "replace"])
      .optional()
      .describe("Defaults to add when tags are supplied. remove and replace are explicit opt-ins."),
  })
  .strict()
  .superRefine((update, ctx) => {
    if (update.expectedCurrentStatus !== undefined && update.status === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["expectedCurrentStatus"],
        message: "expectedCurrentStatus requires status.",
      });
    }
    if (update.tagMode !== undefined && update.tags === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["tagMode"],
        message: "tagMode requires tags.",
      });
    }

    const tagMode = update.tagMode ?? "add";
    const changesTags =
      update.tags !== undefined && (update.tags.length > 0 || tagMode === "replace");
    if (
      update.status === undefined &&
      update.excludeFromPipeline === undefined &&
      !changesTags
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Each update must request at least one actual field change.",
      });
    }
  });

const updatesSchema = z
  .array(leadUpdateItemSchema)
  .min(1, "updates must contain at least one item.")
  .max(50, "updates must contain at most 50 items.")
  .superRefine((updates, ctx) => {
    const seen = new Set<string>();
    updates.forEach((update, index) => {
      if (seen.has(update.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index, "id"],
          message: `Duplicate contact id: ${update.id}`,
        });
      }
      seen.add(update.id);
    });
  });

export const leadUpdateSchema = z
  .object({
    updates: updatesSchema.describe("1-50 contact updates committed as one auditable batch."),
    dryRun: z
      .boolean()
      .optional()
      .describe("Defaults to true. Returns a preview and previewId; writes nothing."),
    previewId: z.string().min(1).optional().describe("The previewId from a prior dry run."),
    confirm: z
      .boolean()
      .optional()
      .describe("Must be true with previewId to commit the exact stored preview."),
  })
  .strict();

export type LeadUpdateInput = z.infer<typeof leadUpdateSchema>;

const leadUpdateResultSchema = z
  .object({
    id: z.string(),
    ok: z.boolean(),
    applied: z.array(z.enum(appliedFields)),
    reason: z.enum(["not_found", "conflict", "error"]).optional(),
    message: z.string().optional(),
  })
  .strict()
  .superRefine((result, ctx) => {
    if (!result.ok && result.reason === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["reason"],
        message: "A failed result must include reason.",
      });
    }
  });

export const leadUpdateResponseSchema = z
  .object({
    results: z.array(leadUpdateResultSchema),
    summary: z
      .object({
        requested: z.number().int().nonnegative(),
        succeeded: z.number().int().nonnegative(),
        failed: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict()
  .superRefine((response, ctx) => {
    const succeeded = response.results.filter((result) => result.ok).length;
    const failed = response.results.length - succeeded;
    if (
      response.summary.requested !== response.results.length ||
      response.summary.succeeded !== succeeded ||
      response.summary.failed !== failed
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["summary"],
        message: "Summary counts do not match results.",
      });
    }
  });

/** Strip two-step control fields and materialize the additive tag default. */
export function buildLeadUpdatePayload(input: LeadUpdateInput): LeadUpdatePayload {
  return {
    updates: input.updates.map((update) => ({
      id: update.id,
      ...(update.status !== undefined ? { status: update.status } : {}),
      ...(update.expectedCurrentStatus !== undefined
        ? { expectedCurrentStatus: update.expectedCurrentStatus }
        : {}),
      ...(update.excludeFromPipeline !== undefined
        ? { excludeFromPipeline: update.excludeFromPipeline }
        : {}),
      ...(update.tags !== undefined
        ? { tags: update.tags, tagMode: update.tagMode ?? "add" }
        : {}),
    })),
  };
}

function renderPreview(
  payload: LeadUpdatePayload,
  config: Config,
  previewId: string,
  expiresInMinutes: number
): string {
  const lines = [
    `PREVIEW · target: ${config.envLabel}`,
    `${payload.updates.length} contact update(s) requested:`,
  ];

  for (const update of payload.updates) {
    lines.push("", `${update.id}:`);
    if (update.status !== undefined) {
      lines.push(
        `  status: ${update.status}${
          update.expectedCurrentStatus
            ? ` (only if current status is ${update.expectedCurrentStatus})`
            : ""
        }`
      );
    }
    if (update.excludeFromPipeline !== undefined) {
      lines.push(`  excludeFromPipeline: ${update.excludeFromPipeline}`);
    }
    if (update.tags !== undefined) {
      lines.push(
        `  tags: ${update.tagMode} requested [${update.tags.join(", ")}]; final tags are hub-owned and not known in preview`
      );
    }
  }

  lines.push(
    "",
    "Nothing was written. WON cannot be set here; only a verified purchase grant can mark it.",
    `previewId: ${previewId} · expires in ${expiresInMinutes} minutes`,
    "To commit: call lead_update again with previewId and confirm: true"
  );
  return lines.join("\n");
}

function renderCommitted(response: LeadUpdateResponse, config: Config): string {
  const lines = [
    `COMMITTED · target: ${config.envLabel}`,
    `requested: ${response.summary.requested} · succeeded: ${response.summary.succeeded}`,
    response.summary.failed > 0
      ? `FAILED: ${response.summary.failed} of ${response.summary.requested}`
      : "failed: 0",
    "",
  ];

  for (const result of response.results) {
    if (result.ok) {
      lines.push(
        `SUCCEEDED ${result.id} · applied: ${result.applied.length ? result.applied.join(", ") : "none"}`
      );
    } else {
      lines.push(
        `FAILED ${result.id} · ${result.reason} · applied: ${
          result.applied.length ? result.applied.join(", ") : "none"
        }${result.message ? ` · ${result.message}` : ""}`
      );
    }
  }
  return lines.join("\n");
}

function contextualizeHubError(error: HubError): HubError {
  const explanations: Partial<Record<number, string>> = {
    0: "Lead update failed because the hub could not be reached; nothing was written.",
    400: "Lead update failed because the hub rejected the contract; refresh this MCP server and retry with locally valid input.",
    401: "Lead update failed because HUB_MCP_TOKEN was rejected by the hub.",
    403: "Lead update refused because hub writes are disabled (HUB_MCP_WRITES_ENABLED is not true).",
    413: "Lead update failed because the hub response exceeded its 64 KiB response limit.",
    500: "Lead update failed because the hub MCP token is not configured server-side.",
  };
  return new HubError(
    explanations[error.status] ?? `Lead update failed at the hub (HTTP ${error.status}).`,
    error.status,
    error.body
  );
}

export function makeLeadUpdateHandler(
  hub: HubClient,
  config: Config,
  previews: PreviewStore<LeadUpdatePayload>
) {
  return async (input: LeadUpdateInput): Promise<string> => {
    if (input.confirm === true) {
      if (!input.previewId) {
        return "Refused: confirm requires the previewId from a dry run. Call again with dryRun first.";
      }
      if (config.readOnly) {
        return "Refused: this MCP server is running with HUB_MCP_READONLY=true.";
      }
      const taken = previews.take(input.previewId);
      if (!taken.ok) return `Refused: ${taken.reason}`;

      let rawResponse: unknown;
      try {
        rawResponse = await hub.updateLeads(taken.payload);
      } catch (error) {
        if (error instanceof HubError) {
          if (error.status === 0) {
            previews.restore(input.previewId, taken.payload);
          }
          throw contextualizeHubError(error);
        }
        throw error;
      }

      const parsed = leadUpdateResponseSchema.safeParse(rawResponse);
      if (!parsed.success) {
        throw new Error("Hub returned an invalid lead_update response; commit outcome is unknown.");
      }
      return renderCommitted(parsed.data, config);
    }

    if (input.previewId && input.dryRun !== false) {
      return "Note: previewId was supplied without confirm: true, so nothing was committed. Re-send with confirm: true.";
    }

    const payload = buildLeadUpdatePayload(input);
    const stored = previews.put(payload);
    return renderPreview(payload, config, stored.previewId, stored.expiresInMinutes);
  };
}
