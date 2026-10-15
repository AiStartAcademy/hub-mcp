/**
 * venue_rental_payment_create — issue a Stripe payment link for one venue
 * rental in the hub, and venue_rental_payment_deactivate — kill an
 * unpaid link.
 *
 * Two-beat by construction: the first call previews, the second
 * commits a stored preview. dryRun defaults to true, so the *only* way to
 * write is to have seen the diff first. Extra weight here: on prod this
 * mints a LIVE-mode Stripe link — real money — so the preview spells out the
 * dollar amounts and the env label.
 */

import { z } from "zod";
import { HubError, type HubClient, type VenueRentalPaymentResponse } from "../hub-client.js";
import type { Config } from "../config.js";
import type { PreviewStore } from "../preview-store.js";

const MAX_AMOUNT_CENTS = 100_000_00; // mirrors the hub's MAX_VENUE_RENTAL_AMOUNT_CENTS

export const venueRentalPaymentCreateSchema = z
  .object({
    venueEventId: z.string().min(1).describe("Venue event id to issue the rental payment link for."),
    feeCents: z
      .number()
      .int()
      .positive()
      .max(MAX_AMOUNT_CENTS)
      .describe("Rental fee in integer cents (e.g. 50000 = $500.00)."),
    depositCents: z
      .number()
      .int()
      .nonnegative()
      .max(MAX_AMOUNT_CENTS)
      .optional()
      .describe("Refundable security deposit in integer cents. Omit or 0 for none."),
    dryRun: z
      .boolean()
      .optional()
      .describe("Defaults to true. Returns a preview and a previewId instead of writing."),
    previewId: z.string().optional().describe("The previewId from a prior dry run."),
    confirm: z.boolean().optional().describe("Must be true, with a previewId, to actually write."),
  })
  .strict();

export type VenueRentalPaymentCreateInput = z.infer<typeof venueRentalPaymentCreateSchema>;

/** The subset we actually send to the hub — control fields stripped. */
type VenueRentalPaymentCreateSpec = Omit<
  VenueRentalPaymentCreateInput,
  "dryRun" | "previewId" | "confirm"
>;

export const venueRentalPaymentDeactivateSchema = z
  .object({
    venueEventId: z.string().min(1).describe("Venue event id whose unpaid rental payment link should be deactivated."),
    dryRun: z
      .boolean()
      .optional()
      .describe("Defaults to true. Returns a preview and a previewId instead of writing."),
    previewId: z.string().optional().describe("The previewId from a prior dry run."),
    confirm: z.boolean().optional().describe("Must be true, with a previewId, to actually write."),
  })
  .strict();

export type VenueRentalPaymentDeactivateInput = z.infer<typeof venueRentalPaymentDeactivateSchema>;

type VenueRentalPaymentDeactivateSpec = Omit<
  VenueRentalPaymentDeactivateInput,
  "dryRun" | "previewId" | "confirm"
>;

function dollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function renderCreatePreview(
  spec: VenueRentalPaymentCreateSpec,
  config: Config,
  previewId: string,
  expires: number
): string {
  const deposit = spec.depositCents ?? 0;
  const lines: string[] = [];
  lines.push(`PREVIEW · target: ${config.envLabel}`);
  lines.push("");
  lines.push(`CREATE Stripe rental payment link for venueEventId ${spec.venueEventId}`);
  lines.push("");
  lines.push(`rental fee: ${dollars(spec.feeCents)}`);
  lines.push(
    deposit > 0 ? `refundable deposit: ${dollars(deposit)}` : "· no security deposit"
  );
  lines.push(`total charged at checkout: ${dollars(spec.feeCents + deposit)}`);
  lines.push("");
  lines.push("⚠ On prod this mints a LIVE-mode Stripe link (real money). The link is");
  lines.push("returned to you — it is NOT sent to the organizer automatically.");
  lines.push("A pending sale appears on /admin/sales until the link is paid.");
  lines.push("");
  lines.push(`previewId: ${previewId} · expires in ${expires} minutes`);
  lines.push("To commit: call venue_rental_payment_create again with previewId and confirm: true");
  return lines.join("\n");
}

function renderDeactivatePreview(
  spec: VenueRentalPaymentDeactivateSpec,
  config: Config,
  previewId: string,
  expires: number
): string {
  return [
    `PREVIEW · target: ${config.envLabel}`,
    "",
    `DEACTIVATE the unpaid rental payment link for venueEventId ${spec.venueEventId}`,
    "",
    "The Stripe link stops accepting payment, the event's rental fields are cleared,",
    "and its pending sale on /admin/sales is marked failed. Refuses if already paid.",
    "",
    `previewId: ${previewId} · expires in ${expires} minutes`,
    "To commit: call venue_rental_payment_deactivate again with previewId and confirm: true",
  ].join("\n");
}

