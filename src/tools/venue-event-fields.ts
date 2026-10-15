import { z } from "zod";
import type {
  VenueEventAgendaItem,
  VenueEventFaqEntry,
  VenueEventGalleryImage,
  VenueEventHost,
  VenueEventHostLinks,
  VenueEventPricingTier,
} from "../hub-client.js";

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
const timeRegex = /^(1[0-2]|[1-9]):[0-5][0-9] (AM|PM)$/;

function isYouTubeUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }

  const host = url.hostname.replace(/^www\./, "").toLowerCase();
  if (host === "youtu.be") {
    return url.pathname.length > 1;
  }

  if (host !== "youtube.com" && host !== "m.youtube.com") {
    return false;
  }

  if (url.pathname === "/watch") {
    return url.searchParams.has("v");
  }

  return (
    url.pathname.startsWith("/shorts/") ||
    url.pathname.startsWith("/embed/") ||
    url.pathname.startsWith("/live/")
  );
}

export const venueEventYoutubeUrlSchema = z
  .string()
  .url()
  .refine(isYouTubeUrl, {
    message: "Must be a YouTube URL. watch, youtu.be, shorts, embed, and live formats are accepted.",
  });

export const venueEventGalleryImageSchema: z.ZodType<VenueEventGalleryImage> = z
  .object({
    url: z.string().url().describe("Required absolute image URL."),
    alt: z.string().min(1).optional().describe("Optional alt text."),
    caption: z.string().min(1).optional().describe("Optional image caption."),
  })
  .strict();

export const venueEventAgendaItemSchema: z.ZodType<VenueEventAgendaItem> = z
  .object({
    date: z.string().regex(dateRegex).optional().describe("Optional day in YYYY-MM-DD format."),
    label: z.string().min(1).optional().describe("Optional day or section label."),
    startTime: z
      .string()
      .regex(timeRegex)
      .optional()
      .describe('Optional start time in 12-hour format, for example "6:00 PM".'),
    endTime: z
      .string()
      .regex(timeRegex)
      .optional()
      .describe('Optional end time in 12-hour format, for example "9:00 PM".'),
    title: z.string().min(1).describe("Required row title."),
    note: z.string().min(1).optional().describe("Optional supporting note."),
    isPublic: z.boolean().optional().describe("Optional public-visibility flag."),
  })
  .strict();

export const venueEventHostLinksSchema: z.ZodType<VenueEventHostLinks> = z
  .object({
    linkedin: z.string().url().optional().describe("Optional LinkedIn profile URL."),
    site: z.string().url().optional().describe("Optional website URL."),
    x: z.string().url().optional().describe("Optional X profile URL."),
  })
  .strict();

export const venueEventHostSchema: z.ZodType<VenueEventHost> = z
  .object({
    name: z.string().min(1).describe("Required host name."),
    role: z.string().min(1).optional().describe("Optional role or title."),
    bio: z.string().min(1).optional().describe("Optional short bio."),
    photoUrl: z.string().url().optional().describe("Optional profile photo URL."),
    profileSlug: z.string().min(1).optional().describe("Optional internal profile slug."),
    links: venueEventHostLinksSchema.optional().describe("Optional external profile links."),
  })
  .strict();

export const venueEventPricingTierSchema: z.ZodType<VenueEventPricingTier> = z
  .object({
    label: z.string().min(1).describe("Required pricing tier label."),
    priceCents: z.number().int().min(0).describe("Required price in cents. Integer, minimum 0."),
    note: z.string().min(1).optional().describe("Optional pricing note."),
    url: z.string().url().optional().describe("Optional checkout or registration URL."),
    availableUntil: z
      .string()
      .regex(dateRegex)
      .optional()
      .describe("Optional cutoff date in YYYY-MM-DD format."),
    soldOut: z.boolean().optional().describe("Optional sold-out flag."),
  })
  .strict();

export const venueEventFaqEntrySchema: z.ZodType<VenueEventFaqEntry> = z
  .object({
    q: z.string().min(1).describe("Required question."),
    a: z.string().min(1).describe("Required answer."),
  })
  .strict();
