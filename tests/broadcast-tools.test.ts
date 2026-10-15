import { describe, expect, it } from "bun:test";
import type { Config } from "../src/config.js";
import type { HubClient } from "../src/hub-client.js";
import { PreviewStore } from "../src/preview-store.js";
import {
  makeBroadcastSendHandler,
  type BroadcastSendPayload,
} from "../src/tools/broadcast-send.js";
import { makeCohortRosterHandler } from "../src/tools/cohort-roster.js";
import { isUnboundedSegment, segmentSchema } from "../src/tools/drip-shared.js";

const writable: Config = {
  hubBaseUrl: "https://hub.example.test",
  hubToken: "test",
  readOnly: false,
  envLabel: "TEST",
  defaultTimezone: "America/Los_Angeles",
};

describe("broadcast tools", () => {
  it("SC-25: broadcast_send refuses confirm without a previewId", async () => {
    const hub = {} as HubClient;
    const handler = makeBroadcastSendHandler(hub, writable, new PreviewStore<BroadcastSendPayload>());
    expect(await handler({ campaignId: "campaign-1", confirm: true })).toBe(
      "Refused: confirm requires the previewId from a dry run. Call again with dryRun first."
    );
  });

  it("SC-26: broadcast_send refuses to commit when readOnly is set", async () => {
    let sent = false;
    const hub = {
      sendBroadcast: async () => {
        sent = true;
        return { campaignId: "campaign-1", sent: 1, failed: 0 };
      },
    } as unknown as HubClient;
    const previews = new PreviewStore<BroadcastSendPayload>();
    const { previewId } = previews.put({ campaignId: "campaign-1" });
    const handler = makeBroadcastSendHandler(hub, { ...writable, readOnly: true }, previews);
    expect(await handler({ campaignId: "campaign-1", previewId, confirm: true })).toBe(
      "Refused: this MCP server is running with HUB_MCP_READONLY=true."
    );
    expect(sent).toBe(false);
  });

  it("SC-27: broadcast_send preview shows counts and the first recipients without sending", async () => {
    let sent = false;
    const recipients = Array.from({ length: 12 }, (_, index) => `person${index + 1}@example.com`);
    const hub = {
      getDripCampaign: async () => ({
        item: { id: "campaign-1", name: "Launch", segment: { cohorts: "any" } },
      }),
      previewDripAudience: async () => ({ count: 12, recipients }),
      sendBroadcast: async () => {
        sent = true;
        return { campaignId: "campaign-1", sent: 12, failed: 0 };
      },
    } as unknown as HubClient;
    const handler = makeBroadcastSendHandler(hub, writable, new PreviewStore<BroadcastSendPayload>());
    const output = await handler({ campaignId: "campaign-1" });
    expect(output).toContain("target: TEST");
    expect(output).toContain("audience total: 12");
    expect(output).toContain("person1@example.com");
    expect(output).toContain("person10@example.com");
    expect(output).not.toContain("person11@example.com");
    expect(output).toContain("previewId:");
    expect(sent).toBe(false);
  });

  it("SC-29: cohort_roster renders name, email, tier and source", async () => {
    const hub = {
      getCohortRoster: async () => ({
        cohort: { id: "cohort-1", slug: "fall", title: "Fall Cohort" },
        roster: [
          { name: "Ada Lovelace", email: "ada@example.com", tier: "ACCELERATOR", source: "stripe" },
        ],
        total: 1,
      }),
    } as unknown as HubClient;
    const output = await makeCohortRosterHandler(hub)({ id: "fall" });
    expect(output).toContain("Ada Lovelace");
    expect(output).toContain("ada@example.com");
    expect(output).toContain("ACCELERATOR");
    expect(output).toContain("stripe");
    expect(output).toContain("total: 1");
    expect(output).toContain("PII");
  });

  it("SC-30: a segment carrying only cohorts is not reported as unbounded", () => {
    const segment = segmentSchema.parse({ cohorts: "any" });
    expect(isUnboundedSegment(segment)).toBe(false);
  });
});

describe("isUnboundedSegment edge cases", () => {
  it("SC-31: includeUsers:false alone does not bound the segment", () => {
    // Regression: an earlier version treated the mere presence of a broadcast
    // key as bounding, so `{includeUsers:false}` silently suppressed the
    // "matches EVERY lead in the CRM" warning while matching every lead.
    expect(isUnboundedSegment({ includeUsers: false })).toBe(true);
  });

  it("SC-32: an empty cohorts list does not bound the segment", () => {
    expect(isUnboundedSegment({ cohorts: [] })).toBe(true);
  });

  it("SC-33: cohorts:any and a non-empty products list both bound it", () => {
    expect(isUnboundedSegment({ cohorts: "any" })).toBe(false);
    expect(isUnboundedSegment({ products: ["self-paced"] })).toBe(false);
    expect(isUnboundedSegment({ includeUsers: true })).toBe(false);
  });
});
