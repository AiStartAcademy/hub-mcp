#!/usr/bin/env node
/**
 * hub-mcp — stdio MCP server for an academy hub LMS.
 *
 * Transport is stdio only. stdout belongs to the JSON-RPC stream — anything
 * logged there corrupts the protocol, so all diagnostics go to stderr.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { HubClient, HubError } from "./hub-client.js";
import { PreviewStore } from "./preview-store.js";
import { SERVER_NAME, SERVER_VERSION } from "./version.js";
import { cohortCreateSchema, makeCohortCreateHandler } from "./tools/cohort-create.js";
import type { CohortCreateInput } from "./tools/cohort-create.js";
import { cohortUpdateSchema, makeCohortUpdateHandler } from "./tools/cohort-update.js";
import {
  sessionSeriesListSchema,
  makeSessionSeriesListHandler,
  type SessionSeriesListInput,
} from "./tools/session-series-list.js";
import {
  sessionSeriesCreateSchema,
  makeSessionSeriesCreateHandler,
  type SessionSeriesCreateInput,
  type SessionSeriesCreateSpec,
} from "./tools/session-series-create.js";
import {
  sessionSeriesAttachSchema,
  makeSessionSeriesAttachHandler,
  type SessionSeriesAttachInput,
  type SessionSeriesAttachPayload,
} from "./tools/session-series-attach.js";
import {
  cohortInstructorStatusSchema,
  makeCohortInstructorStatusHandler,
  type CohortInstructorStatusInput,
} from "./tools/cohort-instructor-status.js";
import {
  instructorOutreachSchema,
  makeInstructorOutreachHandler,
  type InstructorOutreachInput,
  type InstructorOutreachPayload,
} from "./tools/instructor-outreach.js";
import {
  instructorScheduleSchema,
  makeInstructorScheduleHandler,
  type InstructorScheduleInput,
  type InstructorSchedulePayload,
} from "./tools/instructor-schedule.js";
import type { CohortUpdateInput, CohortUpdatePayload } from "./tools/cohort-update.js";
import { instructorGetSchema, makeInstructorGetHandler } from "./tools/instructor-get.js";
import type { InstructorGetInput } from "./tools/instructor-get.js";
import { instructorListSchema, makeInstructorListHandler } from "./tools/instructor-list.js";
import type { InstructorListInput } from "./tools/instructor-list.js";
import {
  instructorProfileUpdateSchema,
  makeInstructorProfileUpdateHandler,
} from "./tools/instructor-profile-update.js";
import type {
  InstructorProfileUpdateInput,
  InstructorProfileUpdatePayload,
} from "./tools/instructor-profile-update.js";
import { zoomMeetingDeleteSchema, makeZoomMeetingDeleteHandler } from "./tools/zoom-meeting-delete.js";
import type { ZoomMeetingDeleteInput } from "./tools/zoom-meeting-delete.js";
import {
  lessonListUnenrichedSchema,
  makeLessonListUnenrichedHandler,
} from "./tools/lesson-list-unenriched.js";
import {
  lessonAudioExtractSchema,
  makeLessonAudioExtractHandler,
} from "./tools/lesson-audio-extract.js";
import type { LessonAudioExtractInput } from "./tools/lesson-audio-extract.js";
import {
  lessonContentUpdateSchema,
  makeLessonContentUpdateHandler,
} from "./tools/lesson-content-update.js";
import type { LessonContentUpdateInput } from "./tools/lesson-content-update.js";
import type { LessonContentUpdateItem } from "./hub-client.js";
import { leadListSchema, makeLeadListHandler } from "./tools/lead-list.js";
import { membershipListSchema, makeMembershipListHandler, type MembershipListInput } from "./tools/membership-list.js";
import { membershipGrantSchema, makeMembershipGrantHandler, type MembershipGrantInput } from "./tools/membership-grant.js";
import { membershipRevokeSchema, makeMembershipRevokeHandler, type MembershipRevokeInput } from "./tools/membership-revoke.js";
import type { LeadListInput } from "./tools/lead-list.js";
import { leadGetSchema, makeLeadGetHandler } from "./tools/lead-get.js";
import type { LeadGetInput } from "./tools/lead-get.js";
import { leadFacetsSchema, makeLeadFacetsHandler } from "./tools/lead-facets.js";
import type { LeadFacetsInput } from "./tools/lead-facets.js";
import {
  leadUpdateSchema,
  makeLeadUpdateHandler,
  type LeadUpdateInput,
} from "./tools/lead-update.js";
import type { LeadUpdatePayload } from "./hub-client.js";
import {
  venueEventCreateSchema,
  makeVenueEventCreateHandler,
  type VenueEventCreateInput,
} from "./tools/venue-event-create.js";
import { venueEventListSchema, makeVenueEventListHandler } from "./tools/venue-event-list.js";
import type { VenueEventListInput } from "./tools/venue-event-list.js";
import {
  venueEventRegistrationsSchema,
  makeVenueEventRegistrationsHandler,
} from "./tools/venue-event-registrations.js";
import type { VenueEventRegistrationsInput } from "./tools/venue-event-registrations.js";
import {
  venueEventUpdateSchema,
  makeVenueEventUpdateHandler,
  type VenueEventUpdateInput,
} from "./tools/venue-event-update.js";
import {
  venueEventSetStatusSchema,
  makeVenueEventSetStatusHandler,
  type VenueEventSetStatusInput,
} from "./tools/venue-event-set-status.js";
import {
  venueAgreementCreateSchema,
  makeVenueAgreementCreateHandler,
  type VenueAgreementCreateInput,
} from "./tools/venue-agreement-create.js";
import {
  venueRentalPaymentCreateSchema,
  venueRentalPaymentDeactivateSchema,
  makeVenueRentalPaymentCreateHandler,
  makeVenueRentalPaymentDeactivateHandler,
  type VenueRentalPaymentCreateInput,
  type VenueRentalPaymentDeactivateInput,
} from "./tools/venue-rental-payment-create.js";
import {
  dripCampaignListSchema,
  makeDripCampaignListHandler,
} from "./tools/drip-campaign-list.js";
import type { DripCampaignListInput } from "./tools/drip-campaign-list.js";
import { dripCampaignGetSchema, makeDripCampaignGetHandler } from "./tools/drip-campaign-get.js";
import type { DripCampaignGetInput } from "./tools/drip-campaign-get.js";
import {
  dripAudiencePreviewSchema,
  makeDripAudiencePreviewHandler,
} from "./tools/drip-audience-preview.js";
import type { DripAudiencePreviewInput } from "./tools/drip-audience-preview.js";
import {
  dripCampaignUpsertSchema,
  makeDripCampaignUpsertHandler,
} from "./tools/drip-campaign-upsert.js";
import type {
  DripCampaignUpsertInput,
  DripUpsertPayload,
} from "./tools/drip-campaign-upsert.js";
import {
  cohortRosterSchema,
  makeCohortRosterHandler,
  type CohortRosterInput,
} from "./tools/cohort-roster.js";
import {
  broadcastSendSchema,
  makeBroadcastSendHandler,
  type BroadcastSendInput,
  type BroadcastSendPayload,
} from "./tools/broadcast-send.js";
import {
  certificateNotifySchema,
  makeCertificateNotifyHandler,
  type CertificateNotifyInput,
  type CertificateNotifyPayload,
} from "./tools/certificate-notify.js";
import { programUpdateSchema, makeProgramUpdateHandler } from "./tools/program-update.js";
import type { ProgramUpdateInput } from "./tools/program-update.js";
import type { ProgramUpdatePayload } from "./hub-client.js";
import {
  programCoverGenerateSchema,
  makeProgramCoverGenerateHandler,
} from "./tools/program-cover-generate.js";
import type { ProgramCoverGenerateInput } from "./tools/program-cover-generate.js";
import { mediaUploadSchema, makeMediaUploadHandler } from "./tools/media-upload.js";
import type { MediaUploadInput } from "./tools/media-upload.js";

type ToolTextResult = {
  content: [{ type: "text"; text: string }];
  isError?: true;
};

async function toolResult(run: () => Promise<string>): Promise<ToolTextResult> {
  try {
    const text = await run();
    return { content: [{ type: "text" as const, text }] };
  } catch (err) {
    if (err instanceof HubError) {
      return {
        content: [{ type: "text" as const, text: `Hub refused the request (${err.status}): ${err.message}` }],
        isError: true,
      };
    }
    return {
      content: [{ type: "text" as const, text: `Unexpected error: ${(err as Error).message}` }],
      isError: true,
    };
  }
}

async function main() {
  const config = loadConfig();
  const hub = new HubClient(config);
  const previews = new PreviewStore<Omit<CohortCreateInput, "dryRun" | "previewId" | "confirm">>();
  const zoomDeletePreviews = new PreviewStore<{ zoomMeetingId: string }>();
  const instructorProfilePreviews = new PreviewStore<InstructorProfileUpdatePayload>();
  const cohortUpdatePreviews = new PreviewStore<CohortUpdatePayload>();
  const sessionSeriesCreatePreviews = new PreviewStore<SessionSeriesCreateSpec>();
  const sessionSeriesAttachPreviews = new PreviewStore<SessionSeriesAttachPayload>();

  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

  const createCohort = makeCohortCreateHandler(hub, config, previews);
  const deleteZoomMeeting = makeZoomMeetingDeleteHandler(hub, config, zoomDeletePreviews);
  const listInstructors = makeInstructorListHandler(hub);
  const getInstructor = makeInstructorGetHandler(hub);
  const updateInstructorProfile = makeInstructorProfileUpdateHandler(
    hub,
    config,
    instructorProfilePreviews
  );
  const updateCohort = makeCohortUpdateHandler(hub, config, cohortUpdatePreviews);
  const listSessionSeries = makeSessionSeriesListHandler(hub);
  const createSessionSeries = makeSessionSeriesCreateHandler(
    hub,
    config,
    sessionSeriesCreatePreviews
  );
  const attachSessionSeries = makeSessionSeriesAttachHandler(
    hub,
    config,
    sessionSeriesAttachPreviews
  );
  const instructorOutreachPreviews = new PreviewStore<InstructorOutreachPayload>();
  const cohortInstructorStatus = makeCohortInstructorStatusHandler(hub);
  const instructorOutreach = makeInstructorOutreachHandler(hub, config, instructorOutreachPreviews);
  const instructorSchedulePreviews = new PreviewStore<InstructorSchedulePayload>();
  const instructorSchedule = makeInstructorScheduleHandler(hub, config, instructorSchedulePreviews);
  const lessonContentUpdatePreviews = new PreviewStore<LessonContentUpdateItem[]>();
  const listUnenrichedLessons = makeLessonListUnenrichedHandler(hub);
  const extractLessonAudio = makeLessonAudioExtractHandler(hub, config);
  const updateLessonContent = makeLessonContentUpdateHandler(hub, config, lessonContentUpdatePreviews);
  const dripUpsertPreviews = new PreviewStore<DripUpsertPayload>();
  const listLeads = makeLeadListHandler(hub);
  const getLead = makeLeadGetHandler(hub);
  const getLeadFacets = makeLeadFacetsHandler(hub);
  const updateLeads = makeLeadUpdateHandler(
    hub,
    config,
    new PreviewStore<LeadUpdatePayload>()
  );
  const listVenueEvents = makeVenueEventListHandler(hub);
  const listVenueEventRegistrations = makeVenueEventRegistrationsHandler(hub);
  const createVenueEvent = makeVenueEventCreateHandler(
    hub,
    config,
    new PreviewStore<Omit<VenueEventCreateInput, "dryRun" | "previewId" | "confirm">>()
  );
  const updateVenueEvent = makeVenueEventUpdateHandler(
    hub,
    config,
    new PreviewStore<Omit<VenueEventUpdateInput, "dryRun" | "previewId" | "confirm">>()
  );
  const setVenueEventStatus = makeVenueEventSetStatusHandler(
    hub,
    config,
    new PreviewStore<Omit<VenueEventSetStatusInput, "dryRun" | "previewId" | "confirm">>()
  );
  const createVenueAgreement = makeVenueAgreementCreateHandler(
    hub,
    config,
    new PreviewStore<Omit<VenueAgreementCreateInput, "dryRun" | "previewId" | "confirm">>()
  );
  const createVenueRentalPayment = makeVenueRentalPaymentCreateHandler(
    hub,
    config,
    new PreviewStore<Omit<VenueRentalPaymentCreateInput, "dryRun" | "previewId" | "confirm">>()
  );
  const deactivateVenueRentalPayment = makeVenueRentalPaymentDeactivateHandler(
    hub,
    config,
    new PreviewStore<Omit<VenueRentalPaymentDeactivateInput, "dryRun" | "previewId" | "confirm">>()
  );
  const listDripCampaigns = makeDripCampaignListHandler(hub);
  const getDripCampaign = makeDripCampaignGetHandler(hub);
  const previewDripAudience = makeDripAudiencePreviewHandler(hub);
  const upsertDripCampaign = makeDripCampaignUpsertHandler(hub, config, dripUpsertPreviews);
  const cohortRoster = makeCohortRosterHandler(hub);
  const broadcastSend = makeBroadcastSendHandler(
    hub,
    config,
    new PreviewStore<BroadcastSendPayload>()
  );
  const certificateNotify = makeCertificateNotifyHandler(
    hub,
    config,
    new PreviewStore<CertificateNotifyPayload>()
  );
  const programUpdatePreviews = new PreviewStore<ProgramUpdatePayload>();
  const updateProgram = makeProgramUpdateHandler(hub, config, programUpdatePreviews);
  const generateProgramCover = makeProgramCoverGenerateHandler(hub, config);
  const uploadMedia = makeMediaUploadHandler(hub, config);
  const listMemberships = makeMembershipListHandler(hub);
  const grantMembership = makeMembershipGrantHandler(
    hub,
    config,
    new PreviewStore<Omit<MembershipGrantInput, "dryRun" | "previewId" | "confirm">>()
  );
  const revokeMembership = makeMembershipRevokeHandler(
    hub,
    config,
    new PreviewStore<Omit<MembershipRevokeInput, "dryRun" | "previewId" | "confirm">>()
  );

  server.tool(
    "membership_list",
    [
      "List hub memberships (paid + complimentary). Read-only.",
      "",
      "Membership is an ENTITLEMENT (a Membership row), not a role — tiers:",
      "MENTOR_NETWORK (recordings + community) and ACCELERATOR (everything, plus coaching).",
      "Use compOnly: true to see admin-granted comps — the only kind revocable via MCP.",
    ].join("\n"),
    membershipListSchema.shape,
    async (args) => toolResult(() => listMemberships(args as MembershipListInput))
  );

  server.tool(
    "membership_grant",
    [
      "Grant a COMPLIMENTARY membership (promotion, partner, scholarship) by email.",
      "",
      "TWO-STEP. The first call previews and returns a previewId — it writes nothing.",
      "Call again with that previewId and confirm: true to actually grant.",
      "Always show the user the preview and get their agreement before confirming.",
      "",
      "On confirm the hub creates the account if needed, sends a REAL welcome email,",
      "invites them to the community chat, and exits their drip campaigns.",
      "Paid Stripe memberships are never touched — this creates a $0 comp row only.",
    ].join("\n"),
    membershipGrantSchema.shape,
    async (args) => toolResult(() => grantMembership(args as MembershipGrantInput))
  );

  server.tool(
    "membership_revoke",
    [
      "Revoke a COMPLIMENTARY membership (find its id with membership_list, compOnly: true).",
      "",
      "TWO-STEP. The first call previews and returns a previewId — it revokes nothing.",
      "Call again with that previewId and confirm: true to actually revoke.",
      "Always show the user the preview and get their agreement before confirming.",
      "",
      "The hub refuses paid memberships — cancel those in Stripe; the webhook syncs.",
    ].join("\n"),
    membershipRevokeSchema.shape,
    async (args) => toolResult(() => revokeMembership(args as MembershipRevokeInput))
  );

  server.tool(
    "cohort_create",
    [
      "Create a cohort in the hub.",
      "",
      "TWO-STEP. The first call previews and returns a previewId — it writes nothing.",
      "Call again with that previewId and confirm: true to actually create it.",
      "Always show the user the preview and get their agreement before confirming.",
      "",
      "The cohort is always created as DRAFT: invisible to students and not purchasable.",
      "Publishing is a deliberate human step in the admin UI.",
    ].join("\n"),
    cohortCreateSchema.shape,
    async (args) => toolResult(() => createCohort(args as CohortCreateInput))
  );

  server.tool(
    "zoom_meeting_delete",
    [
      "Delete a real Zoom meeting created by cohort_create (createZoomMeeting: true) —",
      "cleanup for test/throwaway cohorts.",
      "",
      "TWO-STEP. The first call previews and returns a previewId — it deletes nothing.",
      "Call again with that previewId and confirm: true to actually delete it.",
      "Always show the user the preview and get their agreement before confirming.",
      "",
      "IRREVERSIBLE: cancels the whole recurring series, including future occurrences",
      "and any cloud recordings. If a Cohort still references this meeting, its",
      "zoomLink/zoomMeetingId are cleared — the Cohort row itself is never deleted.",
    ].join("\n"),
    zoomMeetingDeleteSchema.shape,
    async (args) => toolResult(() => deleteZoomMeeting(args as ZoomMeetingDeleteInput))
  );

  server.tool(
    "instructor_schedule",
    [
      "Per-session instructor scheduling: see pending change requests, read one",
      "instructor's full cross-cohort schedule, propose sessions for a cohort,",
      "accept/counter/confirm a change request, or re-push confirmed sessions to",
      "Google Calendar.",
      "",
      "action respond_change is TWO-STEP — the first call previews what would happen",
      "and returns a previewId; call again with confirm: true to commit. Accepting a",
      "change MOVES the real session and emails updated calendar invites to every",
      "confirmed instructor on it, so always show the user the preview first.",
      "",
      "list_changes, schedule, propose and gcal_sync act immediately (no email content",
      "is authored; propose only creates PROPOSED rows, it does not notify anyone —",
      "use instructor_outreach to actually email them).",
    ].join("\n"),
    instructorScheduleSchema.shape,
    async (args) => toolResult(() => instructorSchedule(args as InstructorScheduleInput))
  );

  server.tool(
    "cohort_instructor_status",
    [
      "Read-only rollup of instructor participation for published/upcoming cohorts:",
      "PENDING/CONFIRMED/DECLINED per instructor, per-session availability, notes,",
      "and outreach history. Pass cohortId to narrow to one cohort.",
    ].join("\n"),
    cohortInstructorStatusSchema.shape,
    async (args) => toolResult(() => cohortInstructorStatus(args as CohortInstructorStatusInput))
  );

  server.tool(
    "instructor_outreach",
    [
      "Instructor participation workflow: sync roster records, send a confirm-your-",
      "participation email cycle, or nudge non-responders.",
      "",
      "action send is TWO-STEP. The first call drafts the outreach, renders the full",
      "email for a sample recipient plus the recipient list, and returns a previewId —",
      "it emails nobody. Call again with that previewId and confirm: true to approve",
      "and send. Always show the user the preview and get their agreement first —",
      "the preview IS the per-cycle approval.",
      "",
      "action sync and action nudge act immediately (no email content is authored;",
      "nudge re-sends the latest approved outreach to still-PENDING instructors,",
      "deduped hub-side to once per 24h unless force: true).",
    ].join("\n"),
    instructorOutreachSchema.shape,
    async (args) => toolResult(() => instructorOutreach(args as InstructorOutreachInput))
  );

  server.tool(
    "instructor_list",
    "List instructors from the hub with optional paging and filters.",
    instructorListSchema.shape,
    async (args) => toolResult(() => listInstructors(args as InstructorListInput))
  );

  server.tool(
    "instructor_get",
    "Fetch a single instructor profile by id or slug.",
    instructorGetSchema.shape,
    async (args) => toolResult(() => getInstructor(args as InstructorGetInput))
  );

  server.tool(
    "instructor_profile_update",
    [
      "Update allowlisted instructor profile fields in the hub.",
      "",
      "TWO-STEP. The first call previews and returns a previewId — it writes nothing.",
      "Call again with that previewId and confirm: true to actually write it.",
      "The model wrote this text from a document; the human must read the diff before confirming.",
      "",
      "Writable fields: headline, bio, location, languages, expertiseTags, linkedinUrl, image,",
      "timezone (IANA, e.g. America/Los_Angeles), profileVisibility (PRIVATE|PUBLIC|UNLISTED),",
      "and publicSlug (the /humans/{slug} handle — named apart from the `slug` lookup target).",
      "role, email, name, and every other identity/permission field are refused by the hub with a 400, not silently ignored.",
      "",
      "PUBLISHING IS POSSIBLE. profileVisibility is writable, so this tool CAN make a profile",
      "world-readable — it is no longer structurally incapable of publishing. A preview that changes",
      "visibility prints a ⚠ VISIBILITY banner; treat confirming one as publishing the bio you drafted.",
      "Never raise visibility unless the human asked for it in this conversation.",
    ].join("\n"),
    instructorProfileUpdateSchema.shape,
    async (args) => toolResult(() => updateInstructorProfile(args as InstructorProfileUpdateInput))
  );

  server.tool(
    "cohort_update",
    [
      "Update fields on an existing cohort in the hub (title, description, delivery",
      "mode, location, dates/times, timezone, instructor set, linked courses).",
      "",
      "TWO-STEP. The first call previews and returns a previewId — it writes nothing.",
      "Call again with that previewId and confirm: true to actually write it.",
      "Always show the user the field-by-field diff and get their agreement before confirming.",
      "",
      "instructorEmails and programTitles are FULL-SET REPLACEMENTS, not additions — pass the",
      "complete list you want, not just what's new. Unknown emails/titles refuse the whole request.",
      "",
      "OUT OF SCOPE (use the admin UI instead): status, zoomLink/zoomMeetingId, and groups",
      "(seat tiers/pricing) — those touch live external state or payments and aren't safe to",
      "patch blind through this tool.",
    ].join("\n"),
    cohortUpdateSchema.shape,
    async (args) => toolResult(() => updateCohort(args as CohortUpdateInput))
  );

  server.tool(
    "session_series_list",
    [
      "List shared check-in/onboarding series, or fetch one by id with its instructor,",
      "cohort attachments, and upcoming occurrences. Read-only.",
      "",
      "Zoom links are reported as stored state only. Zoom provisioning is out of scope for",
      "MCP and stays in the admin UI because a wrong write would desync the live recurring meeting.",
    ].join("\n"),
    sessionSeriesListSchema.shape,
    async (args) => toolResult(() => listSessionSeries(args as SessionSeriesListInput))
  );

  server.tool(
    "session_series_create",
    [
      "Create a shared check-in or onboarding session series in the hub.",
      "",
      "TWO-STEP. The first call previews and returns a previewId — it writes nothing.",
      "Call again with that previewId and confirm: true to actually create the series.",
      "Always show the user the normalized schedule before confirming.",
      "",
      "Cohorts are attached separately with session_series_attach; there, cohortIds is a",
      "FULL-SET REPLACEMENT, not a delta — pass every cohort that should remain attached.",
      "",
      "Zoom provisioning is OUT OF SCOPE: provision it in the admin UI. A wrong MCP write",
      "would desync the live recurring meeting from its DB rows, so this creates no join link.",
    ].join("\n"),
    sessionSeriesCreateSchema.shape,
    async (args) => toolResult(() => createSessionSeries(args as SessionSeriesCreateInput))
  );

  server.tool(
    "session_series_attach",
    [
      "Replace the cohorts served by one shared session series.",
      "",
      "TWO-STEP. The first call fetches current state, previews ATTACH/DETACH/unchanged,",
      "and returns a previewId — it writes nothing. Call again with that previewId and",
      "confirm: true to commit. Always show the user every detachment before confirming.",
      "",
      "cohortIds is a FULL-SET REPLACEMENT, not a delta. Passing [] detaches every cohort,",
      "which removes the call from those students' schedules. Unknown ids refuse the whole request.",
      "",
      "Zoom provisioning is OUT OF SCOPE: use the admin UI. A wrong MCP write would desync",
      "the live recurring meeting from its DB rows; this tool changes attachments only.",
    ].join("\n"),
    sessionSeriesAttachSchema.shape,
    async (args) => toolResult(() => attachSessionSeries(args as SessionSeriesAttachInput))
  );

  server.tool(
    "lesson_list_unenriched",
    [
      "List raw Zoom-synced lessons in the hub that still have no content",
      "(empty tags) — the 'Recording - M/D/YYYY' placeholders syncRecordingsToProgram()",
      "creates with no title/description/keywords. Read-only.",
    ].join("\n"),
    lessonListUnenrichedSchema.shape,
    async () => toolResult(() => listUnenrichedLessons())
  );

  server.tool(
    "lesson_content_update",
    [
      "Fill intro/text/tags/timecodes/name/posterUrl/audioUrl/captionsUrl/quizQuestions onto",
      "EXISTING raw lessons in the hub —",
      "no new schema, just the columns syncRecordingsToProgram() already created empty.",
      "Match each item by zoomFileId or lessonId (exactly one per item).",
      "posterUrl/audioUrl/captionsUrl, when supplied, must be absolute https:// URLs.",
      "quizQuestions, when supplied, must be 1-20 questions with 2-6 options each and a",
      "correct_answer that matches one of that question's options.",
      "",
      "TWO-STEP, BATCH. The first call previews the whole batch and returns a previewId —",
      "it writes nothing. Call again with that previewId and confirm: true to commit all",
      "items in one transaction. Always show the user the diff before confirming.",
      "",
      "SAFETY: an item whose lesson already has non-empty tags is REFUSED unless force:true —",
      "this protects lessons already enriched (by n8n or a prior run) from being clobbered.",
    ].join("\n"),
    lessonContentUpdateSchema.shape,
    async (args) => toolResult(() => updateLessonContent(args as LessonContentUpdateInput))
  );

  server.tool(
    "lesson_audio_extract",
    [
      "Trigger asynchronous audio extraction for an existing lesson on the hub.",
      "ONE STEP, non-destructive: this tool just starts the hub-side job and returns",
      "immediately; extraction continues asynchronously on the hub after the response.",
    ].join("\n"),
    lessonAudioExtractSchema.shape,
    async (args) => toolResult(() => extractLessonAudio(args as LessonAudioExtractInput))
  );

  server.tool(
    "lead_list",
    [
      "List leads (contacts) in the hub CRM: status, source, tags, last activity.",
      "Filters: status, exact source, tag substring, free-text q. Read-only.",
    ].join("\n"),
    leadListSchema.shape,
    async (args) => toolResult(() => listLeads(args as LeadListInput))
  );

  server.tool(
    "lead_get",
    [
      "Fetch one lead by id with full detail: contact fields, attribution, notes, and up to",
      "100 recent events (quiz submissions, asset downloads, lesson views). Read-only.",
    ].join("\n"),
    leadGetSchema.shape,
    async (args) => toolResult(() => getLead(args as LeadGetInput))
  );

  server.tool(
    "lead_facets",
    [
      "Aggregate pipeline view of leads: status counts, sources, and tags EXCLUDE contacts",
      "flagged excludeFromPipeline. excludedFromPipelineCount says how many were excluded;",
      "allContactCount and allContactUnsubscribedCount remain whole-CRM counts. No PII. Read-only.",
      "",
      "Call this FIRST when authoring a drip segment: tags and sources are free-form strings,",
      "and a segment referencing a value that doesn't exist silently matches nobody.",
    ].join("\n"),
    leadFacetsSchema.shape,
    async (args) => toolResult(() => getLeadFacets(args as LeadFacetsInput))
  );

  server.tool(
    "lead_update",
    [
      "Batch-update 1-50 CRM contacts, especially to flag non-customers (test accounts, staff,",
      "instructors, partners, or duplicates) out of pipeline reporting.",
      "",
      "TWO-STEP. The first call previews every requested change and returns a previewId; it",
      "writes nothing. Call again with that previewId and confirm: true to commit the stored batch.",
      "Always show the operator the preview and get agreement before confirming.",
      "",
      "SAFETY: status can NEVER be set to WON here. WON is reserved for the hub's verified",
      "purchase-grant path. Tags default to additive tagMode=add; remove and replace are explicit",
      "opt-ins, so existing tags are never silently clobbered.",
    ].join("\n"),
    leadUpdateSchema.shape,
    async (args) => toolResult(() => updateLeads(args as LeadUpdateInput))
  );

  server.tool(
    "venue_event_list",
    [
      "List venue events from the hub with optional status/date/search filters, or fetch",
      "one event by id or slug for full detail. Read-only.",
    ].join("\n"),
    venueEventListSchema.shape,
    async (args) => toolResult(() => listVenueEvents(args as VenueEventListInput))
  );

  server.tool(
    "venue_event_registrations",
    [
      "Fetch registrations for one venue event by id or slug: attendee identity, registration",
      "status, waiver state, and createdAt. Read-only.",
    ].join("\n"),
    venueEventRegistrationsSchema.shape,
    async (args) => toolResult(() => listVenueEventRegistrations(args as VenueEventRegistrationsInput))
  );

  server.tool(
    "venue_event_create",
    [
      "Create a venue event in the hub.",
      "",
      "TWO-STEP. The first call previews and returns a previewId — it writes nothing.",
      "Call again with that previewId and confirm: true to actually create it.",
      "Always show the user the preview and get their agreement before confirming.",
      "",
      "Creates a matching event on the hub's connected Google Calendar, and when the event is APPROVED",
      "emails the organizer a confirmation + Google Calendar invite.",
    ].join("\n"),
    venueEventCreateSchema.shape,
    async (args) => toolResult(() => createVenueEvent(args as VenueEventCreateInput))
  );

  server.tool(
    "venue_event_update",
    [
      "Update one venue event in the hub by id or slug.",
      "",
      "TWO-STEP. The first call previews and returns a previewId — it writes nothing.",
      "Call again with that previewId and confirm: true to actually write it.",
      "Always show the user the preview and get their agreement before confirming.",
      "",
      "Calendar-affecting changes update the hub's connected Google Calendar; APPROVED emails the organizer",
      "a confirmation + Google Calendar invite, and DECLINED cancels the calendar hold.",
    ].join("\n"),
    venueEventUpdateSchema.shape,
    async (args) => toolResult(() => updateVenueEvent(args as VenueEventUpdateInput))
  );

  server.tool(
    "venue_event_set_status",
    [
      "Set one venue event status in the hub by id or slug.",
      "",
      "TWO-STEP. The first call previews and returns a previewId — it writes nothing.",
      "Call again with that previewId and confirm: true to actually write it.",
      "Always show the user the preview and get their agreement before confirming.",
      "",
      "APPROVED emails the organizer a confirmation + Google Calendar invite, DECLINED cancels",
      "the calendar hold, and CANCELLED or PENDING re-sync the Google Calendar event.",
    ].join("\n"),
    venueEventSetStatusSchema.shape,
    async (args) => toolResult(() => setVenueEventStatus(args as VenueEventSetStatusInput))
  );

  server.tool(
    "venue_agreement_create",
    [
      "Create a venue agreement for one venue event in the hub.",
      "",
      "TWO-STEP. The first call previews and returns a previewId — it writes nothing.",
      "Call again with that previewId and confirm: true to actually create it.",
      "Always show the user the preview and get their agreement before confirming.",
      "",
      "If send: true, the signer is emailed immediately; otherwise the agreement is created but",
      "nothing is sent.",
    ].join("\n"),
    venueAgreementCreateSchema.shape,
    async (args) => toolResult(() => createVenueAgreement(args as VenueAgreementCreateInput))
  );

  server.tool(
    "venue_rental_payment_create",
    [
      "Issue a Stripe payment link for one venue rental (PAID_RENTAL deal) in the hub.",
      "",
      "TWO-STEP. The first call previews the amounts and returns a previewId — it writes nothing.",
      "Call again with that previewId and confirm: true to actually mint the link.",
      "Always show the user the preview and get their agreement before confirming.",
      "",
      "⚠ On prod this creates a LIVE-mode Stripe link (real money). The link is returned to you,",
      "never sent to the organizer automatically. A pending sale appears on /admin/sales.",
      "Refuses if the event already has an unpaid link (deactivate it first) or is already paid.",
    ].join("\n"),
    venueRentalPaymentCreateSchema.shape,
    async (args) =>
      toolResult(() => createVenueRentalPayment(args as VenueRentalPaymentCreateInput))
  );

  server.tool(
    "venue_rental_payment_deactivate",
    [
      "Deactivate the unpaid Stripe rental payment link for one venue event in the hub.",
      "",
      "TWO-STEP. The first call previews and returns a previewId — it writes nothing.",
      "Call again with that previewId and confirm: true to actually deactivate.",
      "",
      "The link stops accepting payment, the event's rental fields are cleared, and its pending",
      "sale on /admin/sales is marked failed. Refuses if the rental is already paid.",
    ].join("\n"),
    venueRentalPaymentDeactivateSchema.shape,
    async (args) =>
      toolResult(() => deactivateVenueRentalPayment(args as VenueRentalPaymentDeactivateInput))
  );

  server.tool(
    "drip_campaign_list",
    [
      "List drip campaigns (lead-nurture sequences) in the hub with their status,",
      "audience summary, step count, enrollment counts and send totals. Read-only.",
    ].join("\n"),
    dripCampaignListSchema.shape,
    async (args) => toolResult(() => listDripCampaigns(args as DripCampaignListInput))
  );

  server.tool(
    "drip_campaign_get",
    [
      "Fetch one drip campaign by id or slug: settings, audience rules, exit statuses, and the",
      "full step sequence with cumulative timing. Read-only.",
    ].join("\n"),
    dripCampaignGetSchema.shape,
    async (args) => toolResult(() => getDripCampaign(args as DripCampaignGetInput))
  );

  server.tool(
    "drip_audience_preview",
    [
      "Count how many leads currently match a set of drip audience rules, without creating or",
      "changing anything. Use this before authoring a campaign to check the segment is right.",
      "",
      "A segment with no constraints matches EVERY lead — the result says so explicitly.",
    ].join("\n"),
    dripAudiencePreviewSchema.shape,
    async (args) => toolResult(() => previewDripAudience(args as DripAudiencePreviewInput))
  );

  server.tool(
    "drip_campaign_upsert",
    [
      "Create or edit a drip campaign (lead-nurture email sequence) in the hub.",
      "Omit id and slug to create; pass one of them to patch an existing campaign.",
      "",
      "TWO-STEP. The first call previews and returns a previewId — it writes nothing.",
      "Call again with that previewId and confirm: true to actually write it.",
      "Always show the user the audience count and step timeline before confirming.",
      "",
      "CANNOT SEND MAIL. `status` is not writable here, so a campaign created or edited by this",
      "tool never starts sending on its own — activation is a deliberate human step in the admin",
      "UI at /admin/contacts/campaigns. New campaigns are always DRAFT.",
      "",
      "`steps`, `segment` and `exitOnStatuses` are FULL REPLACEMENTS, not additions — pass the",
      "complete set you want. `steps` is refused entirely on a non-DRAFT campaign, because",
      "re-ordering steps under live enrollments can skip or re-send messages.",
      "",
      "`trigger` selects how contacts enter: LEAD_SEGMENT (default nurture), COHORT_SCHEDULE,",
      "CERTIFICATE_ISSUED or BROADCAST — see the parameter description. Omit it on a patch to",
      "keep the stored trigger.",
      "",
      "delayHours on each step counts from the PREVIOUS step, not from enrollment.",
      "Every commercial CTA points at the hub's own cohorts page — use the {{cohorts_url}}",
      "token, never an external event-listing URL: the hub carries every format, the",
      "membership tier and guest checkout.",
      "Never hardcode cohort prices in campaign copy — use {{upcoming_cohorts}} or",
      "{{next_cohort}}, which render current dates and prices live from the DB.",
    ].join("\n"),
    dripCampaignUpsertSchema.shape,
    async (args) => toolResult(() => upsertDripCampaign(args as DripCampaignUpsertInput))
  );

  server.tool(
    "cohort_roster",
    "List a cohort roster with name, email, membership tier, and enrollment source. Contains PII; read-only.",
    cohortRosterSchema.shape,
    async (args) => toolResult(() => cohortRoster(args as CohortRosterInput))
  );

  server.tool(
    "broadcast_send",
    [
      "Send one drip campaign immediately to its current audience.",
      "TWO-STEP. First preview audience counts and recipients; then resend the previewId with confirm: true.",
      "This is a production blast, so verify the displayed target before confirming.",
    ].join("\n"),
    broadcastSendSchema.shape,
    async (args) => toolResult(() => broadcastSend(args as BroadcastSendInput))
  );

  server.tool(
    "certificate_notify",
    [
      "Email/SMS cohort graduates their completion certificates.",
      "TWO-STEP, dry-run-first. The first call previews the counts and returns a previewId — it sends nothing.",
      "Call again with that previewId and confirm: true to actually notify.",
    ].join("\n"),
    certificateNotifySchema.shape,
    async (args) => toolResult(() => certificateNotify(args as CertificateNotifyInput))
  );

  server.tool(
    "program_update",
    [
      "Edit an EXISTING course (Program) in the hub: name, description, cover, accessMode,",
      "status. No create — the Program must already exist (e.g. a cohort's recording-import target).",
      "",
      "TWO-STEP. The first call previews and returns a previewId — it writes nothing.",
      "Call again with that previewId and confirm: true to actually write it.",
      "Always show the user the field-by-field diff before confirming.",
      "",
      "accessMode: cohort | direct | auth | public | member. 'member' grants access to any user",
      "with an active Membership (either tier) — checkProgramAccess() already implements this.",
      "",
      "PUBLISH GUARDRAIL: status:\"open\" is the only status that makes a course reachable by",
      "students. It is REFUSED unless publish:true is also passed in the same call. Never set",
      "status:\"open\" unless the human explicitly asked to publish in this conversation — leave",
      "new/edited courses at status:\"draft\" otherwise.",
    ].join("\n"),
    programUpdateSchema.shape,
    async (args) => toolResult(() => updateProgram(args as ProgramUpdateInput))
  );

  server.tool(
    "program_cover_generate",
    [
      "Generate a course cover image via the hub's own gpt-image-1.5 pipeline — same model,",
      "size, and GCS destination as the admin UI's 'Generate Cover' button, so results are",
      "visually consistent with every existing course cover on the site.",
      "",
      "ONE STEP — costs real money per call (a live OpenAI image request), but does not write",
      "to the database. Returns a GCS URL only. Review the image, then attach it with",
      "program_update's cover field. Never call this more than needed for one course's cover.",
    ].join("\n"),
    programCoverGenerateSchema.shape,
    async (args) => toolResult(() => generateProgramCover(args as ProgramCoverGenerateInput))
  );

  server.tool(
    "media_upload",
    [
      "Upload a local file into the hub's media library — GCS object + Media row, the same",
      "destination as the admin UI's upload button, so it appears in /media like any other file.",
      "",
      "Pass public: true for images that guest-facing marketing/landing pages need — the file is",
      "stored under a previews/ key that /api/media serves without authentication. Default is",
      "auth-only. Keys are media/{namespace}/{slug}[/previews]/{filename}; collisions get -2, -3.",
    ].join("\n"),
    mediaUploadSchema.shape,
    async (args) => toolResult(() => uploadMedia(args as MediaUploadInput))
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error(
    `[hub-mcp] ready · target ${config.envLabel} ${config.hubBaseUrl}` +
      (config.readOnly ? " · READONLY" : "")
  );
}

main().catch((err) => {
  console.error(`[hub-mcp] fatal: ${(err as Error).message}`);
  process.exit(1);
});
