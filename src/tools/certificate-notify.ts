import { z } from "zod";
import type { Config } from "../config.js";
import { HubError, type CertificateNotifyPayload, type HubClient } from "../hub-client.js";
import type { PreviewStore } from "../preview-store.js";

export const certificateNotifySchema = z.object({
  cohortId: z.string().min(1),
  certificateIds: z.array(z.string()).optional(),
  previewId: z.string().optional(),
  confirm: z.boolean().optional(),
});

export type CertificateNotifyInput = z.infer<typeof certificateNotifySchema>;
export type { CertificateNotifyPayload } from "../hub-client.js";

export function makeCertificateNotifyHandler(
  hub: HubClient,
  config: Config,
  previews: PreviewStore<CertificateNotifyPayload>
) {
  return async (input: CertificateNotifyInput): Promise<string> => {
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
        const notified = await hub.notifyCertificates({ ...taken.payload, dryRun: false });
        return [
          `COMMITTED · target: ${config.envLabel}`,
          `cohort: ${taken.payload.cohortId}`,
          `queued: ${notified.queued}`,
          `already notified: ${notified.alreadyNotified}`,
          `revoked: ${notified.revoked}`,
          `no email: ${notified.noEmail}`,
          `unsubscribed: ${notified.unsubscribed}`,
          ...(notified.campaignMissing
            ? ["WARNING: the certificate notification campaign is missing."]
            : []),
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

    if (input.previewId) {
      return "Note: previewId was supplied without confirm: true, so nothing was committed. Re-send with confirm: true.";
    }

    const notified = await hub.notifyCertificates({
      cohortId: input.cohortId,
      certificateIds: input.certificateIds,
      dryRun: true,
    });
    const payload: CertificateNotifyPayload = {
      cohortId: input.cohortId,
      certificateIds: input.certificateIds,
    };
    const stored = previews.put(payload);
    return [
      `PREVIEW · target: ${config.envLabel}`,
      `cohort: ${input.cohortId}`,
      `queued: ${notified.queued}`,
      `already notified: ${notified.alreadyNotified}`,
      `revoked: ${notified.revoked}`,
      `no email: ${notified.noEmail}`,
      `unsubscribed: ${notified.unsubscribed}`,
      ...(notified.campaignMissing
        ? ["WARNING: the certificate notification campaign is missing."]
        : []),
      `previewId: ${stored.previewId} · expires in ${stored.expiresInMinutes} minutes`,
      "Nothing was sent.",
      "To send: call certificate_notify again with previewId and confirm: true",
    ].join("\n");
  };
}
