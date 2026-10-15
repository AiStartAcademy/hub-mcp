import { describe, expect, test } from "bun:test";
import type { Config } from "../src/config.js";
import type { HubClient, DripCampaignDetailItem } from "../src/hub-client.js";
import { PreviewStore } from "../src/preview-store.js";
import {
  makeDripCampaignUpsertHandler,
  type DripCampaignUpsertInput,
  type DripUpsertPayload,
} from "../src/tools/drip-campaign-upsert.js";
import { isUnboundedSegment, renderStepTimeline } from "../src/tools/drip-shared.js";

const config: Config = {
  hubBaseUrl: "http://localhost:3000",
  hubToken: "test",
  readOnly: false,
  envLabel: "LOCAL",
  defaultTimezone: "America/Los_Angeles",
};

function campaign(overrides: Partial<DripCampaignDetailItem> = {}): DripCampaignDetailItem {
  return {
    id: "camp_1",
    slug: "test-campaign",
    name: "Test campaign",
    status: "DRAFT",
    trigger: "LEAD_SEGMENT",
    priority: 10,
    autoEnroll: false,
    timezone: "America/Los_Angeles",
    sendWindowStartHour: 8,
    sendWindowEndHour: 18,
    skipWeekends: true,
    stepCount: 2,
    enrollmentCounts: { active: 0, completed: 0, exited: 0, paused: 0 },
    sentCount: 0,
    failedCount: 0,
    segmentSummary: "status in [NEW]",
    description: null,
    segment: { statuses: ["NEW"] },
    exitOnStatuses: ["WON", "LOST"],
    steps: [
      { id: "s1", order: 1, delayHours: 0, channel: "EMAIL", subject: "One", body: "<p>1</p>" },
      { id: "s2", order: 2, delayHours: 48, channel: "EMAIL", subject: "Two", body: "<p>2</p>" },
    ],
    ...overrides,
  };
}

function fakeHub(item: DripCampaignDetailItem, calls: string[] = []) {
  return {
    calls,
    hub: {
      getDripCampaign: async () => ({ item }),
      previewDripAudience: async () => ({ count: 42 }),
      createDripCampaign: async () => {
        calls.push("create");
        return {
          id: "camp_new",
          slug: "new-campaign",
          name: "New campaign",
          status: "DRAFT",
          slugWasAdjusted: false,
          stepsCreated: 1,
          segmentMatchCount: 42,
        };
      },
      updateDripCampaign: async () => {
        calls.push("update");
        return {
          id: item.id,
          changed: { priority: { from: 10, to: 5 } },
          unchanged: [],
          stepsReplaced: null,
          isLiveEdit: item.status !== "DRAFT",
          segmentMatchCount: 42,
        };
      },
    } as unknown as HubClient,
  };
}

function run(input: Partial<DripCampaignUpsertInput>, item = campaign(), cfg = config) {
  const { hub, calls } = fakeHub(item);
  const handler = makeDripCampaignUpsertHandler(hub, cfg, new PreviewStore<DripUpsertPayload>());
  return { result: handler({ dryRun: true, ...input } as DripCampaignUpsertInput), calls };
}

describe("drip_campaign_upsert refusals", () => {
  test("refuses replacing steps on an ACTIVE campaign", async () => {
    const { result, calls } = run(
      { id: "camp_1", steps: [{ delayHours: 0, channel: "EMAIL", subject: "Hi", body: "<p>hi</p>" }] },
      campaign({ status: "ACTIVE" })
    );
    const text = await result;
    expect(text).toContain("Refused: cannot replace steps on a ACTIVE campaign");
    expect(calls).toEqual([]);
  });

  test("allows settings edits on an ACTIVE campaign but flags them as live", async () => {
    const { result } = run(
      { id: "camp_1", priority: 5 },
      campaign({ status: "ACTIVE", enrollmentCounts: { active: 7, completed: 0, exited: 0, paused: 0 } })
    );
    const text = await result;
    expect(text).toContain("⚠ LIVE");
    expect(text).toContain("7 active enrollment(s)");
  });

  test("refuses autoEnroll on a live campaign matching every lead", async () => {
    const { result, calls } = run(
      { id: "camp_1", autoEnroll: true, segment: {} },
      campaign({ status: "ACTIVE" })
    );
    const text = await result;
    expect(text).toContain("would start mailing the entire CRM");
    expect(calls).toEqual([]);
  });

  test("refuses an inverted send window supplied outright", async () => {
    const text = await run({ name: "X", sendWindowStartHour: 20, sendWindowEndHour: 9 }).result;
    expect(text).toContain("must be after sendWindowStartHour");
  });

  test("refuses a window inverted by a partial patch against stored values", async () => {
    // Only the start hour moves; it crosses the campaign's stored 18:00 end.
    const text = await run({ id: "camp_1", sendWindowStartHour: 22 }).result;
    expect(text).toContain("resulting send window 22:00-18:00 is invalid");
  });

  test("refuses creating without a name", async () => {
    const text = await run({ priority: 5 }).result;
    expect(text).toBe("Refused: creating a campaign requires a name.");
  });

  test("refuses a patch with no fields", async () => {
    const text = await run({ id: "camp_1" }).result;
    expect(text).toBe("Refused: provide at least one field to update.");
  });

  test("refuses both id and slug", async () => {
    const text = await run({ id: "camp_1", slug: "test-campaign", priority: 5 }).result;
    expect(text).toBe("Refused: provide at most one of id or slug.");
  });

  test("refuses confirm without a previewId", async () => {
    const text = await run({ id: "camp_1", priority: 5, confirm: true }).result;
    expect(text).toContain("confirm requires the previewId");
  });

  test("refuses confirm when the server is read-only", async () => {
    const text = await run(
      { id: "camp_1", priority: 5, confirm: true, previewId: "pv_x" },
      campaign(),
      { ...config, readOnly: true }
    ).result;
    expect(text).toContain("HUB_MCP_READONLY=true");
  });
});