function renderCommitted(
  action: "created" | "deactivated",
  result: VenueRentalPaymentResponse,
  config: Config
): string {
  return [
    `COMMITTED · target: ${config.envLabel}`,
    `Rental payment link ${action}.`,
    `Status: ${result.rentalPaymentStatus ?? "none"}`,
    result.rentalFeeCents != null ? `Fee: ${dollars(result.rentalFeeCents)}` : undefined,
    result.rentalDepositCents != null
      ? `Deposit: ${dollars(result.rentalDepositCents)}`
      : undefined,
    result.rentalPaymentUrl ? `Payment URL: ${result.rentalPaymentUrl}` : undefined,
    action === "created"
      ? "Hand the URL to the venue operator — they send it to the organizer."
      : undefined,
  ]
    .filter(Boolean)
    .join("\n");
}

function makeTwoBeatHandler<Spec>(options: {
  toolName: string;
  config: Config;
  previews: PreviewStore<Spec>;
  commit: (spec: Spec) => Promise<string>;
  preview: (spec: Spec, previewId: string, expires: number) => string;
  rewriteError?: (err: HubError, spec: Spec) => HubError;
}) {
  return async (
    input: Spec & { dryRun?: boolean; previewId?: string; confirm?: boolean }
  ): Promise<string> => {
    const { dryRun, previewId, confirm, ...rest } = input;
    const spec = rest as Spec;

    // ---- Beat 2: commit ----
    if (confirm === true) {
      if (!previewId) {
        return `Refused: confirm requires the previewId from a dry run. Run ${options.toolName} with dryRun first.`;
      }
      if (options.config.readOnly) {
        return "Refused: this MCP server is running with HUB_MCP_READONLY=true.";
      }
      const taken = options.previews.take(previewId);
      if (!taken.ok) return `Refused: ${taken.reason}`;
      try {
        return await options.commit(taken.payload);
      } catch (err) {
        if (err instanceof HubError && err.status === 0) {
          // Network-level failure — the hub was never reached, so the preview
          // is still valid; restore it so the operator can simply retry.
          options.previews.restore(previewId, taken.payload);
          throw err;
        }
        if (err instanceof HubError && options.rewriteError) {
          throw options.rewriteError(err, taken.payload);
        }
        throw err;
      }
    }

    // ---- Beat 1: preview (default) ----
    if (previewId && dryRun !== false) {
      return `Note: previewId was supplied without confirm: true, so nothing was committed. Re-send with confirm: true.`;
    }
    const { previewId: id, expiresInMinutes } = options.previews.put(spec);
    return options.preview(spec, id, expiresInMinutes);
  };
}

function rewriteCreateHubError(
  err: HubError,
  spec: VenueRentalPaymentCreateSpec,
  config: Config
): HubError {
  switch (err.status) {
    case 403:
      return new HubError(
        "MCP writes are disabled on the target hub (HUB_MCP_WRITES_ENABLED must be 1).",
        err.status,
        err.body
      );
    case 404:
      return new HubError(`Venue event not found for id ${spec.venueEventId}.`, err.status, err.body);
    case 409:
      if (/already exists/i.test(err.message)) {
        return new HubError(
          `${err.message} Run venue_rental_payment_deactivate first.`,
          err.status,
          err.body
        );
      }
      if (/paid/i.test(err.message)) {
        return new HubError(
          `${err.message} A paid rental payment cannot be replaced.`,
          err.status,
          err.body
        );
      }
      return err;
    case 503:
      return new HubError(
        `Stripe is not configured on the ${config.envLabel} hub. Set STRIPE_SECRET_KEY there, then retry.`,
        err.status,
        err.body
      );
    default:
      return err;
  }
}

function rewriteDeactivateHubError(
  err: HubError,
  spec: VenueRentalPaymentDeactivateSpec
): HubError {
  switch (err.status) {
    case 403:
      return new HubError(
        "MCP writes are disabled on the target hub (HUB_MCP_WRITES_ENABLED must be 1).",
        err.status,
        err.body
      );
    case 404:
      return new HubError(
        `Venue event not found for id ${spec.venueEventId}, or it has no active rental payment link.`,
        err.status,
        err.body
      );
    case 409:
      return new HubError(
        `${err.message} A paid rental payment cannot be deactivated — refund it in Stripe instead.`,
        err.status,
        err.body
      );
    default:
      return err;
  }
}

export function makeVenueRentalPaymentCreateHandler(
  hub: HubClient,
  config: Config,
  previews: PreviewStore<VenueRentalPaymentCreateSpec>
) {
  return makeTwoBeatHandler<VenueRentalPaymentCreateSpec>({
    toolName: "venue_rental_payment_create",
    config,
    previews,
    commit: async (spec) =>
      renderCommitted("created", await hub.createVenueRentalPayment(spec), config),
    preview: (spec, id, expires) => renderCreatePreview(spec, config, id, expires),
    rewriteError: (err, spec) => rewriteCreateHubError(err, spec, config),
  });
}

export function makeVenueRentalPaymentDeactivateHandler(
  hub: HubClient,
  config: Config,
  previews: PreviewStore<VenueRentalPaymentDeactivateSpec>
) {
  return makeTwoBeatHandler<VenueRentalPaymentDeactivateSpec>({
    toolName: "venue_rental_payment_deactivate",
    config,
    previews,
    commit: async (spec) =>
      renderCommitted("deactivated", await hub.deactivateVenueRentalPayment(spec), config),
    preview: (spec, id, expires) => renderDeactivatePreview(spec, config, id, expires),
    rewriteError: rewriteDeactivateHubError,
  });
}
