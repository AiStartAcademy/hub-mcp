import { z } from "zod";
import type { HubClient, InstructorDetailItem } from "../hub-client.js";

export const instructorGetSchema = z.object({
  id: z.string().optional(),
  slug: z.string().optional(),
});

export type InstructorGetInput = z.infer<typeof instructorGetSchema>;

function countTargets(input: InstructorGetInput): number {
  return [input.id, input.slug].filter((value) => typeof value === "string" && value.trim().length > 0).length;
}

function fmt(value: string | null | undefined): string {
  if (!value) return "—";
  return value;
}

function renderTaughtCohorts(item: InstructorDetailItem): string[] {
  if (!item.taughtCohorts.length) return ["taughtCohorts: none"];
  return [
    "taughtCohorts:",
    ...item.taughtCohorts.map(
      (cohort) => `- ${cohort.title} · ${cohort.status} · ${cohort.slug ?? cohort.id}`
    ),
  ];
}

export function makeInstructorGetHandler(hub: HubClient) {
  return async (input: InstructorGetInput): Promise<string> => {
    if (countTargets(input) !== 1) {
      return "Refused: provide exactly one of id or slug.";
    }

    const { item } = await hub.getInstructor({ id: input.id, slug: input.slug });

    return [
      `${fmt(item.name)} · ${item.email}`,
      `id: ${item.id}`,
      `slug: ${fmt(item.slug)}`,
      `headline: ${fmt(item.headline)}`,
      `bio: ${fmt(item.bio)}`,
      `location: ${fmt(item.location)}`,
      `languages: ${fmt(item.languages)}`,
      `expertiseTags: ${fmt(item.expertiseTags)}`,
      `linkedinUrl: ${fmt(item.linkedinUrl)}`,
      `image: ${fmt(item.image)}`,
      `profileVisibility: ${item.profileVisibility}`,
      `timezone: ${fmt(item.timezone)}`,
      `isMentor: ${item.isMentor ? "true" : "false"}`,
      `taughtCohortCount: ${item.taughtCohortCount}`,
      `createdAt: ${item.createdAt}`,
      `updatedAt: ${item.updatedAt}`,
      `socialLinks: ${JSON.stringify(item.socialLinks)}`,
      ...renderTaughtCohorts(item),
    ].join("\n");
  };
}
