import { z } from "zod";
import type { HubClient, MembershipListItem } from "../hub-client.js";

export const membershipListSchema = z.object({
  page: z.number().int().positive().optional(),
  pageSize: z.number().int().positive().max(100).optional(),
  tier: z.enum(["MENTOR_NETWORK", "ACCELERATOR"]).optional(),
  status: z
    .enum(["active", "past_due", "canceled", "pending"])
    .optional()
    .describe("Membership status filter."),
  compOnly: z
    .boolean()
    .optional()
    .describe("Only complimentary (admin-granted) memberships — the only kind revocable via MCP."),
});

export type MembershipListInput = z.infer<typeof membershipListSchema>;

function renderMembership(item: MembershipListItem): string {
  const who = item.name ? `${item.name} <${item.email ?? "?"}>` : (item.email ?? "?");
  const price = item.isComp ? "COMP" : `$${(item.amountCents / 100).toFixed(0)}/mo`;
  const period = item.currentPeriodEnd
    ? `period ends ${item.currentPeriodEnd.slice(0, 10)}`
    : "open-ended";
  return [
    `• ${who}`,
    `    id: ${item.id} · ${item.tier} · ${item.status} · ${price} · ${period}`,
  ].join("\n");
}

export function makeMembershipListHandler(hub: HubClient) {
  return async (input: MembershipListInput): Promise<string> => {
    const response = await hub.listMemberships(input);
    if (!response.items.length) return "No memberships match this filter.";

    const lines = response.items.map(renderMembership);
    lines.push("");
    lines.push(`total: ${response.total} · page: ${response.page} · pageSize: ${response.pageSize}`);
    return lines.join("\n");
  };
}
