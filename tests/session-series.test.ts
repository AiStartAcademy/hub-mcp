import { describe, expect, it } from "bun:test";
import type { Config } from "../src/config.js";
import { HubError, type HubClient } from "../src/hub-client.js";
import { PreviewStore } from "../src/preview-store.js";
import {
  makeSessionSeriesAttachHandler,
  type SessionSeriesAttachPayload,
} from "../src/tools/session-series-attach.js";
import {
  makeSessionSeriesCreateHandler,
  type SessionSeriesCreateInput,
  type SessionSeriesCreateSpec,
} from "../src/tools/session-series-create.js";
import {
  makeSessionSeriesListHandler,
  sessionSeriesListSchema,
} from "../src/tools/session-series-list.js";
import { normalizeSeriesDays } from "../src/tools/series-shared.js";

const config: Config = {
  hubBaseUrl: "http://localhost:3000",
  hubToken: "test",
  readOnly: false,
  envLabel: "LOCAL",
  defaultTimezone: "America/Los_Angeles",
};

function extractPreviewId(text: string): string {
  const previewId = text.match(/previewId: (pv_\w+)/)?.[1];
  expect(previewId).toBeTruthy();
  return previewId as string;
}

function createInput(overrides: Partial<SessionSeriesCreateInput> = {}): SessionSeriesCreateInput {
  return {
    title: "Daily Check-in",
    days: "THU,MON",
    startTime: "11:00 AM",
    endTime: "11:30 AM",
    startDate: "2026-09-21",
    dryRun: true,
    ...overrides,
  };
}

function detailSeries() {
  return {
    id: "series_1",
    title: "Daily Check-in",
    kind: "CHECKIN",
    status: "ACTIVE",
    description: null,
    days: "MON,THU",
    startTime: "11:00 AM",
    endTime: "11:30 AM",
    timezone: "America/Los_Angeles",
    startDate: "2099-09-21T00:00:00.000Z",
    endDate: null,
    instructorId: "instructor_1",
    zoomLink: null,
    zoomMeetingId: null,
    instructor: { id: "instructor_1", name: "Ada", email: "ada@example.com" },
    cohorts: [
      { cohort: { id: "a", title: "Alpha", slug: "alpha", status: "published" } },
      { cohort: { id: "b", title: "Beta", slug: "beta", status: "published" } },
    ],
    occurrences: [
      {
        id: "occ_1",
        title: "Daily Check-in",
        date: "2099-09-21T00:00:00.000Z",
        startTime: "2099-09-21T18:00:00.000Z",
        endTime: "2099-09-21T18:30:00.000Z",
        timezone: "America/Los_Angeles",
        status: "SCHEDULED",
        recordingLink: null,
        instructorId: "instructor_1",
      },
    ],
  };
}

describe("session-series shared day normalization", () => {
  it("SC-1: parses CSV, deduplicates, and returns canonical week order", () => {
    expect(normalizeSeriesDays("THU,MON,THU")).toEqual(["MON", "THU"]);
  });

  it("SC-2: accepts arrays and canonicalizes case and long weekday names", () => {
    expect(normalizeSeriesDays(["mon", "Tuesday"])).toEqual(["MON", "TUE"]);
  });

  it("SC-3: refuses empty and whitespace-only day inputs instead of guessing", () => {
    for (const value of ["", [], "  ,  "]) {
      expect(() => normalizeSeriesDays(value)).toThrow(/days is required/i);
    }
  });

  it("SC-4: names an unrecognized weekday token", () => {
    expect(() => normalizeSeriesDays("MON,XYZ")).toThrow(/XYZ/);
  });
});

