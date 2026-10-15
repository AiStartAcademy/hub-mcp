/**
 * venue_event_update — update a venue event in the hub.
 *
 * Two-beat by construction: the first call previews, the second
 * commits a stored preview. dryRun defaults to true, so the *only* way to
 * write is to have seen the diff first.
 */

import { z } from "zod";
import {
  HubError,
  type HubClient,
  type VenueEventAgendaItem,
  type VenueEventFaqEntry,
  type VenueEventGalleryImage,
  type VenueEventHost,
  type VenueEventPricingTier,
  type VenueEventRecord,
  type VenueEventUpdatePayload,
} from "../hub-client.js";
import type { Config } from "../config.js";
import type { PreviewStore } from "../preview-store.js";
import {
  venueEventAgendaItemSchema,
  venueEventFaqEntrySchema,
  venueEventGalleryImageSchema,
  venueEventHostSchema,
  venueEventPricingTierSchema,
  venueEventYoutubeUrlSchema,
} from "./venue-event-fields.js";

const venueEventTypeSchema = z.enum([
  "NETWORKING",
  "HACKATHON",
  "WORKSHOP",
  "MEETUP",
  "DEMO_DAY",
  "INTERVIEW",
  "PODCAST",
  "PANEL",
  "KIDS_PROGRAM",
  "MOVIE_CLUB",
  "OTHER",
]);

const venueEventStatusSchema = z.enum(["PENDING", "APPROVED", "DECLINED", "CANCELLED"]);

const venueDealTypeSchema = z.enum([
  "PAID_RENTAL",
  "BARTER",
  "REVENUE_SHARE",
  "FREE_PROMO",
  "INTERNAL",
]);

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
const timeRegex = /^(1[0-2]|[1-9]):[0-5][0-9] (AM|PM)$/;
const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const venueEventUpdateSchema = z
  .object({
    id: z.string().min(1).optional().describe("Venue event id. Provide exactly one of id or slug."),
    slug: z.string().min(1).optional().describe("Venue event slug. Provide exactly one of id or slug."),
    title: z.string().min(1).optional().describe("Updated event title."),
    description: z.string().nullable().optional().describe("Updated event description."),
    type: venueEventTypeSchema.optional().describe("Updated event type."),
    date: z.string().regex(dateRegex).optional().describe("Updated event date in YYYY-MM-DD format."),
    endDate: z
      .string()
      .regex(dateRegex)
      .nullable()
      .optional()
      .describe("Last day of a multi-day event, YYYY-MM-DD. Omit for single-day events."),
    startTime: z
      .string()
      .regex(timeRegex)
      .optional()
      .describe('Updated start time in 12-hour format, for example "6:00 PM".'),
    endTime: z
      .string()
      .regex(timeRegex)
      .optional()
      .describe('Updated end time in 12-hour format, for example "8:30 PM".'),
    timezone: z.string().min(1).nullable().optional().describe("Updated IANA timezone."),
    subtitle: z
      .string()
      .nullable()
      .optional()
      .describe("Short tagline shown under the title on the public event page."),
    videoUrl: venueEventYoutubeUrlSchema
      .nullable()
      .optional()
      .describe(
        "YouTube URL for the event page hero video. watch, youtu.be, shorts, embed, and live URL forms are all accepted."
      ),
    priceNote: z
      .string()
      .nullable()
      .optional()
      .describe('Free-text pricing line shown on the public page, e.g. "Free for members".'),
    gallery: z
      .array(venueEventGalleryImageSchema)
      .nullable()
      .optional()
      .describe(
        "Photo gallery. Array of { url (required, absolute), alt?, caption? }. Order is preserved."
      ),
    agenda: z
      .array(venueEventAgendaItemSchema)
      .nullable()
      .optional()
      .describe(
        "Schedule rows. Array of { date? 'YYYY-MM-DD', label?, startTime? '6:00 PM', endTime? '9:00 PM', title (required), note?, isPublic? }. Rows are grouped into days by date, preserving order."
      ),
    hosts: z
      .array(venueEventHostSchema)
      .nullable()
      .optional()
      .describe(
        "Speakers/hosts. Array of { name (required), role?, bio?, photoUrl?, profileSlug?, links? { linkedin?, site?, x? } }."
      ),
    pricingTiers: z
      .array(venueEventPricingTierSchema)
      .nullable()
      .optional()
      .describe(
        "Ticket tiers. Array of { label (required), priceCents (required integer, in CENTS not dollars), note?, url?, availableUntil? 'YYYY-MM-DD', soldOut? }."
      ),
    faq: z
      .array(venueEventFaqEntrySchema)
      .nullable()
      .optional()
      .describe("Array of { q (required), a (required) }."),
    organizerName: z.string().min(1).optional().describe("Updated organizer name."),
    orgName: z.string().nullable().optional().describe("Updated organizer organization name."),
    contactEmail: z
      .string()
      .regex(emailRegex)
      .optional()
      .describe("Updated organizer contact email address."),
    contactPhone: z.string().nullable().optional().describe("Updated organizer phone number."),
    expectedAttendees: z
      .number()
      .int()
      .min(0)
      .nullable()
      .optional()
      .describe("Updated expected attendee count. Integer, minimum 0."),
    capacity: z
      .number()
      .int()
      .min(0)
      .nullable()
      .optional()
      .describe("Updated venue capacity. Integer, minimum 0."),
    status: venueEventStatusSchema.optional().describe("Updated event status."),
    dealType: venueDealTypeSchema.optional().describe("Updated deal type."),
    dealNote: z.string().nullable().optional().describe("Updated internal deal note."),
    adminNote: z.string().nullable().optional().describe("Updated internal admin note."),
    quoteAmountCents: z
      .number()
      .int()
      .min(0)
      .nullable()
      .optional()
      .describe("Updated quoted amount in cents. Integer, minimum 0."),
    quoteNote: z.string().nullable().optional().describe("Updated internal quote note."),
    cover: z.string().nullable().optional().describe("Updated cover image URL."),
    externalRegistrationUrl: z
      .string()
      .nullable()
      .optional()
      .describe("Updated external registration URL."),
    ticketPriceCents: z
      .number()
      .int()
      .min(0)
      .nullable()
      .optional()
      .describe("Updated ticket price in cents. Integer, minimum 0."),
    ticketPaymentLink: z.string().nullable().optional().describe("Updated ticket payment link."),
    isOnline: z.boolean().optional().describe("Updated online-event flag."),
    dryRun: z
      .boolean()
      .optional()
      .describe("Defaults to true. Returns a preview and a previewId instead of writing."),
    previewId: z.string().optional().describe("The previewId from a prior dry run."),
    confirm: z.boolean().optional().describe("Must be true, with a previewId, to actually write."),
  })
  .strict();

