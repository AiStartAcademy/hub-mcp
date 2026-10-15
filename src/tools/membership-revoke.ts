/**
 * membership_revoke — cancel a complimentary membership.
 *
 * Comp rows only: paid memberships are canceled in Stripe and synced back by
 * the webhook; the hub refuses to touch them here. Two-beat like every write.
 */

import { z } from "zod";
import { HubError, type HubClient } from "../hub-client.js";
import type { Config } from "../config.js";
import type { PreviewStore } from "../preview-store.js";

export const membershipRevokeSchema = z.object({
  membershipId: z
    .string()
    .min(1)
    .describe("The Membership id (find it with membership_list, compOnly: true)."),
  dryRun: z.boolean().optional().describe("Defaults to true. Returns a preview instead of writing."),
  previewId: z.string().optional().describe("The previewId from a prior dry run."),
  confirm: z.boolean().optional().describe("Must be true, with a previewId, to actually revoke."),
});

export type MembershipRevokeInput = z.infer<typeof membershipRevokeSchema>;

type RevokeSpec = Omit<MembershipRevokeInput, "dryRun" | "previewId" | "confirm">;

export function makeMembershipRevokeHandler(
  hub: HubClient,
  config: Config,
  previews: PreviewStore<RevokeSpec>
) {
  return async (input: MembershipRevokeInput): Promise<string> => {
    const { dryRun, previewId, confirm, ...spec } = input;

    if (confirm === true) {
      if (!previewId) {
        return "Refused: confirm requires the previewId from a dry run. Run membership_revoke with dryRun first.";
      }
      if (config.readOnly) {
        return "Refused: this MCP server is running with HUB_MCP_READONLY=true.";
      }
      const taken = previews.take(previewId);
      if (!taken.ok) return `Refused: ${taken.reason}`;

      let revoked;
      try {
        revoked = await hub.revokeMembership(taken.payload.membershipId);
      } catch (err) {
        if (err instanceof HubError && err.status === 0) {
          previews.restore(previewId, taken.payload);
        }
        throw err;
      }
      return [
        `COMMITTED · target: ${config.envLabel}`,
        `Revoked comp membership ${revoked.id} (${revoked.tier}) for ${revoked.buyerEmail ?? "?"}`,
        "Their member access ends immediately. They keep their hub account.",
      ].join("\n");
    }

    if (previewId && dryRun !== false) {
      return "Note: previewId was supplied without confirm: true, so nothing was committed. Re-send with confirm: true.";
    }
    const { previewId: id, expiresInMinutes } = previews.put(spec);
    return [
      `PREVIEW · target: ${config.envLabel}`,
      "",
      `REVOKE membership ${spec.membershipId} — sets status to canceled; access ends immediately`,
      "· refused by the hub if this is a PAID membership (cancel those in Stripe)",
      "· the member keeps their hub account and any cohort enrollments",
      "",
      `previewId: ${id} · expires in ${expiresInMinutes} minutes`,
      "To commit: call membership_revoke again with previewId and confirm: true",
    ].join("\n");
  };
}