describe("session_series_create", () => {
  it("SC-5: previews human schedule details, rolling or bounded dates, and the Zoom exclusion", async () => {
    const hub = {
      createSessionSeries: async () => {
        throw new Error("dry run must not call the hub");
      },
    } as unknown as HubClient;

    const rolling = await makeSessionSeriesCreateHandler(
      hub,
      config,
      new PreviewStore<SessionSeriesCreateSpec>()
    )(createInput());
    expect(rolling).toContain("days: MON, THU");
    expect(rolling).toContain("11:00 AM–11:30 AM America/Los_Angeles");
    expect(rolling).toContain("2026-09-21 → rolling (no end date)");
    expect(rolling).toContain("NO Zoom meeting is created");
    expect(rolling).toContain("no join link until it is provisioned in the admin UI");

    const bounded = await makeSessionSeriesCreateHandler(
      hub,
      config,
      new PreviewStore<SessionSeriesCreateSpec>()
    )(createInput({ endDate: "2026-12-18" }));
    expect(bounded).toContain("2026-09-21 → 2026-12-18");
    expect(bounded).not.toContain("rolling (no end date)");
  });

  it("SC-5: refuses invalid days before storing a preview", async () => {
    const previews = new PreviewStore<SessionSeriesCreateSpec>();
    const hub = {} as unknown as HubClient;
    const handler = makeSessionSeriesCreateHandler(hub, config, previews);

    const text = await handler(createInput({ days: "MON,XYZ" }));

    expect(text).toMatch(/^Refused: .*XYZ/);
    expect(text).not.toContain("previewId:");
  });

  it("SC-6: refuses confirm true without a previewId using the standard wording", async () => {
    const handler = makeSessionSeriesCreateHandler(
      {} as unknown as HubClient,
      config,
      new PreviewStore<SessionSeriesCreateSpec>()
    );

    const text = await handler(createInput({ confirm: true, dryRun: undefined }));

    expect(text).toBe(
      "Refused: confirm requires the previewId from a dry run. Run session_series_create with dryRun first."
    );
  });

  it("SC-7: read-only mode refuses a valid commit preview without calling the hub", async () => {
    const calls: unknown[] = [];
    const hub = {
      createSessionSeries: async (payload: unknown) => {
        calls.push(payload);
        return { success: true, series: detailSeries() };
      },
    } as unknown as HubClient;
    const previews = new PreviewStore<SessionSeriesCreateSpec>();
    const previewId = extractPreviewId(
      await makeSessionSeriesCreateHandler(hub, config, previews)(createInput())
    );

    const text = await makeSessionSeriesCreateHandler(
      hub,
      { ...config, readOnly: true },
      previews
    )(createInput({ previewId, confirm: true, dryRun: undefined }));

    expect(text).toBe("Refused: this MCP server is running with HUB_MCP_READONLY=true.");
    expect(calls).toEqual([]);
  });

  it("uses the configured default timezone in the preview and committed payload", async () => {
    const calls: unknown[] = [];
    const hub = {
      createSessionSeries: async (payload: unknown) => {
        calls.push(payload);
        return { success: true, series: detailSeries() };
      },
    } as unknown as HubClient;
    const configured = { ...config, defaultTimezone: "Europe/Berlin" };
    const previews = new PreviewStore<SessionSeriesCreateSpec>();
    const handler = makeSessionSeriesCreateHandler(hub, configured, previews);

    const preview = await handler(createInput());
    expect(preview).toContain("11:00 AM–11:30 AM Europe/Berlin");

    await handler(createInput({
      previewId: extractPreviewId(preview),
      confirm: true,
      dryRun: undefined,
    }));
    expect(calls).toEqual([expect.objectContaining({ timezone: "Europe/Berlin" })]);
  });
});

describe("session_series_attach", () => {
  it("SC-8: diffs requested full-set attachments against current state and warns on detach", async () => {
    const calls: string[] = [];
    const hub = {
      getSessionSeries: async (id: string) => {
        calls.push(id);
        return { series: detailSeries() };
      },
    } as unknown as HubClient;
    const handler = makeSessionSeriesAttachHandler(
      hub,
      config,
      new PreviewStore<SessionSeriesAttachPayload>()
    );

    const text = await handler({ id: "series_1", cohortIds: ["b", "c"], dryRun: true });

    expect(calls).toEqual(["series_1"]);
    expect(text).toContain("ATTACH: c");
    expect(text).toContain("DETACH: a (Alpha)");
    expect(text).toContain("unchanged: b (Beta)");
    expect(text).toContain("detaching removes the call from those students' schedules");
  });

  it("SC-9: an empty requested full set previews detaching every current cohort", async () => {
    const hub = {
      getSessionSeries: async () => ({ series: detailSeries() }),
    } as unknown as HubClient;
    const handler = makeSessionSeriesAttachHandler(
      hub,
      config,
      new PreviewStore<SessionSeriesAttachPayload>()
    );

    const text = await handler({ id: "series_1", cohortIds: [], dryRun: true });

    expect(text).toContain("ATTACH: none");
    expect(text).toContain("DETACH: a (Alpha), b (Beta)");
    expect(text).toContain("detaching removes the call from those students' schedules");
    expect(text).not.toContain("Nothing to update");
  });
});

