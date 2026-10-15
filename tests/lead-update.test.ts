import { describe, expect, it } from "bun:test";
import type { Config } from "../src/config.js";
import { HubError, type HubClient, type LeadUpdatePayload } from "../src/hub-client.js";
import { PreviewStore } from "../src/preview-store.js";
import {
  buildLeadUpdatePayload,
  leadUpdateSchema,
  makeLeadUpdateHandler,
} from "../src/tools/lead-update.js";

const writable: Config = {
  hubBaseUrl: "https://hub.example.test",
  hubToken: "test",
  readOnly: false,
  envLabel: "TEST",
  defaultTimezone: "America/Los_Angeles",
};

describe("lead_update validation and payload building", () => {
  it("SC-5: refuses WON case- and whitespace-insensitively before any hub call", () => {
    for (const status of ["WON", "won", " wOn "]) {
      const parsed = leadUpdateSchema.safeParse({
        updates: [{ id: "contact-1", status }],
      });
      expect(parsed.success).toBe(false);
      if (!parsed.success) {
        expect(parsed.error.issues.map((issue) => issue.message).join(" ")).toContain(
          "WON is reserved for verified purchases"
        );
      }
    }
  });

  it("SC-6: accepts a 17-record batch and builds the normalized hub payload", () => {
    const parsed = leadUpdateSchema.parse({
      updates: Array.from({ length: 17 }, (_, index) => ({
        id: ` contact-${index + 1} `,
        status: " qualified ",
        expectedCurrentStatus: " contacted ",
        excludeFromPipeline: true,
      })),
    });

    const payload = buildLeadUpdatePayload(parsed);
    expect(payload.updates).toHaveLength(17);
    expect(payload.updates[0]).toEqual({
      id: "contact-1",
      status: "QUALIFIED",
      expectedCurrentStatus: "CONTACTED",
      excludeFromPipeline: true,
    });
  });

  it("SC-6: enforces batch, id, tag, dependency, and actual-change bounds locally", () => {
    const failures = [
      { updates: [] },
      {
        updates: Array.from({ length: 51 }, (_, index) => ({
          id: `contact-${index}`,
          excludeFromPipeline: true,
        })),
      },
      { updates: [{ id: "contact-1", tags: ["partner"] }, { id: " contact-1 ", status: "LOST" }] },
      { updates: [{ id: " ", status: "LOST" }] },
      { updates: [{ id: "x".repeat(129), status: "LOST" }] },
      { updates: [{ id: "contact-1" }] },
      { updates: [{ id: "contact-1", expectedCurrentStatus: "NEW" }] },
      { updates: [{ id: "contact-1", tagMode: "replace" }] },
      { updates: [{ id: "contact-1", tags: Array.from({ length: 101 }, (_, index) => `tag-${index}`) }] },
      { updates: [{ id: "contact-1", tags: ["x".repeat(101)] }] },
      { updates: [{ id: "contact-1", excludeFromPipeline: "yes" }] },
    ];

    for (const input of failures) {
      expect(leadUpdateSchema.safeParse(input).success).toBe(false);
    }

    expect(
      leadUpdateSchema.safeParse({
        updates: Array.from({ length: 50 }, (_, index) => ({
          id: `contact-${index}`,
          excludeFromPipeline: false,
        })),
      }).success
    ).toBe(true);
  });

  it("SC-7: defaults tag writes to add, deduplicates/cleans tags, and preserves explicit modes", () => {
    const added = buildLeadUpdatePayload(
      leadUpdateSchema.parse({
        updates: [{ id: "contact-1", tags: [" partner ", "", "partner", " staff ", "  "] }],
      })
    );
    expect(added.updates[0]).toEqual({
      id: "contact-1",
      tags: ["partner", "staff"],
      tagMode: "add",
    });

    for (const tagMode of ["remove", "replace"] as const) {
      const payload = buildLeadUpdatePayload(
        leadUpdateSchema.parse({
          updates: [{ id: "contact-1", tags: [" partner "], tagMode }],
        })
      );
      expect(payload.updates[0]?.tagMode).toBe(tagMode);
    }
  });
});

