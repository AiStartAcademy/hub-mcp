import { describe, expect, test } from "bun:test";
import type { Config } from "../src/config.js";
import { HubError, type HubClient } from "../src/hub-client.js";
import { PreviewStore } from "../src/preview-store.js";
import {
  makeVenueAgreementCreateHandler,
  type VenueAgreementCreateInput,
} from "../src/tools/venue-agreement-create.js";
import { makeVenueEventCreateHandler, type VenueEventCreateInput } from "../src/tools/venue-event-create.js";
import {
  makeVenueEventSetStatusHandler,
  type VenueEventSetStatusInput,
} from "../src/tools/venue-event-set-status.js";
import { makeVenueEventUpdateHandler, type VenueEventUpdateInput } from "../src/tools/venue-event-update.js";

const config: Config = {
  hubBaseUrl: "http://localhost:3000",
  hubToken: "test",
  readOnly: false,
  envLabel: "LOCAL",
  defaultTimezone: "America/Los_Angeles",
};

function venueEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: "ve_1",
    slug: "founders-night",
    title: "Founders Night",
    description: "Original description",
    type: "MEETUP",
    date: "2026-09-10T00:00:00.000Z",
    startTime: "6:00 PM",
    endTime: "8:00 PM",
    timezone: "America/Los_Angeles",
    organizerName: "Original Organizer",
    orgName: "Example Org",
    contactEmail: "organizer@example.com",
    contactPhone: "555-0100",
    expectedAttendees: 80,
    capacity: 120,
    status: "PENDING",
    dealType: "PAID_RENTAL",
    dealNote: "Original deal note",
    adminNote: "Original admin note",
    quoteAmountCents: 150000,
    quoteNote: "Original quote note",
    cover: "https://example.com/cover.png",
    externalRegistrationUrl: "https://example.com/register",
    ticketPriceCents: 2500,
    ticketPaymentLink: "https://example.com/pay",
    isOnline: false,
    ...overrides,
  };
}

function extractPreviewId(text: string): string {
  const previewId = text.match(/previewId: (pv_\w+)/)?.[1];
  expect(previewId).toBeTruthy();
  return previewId as string;
}

function createVenueInput(overrides: Partial<VenueEventCreateInput> = {}): VenueEventCreateInput {
  return {
    title: "Founders Night",
    type: "MEETUP",
    date: "2026-09-10",
    startTime: "6:00 PM",
    endTime: "8:00 PM",
    organizerName: "Original Organizer",
    contactEmail: "organizer@example.com",
    dryRun: true,
    ...overrides,
  };
}

function updateVenueInput(overrides: Partial<VenueEventUpdateInput> = {}): VenueEventUpdateInput {
  return {
    id: "ve_1",
    title: "Updated Founders Night",
    dryRun: true,
    ...overrides,
  };
}

function setStatusInput(overrides: Partial<VenueEventSetStatusInput> = {}): VenueEventSetStatusInput {
  return {
    id: "ve_1",
    status: "APPROVED",
    dryRun: true,
    ...overrides,
  };
}

function agreementInput(overrides: Partial<VenueAgreementCreateInput> = {}): VenueAgreementCreateInput {
  return {
    venueEventId: "ve_1",
    dryRun: true,
    ...overrides,
  };
}

