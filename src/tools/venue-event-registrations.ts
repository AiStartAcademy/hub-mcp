import { z } from "zod";
import type { HubClient, VenueEventRegistrationRecord } from "../hub-client.js";

export const venueEventRegistrationsSchema = z.object({
  id: z.string().optional(),
  slug: z.string().optional(),
});

export type VenueEventRegistrationsInput = z.infer<typeof venueEventRegistrationsSchema>;

function countTargets(input: VenueEventRegistrationsInput): number {
  return [input.id, input.slug].filter((value) => typeof value === "string" && value.trim().length > 0).length;
}

function fmt(value: string | null | undefined): string {
  if (!value) return "—";
  return value;
}

function renderRegistration(item: VenueEventRegistrationRecord): string {
  const waiver =
    item.waiverAcceptedAt || item.waiverVersion
      ? `${item.waiverAcceptedAt ?? "—"} · ${item.waiverVersion ?? "—"}`
      : "—";

  return [
    `• ${item.name} <${item.email}>`,
    `    status: ${item.status} · phone: ${fmt(item.phone)} · contactId: ${fmt(item.contactId)}`,
    `    waiver: ${waiver}`,
    `    createdAt: ${item.createdAt}`,
  ].join("\n");
}

export function makeVenueEventRegistrationsHandler(hub: HubClient) {
  return async (input: VenueEventRegistrationsInput): Promise<string> => {
    if (countTargets(input) !== 1) {
      return "Refused: provide exactly one of id or slug.";
    }

    const response = await hub.getVenueEventRegistrations({ id: input.id, slug: input.slug });
    const header = `${response.event.title} · ${response.event.slug} · registrations: ${response.registrations.length}`;

    if (!response.registrations.length) {
      return `${header}\nNo registrations found.`;
    }

    return [header, ...response.registrations.map(renderRegistration)].join("\n");
  };
}
