/**
 * membership_grant — grant a complimentary membership (promo/partner/scholarship).
 *
 * Two-beat like every write tool: dryRun previews, confirm commits the stored
 * preview. This is deliberately NOT a role change — membership is an
 * entitlement row; the hub's Stripe webhook stays the sole writer of paid
 * membership state, and this tool can only create comp_ rows.
 */

import { z } from "zod";
import { HubError, type HubClient } from "../hub-client.js";
import type { Config } from "../config.js";
import type { PreviewStore } from "../preview-store.js";

export const membershipGrantSchema = z.object({
  email: z.string().email().describe("The recipient's email. A hub account is created if none exists."),
  tier: z
    .enum(["MENTOR_NETWORK", "ACCELERATOR"])
    .describe(
      "MENTOR_NETWORK: recordings, community, weekly Q&A. " +
        "ACCELERATOR: everything, plus pods, coaching calls, deal desk, build sprints, member library."
    ),
  months: z
    .number()
    .int()
    .min(0)
    .max(24)
    .optional()
    .describe("Duration in months (30-day blocks). 0 or omitted = open-ended, access until revoked."),
  dryRun: z
    .boolean()
    .optional()
    .describe("Defaults to true. Returns a preview and a previewId instead of writing."),
  previewId: z.string().optional().describe("The previewId from a prior dry run."),
  confirm: z.boolean().optional().describe("Must be true, with a previewId, to actually grant."),
});

export type MembershipGrantInput = z.infer<typeof membershipGrantSchema>;

type GrantSpec = Omit<MembershipGrantInput, "dryRun" | "previewId" | "confirm">;

function renderPreview(spec: GrantSpec, config: Config, previewId: string, expires: number): string {
  const duration =
    spec.months && spec.months > 0 ? `${spec.months} month(s)` : "open-ended (until revoked)";
  return [
    `PREVIEW · target: ${config.envLabel}`,
    "",
    `GRANT complimentary membership to ${spec.email}`,
    `  tier: ${spec.tier} · duration: ${duration} · $0 (comp)`,
    "",
    "On confirm, the hub will:",
    "  · create a hub account for this email if none exists",
    "  · send a REAL welcome email to the recipient",
    "  · invite them to the members community chat",
    "  · mark their CRM contact WON and exit any active drip campaigns",
    "· paid Stripe memberships are untouched — this only creates a comp row",
    "",
    `previewId: ${previewId} · expires in ${expires} minutes`,
    "To commit: call membership_grant again with previewId and confirm: true",
  ].join("\n");
}

export function makeMembershipGrantHandler(
  hub: HubClient,
  config: Config,
  previews: PreviewStore<GrantSpec>
) {
  return async (input: MembershipGrantInput): Promise<string> => {
    const { dryRun, previewId, confirm, ...spec } = input;

    if (confirm === true) {
      if (!previewId) {
        return "Refused: confirm requires the previewId from a dry run. Run membership_grant with dryRun first.";
      }
      if (config.readOnly) {
        return "Refused: this MCP server is running with HUB_MCP_READONLY=true.";
      }
      const taken = previews.take(previewId);
      if (!taken.ok) return `Refused: ${taken.reason}`;

      let granted;
      try {
        granted = await hub.grantMembership(taken.payload);
      } catch (err) {
        if (err instanceof HubError && err.status === 0) {
          previews.restore(previewId, taken.payload);
        }
        throw err;
      }
      return [
        `COMMITTED · target: ${config.envLabel}`,
        `${granted.email} → ${granted.tier} (comp, ${granted.status})`,
        granted.currentPeriodEnd
          ? `period ends: ${granted.currentPeriodEnd.slice(0, 10)}`
          : "open-ended — revoke with membership_revoke when the promo ends",
        granted.userCreated
          ? "· a new hub account was created; they also received an account-setup email"
          : "· existing hub account",
        `membershipId: ${granted.membershipId}`,
        `${config.hubBaseUrl}/admin/members`,
      ].join("\n");
    }

    if (previewId && dryRun !== false) {
      return "Note: previewId was supplied without confirm: true, so nothing was committed. Re-send with confirm: true.";
    }
    const { previewId: id, expiresInMinutes } = previews.put(spec);
    return renderPreview(spec, config, id, expiresInMinutes);
  };
}
