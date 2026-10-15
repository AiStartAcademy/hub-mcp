import { z } from "zod";
import type { HubClient } from "../hub-client.js";
import { describeSegmentInput, renderStepTimeline } from "./drip-shared.js";

export const dripCampaignGetSchema = z.object({
  id: z.string().optional().describe("Provide exactly one of id or slug."),
  slug: z.string().optional().describe("Provide exactly one of id or slug."),
});

export type DripCampaignGetInput = z.infer<typeof dripCampaignGetSchema>;

export function makeDripCampaignGetHandler(hub: HubClient) {
  return async (input: DripCampaignGetInput): Promise<string> => {
    const targets = [input.id, input.slug].filter(
      (value) => typeof value === "string" && value.trim().length > 0
    );
    if (targets.length !== 1) return "Refused: provide exactly one of id or slug.";

    const { item } = await hub.getDripCampaign(input.id ? { id: input.id } : { slug: input.slug });
    const enrol = item.enrollmentCounts;

    const lines = [
      `${item.name} (${item.slug})`,
      `status: ${item.status} · priority: ${item.priority} · autoEnroll: ${item.autoEnroll}`,
      `window: ${item.sendWindowStartHour}:00-${item.sendWindowEndHour}:00 ${item.timezone}` +
        (item.skipWeekends ? " · skips weekends" : ""),
      `exits on lead status: ${item.exitOnStatuses.length ? item.exitOnStatuses.join(", ") : "none"}`,
      `audience: ${describeSegmentInput(item.segment)}`,
      `test email: ${item.testEmail ?? "— (set one to use \"Send test\" in the admin UI)"}`,
      "",
      `enrollments: ${enrol.active} active / ${enrol.completed} completed / ${enrol.exited} exited / ${enrol.paused} paused`,
      `sends: ${item.sentCount} sent · ${item.failedCount} failed`,
      "",
      item.description ? `description: ${item.description}` : "description: —",
      "",
      `steps (${item.steps.length}):`,
      ...(item.steps.length ? renderStepTimeline(item.steps) : ["  (none — campaign cannot be activated)"]),
    ];

    if (item.status !== "DRAFT") {
      lines.push("");
      lines.push(
        `⚠ This campaign is ${item.status}. Its steps cannot be replaced via MCP while leads are enrolled.`
      );
    }
    return lines.join("\n");
  };
}
