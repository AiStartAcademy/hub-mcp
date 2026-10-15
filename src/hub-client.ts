/**
 * The only thing in this server that talks to the hub.
 *
 * Keeping network access behind this seam lets tools use typed hub operations
 * without duplicating transport, authentication, or error handling.
 */

import { z } from "zod";
import type { Config } from "./config.js";

export class HubError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: unknown
  ) {
    super(message);
    this.name = "HubError";
  }
}

export class HubClient {
  constructor(private readonly config: Config) {}

  private async request<T>(method: "GET" | "POST" | "PATCH" | "DELETE", path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.config.hubBaseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.config.hubToken}`,
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (cause) {
      // Network-level failure — the hub was never reached, so nothing was written.
      throw new HubError(
        `Could not reach the hub at ${this.config.hubBaseUrl}: ${(cause as Error).message}`,
        0
      );
    }

    const text = await res.text();
    let parsed: unknown;
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch (cause) {
      void cause;
      throw new HubError(`Hub returned non-JSON (${res.status}): ${text.slice(0, 200)}`, res.status);
    }

    if (!res.ok) {
      const msg = (parsed as { error?: string })?.error ?? `Hub returned ${res.status}`;
      throw new HubError(msg, res.status, parsed);
    }
    return parsed as T;
  }

  createCohort(input: unknown) {
    return this.request<CreatedCohort>("POST", "/api/internal/mcp/cohort", input);
  }

  listInstructors(params: ListInstructorsParams = {}) {
    const search = new URLSearchParams();

    if (params.page !== undefined) search.set("page", String(params.page));
    if (params.pageSize !== undefined) search.set("pageSize", String(params.pageSize));
    if (params.q !== undefined) search.set("q", params.q);
    if (params.role !== undefined) search.set("role", params.role);
    if (params.hasProfile !== undefined) search.set("hasProfile", String(params.hasProfile));

    const query = search.toString();
    return this.request<InstructorsListResponse>(
      "GET",
      `/api/internal/mcp/v1/instructors${query ? `?${query}` : ""}`
    );
  }

  getInstructor(params: GetInstructorParams) {
    const provided = [params.id, params.slug].filter(
      (value): value is string => typeof value === "string" && value.length > 0
    );
    if (provided.length !== 1) {
      throw new Error("getInstructor requires exactly one of id or slug.");
    }

    const search = new URLSearchParams(params.id ? { id: params.id } : { slug: params.slug as string });
    return this.request<InstructorDetailResponse>("GET", `/api/internal/mcp/v1/instructors?${search.toString()}`);
  }

  updateInstructorProfile(input: UpdateInstructorProfileInput) {
    return this.request<UpdateInstructorProfileResponse>(
      "PATCH",
      "/api/internal/mcp/v1/instructors/profile",
      input
    );
  }

  deleteZoomMeeting(zoomMeetingId: string) {
    return this.request<DeletedZoomMeeting>("POST", "/api/internal/mcp/cohort/zoom", { zoomMeetingId });
  }

  getCohort(params: { id?: string; slug?: string }) {
    const provided = [params.id, params.slug].filter(
      (value): value is string => typeof value === "string" && value.length > 0
    );
    if (provided.length !== 1) {
      throw new Error("getCohort requires exactly one of id or slug.");
    }
    const search = new URLSearchParams(params.id ? { id: params.id } : { slug: params.slug as string });
    return this.request<CohortDetailResponse>("GET", `/api/internal/mcp/v1/cohorts?${search.toString()}`);
  }

  updateCohort(input: CohortUpdatePayload) {
    return this.request<CohortUpdateResponse>("PATCH", "/api/internal/mcp/v1/cohorts", input);
  }

  listSessionSeries() {
    return this.request<SessionSeriesListResponse>("GET", "/api/internal/mcp/v1/session-series");
  }

  getSessionSeries(id: string) {
    const search = new URLSearchParams({ id });
    return this.request<SessionSeriesDetailResponse>(
      "GET",
      `/api/internal/mcp/v1/session-series?${search.toString()}`
    );
  }

  createSessionSeries(input: unknown) {
    return this.request<SessionSeriesCreateResponse>(
      "POST",
      "/api/internal/mcp/v1/session-series",
      input
    );
  }

  updateSessionSeries(input: SessionSeriesPatchPayload) {
    return this.request<SessionSeriesPatchResponse>(
      "PATCH",
      "/api/internal/mcp/v1/session-series",
      input
    );
  }

  getInstructorParticipation(cohortId?: string) {
    const query = cohortId ? `?cohortId=${encodeURIComponent(cohortId)}` : "";
    return this.request<ParticipationStatusResponse>(
      "GET",
      `/api/internal/mcp/v1/instructor-participation${query}`
    );
  }

  instructorParticipationAction(input: ParticipationActionPayload) {
    return this.request<Record<string, unknown>>(
      "POST",
      "/api/internal/mcp/v1/instructor-participation",
      input
    );
  }

  listUnenrichedLessons() {
    return this.request<UnenrichedLessonsResponse>("GET", "/api/internal/mcp/v1/lessons/content");
  }

  updateLessonContent(items: LessonContentUpdateItem[]) {
    return this.request<LessonContentUpdateResponse>(
      "PATCH",
      "/api/internal/mcp/v1/lessons/content",
      { items }
    );
  }

  extractLessonAudio(lessonId: string) {
    return this.request<LessonAudioExtractResponse>(
      "POST",
      "/api/internal/mcp/v1/lessons/extract-audio",
      { lessonId }
    );
  }

  listDripCampaigns(params: ListDripCampaignsParams = {}) {
    const search = new URLSearchParams();
    if (params.page !== undefined) search.set("page", String(params.page));
    if (params.pageSize !== undefined) search.set("pageSize", String(params.pageSize));
    if (params.status !== undefined) search.set("status", params.status);

    const query = search.toString();
    return this.request<DripCampaignListResponse>(
      "GET",
      `/api/internal/mcp/v1/drip${query ? `?${query}` : ""}`
    );
  }

  getDripCampaign(params: { id?: string; slug?: string }) {
    const provided = [params.id, params.slug].filter(
      (value): value is string => typeof value === "string" && value.length > 0
    );
    if (provided.length !== 1) {
      throw new Error("getDripCampaign requires exactly one of id or slug.");
    }
    const search = new URLSearchParams(params.id ? { id: params.id } : { slug: params.slug as string });
    return this.request<DripCampaignDetailResponse>(
      "GET",
      `/api/internal/mcp/v1/drip?${search.toString()}`
    );
  }

  previewDripAudience(segment: DripSegment) {
    return this.request<DripAudienceResponse>("POST", "/api/internal/mcp/v1/drip/audience", {
      segment,
    });
  }

  getCohortRoster(idOrSlug: string) {
    return this.request<CohortRosterResponse>(
      "GET",
      `/api/internal/mcp/v1/cohorts/${encodeURIComponent(idOrSlug)}/roster`
    );
  }

  sendBroadcast(input: BroadcastSendPayload) {
    return this.request<BroadcastSendResponse>(
      "POST",
      "/api/internal/mcp/v1/drip/broadcast",
      input
    );
  }

  notifyCertificates(input: CertificateNotifyPayload) {
    return this.request<CertificateNotifyResponse>(
      "POST",
      `/api/internal/mcp/v1/cohorts/${encodeURIComponent(input.cohortId)}/certificates/notify`,
      { certificateIds: input.certificateIds, dryRun: input.dryRun }
    );
  }

  createDripCampaign(input: DripCampaignCreatePayload) {
    return this.request<DripCampaignCreateResponse>("POST", "/api/internal/mcp/v1/drip", input);
  }

  updateDripCampaign(input: DripCampaignPatchPayload) {
    return this.request<DripCampaignPatchResponse>("PATCH", "/api/internal/mcp/v1/drip", input);
  }

  listLeads(params: ListLeadsParams = {}) {
    const search = new URLSearchParams();
    if (params.page !== undefined) search.set("page", String(params.page));
    if (params.pageSize !== undefined) search.set("pageSize", String(params.pageSize));
    if (params.status !== undefined) search.set("status", params.status);
    if (params.source !== undefined) search.set("source", params.source);
    if (params.tag !== undefined) search.set("tag", params.tag);
    if (params.q !== undefined) search.set("q", params.q);

    const query = search.toString();
    return this.request<LeadListResponse>(
      "GET",
      `/api/internal/mcp/v1/leads${query ? `?${query}` : ""}`
    );
  }

  getLead(id: string) {
    const search = new URLSearchParams({ id });
    return this.request<LeadDetailResponse>(
      "GET",
      `/api/internal/mcp/v1/leads?${search.toString()}`
    );
  }

  getLeadFacets() {
    return this.request<LeadFacetsResponse>("GET", "/api/internal/mcp/v1/leads/facets");
  }

  listMemberships(params: ListMembershipsParams = {}) {
    const search = new URLSearchParams();
    if (params.page !== undefined) search.set("page", String(params.page));
    if (params.pageSize !== undefined) search.set("pageSize", String(params.pageSize));
    if (params.tier !== undefined) search.set("tier", params.tier);
    if (params.status !== undefined) search.set("status", params.status);
    if (params.compOnly) search.set("compOnly", "true");

    const query = search.toString();
    return this.request<MembershipListResponse>(
      "GET",
      `/api/internal/mcp/v1/memberships${query ? `?${query}` : ""}`
    );
  }

  grantMembership(payload: MembershipGrantPayload) {
    return this.request<MembershipGrantResponse>(
      "POST",
      "/api/internal/mcp/v1/memberships",
      payload
    );
  }

  updateLeads(payload: LeadUpdatePayload) {
    return this.request<unknown>("PATCH", "/api/internal/mcp/v1/leads/update", payload);
  }

  revokeMembership(membershipId: string) {
    return this.request<MembershipRevokeResponse>(
      "DELETE",
      "/api/internal/mcp/v1/memberships",
      { membershipId }
    );
  }

  getProgram(id: string) {
    return this.request<ProgramDetailResponse>("GET", `/api/internal/mcp/v1/programs?id=${encodeURIComponent(id)}`);
  }

  updateProgram(input: ProgramUpdatePayload) {
    return this.request<ProgramUpdateResponse>("PATCH", "/api/internal/mcp/v1/programs", input);
  }

  generateProgramCover(prompt: string) {
    return this.request<ProgramCoverGenerateResponse>("POST", "/api/internal/mcp/v1/programs/cover-generate", {
      prompt,
    });
  }

  uploadMedia(payload: MediaUploadPayload) {
    return this.request<MediaUploadResponse>("POST", "/api/internal/mcp/v1/media/upload", payload);
  }

  async listVenueEvents(params: ListVenueEventsParams = {}): Promise<VenueEventListResponse> {
    const search = new URLSearchParams();
    if (params.status !== undefined) search.set("status", params.status);
    if (params.from !== undefined) search.set("from", params.from);
    if (params.to !== undefined) search.set("to", params.to);
    if (params.q !== undefined) search.set("q", params.q);
    if (params.page !== undefined) search.set("page", String(params.page));
    if (params.pageSize !== undefined) search.set("pageSize", String(params.pageSize));

    const query = search.toString();
    const response = await this.request<unknown>(
      "GET",
      `/api/internal/mcp/v1/venue-events${query ? `?${query}` : ""}`
    );
    return venueEventListResponseSchema.parse(response);
  }

  async getVenueEvent(params: GetVenueEventParams): Promise<VenueEventRecord> {
    const provided = [params.id, params.slug].filter(
      (value): value is string => typeof value === "string" && value.length > 0
    );
    if (provided.length !== 1) {
      throw new Error("getVenueEvent requires exactly one of id or slug.");
    }

    const search = new URLSearchParams(params.id ? { id: params.id } : { slug: params.slug as string });
    const response = await this.request<unknown>(
      "GET",
      `/api/internal/mcp/v1/venue-events?${search.toString()}`
    );
    return venueEventRecordSchema.parse(response);
  }

  async getVenueEventRegistrations(params: GetVenueEventParams): Promise<VenueEventRegistrationsResponse> {
    const provided = [params.id, params.slug].filter(
      (value): value is string => typeof value === "string" && value.length > 0
    );
    if (provided.length !== 1) {
      throw new Error("getVenueEventRegistrations requires exactly one of id or slug.");
    }

    const search = new URLSearchParams(params.id ? { id: params.id } : { slug: params.slug as string });
    search.set("registrations", "true");

    const response = await this.request<unknown>(
      "GET",
      `/api/internal/mcp/v1/venue-events?${search.toString()}`
    );
    return venueEventRegistrationsResponseSchema.parse(response);
  }

  async createVenueEvent(input: VenueEventCreatePayload): Promise<VenueEventRecord> {
    const response = await this.request<unknown>("POST", "/api/internal/mcp/v1/venue-events", input);
    return venueEventRecordSchema.parse(response);
  }

  async updateVenueEvent(input: VenueEventUpdatePayload): Promise<VenueEventPatchResponse> {
    const response = await this.request<unknown>("PATCH", "/api/internal/mcp/v1/venue-events", input);
    return venueEventPatchResponseSchema.parse(response);
  }

  async createVenueAgreement(input: unknown): Promise<VenueAgreementResponse> {
    const response = await this.request<unknown>(
      "POST",
      "/api/internal/mcp/v1/venue-events/agreement",
      input
    );
    return venueAgreementResponseSchema.parse(response);
  }

  async createVenueRentalPayment(input: unknown): Promise<VenueRentalPaymentResponse> {
    const response = await this.request<unknown>(
      "POST",
      "/api/internal/mcp/v1/venue-events/rental-payment",
      input
    );
    return venueRentalPaymentResponseSchema.parse(response);
  }

  async deactivateVenueRentalPayment(input: unknown): Promise<VenueRentalPaymentResponse> {
    const response = await this.request<unknown>(
      "DELETE",
      "/api/internal/mcp/v1/venue-events/rental-payment",
      input
    );
    return venueRentalPaymentResponseSchema.parse(response);
  }
}

export type ProgramField = "name" | "description" | "cover" | "accessMode" | "status";

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
const venueEventListStatusSchema = z.enum(["ALL", "PENDING", "APPROVED", "DECLINED", "CANCELLED"]);
const venueDealTypeSchema = z.enum(["PAID_RENTAL", "BARTER", "REVENUE_SHARE", "FREE_PROMO", "INTERNAL"]);
const venueEventSourceSchema = z.enum(["FORM", "MCP", "ADMIN"]);
const venueEventRegistrationStatusSchema = z.enum(["CONFIRMED", "PENDING_PAYMENT", "CANCELLED"]);
const venueAgreementTemplateKeySchema = z.enum(["paid-rental", "free-barter", "revenue-share"]);
const venueAgreementStatusSchema = z.enum(["DRAFT", "SENT", "SIGNED", "VOID"]);

// createVenueEvent() parses the hub's full created row through this schema, so under
// .strict() any new hub column made venue_event_create throw. .passthrough() keeps the
// MCP forward-compatible with hub schema changes.
const venueEventRecordSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    slug: z.string(),
    type: venueEventTypeSchema,
    description: z.string().nullable(),
    organizerName: z.string(),
    orgName: z.string().nullable(),
    contactEmail: z.string(),
    contactPhone: z.string().nullable(),
    date: z.string(),
    endDate: z.string().nullable(),
    startTime: z.string(),
    endTime: z.string(),
    timezone: z.string(),
    subtitle: z.string().nullable(),
    videoUrl: z.string().nullable(),
    priceNote: z.string().nullable(),
    gallery: z.string().nullable(),
    agenda: z.string().nullable(),
    hosts: z.string().nullable(),
    pricingTiers: z.string().nullable(),
    faq: z.string().nullable(),
    expectedAttendees: z.number().int().nullable(),
    capacity: z.number().int().nullable(),
    status: venueEventStatusSchema,
    dealType: venueDealTypeSchema,
    dealNote: z.string().nullable(),
    adminNote: z.string().nullable(),
    quoteAmountCents: z.number().int().nullable(),
    quoteNote: z.string().nullable(),
    cover: z.string().nullable(),
    externalRegistrationUrl: z.string().nullable(),
    ticketPriceCents: z.number().int().nullable(),
    ticketPaymentLink: z.string().nullable(),
    isOnline: z.boolean(),
    rentalFeeCents: z.number().int().nullable(),
    rentalDepositCents: z.number().int().nullable(),
    rentalPaymentLinkId: z.string().nullable(),
    rentalPaymentUrl: z.string().nullable(),
    rentalPaymentStatus: z.string().nullable(),
    source: venueEventSourceSchema,
    gcalEventId: z.string().nullable(),
    gcalSyncError: z.string().nullable(),
    gcalSyncedAt: z.string().nullable(),
    contactId: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .passthrough();

const venueEventRegistrationRecordSchema = z
  .object({
    id: z.string(),
    venueEventId: z.string(),
    contactId: z.string().nullable(),
    name: z.string(),
    email: z.string(),
    phone: z.string().nullable(),
    status: venueEventRegistrationStatusSchema,
    waiverAcceptedAt: z.string().nullable(),
    waiverVersion: z.string().nullable(),
    ip: z.string().nullable(),
    userAgent: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .strict();

const gcalSyncResultSchema = z
  .object({
    outcome: z.string(),
    eventId: z.string().nullable(),
    error: z.string().nullable(),
  })
  .strict();

const venueEventListResponseSchema = z
  .object({
    events: z.array(venueEventRecordSchema),
    page: z.number().int(),
    pageSize: z.number().int(),
    total: z.number().int(),
  })
  .strict();

const venueEventRegistrationsResponseSchema = z
  .object({
    event: z
      .object({
        id: z.string(),
        slug: z.string(),
        title: z.string(),
      })
      .strict(),
    registrations: z.array(venueEventRegistrationRecordSchema),
  })
  .strict();

const venueEventPatchResponseSchema = z
  .object({
    event: venueEventRecordSchema,
    syncResult: gcalSyncResultSchema.nullable(),
  })
  .strict();

const venueAgreementResponseSchema = z
  .object({
    id: z.string(),
    token: z.string(),
    status: venueAgreementStatusSchema,
    templateKey: venueAgreementTemplateKeySchema,
    signingUrl: z.string(),
  })
  .strict();

export type VenueEventType = z.infer<typeof venueEventTypeSchema>;
export type VenueEventStatus = z.infer<typeof venueEventStatusSchema>;
export type VenueEventListStatus = z.infer<typeof venueEventListStatusSchema>;
export type VenueDealType = z.infer<typeof venueDealTypeSchema>;
export type VenueEventSource = z.infer<typeof venueEventSourceSchema>;
export type VenueEventRegistrationStatus = z.infer<typeof venueEventRegistrationStatusSchema>;
export type VenueAgreementTemplateKey = z.infer<typeof venueAgreementTemplateKeySchema>;
export type VenueAgreementStatus = z.infer<typeof venueAgreementStatusSchema>;
export type VenueEventRecord = z.infer<typeof venueEventRecordSchema>;
export type VenueEventRegistrationRecord = z.infer<typeof venueEventRegistrationRecordSchema>;
export type GcalSyncResult = z.infer<typeof gcalSyncResultSchema>;
export type VenueEventListResponse = z.infer<typeof venueEventListResponseSchema>;
export type VenueEventRegistrationsResponse = z.infer<typeof venueEventRegistrationsResponseSchema>;
export type VenueEventPatchResponse = z.infer<typeof venueEventPatchResponseSchema>;
export type VenueAgreementResponse = z.infer<typeof venueAgreementResponseSchema>;

const venueRentalPaymentResponseSchema = z
  .object({
    rentalFeeCents: z.number().int().nullable(),
    rentalDepositCents: z.number().int().nullable(),
    rentalPaymentLinkId: z.string().nullable(),
    rentalPaymentUrl: z.string().nullable(),
    rentalPaymentStatus: z.string().nullable(),
  })
  .strict();

export type VenueRentalPaymentResponse = z.infer<typeof venueRentalPaymentResponseSchema>;

export interface ListVenueEventsParams {
  status?: VenueEventListStatus;
  from?: string;
  to?: string;
  q?: string;
  page?: number;
  pageSize?: number;
}

export interface GetVenueEventParams {
  id?: string;
  slug?: string;
}

export interface VenueEventGalleryImage {
  url: string;
  alt?: string;
  caption?: string;
}

export interface VenueEventAgendaItem {
  date?: string;
  label?: string;
  startTime?: string;
  endTime?: string;
  title: string;
  note?: string;
  isPublic?: boolean;
}

export interface VenueEventHostLinks {
  linkedin?: string;
  site?: string;
  x?: string;
}

export interface VenueEventHost {
  name: string;
  role?: string;
  bio?: string;
  photoUrl?: string;
  profileSlug?: string;
  links?: VenueEventHostLinks;
}

export interface VenueEventPricingTier {
  label: string;
  priceCents: number;
  note?: string;
  url?: string;
  availableUntil?: string;
  soldOut?: boolean;
}

export interface VenueEventFaqEntry {
  q: string;
  a: string;
}

export interface VenueEventCreatePayload {
  title: string;
  type: VenueEventType;
  date: string;
  startTime: string;
  endTime: string;
  organizerName: string;
  contactEmail: string;
  slug?: string;
  description?: string | null;
  endDate?: string | null;
  subtitle?: string | null;
  videoUrl?: string | null;
  priceNote?: string | null;
  gallery?: VenueEventGalleryImage[] | null;
  agenda?: VenueEventAgendaItem[] | null;
  hosts?: VenueEventHost[] | null;
  pricingTiers?: VenueEventPricingTier[] | null;
  faq?: VenueEventFaqEntry[] | null;
  orgName?: string | null;
  contactPhone?: string | null;
  timezone?: string | null;
  expectedAttendees?: number | null;
  capacity?: number | null;
  dealType?: VenueDealType;
  dealNote?: string | null;
  adminNote?: string | null;
  quoteAmountCents?: number | null;
  quoteNote?: string | null;
  cover?: string | null;
  externalRegistrationUrl?: string | null;
  ticketPriceCents?: number | null;
  ticketPaymentLink?: string | null;
  isOnline?: boolean;
  status?: VenueEventStatus;
}

export interface VenueEventUpdatePayload {
  id?: string;
  slug?: string;
  title?: string;
  description?: string | null;
  type?: VenueEventType;
  date?: string;
  endDate?: string | null;
  startTime?: string;
  endTime?: string;
  timezone?: string | null;
  subtitle?: string | null;
  videoUrl?: string | null;
  priceNote?: string | null;
  gallery?: VenueEventGalleryImage[] | null;
  agenda?: VenueEventAgendaItem[] | null;
  hosts?: VenueEventHost[] | null;
  pricingTiers?: VenueEventPricingTier[] | null;
  faq?: VenueEventFaqEntry[] | null;
  organizerName?: string;
  orgName?: string | null;
  contactEmail?: string;
  contactPhone?: string | null;
  expectedAttendees?: number | null;
  capacity?: number | null;
  status?: VenueEventStatus;
  dealType?: VenueDealType;
  dealNote?: string | null;
  adminNote?: string | null;
  quoteAmountCents?: number | null;
  quoteNote?: string | null;
  cover?: string | null;
  externalRegistrationUrl?: string | null;
  ticketPriceCents?: number | null;
  ticketPaymentLink?: string | null;
  isOnline?: boolean;
}

export interface ProgramDetailItem {
  id: string;
  name: string;
  description: string | null;
  cover: string | null;
  status: string;
  locked: boolean;
  accessMode: string;
  createdAt: string;
  updatedAt: string;
  modules: { id: string; name: string }[];
  cohortCount: number;
  enrollmentCount: number;
}

export interface ProgramDetailResponse {
  item: ProgramDetailItem;
}

export type ProgramUpdatePayload = { id: string; publish?: boolean } & Partial<
  Record<ProgramField, string>
>;

export interface ProgramUpdateResponse {
  id: string;
  changed: Partial<Record<ProgramField, { from: string | null; to: string | null }>>;
  unchanged: ProgramField[];
}

export interface ProgramCoverGenerateResponse {
  url: string;
}

export interface MediaUploadPayload {
  filename: string;
  mimeType: string;
  dataBase64: string;
  namespace?: string;
  slug?: string;
  public?: boolean;
}

export interface MediaUploadResponse {
  url: string;
  objectKey: string;
  size: number;
  public: boolean;
}

export interface ListLeadsParams {
  page?: number;
  pageSize?: number;
  status?: string;
  source?: string;
  tag?: string;
  q?: string;
}

export interface ListMembershipsParams {
  page?: number;
  pageSize?: number;
  tier?: "MENTOR_NETWORK" | "ACCELERATOR";
  status?: string;
  compOnly?: boolean;
}

export interface MembershipListItem {
  id: string;
  tier: string;
  status: string;
  amountCents: number;
  currency: string;
  email: string | null;
  name: string | null;
  isComp: boolean;
  currentPeriodEnd: string | null;
  createdAt: string;
}

export interface MembershipListResponse {
  items: MembershipListItem[];
  page: number;
  pageSize: number;
  total: number;
}

export interface MembershipGrantPayload {
  email: string;
  tier: "MENTOR_NETWORK" | "ACCELERATOR";
  months?: number;
}

export interface MembershipGrantResponse {
  membershipId: string;
  tier: string;
  status: string;
  currentPeriodEnd: string | null;
  email: string;
  userCreated: boolean;
}

export interface MembershipRevokeResponse {
  id: string;
  tier: string;
  buyerEmail: string | null;
  status: string;
}

export interface LeadListItem {
  id: string;
  email: string;
  name: string | null;
  status: string;
  source: string | null;
  tags: string[];
  lastActivityAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LeadListResponse {
  items: LeadListItem[];
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
}

export interface LeadEvent {
  id: string;
  type: string;
  metadata: Record<string, unknown> | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  createdAt: string;
}

export interface LeadDetailResponse {
  item: LeadListItem & {
    phone: string | null;
    attribution: Record<string, unknown> | null;
    notes: string | null;
    events: LeadEvent[];
    eventsTruncated: boolean;
  };
}

export interface LeadFacetsResponse {
  pipelineContactCount: number;
  excludedFromPipelineCount: number;
  allContactCount: number;
  pipelineStatuses: Record<string, number>;
  pipelineSources: Array<{ source: string | null; count: number }>;
  pipelineTags: Array<{ tag: string; count: number }>;
  pipelineTagScanCapped: boolean;
  allContactUnsubscribedCount: number;
  onboardingForms: Array<{ slug: string; title: string; responses: number }>;
}

export interface LeadUpdateItem {
  id: string;
  status?: "NEW" | "CONTACTED" | "QUALIFIED" | "LOST";
  expectedCurrentStatus?: "NEW" | "CONTACTED" | "QUALIFIED" | "LOST" | "WON";
  excludeFromPipeline?: boolean;
  tags?: string[];
  tagMode?: "add" | "remove" | "replace";
}

export interface LeadUpdatePayload {
  updates: LeadUpdateItem[];
}

export interface LeadUpdateResult {
  id: string;
  ok: boolean;
  applied: Array<"status" | "excludeFromPipeline" | "tags">;
  reason?: "not_found" | "conflict" | "error";
  message?: string;
}

export interface LeadUpdateResponse {
  results: LeadUpdateResult[];
  summary: { requested: number; succeeded: number; failed: number };
}

/** Mirrors hub/src/lib/drip/segment.ts DripSegment. */
export interface DripSegment {
  sources?: string[];
  statuses?: string[];
  anyTags?: string[];
  allTags?: string[];
  noneTags?: string[];
  minAgeHours?: number;
  maxAgeDays?: number;
  inactiveForDays?: number;
  callable?: boolean;
  cohorts?: "any" | string[];
  products?: Array<"self-paced" | "membership">;
  includeUsers?: boolean;
}

export interface CohortRosterResponse {
  cohort: { id: string; slug: string | null; title: string };
  roster: Array<{ name: string; email: string; tier: string | null; source: string }>;
  total: number;
}

export interface BroadcastSendPayload {
  campaignId: string;
}

export interface BroadcastSendResponse {
  campaignId: string;
  sent: number;
  failed: number;
}

export interface CertificateNotifyPayload {
  cohortId: string;
  certificateIds?: string[];
  dryRun?: boolean;
}

export interface CertificateNotifyResponse {
  ok: boolean;
  queued: number;
  alreadyNotified: number;
  revoked: number;
  noEmail: number;
  unsubscribed: number;
  campaignMissing?: boolean;
}

export interface DripStepInput {
  delayHours: number;
  channel: "EMAIL" | "TASK" | "CALL" | "SMS";
  subject: string;
  body: string;
  ctaLabel?: string | null;
  ctaUrl?: string | null;
  callAssistantId?: string | null;
  callFirstMessage?: string | null;
}

export interface DripStepItem extends DripStepInput {
  id: string;
  order: number;
}

export interface ListDripCampaignsParams {
  page?: number;
  pageSize?: number;
  status?: string;
}

export interface DripEnrollmentCounts {
  active: number;
  completed: number;
  exited: number;
  paused: number;
}

export interface DripCampaignListItem {
  id: string;
  slug: string;
  name: string;
  status: string;
  /** One of the hub's CAMPAIGN_TRIGGERS — see tools/drip-shared.ts. */
  trigger: string;
  priority: number;
  autoEnroll: boolean;
  timezone: string;
  sendWindowStartHour: number;
  sendWindowEndHour: number;
  skipWeekends: boolean;
  stepCount: number;
  enrollmentCounts: DripEnrollmentCounts;
  sentCount: number;
  failedCount: number;
  segmentSummary: string;
}

export interface DripCampaignListResponse {
  items: DripCampaignListItem[];
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
}

export interface DripCampaignDetailItem extends DripCampaignListItem {
  description: string | null;
  segment: DripSegment;
  exitOnStatuses: string[];
  testEmail: string | null;
  steps: DripStepItem[];
}

export interface DripCampaignDetailResponse {
  item: DripCampaignDetailItem;
}

export interface DripAudienceResponse {
  count: number;
  recipients?: string[];
}

export interface DripCampaignSettingsFields {
  name?: string;
  description?: string | null;
  trigger?: string;
  priority?: number;
  timezone?: string;
  sendWindowStartHour?: number;
  sendWindowEndHour?: number;
  skipWeekends?: boolean;
  exitOnStatuses?: string[];
  testEmail?: string | null;
  autoEnroll?: boolean;
  segment?: DripSegment;
  steps?: DripStepInput[];
}

export type DripCampaignCreatePayload = { name: string } & DripCampaignSettingsFields;

export interface DripCampaignCreateResponse {
  id: string;
  slug: string;
  name: string;
  status: string;
  slugWasAdjusted: boolean;
  stepsCreated: number;
  segmentMatchCount: number;
  /**
   * Per-step normalisation warnings from the hub — e.g. a ctaUrl the sanitizer
   * refused, which silently drops BOTH halves of the CTA. The write still
   * succeeds, so this is the only signal that a button went missing. Always
   * surface it: a silently discarded CTA on marketing mail shipped to
   * production undetected once already.
   */
  warnings?: string[];
}

export type DripCampaignPatchPayload = { id: string } & DripCampaignSettingsFields;

export interface DripCampaignPatchResponse {
  id: string;
  changed: Record<string, { from: unknown; to: unknown }>;
  unchanged: string[];
  stepsReplaced: number | null;
  isLiveEdit: boolean;
  segmentMatchCount: number;
  /** See DripCampaignCreateResponse.warnings. */
  warnings?: string[];
}

export interface ListInstructorsParams {
  page?: number;
  pageSize?: number;
  q?: string;
  role?: string;
  hasProfile?: boolean;
}

export interface GetInstructorParams {
  id?: string;
  slug?: string;
}

export type InstructorProfileField =
  | "headline"
  | "bio"
  | "location"
  | "languages"
  | "expertiseTags"
  | "linkedinUrl"
  | "image"
  | "timezone"
  | "profileVisibility"
  /** The public /humans/{slug} handle. Named apart from the `slug` lookup target on purpose. */
  | "publicSlug";

export interface UpdateInstructorProfileInput {
  userId?: string;
  email?: string;
  slug?: string;
  headline?: string | null;
  bio?: string | null;
  location?: string | null;
  languages?: string | null;
  expertiseTags?: string | null;
  linkedinUrl?: string | null;
  image?: string | null;
  /** IANA identifier, e.g. "America/Los_Angeles". Rejected by the hub if not null-free and valid. */
  timezone?: string | null;
  /** PRIVATE | PUBLIC | UNLISTED. */
  profileVisibility?: string | null;
  publicSlug?: string | null;
}

export interface InstructorListItem {
  id: string;
  name: string | null;
  slug: string | null;
  headline: string | null;
  image: string | null;
  location: string | null;
  expertiseTags: string | null;
  profileVisibility: string;
  linkedinUrl: string | null;
  taughtCohortCount: number;
}

export interface InstructorsListResponse {
  items: InstructorListItem[];
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
  candidatesTruncated?: true;
}

export interface InstructorTaughtCohort {
  id: string;
  slug: string | null;
  title: string;
  status: string;
}

export interface InstructorDetailItem {
  id: string;
  name: string | null;
  email: string;
  slug: string | null;
  headline: string | null;
  bio: string | null;
  image: string | null;
  location: string | null;
  languages: string | null;
  expertiseTags: string | null;
  socialLinks: Record<string, unknown>;
  timezone: string | null;
  isMentor: boolean;
  profileVisibility: string;
  createdAt: string;
  updatedAt: string;
  linkedinUrl: string | null;
  taughtCohortCount: number;
  taughtCohorts: InstructorTaughtCohort[];
}

export interface InstructorDetailResponse {
  item: InstructorDetailItem;
}

export interface InstructorProfileFieldChange {
  from: string | null;
  to: string | null;
}

export interface UpdateInstructorProfileResponse {
  userId: string;
  changed: Partial<Record<InstructorProfileField, InstructorProfileFieldChange>>;
  unchanged: InstructorProfileField[];
}

export interface DeletedZoomMeeting {
  deleted: boolean;
  zoomMeetingId: string;
  cohortsCleared: number;
}

export interface CohortDetailItem {
  id: string;
  slug: string | null;
  title: string;
  description: string | null;
  status: string;
  deliveryMode: string;
  location: string | null;
  startDate: string | null;
  endDate: string | null;
  startTime: string | null;
  endTime: string | null;
  timezone: string | null;
  instructors: { id: string; name: string | null; email: string }[];
  programs: { id: string; name: string }[];
}

export interface CohortDetailResponse {
  item: CohortDetailItem;
}

export type CohortUpdatePayload = { id: string } & Record<string, unknown>;

export interface CohortUpdateResponse {
  id: string;
  changed: Record<string, { from: unknown; to: unknown }>;
  unchanged: string[];
}

export interface SessionSeriesBaseItem {
  id: string;
  title: string;
  kind: "CHECKIN" | "ONBOARDING";
  status: "ACTIVE" | "PAUSED" | "ARCHIVED";
  description: string | null;
  days: string;
  startTime: string;
  endTime: string;
  timezone: string;
  startDate: string;
  endDate: string | null;
  instructorId: string | null;
  zoomLink: string | null;
  zoomMeetingId: string | null;
}

export interface SessionSeriesCohort {
  id: string;
  title: string;
  status: string;
}

export interface SessionSeriesListItem extends SessionSeriesBaseItem {
  cohorts: Array<{ cohort: SessionSeriesCohort }>;
  _count: { occurrences: number };
}

export interface SessionSeriesOccurrence {
  id: string;
  title: string;
  date: string;
  startTime: string;
  endTime: string;
  timezone: string;
  status: string;
  recordingLink: string | null;
  instructorId: string | null;
}

export interface SessionSeriesDetailItem extends SessionSeriesBaseItem {
  instructor: { id: string; name: string | null; email: string } | null;
  cohorts: Array<{
    cohort: SessionSeriesCohort & { slug: string | null };
  }>;
  occurrences: SessionSeriesOccurrence[];
}

export interface SessionSeriesListResponse {
  series: SessionSeriesListItem[];
}

export interface SessionSeriesDetailResponse {
  series: SessionSeriesDetailItem;
}

export interface SessionSeriesCreateResponse {
  success: true;
  series: SessionSeriesBaseItem;
}

export type SessionSeriesPatchPayload = { id: string } & Record<string, unknown>;

export interface SessionSeriesPatchResponse {
  success: true;
  series: SessionSeriesBaseItem | null;
  cohorts?: SessionSeriesCohort[];
}

export interface UnenrichedLessonItem {
  lessonId: string;
  zoomFileId: string | null;
  name: string;
  durationSec: number;
  moduleName: string;
  programId: string;
  programName: string;
}

export interface UnenrichedLessonsResponse {
  items: UnenrichedLessonItem[];
  total: number;
}

export interface LessonQuizQuestion {
  question: string;
  options: string[];
  correct_answer: string;
  explanation?: string;
}

export type LessonContentField =
  | "name"
  | "intro"
  | "text"
  | "tags"
  | "timecodes"
  | "posterUrl"
  | "audioUrl"
  | "captionsUrl"
  | "quizQuestions";

export interface LessonContentValueByField {
  name: string;
  intro: string;
  text: string;
  tags: string;
  timecodes: string;
  posterUrl: string;
  audioUrl: string;
  captionsUrl: string;
  quizQuestions: LessonQuizQuestion[];
}

export type LessonContentUpdateItem = {
  zoomFileId?: string;
  lessonId?: string;
  force?: boolean;
} & Partial<LessonContentValueByField>;

export interface LessonContentUpdateResult {
  lessonId: string;
  zoomFileId: string | null;
  changed: Partial<{
    [K in LessonContentField]: { from: LessonContentValueByField[K] | null; to: LessonContentValueByField[K] };
  }>;
  unchanged: LessonContentField[];
  refused?: string;
}

export interface LessonContentUpdateResponse {
  items: LessonContentUpdateResult[];
}

export interface LessonAudioExtractResponse {
  started: true;
}

export interface CreatedCohort {
  id: string;
  slug: string | null;
  title: string;
  status: string;
  deliveryMode: string;
  startDate: string | null;
  endDate: string | null;
  zoomLink: string | null;
  zoomMeetingId: string | null;
  zoomWarning: string | null;
  sessionsCreated: number | null;
  sessionsNote: string | null;
  instructors: { id: string; name: string | null; email: string }[];
  programs: { id: string; name: string }[];
  rawProgram: { id: string; name: string } | null;
  slugWasAdjusted: boolean;
  groups: { id: string; name: string; price: number; seats: number }[];
}

export interface ParticipationInstructor {
  cohortInstructorId: string;
  name: string | null;
  email: string;
  status: string; // PENDING | CONFIRMED | DECLINED
  invitedAt: string | null;
  respondedAt: string | null;
  notes: string | null;
  sessionResponses: {
    sessionId: string;
    title: string;
    date: string;
    availability: string;
    note: string | null;
  }[];
}

export interface ParticipationCohort {
  cohortId: string;
  title: string;
  status: string;
  startDate: string | null;
  endDate: string | null;
  sessionCount: number;
  unconfirmedCount: number;
  instructors: ParticipationInstructor[];
}

export interface ParticipationOutreach {
  id: string;
  cohortId: string;
  subject: string;
  status: string; // DRAFT | APPROVED | SENT
  approvedAt: string | null;
  sentAt: string | null;
  createdAt: string;
  _count: { sends: number };
}

export interface ParticipationStatusResponse {
  items: ParticipationCohort[];
  outreaches: ParticipationOutreach[];
}

export type ParticipationActionPayload = {
  action:
    | "sync"
    | "draft"
    | "preview"
    | "approve"
    | "send"
    | "nudge"
    // v2 — per-session schedule negotiation
    | "propose"
    | "list_changes"
    | "respond_change"
    | "gcal_sync"
    | "schedule";
  cohortId?: string;
  outreachId?: string;
  subject?: string;
  body?: string;
  only?: string[];
  force?: boolean;
  instructorIds?: string[];
  instructorId?: string;
  assignmentId?: string;
  decision?: "accept" | "counter" | "confirm";
  adminNote?: string;
  sessionId?: string;
};

export type ChangeRequestRow = {
  assignmentId: string;
  instructor: string;
  email: string;
  cohortId: string;
  cohortTitle: string;
  sessionId: string;
  sessionTitle: string;
  currentDate: string;
  currentTime: string;
  proposedDate: string | null;
  proposedTime: string | null;
  note: string | null;
  respondedAt: string | null;
};