export type VenueEventUpdateInput = z.infer<typeof venueEventUpdateSchema>;

/** The subset we actually send to the hub — control fields stripped. */
type VenueEventUpdateSpec = Omit<VenueEventUpdateInput, "dryRun" | "previewId" | "confirm">;

type VenueEventStructuredFieldValue =
  | VenueEventAgendaItem[]
  | VenueEventFaqEntry[]
  | VenueEventGalleryImage[]
  | VenueEventHost[]
  | VenueEventPricingTier[];

const mutableVenueEventFields = [
  "title",
  "description",
  "type",
  "date",
  "endDate",
  "startTime",
  "endTime",
  "timezone",
  "subtitle",
  "videoUrl",
  "priceNote",
  "gallery",
  "agenda",
  "hosts",
  "pricingTiers",
  "faq",
  "organizerName",
  "orgName",
  "contactEmail",
  "contactPhone",
  "expectedAttendees",
  "capacity",
  "status",
  "dealType",
  "dealNote",
  "adminNote",
  "quoteAmountCents",
  "quoteNote",
  "cover",
  "externalRegistrationUrl",
  "ticketPriceCents",
  "ticketPaymentLink",
  "isOnline",
] as const satisfies readonly (keyof VenueEventUpdateSpec)[];

const calendarSyncFields = [
  "status",
  "date",
  "endDate",
  "startTime",
  "endTime",
  "title",
] as const satisfies readonly (keyof VenueEventUpdateSpec)[];

function isStructuredVenueEventField(field: keyof VenueEventUpdateSpec): boolean {
  switch (field) {
    case "gallery":
    case "agenda":
    case "hosts":
    case "pricingTiers":
    case "faq":
      return true;
    default:
      return false;
  }
}

function parseStructuredVenueEventField(
  value: string | null
): VenueEventStructuredFieldValue | string | null {
  if (value === null) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as VenueEventStructuredFieldValue) : value;
  } catch {
    return value;
  }
}