describe("drip_campaign_upsert preview and commit", () => {
  test("a dry run writes nothing and warns about an unbounded segment", async () => {
    const { result, calls } = run({ name: "Everyone", segment: {} });
    const text = await result;
    expect(text).toContain("PREVIEW · target: LOCAL");
    expect(text).toContain("matches EVERY lead in the CRM");
    expect(text).toContain("Nothing was committed.");
    expect(calls).toEqual([]);
  });

  test("previewId is single-use", async () => {
    const { hub, calls } = fakeHub(campaign());
    const previews = new PreviewStore<DripUpsertPayload>();
    const handler = makeDripCampaignUpsertHandler(hub, config, previews);

    const preview = await handler({
      name: "Nurture",
      dryRun: true,
      steps: [{ delayHours: 0, channel: "EMAIL", subject: "Hi", body: "<p>hi</p>" }],
    } as DripCampaignUpsertInput);
    const previewId = preview.match(/previewId: (pv_\w+)/)?.[1];
    expect(previewId).toBeTruthy();

    const committed = await handler({
      previewId,
      confirm: true,
    } as DripCampaignUpsertInput);
    expect(committed).toContain("COMMITTED");
    expect(committed).toContain("Status is DRAFT");
    expect(calls).toEqual(["create"]);

    const replay = await handler({ previewId, confirm: true } as DripCampaignUpsertInput);
    expect(replay).toContain("unknown, already used, or expired");
    expect(calls).toEqual(["create"]);
  });

  test("a previewId without confirm does not commit", async () => {
    const { result, calls } = run({ id: "camp_1", priority: 5, previewId: "pv_x" });
    expect(await result).toContain("nothing was committed");
    expect(calls).toEqual([]);
  });
});

describe("drip segment + timeline helpers", () => {
  test("isUnboundedSegment detects segments that match everyone", () => {
    expect(isUnboundedSegment(undefined)).toBe(true);
    expect(isUnboundedSegment({})).toBe(true);
    expect(isUnboundedSegment({ statuses: [] })).toBe(true);
    expect(isUnboundedSegment({ statuses: ["NEW"] })).toBe(false);
    expect(isUnboundedSegment({ minAgeHours: 24 })).toBe(false);
  });

  test("renderStepTimeline accumulates delays into day numbers", () => {
    const lines = renderStepTimeline([
      { delayHours: 0, channel: "EMAIL", subject: "First" },
      { delayHours: 48, channel: "EMAIL", subject: "Second" },
      { delayHours: 24, channel: "TASK", subject: "Call them" },
    ]);
    expect(lines[0]).toContain("+0h (day 1) · First");
    expect(lines[1]).toContain("+48h (day 3) · Second");
    expect(lines[2]).toContain("+24h (day 4) · Call them [TASK — no mail]");
  });
});

// ---------------------------------------------------------------------------
// Trigger pass-through + SMS steps. The hub route already accepts `trigger`
// (WRITE_FIELDS) and STEP_CHANNELS includes SMS; the MCP surface lagged behind,
// so a CERTIFICATE_ISSUED or BROADCAST campaign could not be authored remotely.
// ---------------------------------------------------------------------------