function fakeHub(options: {
  currentEvent?: ReturnType<typeof venueEvent>;
  createVenueEventImpl?: (payload: unknown) => Promise<unknown>;
  updateVenueEventImpl?: (payload: unknown) => Promise<unknown>;
  createVenueAgreementImpl?: (payload: unknown) => Promise<unknown>;
} = {}) {
  const calls: string[] = [];
  const createVenueEventPayloads: unknown[] = [];
  const updateVenueEventPayloads: unknown[] = [];
  const createVenueAgreementPayloads: unknown[] = [];
  const currentEvent = options.currentEvent ?? venueEvent();

  return {
    calls,
    createVenueEventPayloads,
    updateVenueEventPayloads,
    createVenueAgreementPayloads,
    hub: {
      getVenueEvent: async () => currentEvent,
      createVenueEvent: async (payload: unknown) => {
        calls.push("createVenueEvent");
        createVenueEventPayloads.push(payload);
        if (options.createVenueEventImpl) {
          return options.createVenueEventImpl(payload);
        }
        return {
          title: "Founders Night",
          status: "APPROVED",
          dealType: "PAID_RENTAL",
          date: "2026-09-10T00:00:00.000Z",
          startTime: "6:00 PM",
          endTime: "8:00 PM",
          slug: "founders-night",
        };
      },
      updateVenueEvent: async (payload: unknown) => {
        calls.push("updateVenueEvent");
        updateVenueEventPayloads.push(payload);
        if (options.updateVenueEventImpl) {
          return options.updateVenueEventImpl(payload);
        }
        return {
          event: {
            ...currentEvent,
            ...(payload as Record<string, unknown>),
            status: (payload as { status?: string }).status ?? currentEvent.status,
            title: (payload as { title?: string }).title ?? currentEvent.title,
            date: (payload as { date?: string }).date ?? currentEvent.date,
            startTime: (payload as { startTime?: string }).startTime ?? currentEvent.startTime,
            endTime: (payload as { endTime?: string }).endTime ?? currentEvent.endTime,
          },
          syncResult: null,
        };
      },
      createVenueAgreement: async (payload: unknown) => {
        calls.push("createVenueAgreement");
        createVenueAgreementPayloads.push(payload);
        if (options.createVenueAgreementImpl) {
          return options.createVenueAgreementImpl(payload);
        }
        return {
          id: "agreement_1",
          token: "token_1",
          status: "SENT",
          templateKey: "paid-rental",
          signingUrl: "https://sign.example.com/agreement_1",
        };
      },
    } as unknown as HubClient,
  };
}

