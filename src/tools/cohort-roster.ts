import { z } from "zod";
import type { HubClient } from "../hub-client.js";

export const cohortRosterSchema = z.object({
  id: z.string().min(1).describe("Cohort id or slug."),
});

export type CohortRosterInput = z.infer<typeof cohortRosterSchema>;

export function makeCohortRosterHandler(hub: HubClient) {
  return async ({ id }: CohortRosterInput): Promise<string> => {
    const result = await hub.getCohortRoster(id);
    return [
      `cohort: ${result.cohort.title} (${result.cohort.slug ?? result.cohort.id})`,
      `total: ${result.total}`,
      ...result.roster.map(
        (row) => `${row.name} · ${row.email} · tier: ${row.tier ?? "none"} · source: ${row.source}`
      ),
      "",
      "PII: this roster contains personal information. Do not paste it anywhere public.",
    ].join("\n");
  };
}