function formatContentCount(field: keyof VenueEventUpdateSpec, count: number): string {
  switch (field) {
    case "agenda":
      return `${count} ${count === 1 ? "agenda item" : "agenda items"}`;
    case "hosts":
      return `${count} ${count === 1 ? "host" : "hosts"}`;
    case "pricingTiers":
      return `${count} ${count === 1 ? "pricing tier" : "pricing tiers"}`;
    case "gallery":
      return `${count} ${count === 1 ? "gallery image" : "gallery images"}`;
    case "faq":
      return `${count} ${count === 1 ? "FAQ" : "FAQs"}`;
    default:
      return String(count);
  }
}

function renderVenueEventUrl(config: Config, slug: string): string {
  return new URL(`/events/${encodeURIComponent(slug)}`, config.hubBaseUrl).toString();
}

function formatFieldValue(field: keyof VenueEventUpdateSpec, value: unknown): string {
  if (value === null) {
    return "null";
  }
  if (value === undefined) {
    return "undefined";
  }
  if ((field === "date" || field === "endDate") && typeof value === "string") {
    return value.slice(0, 10);
  }
  if (isStructuredVenueEventField(field) && Array.isArray(value)) {
    return formatContentCount(field, value.length);
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  return String(value);
}

function currentFieldValue(event: VenueEventRecord, field: keyof VenueEventUpdateSpec): unknown {
  switch (field) {
    case "id":
      return event.id;
    case "slug":
      return event.slug;
    case "date":
      return event.date;
    case "endDate":
      return event.endDate;
    case "title":
      return event.title;
    case "description":
      return event.description;
    case "type":
      return event.type;
    case "startTime":
      return event.startTime;
    case "endTime":
      return event.endTime;
    case "timezone":
      return event.timezone;
    case "subtitle":
      return event.subtitle;
    case "videoUrl":
      return event.videoUrl;
    case "priceNote":
      return event.priceNote;
    case "gallery":
      return parseStructuredVenueEventField(event.gallery);
    case "agenda":
      return parseStructuredVenueEventField(event.agenda);
    case "hosts":
      return parseStructuredVenueEventField(event.hosts);
    case "pricingTiers":
      return parseStructuredVenueEventField(event.pricingTiers);
    case "faq":
      return parseStructuredVenueEventField(event.faq);
    case "organizerName":
      return event.organizerName;
    case "orgName":
      return event.orgName;
    case "contactEmail":
      return event.contactEmail;
    case "contactPhone":
      return event.contactPhone;
    case "expectedAttendees":
      return event.expectedAttendees;
    case "capacity":
      return event.capacity;
    case "status":
      return event.status;
    case "dealType":
      return event.dealType;
    case "dealNote":
      return event.dealNote;
    case "adminNote":
      return event.adminNote;
    case "quoteAmountCents":
      return event.quoteAmountCents;
    case "quoteNote":
      return event.quoteNote;
    case "cover":
      return event.cover;
    case "externalRegistrationUrl":
      return event.externalRegistrationUrl;
    case "ticketPriceCents":
      return event.ticketPriceCents;
    case "ticketPaymentLink":
      return event.ticketPaymentLink;
    case "isOnline":
      return event.isOnline;
    default:
      return undefined;
  }
}

function fieldChanged(
  event: VenueEventRecord,
  spec: VenueEventUpdateSpec,
  field: (typeof mutableVenueEventFields)[number]
): boolean {
  const next = spec[field];
  if (next === undefined) {
    return false;
  }
  const current = currentFieldValue(event, field);
  if ((field === "date" || field === "endDate") && typeof current === "string" && typeof next === "string") {
    return current.slice(0, 10) !== next;
  }
  if (isStructuredVenueEventField(field)) {
    return JSON.stringify(current) !== JSON.stringify(next);
  }
  return current !== next;
}

function renderFieldChange(
  field: (typeof mutableVenueEventFields)[number],
  current: unknown,
  next: VenueEventUpdateSpec[(typeof mutableVenueEventFields)[number]]
): string {
  if (next === null) {
    return `${field}: ${formatFieldValue(field, current)} → cleared`;
  }

  return `${field}: ${formatFieldValue(field, current)} → ${formatFieldValue(field, next)}`;
}

function renderPreview(
  current: VenueEventRecord,
  spec: VenueEventUpdateSpec,
  config: Config,
  previewId: string,
  expires: number
): string {
  const changedFields = mutableVenueEventFields.filter((field) => fieldChanged(current, spec, field));
  const triggersCalendarSync = calendarSyncFields.some((field) =>
    changedFields.includes(field as (typeof mutableVenueEventFields)[number])
  );
  const lines: string[] = [];
  lines.push(`PREVIEW · target: ${config.envLabel}`);
  lines.push("");
  lines.push(`UPDATE VenueEvent "${current.title}" (${spec.id ? `id ${spec.id}` : `slug ${spec.slug as string}`})`);
  lines.push("");
  if (changedFields.length === 0) {
    lines.push("⚠ No field values would change; the PATCH payload is effectively empty.");
  } else {
    for (const field of changedFields) {
      lines.push(renderFieldChange(field, currentFieldValue(current, field), spec[field]));
    }
  }
  lines.push("");
  if (triggersCalendarSync) {
    lines.push(
      "· a Google Calendar sync will fire because this update changes one of status | date | startTime | endTime | title"
    );
  } else {
    lines.push(
      "· no Google Calendar sync will fire because this update does not change status, date, startTime, endTime, or title"
    );
  }
  lines.push(
    "· a status change emails the organizer: APPROVED sends a confirmation + calendar invite; DECLINED cancels the hold"
  );
  lines.push("");
  lines.push(`previewId: ${previewId} · expires in ${expires} minutes`);
  lines.push("To commit: call venue_event_update again with previewId and confirm: true");
  return lines.join("\n");
}

function getLookupError(spec: VenueEventUpdateSpec): string | null {
  const hasId = typeof spec.id === "string" && spec.id.length > 0;
  const hasSlug = typeof spec.slug === "string" && spec.slug.length > 0;
  if (!hasId && !hasSlug) {
    return "Refused: provide exactly one of id or slug.";
  }
  if (hasId && hasSlug) {
    return "Refused: provide exactly one of id or slug, not both.";
  }
  return null;
}

export function makeVenueEventUpdateHandler(
  hub: HubClient,
  config: Config,
  previews: PreviewStore<VenueEventUpdateSpec>
) {
  return async (input: VenueEventUpdateInput): Promise<string> => {
    const { dryRun, previewId, confirm, ...spec } = input;

    // ---- Beat 2: commit ----
    if (confirm === true) {
      if (!previewId) {
        return "Refused: confirm requires the previewId from a dry run. Run venue_event_update with dryRun first.";
      }
      if (config.readOnly) {
        return "Refused: this MCP server is running with HUB_MCP_READONLY=true.";
      }
      const taken = previews.take(previewId);
      if (!taken.ok) return `Refused: ${taken.reason}`;

      let result;
      try {
        const payload: VenueEventUpdatePayload = taken.payload;
        result = await hub.updateVenueEvent(payload);
      } catch (err) {
        if (err instanceof HubError && err.status === 0) {
          previews.restore(previewId, taken.payload);
        }
        throw err;
      }

      const syncLine =
        result.syncResult === null
          ? "No calendar sync was triggered."
          : result.syncResult.outcome === "failed"
            ? `⚠ Calendar sync failed: ${result.syncResult.error ?? "unknown error"}`
            : `Calendar sync: ${result.syncResult.outcome}${result.syncResult.eventId ? ` (${result.syncResult.eventId})` : ""}`;

      return [
        `COMMITTED · target: ${config.envLabel}`,
        `Updated: ${result.event.title}`,
        `Status: ${result.event.status}`,
        `Date: ${result.event.date.slice(0, 10)} · ${result.event.startTime} to ${result.event.endTime}`,
        syncLine,
        renderVenueEventUrl(config, result.event.slug),
      ]
        .filter(Boolean)
        .join("\n");
    }

    // ---- Beat 1: preview (default) ----
    if (previewId && dryRun !== false) {
      return "Note: previewId was supplied without confirm: true, so nothing was committed. Re-send with confirm: true.";
    }

    const lookupError = getLookupError(spec);
    if (lookupError) {
      return lookupError;
    }

    let current;
    try {
      current = await hub.getVenueEvent(spec.id ? { id: spec.id } : { slug: spec.slug as string });
    } catch (err) {
      if (err instanceof HubError && err.status === 404) {
        return spec.id
          ? `Refused: venue event not found for id ${spec.id}.`
          : `Refused: venue event not found for slug ${spec.slug as string}.`;
      }
      throw err;
    }

    const { previewId: id, expiresInMinutes } = previews.put(spec);
    return renderPreview(current, spec, config, id, expiresInMinutes);
  };
}
