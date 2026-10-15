import { z } from "zod";
import type { HubClient } from "../hub-client.js";
import { describeSegmentInput, isUnboundedSegment, segmentSchema } from "./drip-shared.js";

export const dripAudiencePreviewSchema = z.object({
  segment: segmentSchema,
});

export type DripAudiencePreviewInput = z.infer<typeof dripAudiencePreviewSchema>;

export function makeDripAudiencePreviewHandler(hub: HubClient) {
  return async (input: DripAudiencePreviewInput): Promise<string> => {
    const { count } = await hub.previewDripAudience(input.segment);
    const lines = [
      `audience: ${describeSegmentInput(input.segment)}`,
      `matching leads right now: ${count}`,
    ];
    if (isUnboundedSegment(input.segment)) {
      lines.push("");
      lines.push("⚠ This segment has no constraints — it matches EVERY lead in the CRM.");
    }
    lines.push("");
    lines.push(
      "Count is a snapshot. Membership is evaluated at enrollment only, so this is who would" +
        " be swept in if the campaign were active now — not a fixed list."
    );
    return lines.join("\n");
  };
}