describe("lead_update two-step behavior and result reporting", () => {
  it("SC-6: previews without writing and commits the stored batch instead of resent arguments", async () => {
    const calls: LeadUpdatePayload[] = [];
    const hub = {
      updateLeads: async (payload: LeadUpdatePayload) => {
        calls.push(payload);
        return {
          results: [
            { id: "contact-1", ok: true, applied: ["status", "excludeFromPipeline", "tags"] },
            {
              id: "contact-2",
              ok: false,
              reason: "conflict",
              applied: [],
              message: "Status changed concurrently; no fields were updated",
            },
          ],
          summary: { requested: 2, succeeded: 1, failed: 1 },
        };
      },
    } as unknown as HubClient;
    const handler = makeLeadUpdateHandler(
      hub,
      writable,
      new PreviewStore<LeadUpdatePayload>()
    );

    const preview = await handler({
      updates: [
        { id: "contact-1", status: "QUALIFIED", excludeFromPipeline: true, tags: ["partner"] },
        { id: "contact-2", status: "LOST", expectedCurrentStatus: "CONTACTED" },
      ],
    });
    expect(calls).toHaveLength(0);
    expect(preview).toContain("PREVIEW · target: TEST");
    expect(preview).toContain("contact-1");
    expect(preview).toContain("tags: add requested [partner]; final tags are hub-owned and not known in preview");
    const previewId = preview.match(/previewId: (\S+)/)?.[1];
    expect(previewId).toBeDefined();

    const committed = await handler({
      updates: [{ id: "resent-id", status: "LOST" }],
      previewId,
      confirm: true,
    });
    expect(calls).toEqual([
      {
        updates: [
          {
            id: "contact-1",
            status: "QUALIFIED",
            excludeFromPipeline: true,
            tags: ["partner"],
            tagMode: "add",
          },
          { id: "contact-2", status: "LOST", expectedCurrentStatus: "CONTACTED" },
        ],
      },
    ]);
    expect(committed).toContain("COMMITTED · target: TEST");
    expect(committed).toContain("SUCCEEDED contact-1");
    expect(committed).toContain("FAILED contact-2 · conflict");
    expect(committed).toContain("FAILED: 1 of 2");
    expect(committed).toContain("Status changed concurrently; no fields were updated");
  });

  it("SC-6: rejects a malformed 200 response instead of trusting it", async () => {
    const hub = {
      updateLeads: async () => ({ results: "not-an-array", summary: {} }),
    } as unknown as HubClient;
    const previews = new PreviewStore<LeadUpdatePayload>();
    const { previewId } = previews.put({
      updates: [{ id: "contact-1", excludeFromPipeline: true }],
    });
    const handler = makeLeadUpdateHandler(hub, writable, previews);

    await expect(
      handler({ updates: [{ id: "contact-1", excludeFromPipeline: true }], previewId, confirm: true })
    ).rejects.toThrow("Hub returned an invalid lead_update response");
  });

  it("SC-6: explains actionable HTTP failure layers and restores only transport failures", async () => {
    const expected = new Map([
      [0, "could not be reached"],
      [401, "HUB_MCP_TOKEN was rejected"],
      [403, "hub writes are disabled"],
      [413, "64 KiB response limit"],
      [500, "hub MCP token is not configured"],
    ]);

    for (const [status, message] of expected) {
      const hub = {
        updateLeads: async () => {
          throw new HubError("raw hub error", status);
        },
      } as unknown as HubClient;
      const previews = new PreviewStore<LeadUpdatePayload>();
      const { previewId } = previews.put({ updates: [{ id: "contact-1", status: "LOST" }] });
      const handler = makeLeadUpdateHandler(hub, writable, previews);

      await expect(
        handler({ updates: [{ id: "contact-1", status: "LOST" }], previewId, confirm: true })
      ).rejects.toThrow(message);

      const retried = await handler({
        updates: [{ id: "contact-1", status: "LOST" }],
        previewId,
        confirm: true,
      }).catch((error: Error) => error.message);
      if (status === 0) {
        expect(retried).toContain("could not be reached");
      } else {
        expect(retried).toContain("Refused: Preview");
      }
    }
  });
});