import { CAMPAIGN_TRIGGERS } from "../src/tools/drip-shared.js";
import { dripCampaignUpsertSchema } from "../src/tools/drip-campaign-upsert.js";

/** A hub double that records the exact payloads it was handed. */
function recordingHub(item: DripCampaignDetailItem) {
  const payloads: unknown[] = [];
  const hub = {
    getDripCampaign: async () => ({ item }),
    previewDripAudience: async () => ({ count: 3 }),
    createDripCampaign: async (payload: unknown) => {
      payloads.push(payload);
      return {
        id: "camp_new",
        slug: "cert",
        name: "Cert",
        status: "DRAFT",
        slugWasAdjusted: false,
        stepsCreated: 1,
        segmentMatchCount: 3,
      };
    },
    updateDripCampaign: async (payload: unknown) => {
      payloads.push(payload);
      return {
        id: item.id,
        changed: { trigger: { from: "LEAD_SEGMENT", to: "CERTIFICATE_ISSUED" } },
        unchanged: [],
        stepsReplaced: null,
        isLiveEdit: false,
        segmentMatchCount: 3,
      };
    },
  } as unknown as HubClient;
  return { hub, payloads };
}

async function previewThenCommit(input: Partial<DripCampaignUpsertInput>, item = campaign()) {
  const { hub, payloads } = recordingHub(item);
  const handler = makeDripCampaignUpsertHandler(hub, config, new PreviewStore<DripUpsertPayload>());
  const preview = await handler({ dryRun: true, ...input } as DripCampaignUpsertInput);
  const previewId = /previewId: (\S+)/.exec(preview)?.[1];
  if (!previewId) throw new Error(`no previewId in preview:\n${preview}`);
  const committed = await handler({ ...input, previewId, confirm: true } as DripCampaignUpsertInput);
  return { preview, committed, payloads };
}

describe("drip_campaign_upsert trigger", () => {
  test("SC-1: the schema accepts every hub CAMPAIGN_TRIGGERS value and rejects anything else", () => {
    expect([...CAMPAIGN_TRIGGERS].sort()).toEqual(
      ["BROADCAST", "CERTIFICATE_ISSUED", "COHORT_SCHEDULE", "LEAD_SEGMENT"].sort()
    );
    for (const trigger of CAMPAIGN_TRIGGERS) {
      expect(dripCampaignUpsertSchema.safeParse({ name: "X", trigger }).success).toBe(true);
    }
    expect(dripCampaignUpsertSchema.safeParse({ name: "X", trigger: "ON_SIGNUP" }).success).toBe(false);
    // Optional: omitting it is still a valid call.
    expect(dripCampaignUpsertSchema.safeParse({ name: "X" }).success).toBe(true);
  });

  test("SC-2a: create passes trigger through to the hub and lists it in the preview", async () => {
    const { preview, payloads } = await previewThenCommit({
      name: "Certificate delivery",
      trigger: "CERTIFICATE_ISSUED",
    });
    expect(preview).toContain('trigger: "CERTIFICATE_ISSUED"');
    expect(payloads).toHaveLength(1);
    expect(payloads[0]).toMatchObject({ name: "Certificate delivery", trigger: "CERTIFICATE_ISSUED" });
  });

  test("SC-2b: patch shows a trigger diff against the stored value and passes it through", async () => {
    const { preview, payloads } = await previewThenCommit(
      { id: "camp_1", trigger: "BROADCAST" },
      campaign({ trigger: "LEAD_SEGMENT" })
    );
    expect(preview).toContain('trigger: "LEAD_SEGMENT" → "BROADCAST"');
    expect(payloads[0]).toMatchObject({ id: "camp_1", trigger: "BROADCAST" });
  });

  test("SC-2c: a patch that omits trigger never sends the key (stored trigger untouched)", async () => {
    const { payloads } = await previewThenCommit({ id: "camp_1", priority: 5 });
    expect(Object.prototype.hasOwnProperty.call(payloads[0], "trigger")).toBe(false);
  });
});

describe("drip_campaign_upsert SMS steps", () => {
  test("SC-3a: the step schema accepts channel SMS", () => {
    const parsed = dripCampaignUpsertSchema.safeParse({
      name: "X",
      steps: [{ delayHours: 0, channel: "SMS", subject: "Text", body: "Your certificate is ready." }],
    });
    expect(parsed.success).toBe(true);
  });

  test("SC-3b: the timeline tags SMS steps so the operator can tell them from mail", () => {
    const [line] = renderStepTimeline([{ delayHours: 2, channel: "SMS", subject: "Nudge" }]);
    expect(line).toContain("Nudge [SMS");
  });
});