describe("venue write tool previews and commits", () => {
  test("a dry run writes nothing and returns a previewId", async () => {
    const { hub, calls } = fakeHub();
    const handler = makeVenueEventCreateHandler(
      hub,
      config,
      new PreviewStore<Omit<VenueEventCreateInput, "dryRun" | "previewId" | "confirm">>()
    );

    const text = await handler(createVenueInput());

    expect(text).toContain("PREVIEW · target: LOCAL");
    expect(text).toContain("previewId: pv_");
    expect(calls).toEqual([]);
  });

  test("preview text names the venue event side effects and update field changes", async () => {
    const createHandler = makeVenueEventCreateHandler(
      fakeHub().hub,
      config,
      new PreviewStore<Omit<VenueEventCreateInput, "dryRun" | "previewId" | "confirm">>()
    );
    const createPreview = await createHandler(createVenueInput());
    expect(createPreview).toContain("status defaults to APPROVED");
    expect(createPreview).toContain("Google Calendar");
    expect(createPreview).toContain("emails a confirmation + calendar invite");

    const updateHandler = makeVenueEventUpdateHandler(
      fakeHub({ currentEvent: venueEvent({ title: "Old Title", capacity: 40 }) }).hub,
      config,
      new PreviewStore<Omit<VenueEventUpdateInput, "dryRun" | "previewId" | "confirm">>()
    );
    const updatePreview = await updateHandler(updateVenueInput({ title: "New Title", capacity: 60 }));
    expect(updatePreview).toContain('title: Old Title → New Title');
    expect(updatePreview).toContain("capacity: 40 → 60");
  });

  test("uses the configured default timezone in the preview and committed payload", async () => {
    const { hub, createVenueEventPayloads } = fakeHub();
    const configured = { ...config, defaultTimezone: "Europe/Berlin" };
    const previews = new PreviewStore<
      Omit<VenueEventCreateInput, "dryRun" | "previewId" | "confirm">
    >();
    const handler = makeVenueEventCreateHandler(hub, configured, previews);

    const preview = await handler(createVenueInput());
    expect(preview).toContain("6:00 PM to 8:00 PM · Europe/Berlin");
    expect(preview).toContain("timezone defaults to Europe/Berlin");

    await handler(createVenueInput({
      previewId: extractPreviewId(preview),
      confirm: true,
      dryRun: undefined,
    }));
    expect(createVenueEventPayloads).toEqual([
      expect.objectContaining({ timezone: "Europe/Berlin" }),
    ]);
  });

  test("confirm without a previewId is refused for all four write tools", async () => {
    const { hub, calls } = fakeHub();
    const cases = [
      makeVenueEventCreateHandler(
        hub,
        config,
        new PreviewStore<Omit<VenueEventCreateInput, "dryRun" | "previewId" | "confirm">>()
      )(createVenueInput({ confirm: true, dryRun: undefined })),
      makeVenueAgreementCreateHandler(
        hub,
        config,
        new PreviewStore<Omit<VenueAgreementCreateInput, "dryRun" | "previewId" | "confirm">>()
      )(agreementInput({ confirm: true, dryRun: undefined })),
      makeVenueEventUpdateHandler(
        hub,
        config,
        new PreviewStore<Omit<VenueEventUpdateInput, "dryRun" | "previewId" | "confirm">>()
      )(updateVenueInput({ confirm: true, dryRun: undefined })),
      makeVenueEventSetStatusHandler(
        hub,
        config,
        new PreviewStore<Omit<VenueEventSetStatusInput, "dryRun" | "previewId" | "confirm">>()
      )(setStatusInput({ confirm: true, dryRun: undefined })),
    ];

    const results = await Promise.all(cases);

    expect(results[0]).toContain("Refused: confirm requires the previewId");
    expect(results[1]).toContain("Refused: confirm requires the previewId");
    expect(results[2]).toContain("Refused: confirm requires the previewId");
    expect(results[3]).toContain("Refused: confirm requires the previewId");
    expect(calls).toEqual([]);
  });

  test("confirm with an unknown previewId is refused for all four write tools", async () => {
    const { hub, calls } = fakeHub();
    const cases = [
      makeVenueEventCreateHandler(
        hub,
        config,
        new PreviewStore<Omit<VenueEventCreateInput, "dryRun" | "previewId" | "confirm">>()
      )(createVenueInput({ previewId: "pv_missing", confirm: true, dryRun: undefined })),
      makeVenueAgreementCreateHandler(
        hub,
        config,
        new PreviewStore<Omit<VenueAgreementCreateInput, "dryRun" | "previewId" | "confirm">>()
      )(agreementInput({ previewId: "pv_missing", confirm: true, dryRun: undefined })),
      makeVenueEventUpdateHandler(
        hub,
        config,
        new PreviewStore<Omit<VenueEventUpdateInput, "dryRun" | "previewId" | "confirm">>()
      )(updateVenueInput({ previewId: "pv_missing", confirm: true, dryRun: undefined })),
      makeVenueEventSetStatusHandler(
        hub,
        config,
        new PreviewStore<Omit<VenueEventSetStatusInput, "dryRun" | "previewId" | "confirm">>()
      )(setStatusInput({ previewId: "pv_missing", confirm: true, dryRun: undefined })),
    ];

    const results = await Promise.all(cases);

    expect(results[0]).toContain("unknown, already used, or expired");
    expect(results[1]).toContain("unknown, already used, or expired");
    expect(results[2]).toContain("unknown, already used, or expired");
    expect(results[3]).toContain("unknown, already used, or expired");
    expect(calls).toEqual([]);
  });

  test("previewId is single-use", async () => {
    const { hub, calls } = fakeHub();
    const previews = new PreviewStore<Omit<VenueEventCreateInput, "dryRun" | "previewId" | "confirm">>();
    const handler = makeVenueEventCreateHandler(hub, config, previews);

    const preview = await handler(createVenueInput({ title: "Nurture Meetup" }));
    const previewId = extractPreviewId(preview);

    const committed = await handler(createVenueInput({ previewId, confirm: true, dryRun: undefined }));
    expect(committed).toContain("COMMITTED");
    expect(calls).toEqual(["createVenueEvent"]);

    const replay = await handler(createVenueInput({ previewId, confirm: true, dryRun: undefined }));
    expect(replay).toContain("unknown, already used, or expired");
    expect(calls).toEqual(["createVenueEvent"]);
  });

  test("readOnly blocks the commit path of all four write tools", async () => {
    const { hub, calls } = fakeHub();

    const createPreviews = new PreviewStore<Omit<VenueEventCreateInput, "dryRun" | "previewId" | "confirm">>();
    const agreementPreviews = new PreviewStore<Omit<VenueAgreementCreateInput, "dryRun" | "previewId" | "confirm">>();
    const updatePreviews = new PreviewStore<Omit<VenueEventUpdateInput, "dryRun" | "previewId" | "confirm">>();
    const setStatusPreviews = new PreviewStore<Omit<VenueEventSetStatusInput, "dryRun" | "previewId" | "confirm">>();

    const createPreviewId = extractPreviewId(
      await makeVenueEventCreateHandler(hub, config, createPreviews)(createVenueInput())
    );
    const agreementPreviewId = extractPreviewId(
      await makeVenueAgreementCreateHandler(hub, config, agreementPreviews)(agreementInput())
    );
    const updatePreviewId = extractPreviewId(
      await makeVenueEventUpdateHandler(hub, config, updatePreviews)(updateVenueInput())
    );
    const setStatusPreviewId = extractPreviewId(
      await makeVenueEventSetStatusHandler(hub, config, setStatusPreviews)(setStatusInput())
    );

    calls.length = 0;
    const readOnlyConfig = { ...config, readOnly: true };

    const results = await Promise.all([
      makeVenueEventCreateHandler(hub, readOnlyConfig, createPreviews)(
        createVenueInput({ previewId: createPreviewId, confirm: true, dryRun: undefined })
      ),
      makeVenueAgreementCreateHandler(hub, readOnlyConfig, agreementPreviews)(
        agreementInput({ previewId: agreementPreviewId, confirm: true, dryRun: undefined })
      ),
      makeVenueEventUpdateHandler(hub, readOnlyConfig, updatePreviews)(
        updateVenueInput({ previewId: updatePreviewId, confirm: true, dryRun: undefined })
      ),
      makeVenueEventSetStatusHandler(hub, readOnlyConfig, setStatusPreviews)(
        setStatusInput({ previewId: setStatusPreviewId, confirm: true, dryRun: undefined })
      ),
    ]);

    expect(results[0]).toContain("HUB_MCP_READONLY=true");
    expect(results[1]).toContain("HUB_MCP_READONLY=true");
    expect(results[2]).toContain("HUB_MCP_READONLY=true");
    expect(results[3]).toContain("HUB_MCP_READONLY=true");
    expect(calls).toEqual([]);
  });

  test("commit uses the stored preview payload, not resent arguments", async () => {
    const { hub, createVenueEventPayloads } = fakeHub();
    const previews = new PreviewStore<Omit<VenueEventCreateInput, "dryRun" | "previewId" | "confirm">>();
    const handler = makeVenueEventCreateHandler(hub, config, previews);

    const preview = await handler(
      createVenueInput({
        title: "Original Title",
        date: "2026-10-01",
        organizerName: "Original Organizer",
        contactEmail: "original@example.com",
      })
    );
    const previewId = extractPreviewId(preview);

    await handler(
      createVenueInput({
        title: "Different Title",
        date: "2026-12-31",
        organizerName: "Different Organizer",
        contactEmail: "different@example.com",
        previewId,
        confirm: true,
        dryRun: undefined,
      })
    );

    expect(createVenueEventPayloads).toEqual([
      {
        title: "Original Title",
        type: "MEETUP",
        date: "2026-10-01",
        startTime: "6:00 PM",
        endTime: "8:00 PM",
        organizerName: "Original Organizer",
        contactEmail: "original@example.com",
        timezone: "America/Los_Angeles",
      },
    ]);
  });

  test("a HubError with status 0 restores the preview for a second commit attempt", async () => {
    let attempts = 0;
    const { hub, calls } = fakeHub({
      createVenueEventImpl: async () => {
        attempts += 1;
        if (attempts === 1) {
          throw new HubError("network down", 0);
        }
        return {
          title: "Recovered Event",
          status: "APPROVED",
          dealType: "PAID_RENTAL",
          date: "2026-09-10T00:00:00.000Z",
          startTime: "6:00 PM",
          endTime: "8:00 PM",
          slug: "recovered-event",
        };
      },
    });
    const previews = new PreviewStore<Omit<VenueEventCreateInput, "dryRun" | "previewId" | "confirm">>();
    const handler = makeVenueEventCreateHandler(hub, config, previews);
    const previewId = extractPreviewId(await handler(createVenueInput()));

    try {
      await handler(createVenueInput({ previewId, confirm: true, dryRun: undefined }));
      expect("expected HubError").toBe("received success");
    } catch (err) {
      expect(err).toBeInstanceOf(HubError);
      expect((err as HubError).status).toBe(0);
    }

    const committed = await handler(createVenueInput({ previewId, confirm: true, dryRun: undefined }));
    expect(committed).toContain("COMMITTED");
    expect(calls).toEqual(["createVenueEvent", "createVenueEvent"]);
  });

  test("a HubError with non-zero status does not restore the preview", async () => {
    const { hub, calls } = fakeHub({
      createVenueEventImpl: async () => {
        throw new HubError("conflict", 409, { code: "CONFLICT" });
      },
    });
    const previews = new PreviewStore<Omit<VenueEventCreateInput, "dryRun" | "previewId" | "confirm">>();
    const handler = makeVenueEventCreateHandler(hub, config, previews);
    const previewId = extractPreviewId(await handler(createVenueInput()));

    try {
      await handler(createVenueInput({ previewId, confirm: true, dryRun: undefined }));
      expect("expected HubError").toBe("received success");
    } catch (err) {
      expect(err).toBeInstanceOf(HubError);
      expect((err as HubError).status).toBe(409);
    }

    const replay = await handler(createVenueInput({ previewId, confirm: true, dryRun: undefined }));
    expect(replay).toContain("unknown, already used, or expired");
    expect(calls).toEqual(["createVenueEvent"]);
  });

  test("venue_agreement_create surfaces a recoverable 502 as committed with a warning", async () => {
    const { hub, calls } = fakeHub({
      createVenueAgreementImpl: async () => {
        throw new HubError("bad gateway", 502, {
          id: "agreement_502",
          token: "token_502",
          status: "SENT",
          templateKey: "paid-rental",
          signingUrl: "https://sign.example.com/agreement_502",
        });
      },
    });
    const previews = new PreviewStore<Omit<VenueAgreementCreateInput, "dryRun" | "previewId" | "confirm">>();
    const handler = makeVenueAgreementCreateHandler(hub, config, previews);
    const previewId = extractPreviewId(await handler(agreementInput({ send: true })));

    const committed = await handler(
      agreementInput({ previewId, confirm: true, dryRun: undefined, send: false })
    );

    expect(committed).toContain("COMMITTED");
    expect(committed).toContain("Agreement was created, but the signer email did NOT send");
    expect(committed).toContain("Signing URL: https://sign.example.com/agreement_502");
    expect(committed).toContain("re-send it manually");
    expect(calls).toEqual(["createVenueAgreement"]);
  });

  test("venue_agreement_create rethrows a 502 whose body does not match the agreement shape", async () => {
    const { hub, calls } = fakeHub({
      createVenueAgreementImpl: async () => {
        throw new HubError("bad gateway", 502, { invalid: true });
      },
    });
    const previews = new PreviewStore<Omit<VenueAgreementCreateInput, "dryRun" | "previewId" | "confirm">>();
    const handler = makeVenueAgreementCreateHandler(hub, config, previews);
    const previewId = extractPreviewId(await handler(agreementInput({ send: true })));

    try {
      await handler(agreementInput({ previewId, confirm: true, dryRun: undefined }));
      expect("expected HubError").toBe("received success");
    } catch (err) {
      expect(err).toBeInstanceOf(HubError);
      expect((err as HubError).status).toBe(502);
    }

    expect(calls).toEqual(["createVenueAgreement"]);
  });
});