describe("session-series write failure handling", () => {
  it("SC-10: restores create and attach previews only after status-zero HubErrors", async () => {
    for (const mode of ["create", "attach"] as const) {
      for (const status of [0, 500]) {
        let attempts = 0;
        const hub = {
          getSessionSeries: async () => ({ series: detailSeries() }),
          createSessionSeries: async () => {
            attempts += 1;
            if (attempts === 1) throw new HubError("write failed", status);
            return { success: true, series: detailSeries() };
          },
          updateSessionSeries: async () => {
            attempts += 1;
            if (attempts === 1) throw new HubError("write failed", status);
            return {
              success: true,
              series: null,
              cohorts: [{ id: "b", title: "Beta", status: "published" }],
            };
          },
        } as unknown as HubClient;

        let previewId: string;
        let commit: () => Promise<string>;
        if (mode === "create") {
          const previews = new PreviewStore<SessionSeriesCreateSpec>();
          const handler = makeSessionSeriesCreateHandler(hub, config, previews);
          previewId = extractPreviewId(await handler(createInput()));
          commit = () => handler(createInput({ previewId, confirm: true, dryRun: undefined }));
        } else {
          const previews = new PreviewStore<SessionSeriesAttachPayload>();
          const handler = makeSessionSeriesAttachHandler(hub, config, previews);
          previewId = extractPreviewId(
            await handler({ id: "series_1", cohortIds: ["b"], dryRun: true })
          );
          commit = () => handler({
            id: "ignored-on-commit",
            cohortIds: ["ignored-on-commit"],
            previewId,
            confirm: true,
          });
        }

        await expect(commit()).rejects.toThrow("write failed");
        const second = await commit();
        if (status === 0) {
          expect(second).toContain("COMMITTED");
          expect(attempts).toBe(2);
        } else {
          expect(second).toContain("unknown, already used, or expired");
          expect(attempts).toBe(1);
        }
      }
    }
  });
});

describe("session_series_list", () => {
  it("SC-11: is read-only, has no write controls, and renders list and detail responses", async () => {
    expect(Object.keys(sessionSeriesListSchema.shape)).toEqual(["id"]);

    const calls: string[] = [];
    const listSeries = {
      ...detailSeries(),
      instructor: undefined,
      occurrences: undefined,
      cohorts: [{ cohort: { id: "a", title: "Alpha", status: "published" } }],
      _count: { occurrences: 3 },
    };
    const hub = {
      listSessionSeries: async () => {
        calls.push("list");
        return { series: [listSeries] };
      },
      getSessionSeries: async (id: string) => {
        calls.push(`detail:${id}`);
        return { series: detailSeries() };
      },
    } as unknown as HubClient;
    const handler = makeSessionSeriesListHandler(hub);

    const list = await handler({});
    expect(list).toContain("Daily Check-in · CHECKIN · ACTIVE");
    expect(list).toContain("MON, THU · 11:00 AM–11:30 AM America/Los_Angeles");
    expect(list).toContain("rolling");
    expect(list).toContain("1 cohort: Alpha");
    expect(list).toContain("3 occurrences");

    const detail = await handler({ id: "series_1" });
    expect(detail).toContain("instructor: Ada <ada@example.com>");
    expect(detail).toContain("cohorts: Alpha (a), Beta (b)");
    expect(detail).toContain("upcoming occurrences:");
    expect(detail).toContain("2099-09-21");
    expect(calls).toEqual(["list", "detail:series_1"]);
  });
});

describe("session_series_create location (A2)", () => {
  it("L-1: accepts an in-person location, shows it in the preview, and sends it on commit", async () => {
    const calls: unknown[] = [];
    const hub = {
      createSessionSeries: async (payload: unknown) => {
        calls.push(payload);
        return { success: true, series: detailSeries() };
      },
    } as unknown as HubClient;
    const previews = new PreviewStore<SessionSeriesCreateSpec>();
    const handler = makeSessionSeriesCreateHandler(hub, config, previews);

    const preview = await handler(
      createInput({ days: "THU", startTime: "6:00 PM", endTime: "7:00 PM", location: "123 Main St, Springfield" })
    );
    expect(preview).toContain("in person: 123 Main St, Springfield");
    expect(calls).toHaveLength(0);

    await handler({ title: "x", days: "THU", startTime: "x", endTime: "x", startDate: "x", previewId: extractPreviewId(preview), confirm: true });
    expect(calls[0]).toEqual(expect.objectContaining({ location: "123 Main St, Springfield" }));
  });
});
