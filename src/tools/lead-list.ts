import { z } from "zod";
import type { HubClient, LeadListItem } from "../hub-client.js";

export const leadListSchema = z.object({
  page: z.number().int().positive().optional(),
  pageSize: z.number().int().positive().max(100).optional(),
  status: z.enum(["NEW", "CONTACTED", "QUALIFIED", "WON", "LOST"]).optional(),
  source: z
    .string()
    .max(200)
    .optional()
    .describe('Exact Contact.source match, e.g. "onboarding:ai-path" or "asset_download". No wildcards here.'),
  tag: z.string().max(200).optional().describe("Substring match on the lead's tags."),
  q: z.string().max(200).optional().describe("Free-text search over name, email and phone."),
});

export type LeadListInput = z.infer<typeof leadListSchema>;

function renderLead(item: LeadListItem): string {
  const who = item.name ? `${item.name} <${item.email}>` : item.email;
  const tags = item.tags.length ? item.tags.join(", ") : "—";
  const activity = item.lastActivityAt ?? item.createdAt;
  return [
    `• ${who}`,
    `    id: ${item.id} · status: ${item.status} · source: ${item.source ?? "—"}`,
    `    tags: ${tags}`,
    `    last activity: ${activity}`,
  ].join("\n");
}

export function makeLeadListHandler(hub: HubClient) {
  return async (input: LeadListInput): Promise<string> => {
    const response = await hub.listLeads(input);
    if (!response.items.length) return "No leads match this filter.";

    const lines = response.items.map(renderLead);
    lines.push("");
    lines.push(
      `total: ${response.total} · page: ${response.page} · pageSize: ${response.pageSize}` +
        (response.hasMore ? " · more pages available" : "")
    );
    return lines.join("\n");
  };
}
