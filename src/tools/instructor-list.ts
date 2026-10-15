import { z } from "zod";
import type { HubClient, InstructorListItem, ListInstructorsParams } from "../hub-client.js";

export const instructorListSchema = z.object({
  page: z.number().int().positive().optional(),
  pageSize: z.number().int().positive().optional(),
  q: z.string().optional(),
  role: z.string().optional(),
  hasProfile: z.boolean().optional(),
});

export type InstructorListInput = z.infer<typeof instructorListSchema>;

function fmt(value: string | null | undefined): string {
  if (!value) return "—";
  return value;
}

function renderItem(item: InstructorListItem): string {
  return [
    fmt(item.name),
    fmt(item.headline),
    fmt(item.location),
    String(item.taughtCohortCount),
    fmt(item.linkedinUrl),
  ].join(" · ");
}

export function makeInstructorListHandler(hub: HubClient) {
  return async (input: InstructorListInput): Promise<string> => {
    const response = await hub.listInstructors(input satisfies ListInstructorsParams);
    const lines = response.items.length ? response.items.map(renderItem) : ["No instructors found."];
    lines.push("");
    lines.push(`total: ${response.total} · page: ${response.page} · pageSize: ${response.pageSize}`);
    if (response.candidatesTruncated) {
      lines.push("⚠ candidatesTruncated: true");
    }
    return lines.join("\n");
  };
}
