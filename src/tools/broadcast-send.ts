import { z } from "zod";
import type { Config } from "../config.js";
import { HubError, type BroadcastSendPayload, type HubClient } from "../hub-client.js";
import type { PreviewStore } from "../preview-store.js";

export const broadcastSendSchema = z.object({
  campaignId: z.string().min(1),
  dryRun: z.boolean().optional(),
  previewId: z.string().optional(),
  confirm: z.boolean().optional(),
});

export type BroadcastSendInput = z.infer<typeof broadcastSendSchema>;
export type { BroadcastSendPayload } from "../hub-client.js";

export function makeBroadcastSendHandler(
  hub: HubClient,
  config: Config,
  previews: PreviewStore<BroadcastSendPayload>
) {
  return async (input: BroadcastSendInput): Promise<string> => {
    if (input.confirm === true) {
      if (!input.previewId) {
        return "Refused: confirm requires the previewId from a dry run. Call again with dryRun first.";
      }
      if (config.readOnly) {
        return "Refused: this MCP server is running with HUB_MCP_READONLY=true.";
      }
      const taken = previews.take(input.previewId);
      if (!taken.ok) return `Refused: ${taken.reason}`;
      try {
        const sent = await hub.sendBroadcast(taken.payload);
        return [
          `COMMITTED · target: ${config.envLabel}`,
          `campaign: ${sent.campaignId}`,
          `sent: ${sent.sent}`,
          `failed: ${sent.failed}`,
        ].join("\n");
      } catch (error) {
        // Only a never-reached hub provably sent nothing, so only then is the
        // preview safe to hand back for a retry.
        if (error instanceof HubError && error.status === 0) {
          previews.restore(input.previewId, taken.payload);
        }
        throw error;
      }
    }

    if (input.previewId && input.dryRun !== false) {
      return "Note: previewId was supplied without confirm: true, so nothing was committed. Re-send with confirm: true.";
    }

    const { item } = await hub.getDripCampaign({ id: input.campaignId });
    const audience = await hub.previewDripAudience(item.segment);
    const payload: BroadcastSendPayload = { campaignId: input.campaignId };
    const stored = previews.put(payload);
    return [
      `PREVIEW · target: ${config.envLabel}`,
      `broadcast: ${item.name} (${item.id})`,
      `audience total: ${audience.count}`,
      "first recipients:",
      ...(audience.recipients?.slice(0, 10).map((email) => `  ${email}`) ?? ["  (none returned)"]),
      `previewId: ${stored.previewId} · expires in ${stored.expiresInMinutes} minutes`,
      "Nothing was sent.",
      "To send: call broadcast_send again with previewId and confirm: true",
    ].join("\n");
  };
}
