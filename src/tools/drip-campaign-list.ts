import { z } from "zod";
import type { HubClient, DripCampaignListItem } from "../hub-client.js";

export const dripCampaignListSchema = z.object({
  page: z.number().int().positive().optional(),
  pageSize: z.number().int().positive().max(100).optional(),
  status: z.enum(["DRAFT", "ACTIVE", "PAUSED", "ARCHIVED"]).optional(),
});

export type DripCampaignListInput = z.infer<typeof dripCampaignListSchema>;

function renderItem(item: DripCampaignListItem): string {
  const window = `${item.sendWindowStartHour}:00-${item.sendWindowEndHour}:00 ${item.timezone}`;
  const enrol = item.enrollmentCounts;
  return [
    `${item.status === "ACTIVE" ? "●" : "○"} ${item.name} (${item.slug})`,
    `    status: ${item.status} · priority: ${item.priority} · autoEnroll: ${item.autoEnroll} · steps: ${item.stepCount}`,
    `    window: ${window}${item.skipWeekends ? " · skips weekends" : ""}`,
    `    audience: ${item.segmentSummary}`,
    `    enrollments: ${enrol.active} active / ${enrol.completed} completed / ${enrol.exited} exited / ${enrol.paused} paused`,
    `    sends: ${item.sentCount} sent · ${item.failedCount} failed`,
  ].join("\n");
}

export function makeDripCampaignListHandler(hub: HubClient) {
  return async (input: DripCampaignListInput): Promise<string> => {
    const response = await hub.listDripCampaigns(input);
    if (!response.items.length) return "No drip campaigns found.";

    const lines = response.items.map(renderItem);
    lines.push("");
    lines.push(
      `total: ${response.total} · page: ${response.page} · pageSize: ${response.pageSize}` +
        (response.hasMore ? " · more pages available" : "")
    );
    return lines.join("\n");
  };
}
