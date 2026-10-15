import { z } from "zod";
import type { HubClient } from "../hub-client.js";

export const leadGetSchema = z.object({
  id: z.string().min(1).max(128),
});

export type LeadGetInput = z.infer<typeof leadGetSchema>;

export function makeLeadGetHandler(hub: HubClient) {
  return async (input: LeadGetInput): Promise<string> => {
    const { item } = await hub.getLead(input.id);
    const lines = [
      `${item.name ?? "(no name)"} <${item.email}>`,
      `id: ${item.id} · status: ${item.status} · source: ${item.source ?? "—"}`,
      `phone: ${item.phone ?? "—"}`,
      `tags: ${item.tags.length ? item.tags.join(", ") : "—"}`,
      `created: ${item.createdAt} · last activity: ${item.lastActivityAt ?? "—"}`,
    ];
    if (item.attribution && Object.keys(item.attribution).length) {
      lines.push(`attribution: ${JSON.stringify(item.attribution)}`);
    }
    if (item.notes) {
      lines.push("", `notes: ${item.notes}`);
    }
    if (item.events.length) {
      lines.push("", `events (${item.events.length}${item.eventsTruncated ? ", truncated to 100" : ""}):`);
      for (const event of item.events) {
        const utm = [event.utmSource, event.utmMedium, event.utmCampaign]
          .filter(Boolean)
          .join("/");
        const meta =
          event.metadata && Object.keys(event.metadata).length
            ? ` · ${JSON.stringify(event.metadata).slice(0, 200)}`
            : "";
        lines.push(`  ${event.createdAt} · ${event.type}${utm ? ` · utm: ${utm}` : ""}${meta}`);
      }
    }
    return lines.join("\n");
  };
}
