/**
 * venue_event_create — create a venue event in the hub.
 *
 * Two-beat by construction: the first call previews, the second
 * commits a stored preview. dryRun defaults to true, so the *only* way to
 * write is to have seen the diff first.
 */

import { z } from "zod";
import {
  HubError,
  type HubClient,
  type VenueEventCreatePayload,
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

export const venueEventCreateSchema = z
  .object({
    title: z.string().min(1).describe("Event title."),
    type: venueEventTypeSchema.describe("Event type."),
    date: z.string().regex(dateRegex).describe("Event date in YYYY-MM-DD format."),
    startTime: z
      .string()
      .regex(timeRegex)
      .describe('Start time in 12-hour format, for example "6:00 PM".'),
    endTime: z
      .string()
      .regex(timeRegex)
      .describe('End time in 12-hour format, for example "8:30 PM".'),
    organizerName: z.string().min(1).describe("Organizer name."),
    contactEmail: z
      .string()
      .regex(emailRegex)
      .describe("Organizer contact email address."),
    slug: z.string().min(1).optional().describe("Optional slug. If omitted, the hub generates one."),
    description: z.string().nullable().optional().describe("Optional event description."),
    endDate: z
      .string()
      .regex(dateRegex)
      .nullable()
      .optional()
      .describe("Last day of a multi-day event, YYYY-MM-DD. Omit for single-day events."),
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
    orgName: z.string().nullable().optional().describe("Optional organizer organization name."),
    contactPhone: z.string().nullable().optional().describe("Optional organizer phone number."),
    timezone: z
      .string()
      .min(1)
      .optional()
      .describe(
        "Optional IANA timezone. Defaults to HUB_DEFAULT_TIMEZONE (America/Los_Angeles if unset)."
      ),
    expectedAttendees: z
      .number()
      .int()
      .min(0)
      .nullable()
      .optional()
      .describe("Optional expected attendee count. Integer, minimum 0."),
    capacity: z
      .number()
      .int()
      .min(0)
      .nullable()
      .optional()
      .describe("Optional venue capacity. Integer, minimum 0."),
    dealType: venueDealTypeSchema.optional().describe("Optional deal type. Defaults to PAID_RENTAL."),
    dealNote: z.string().nullable().optional().describe("Optional internal deal note."),
    adminNote: z.string().nullable().optional().describe("Optional internal admin note."),
    quoteAmountCents: z
      .number()
      .int()
      .min(0)
      .nullable()
      .optional()
      .describe("Optional quoted amount in cents. Integer, minimum 0."),
    quoteNote: z.string().nullable().optional().describe("Optional internal quote note."),
    cover: z.string().nullable().optional().describe("Optional cover image URL."),
    externalRegistrationUrl: z
      .string()
      .nullable()
      .optional()
      .describe("Optional external registration URL."),
    ticketPriceCents: z
      .number()
      .int()
      .min(0)
      .nullable()
      .optional()
      .describe("Optional ticket price in cents. Integer, minimum 0."),
    ticketPaymentLink: z.string().nullable().optional().describe("Optional ticket payment link."),
    isOnline: z.boolean().optional().describe("Optional online-event flag. Defaults to false."),
    status: venueEventStatusSchema
      .optional()
      .describe("Optional status. If omitted, MCP-created events default to APPROVED."),
    dryRun: z
      .boolean()
      .optional()
      .describe("Defaults to true. Returns a preview and a previewId instead of writing."),
    previewId: z.string().optional().describe("The previewId from a prior dry run."),
    confirm: z.boolean().optional().describe("Must be true, with a previewId, to actually write."),
  })
  .strict();

export type VenueEventCreateInput = z.infer<typeof venueEventCreateSchema>;

/** The subset we actually send to the hub — control fields stripped. */
type VenueEventCreateSpec = Omit<VenueEventCreateInput, "dryRun" | "previewId" | "confirm">;

function formatContentCount(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function renderContentSummary(spec: VenueEventCreateSpec): string | null {
  const parts: string[] = [];

  if (spec.agenda !== undefined && spec.agenda !== null) {
    parts.push(formatContentCount(spec.agenda.length, "agenda item", "agenda items"));
  }
  if (spec.hosts !== undefined && spec.hosts !== null) {
    parts.push(formatContentCount(spec.hosts.length, "host", "hosts"));
  }
  if (spec.pricingTiers !== undefined && spec.pricingTiers !== null) {
    parts.push(formatContentCount(spec.pricingTiers.length, "pricing tier", "pricing tiers"));
  }
  if (spec.gallery !== undefined && spec.gallery !== null) {
    parts.push(formatContentCount(spec.gallery.length, "gallery image", "gallery images"));
  }
  if (spec.faq !== undefined && spec.faq !== null) {
    parts.push(formatContentCount(spec.faq.length, "FAQ", "FAQs"));
  }

  return parts.length > 0 ? `Content: ${parts.join(" · ")}` : null;
}

function renderVenueEventUrl(config: Config, slug: string): string {
  return new URL(`/events/${encodeURIComponent(slug)}`, config.hubBaseUrl).toString();
}

function renderPreview(
  spec: VenueEventCreateSpec,
  config: Config,
  previewId: string,
  expires: number,
  timezoneWasDefaulted: boolean
): string {
  const status = spec.status ?? "APPROVED";
  const dealType = spec.dealType ?? "PAID_RENTAL";
  const timezone = spec.timezone ?? config.defaultTimezone;
  const lines: string[] = [];
  lines.push(`PREVIEW · target: ${config.envLabel}`);
  lines.push("");
  lines.push(`CREATE VenueEvent "${spec.title}" (status ${status})`);
  lines.push(`Type: ${spec.type}`);
  if (spec.endDate) {
    lines.push(`Date: ${spec.date} to ${spec.endDate} · ${spec.startTime} to ${spec.endTime} · ${timezone}`);
  } else {
    lines.push(`Date: ${spec.date} · ${spec.startTime} to ${spec.endTime} · ${timezone}`);
  }
  lines.push(`Organizer: ${spec.organizerName} <${spec.contactEmail}>`);
  lines.push(`Deal type: ${dealType}`);
  if (spec.videoUrl) {
    lines.push(`Video: ${spec.videoUrl}`);
  }
  if (spec.subtitle) {
    lines.push(`Subtitle: ${spec.subtitle}`);
  }
  if (spec.priceNote) {
    lines.push(`Price note: ${spec.priceNote}`);
  }
  const contentSummary = renderContentSummary(spec);
  if (contentSummary) {
    lines.push(contentSummary);
  }
  lines.push("");
  if (spec.status === undefined) {
    lines.push("· status defaults to APPROVED for MCP-created events (the schema default is PENDING)");
  }
  if (spec.dealType === undefined) {
    lines.push("· dealType defaults to PAID_RENTAL");
  }
  if (timezoneWasDefaulted) {
    lines.push(`· timezone defaults to ${config.defaultTimezone}`);
  }
  if (spec.slug === undefined) {
    lines.push("· slug is auto-generated from the title and de-duplicated if it collides");
  }
  lines.push(
    "· creates/updates an event on the hub's connected Google Calendar and, when APPROVED, emails a confirmation + calendar invite to the organizer"
  );
  lines.push("");
  lines.push(`previewId: ${previewId} · expires in ${expires} minutes`);
  lines.push("To commit: call venue_event_create again with previewId and confirm: true");
  return lines.join("\n");
}

export function makeVenueEventCreateHandler(
  hub: HubClient,
  config: Config,
  previews: PreviewStore<VenueEventCreateSpec>
) {
  return async (input: VenueEventCreateInput): Promise<string> => {
    const { dryRun, previewId, confirm, ...inputSpec } = input;
    const timezoneWasDefaulted = inputSpec.timezone === undefined;
    const spec: VenueEventCreateSpec = {
      ...inputSpec,
      timezone: inputSpec.timezone ?? config.defaultTimezone,
    };

    // ---- Beat 2: commit ----
    if (confirm === true) {
      if (!previewId) {
        return "Refused: confirm requires the previewId from a dry run. Run venue_event_create with dryRun first.";
      }
      if (config.readOnly) {
        return "Refused: this MCP server is running with HUB_MCP_READONLY=true.";
      }
      const taken = previews.take(previewId);
      if (!taken.ok) return `Refused: ${taken.reason}`;

      let result;
      try {
        const payload: VenueEventCreatePayload = taken.payload;
        result = await hub.createVenueEvent(payload);
      } catch (err) {
        if (err instanceof HubError && err.status === 0) {
          previews.restore(previewId, taken.payload);
        }
        throw err;
      }
      return [
        `COMMITTED · target: ${config.envLabel}`,
        `Created: ${result.title}`,
        `Status: ${result.status}`,
        `Deal type: ${result.dealType}`,
        `Date: ${result.date.slice(0, 10)} · ${result.startTime} to ${result.endTime}`,
        renderVenueEventUrl(config, result.slug),
      ]
        .filter(Boolean)
        .join("\n");
    }

    // ---- Beat 1: preview (default) ----
    if (previewId && dryRun !== false) {
      return "Note: previewId was supplied without confirm: true, so nothing was committed. Re-send with confirm: true.";
    }
    const { previewId: id, expiresInMinutes } = previews.put(spec);
    return renderPreview(spec, config, id, expiresInMinutes, timezoneWasDefaulted);
  };
}
