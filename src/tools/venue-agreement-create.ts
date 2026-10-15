/**
 * venue_agreement_create — create a venue agreement in the hub.
 *
 * Two-beat by construction: the first call previews, the second
 * commits a stored preview. dryRun defaults to true, so the *only* way to
 * write is to have seen the diff first.
 */

import { z } from "zod";
import { HubError, type HubClient } from "../hub-client.js";
import type { Config } from "../config.js";
import type { PreviewStore } from "../preview-store.js";

const venueAgreementTemplateKeySchema = z.enum(["paid-rental", "free-barter", "revenue-share"]);
const venueAgreementStatusSchema = z.enum(["DRAFT", "SENT", "SIGNED", "VOID"]);
const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const variableValueSchema = z.union([z.string(), z.number()]);

export const venueAgreementCreateSchema = z
  .object({
    venueEventId: z.string().min(1).describe("Venue event id to attach the agreement to."),
    templateKey: venueAgreementTemplateKeySchema
      .optional()
      .describe("Agreement template. Omit to auto-select from the event dealType."),
    variables: z
      .record(z.string(), variableValueSchema)
      .optional()
      .describe("Template variable fills as string or number values."),
    send: z.boolean().optional().describe("If true, email the signer when the agreement is created."),
    signerEmail: z
      .string()
      .regex(emailRegex)
      .optional()
      .describe("Signer email address. Required only when you need to override the hub default."),
    dryRun: z
      .boolean()
      .optional()
      .describe("Defaults to true. Returns a preview and a previewId instead of writing."),
    previewId: z.string().optional().describe("The previewId from a prior dry run."),
    confirm: z.boolean().optional().describe("Must be true, with a previewId, to actually write."),
  })
  .strict();

export type VenueAgreementCreateInput = z.infer<typeof venueAgreementCreateSchema>;

/** The subset we actually send to the hub — control fields stripped. */
type VenueAgreementCreateSpec = Omit<VenueAgreementCreateInput, "dryRun" | "previewId" | "confirm">;

const recoveredVenueAgreementSchema = z
  .object({
    // The hub's 502 body carries the human-readable failure alongside the
    // recoverable agreement fields — tolerate it, don't fail the recovery on it.
    error: z.string().optional(),
    id: z.string(),
    token: z.string(),
    status: venueAgreementStatusSchema,
    templateKey: venueAgreementTemplateKeySchema,
    signingUrl: z.string(),
  })
  .strict();

function renderPreview(
  spec: VenueAgreementCreateSpec,
  config: Config,
  previewId: string,
  expires: number
): string {
  const lines: string[] = [];
  lines.push(`PREVIEW · target: ${config.envLabel}`);
  lines.push("");
  lines.push(`CREATE VenueAgreement for venueEventId ${spec.venueEventId}`);
  lines.push("");
  lines.push(`template: ${spec.templateKey ?? "auto from dealType"}`);
  const variableEntries = Object.entries(spec.variables ?? {});
  if (variableEntries.length === 0) {
    lines.push("· no template variables supplied");
  } else {
    for (const [key, value] of variableEntries) {
      lines.push(`fill ${key}: ${String(value)}`);
    }
  }
  if (spec.send === true) {
    lines.push(
      spec.signerEmail
        ? `⚠ signer email will be sent to ${spec.signerEmail}`
        : "⚠ signer email will be sent"
    );
  } else {
    lines.push("· agreement will be created, but no email will be sent");
  }
  lines.push("");
  lines.push(`previewId: ${previewId} · expires in ${expires} minutes`);
  lines.push("To commit: call venue_agreement_create again with previewId and confirm: true");
  return lines.join("\n");
}

function renderCommitted(
  result: z.infer<typeof recoveredVenueAgreementSchema>,
  config: Config,
  warning?: string
): string {
  return [
    `COMMITTED · target: ${config.envLabel}`,
    `Agreement: ${result.id}`,
    `Status: ${result.status}`,
    `Template: ${result.templateKey}`,
    warning,
    `Signing URL: ${result.signingUrl}`,
  ]
    .filter(Boolean)
    .join("\n");
}

export function makeVenueAgreementCreateHandler(
  hub: HubClient,
  config: Config,
  previews: PreviewStore<VenueAgreementCreateSpec>
) {
  return async (input: VenueAgreementCreateInput): Promise<string> => {
    const { dryRun, previewId, confirm, ...spec } = input;

    // ---- Beat 2: commit ----
    if (confirm === true) {
      if (!previewId) {
        return "Refused: confirm requires the previewId from a dry run. Run venue_agreement_create with dryRun first.";
      }
      if (config.readOnly) {
        return "Refused: this MCP server is running with HUB_MCP_READONLY=true.";
      }
      const taken = previews.take(previewId);
      if (!taken.ok) return `Refused: ${taken.reason}`;

      try {
        const result = await hub.createVenueAgreement(taken.payload);
        return renderCommitted(result, config);
      } catch (err) {
        if (err instanceof HubError && err.status === 0) {
          previews.restore(previewId, taken.payload);
          throw err;
        }
        if (err instanceof HubError && err.status === 502) {
          const recovered = recoveredVenueAgreementSchema.safeParse(err.body);
          if (recovered.success) {
            return renderCommitted(
              recovered.data,
              config,
              "⚠ Agreement was created, but the signer email did NOT send; re-send it manually."
            );
          }
        }
        throw err;
      }
    }

    // ---- Beat 1: preview (default) ----
    if (previewId && dryRun !== false) {
      return "Note: previewId was supplied without confirm: true, so nothing was committed. Re-send with confirm: true.";
    }
    const { previewId: id, expiresInMinutes } = previews.put(spec);
    return renderPreview(spec, config, id, expiresInMinutes);
  };
}
