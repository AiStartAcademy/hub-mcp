import { z } from "zod";
import type {
  HubClient,
  ListVenueEventsParams,
  VenueEventListStatus,
  VenueEventRecord,
} from "../hub-client.js";
import { formatCents } from "./venue-money.js";

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const venueEventListSchema = z.object({
  id: z.string().optional(),
  slug: z.string().optional(),
  status: z.enum(["ALL", "PENDING", "APPROVED", "DECLINED", "CANCELLED"]).optional(),
  from: dateSchema.optional(),
  to: dateSchema.optional(),
  q: z.string().max(200).optional(),
  page: z.number().int().positive().optional(),
  pageSize: z.number().int().positive().max(100).optional(),
});

export type VenueEventListInput = z.infer<typeof venueEventListSchema>;

function countTargets(input: VenueEventListInput): number {
  return [input.id, input.slug].filter((value) => typeof value === "string" && value.trim().length > 0).length;
}

function fmt(value: string | null | undefined): string {
  if (!value) return "—";
  return value;
}

function formatCount(value: number | null): string {
  return value === null ? "—" : String(value);
}

function formatTimeRange(item: VenueEventRecord): string {
  return `${item.startTime} - ${item.endTime} ${item.timezone}`;
}

function formatGcalState(item: VenueEventRecord): string {
  if (item.gcalSyncError) return `failed · ${item.gcalSyncError}`;
  if (item.gcalSyncedAt && item.gcalEventId) return `synced · ${item.gcalSyncedAt} · ${item.gcalEventId}`;
  if (item.gcalSyncedAt) return `synced · ${item.gcalSyncedAt}`;
  if (item.gcalEventId) return `linked · ${item.gcalEventId}`;
  return "unsynced";
}

function hasListFilters(input: VenueEventListInput): boolean {
  return (
    input.status !== undefined ||
    input.from !== undefined ||
    input.to !== undefined ||
    input.q !== undefined ||
    input.page !== undefined ||
    input.pageSize !== undefined
  );
}

function renderListItem(item: VenueEventRecord): string {
  return [
    `• ${item.date.slice(0, 10)} · ${item.title}`,
    `    status: ${item.status} · dealType: ${item.dealType} · type: ${item.type}`,
    `    time: ${formatTimeRange(item)} · organizer: ${item.organizerName} <${item.contactEmail}>`,
    `    slug: ${item.slug} · org: ${fmt(item.orgName)} · gcal: ${formatGcalState(item)}`,
  ].join("\n");
}

function formatOptionalCents(value: number | null): string {
  return value === null ? "—" : formatCents(value);
}

function hasRentalPaymentDetails(item: VenueEventRecord): boolean {
  return (
    item.rentalFeeCents !== null ||
    item.rentalDepositCents !== null ||
    item.rentalPaymentStatus !== null ||
    item.rentalPaymentUrl !== null
  );
}

function renderDetail(item: VenueEventRecord): string {
  const lines = [
    `${item.title} · ${item.status} · ${item.dealType}`,
    `id: ${item.id}`,
    `slug: ${item.slug}`,
    `type: ${item.type}`,
    `date: ${item.date}`,
    `time: ${formatTimeRange(item)}`,
    `organizer: ${item.organizerName} <${item.contactEmail}>`,
    `organization: ${fmt(item.orgName)}`,
    `phone: ${fmt(item.contactPhone)}`,
    `description: ${fmt(item.description)}`,
    `expectedAttendees: ${formatCount(item.expectedAttendees)} · capacity: ${formatCount(item.capacity)}`,
    `isOnline: ${item.isOnline ? "true" : "false"} · source: ${item.source}`,
    `registrationUrl: ${fmt(item.externalRegistrationUrl)}`,
    `ticketPriceCents: ${item.ticketPriceCents ?? "—"} · ticketPaymentLink: ${fmt(item.ticketPaymentLink)}`,
    `cover: ${fmt(item.cover)}`,
    `quoteAmountCents: ${item.quoteAmountCents ?? "—"} · quoteNote: ${fmt(item.quoteNote)}`,
    `dealNote: ${fmt(item.dealNote)}`,
    `adminNote: ${fmt(item.adminNote)}`,
    `gcal: ${formatGcalState(item)}`,
    `createdAt: ${item.createdAt}`,
    `updatedAt: ${item.updatedAt}`,
  ];

  if (hasRentalPaymentDetails(item)) {
    lines.splice(
      lines.length - 3,
      0,
      `rentalFee: ${formatOptionalCents(item.rentalFeeCents)} · rentalDeposit: ${formatOptionalCents(item.rentalDepositCents)}`,
      `rentalPaymentStatus: ${fmt(item.rentalPaymentStatus)}`,
      `rentalPaymentUrl: ${fmt(item.rentalPaymentUrl)}`
    );
  }

  return lines.join("\n");
}

function toListParams(input: VenueEventListInput): ListVenueEventsParams {
  return {
    status: input.status as VenueEventListStatus | undefined,
    from: input.from,
    to: input.to,
    q: input.q,
    page: input.page,
    pageSize: input.pageSize,
  };
}

export function makeVenueEventListHandler(hub: HubClient) {
  return async (input: VenueEventListInput): Promise<string> => {
    const targetCount = countTargets(input);

    if (targetCount > 1) {
      return "Refused: provide exactly one of id or slug.";
    }

    if (targetCount === 1) {
      if (hasListFilters(input)) {
        return "Refused: when using id or slug, omit list filters and paging.";
      }

      const item = await hub.getVenueEvent({ id: input.id, slug: input.slug });
      return renderDetail(item);
    }

    const response = await hub.listVenueEvents(toListParams(input));
    if (!response.events.length) return "No venue events match this filter.";

    const lines = response.events.map(renderListItem);
    lines.push("");
    lines.push(`total: ${response.total} · page: ${response.page} · pageSize: ${response.pageSize}`);
    return lines.join("\n");
  };
}
