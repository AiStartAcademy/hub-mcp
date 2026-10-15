import { describe, expect, it } from "bun:test";
import type { Config } from "../src/config.js";
import { HubError, type HubClient } from "../src/hub-client.js";
import { PreviewStore } from "../src/preview-store.js";
import {
  makeCertificateNotifyHandler,
  type CertificateNotifyPayload,
} from "../src/tools/certificate-notify.js";

const writable: Config = {
  hubBaseUrl: "https://hub.example.test",
  hubToken: "test",
  readOnly: false,
  envLabel: "TEST",
  defaultTimezone: "America/Los_Angeles",
};

const counts = {
  ok: true,
  queued: 3,
  alreadyNotified: 2,
  revoked: 1,
  noEmail: 4,
  unsubscribed: 5,
};

describe("certificate_notify", () => {
  it("SC-1: preview returns counts and a previewId without sending", async () => {
    const calls: CertificateNotifyPayload[] = [];
    const hub = {
      notifyCertificates: async (input: CertificateNotifyPayload) => {
        calls.push(input);
        return counts;
      },
    } as unknown as HubClient;
    const handler = makeCertificateNotifyHandler(
      hub,
      writable,
      new PreviewStore<CertificateNotifyPayload>()
    );

    const output = await handler({ cohortId: "cohort-1", certificateIds: ["certificate-1"] });

    expect(calls).toEqual([
      { cohortId: "cohort-1", certificateIds: ["certificate-1"], dryRun: true },
    ]);
    expect(calls.some((call) => call.dryRun === false)).toBe(false);
    expect(output).toContain("PREVIEW · target: TEST");
    expect(output).toContain("cohort: cohort-1");
    expect(output).toContain("queued: 3");
    expect(output).toContain("already notified: 2");
    expect(output).toContain("revoked: 1");
    expect(output).toContain("no email: 4");
    expect(output).toContain("unsubscribed: 5");
    expect(output).toContain("previewId:");
    expect(output).toContain("Nothing was sent.");
  });

  it("SC-2: confirm without previewId is refused", async () => {
    const handler = makeCertificateNotifyHandler(
      {} as HubClient,
      writable,
      new PreviewStore<CertificateNotifyPayload>()
    );

    expect(await handler({ cohortId: "cohort-1", confirm: true })).toBe(
      "Refused: confirm requires the previewId from a dry run. Call again with dryRun first."
    );
  });

  it("SC-3: confirm with previewId commits and consumes the preview", async () => {
    const calls: CertificateNotifyPayload[] = [];
    const hub = {
      notifyCertificates: async (input: CertificateNotifyPayload) => {
        calls.push(input);
        return counts;
      },
    } as unknown as HubClient;
    const previews = new PreviewStore<CertificateNotifyPayload>();
    const handler = makeCertificateNotifyHandler(hub, writable, previews);
    const preview = await handler({ cohortId: "cohort-1" });
    const previewId = preview.match(/previewId: (\S+)/)?.[1];

    expect(previewId).toBeDefined();
    const committed = await handler({ cohortId: "ignored", previewId, confirm: true });
    expect(calls.at(-1)).toEqual({ cohortId: "cohort-1", certificateIds: undefined, dryRun: false });
    expect(committed).toContain("COMMITTED · target: TEST");
    expect(committed).toContain("cohort: cohort-1");
    expect(committed).toContain("queued: 3");

    const repeated = await handler({ cohortId: "cohort-1", previewId, confirm: true });
    expect(repeated).toContain("Refused: Preview");
    expect(repeated).toContain("unknown, already used, or expired");
    expect(calls).toHaveLength(2);
  });

  it("SC-4: refuses to commit when HUB_MCP_READONLY is set", async () => {
    let called = false;
    const hub = {
      notifyCertificates: async () => {
        called = true;
        return counts;
      },
    } as unknown as HubClient;
    const previews = new PreviewStore<CertificateNotifyPayload>();
    const { previewId } = previews.put({ cohortId: "cohort-1" });
    const handler = makeCertificateNotifyHandler(hub, { ...writable, readOnly: true }, previews);

    expect(await handler({ cohortId: "cohort-1", previewId, confirm: true })).toBe(
      "Refused: this MCP server is running with HUB_MCP_READONLY=true."
    );
    expect(called).toBe(false);
  });

  it("SC-5: restores the preview when the hub was never reached", async () => {
    let status = 0;
    let commitAttempts = 0;
    const hub = {
      notifyCertificates: async (input: CertificateNotifyPayload) => {
        if (input.dryRun) return counts;
        commitAttempts += 1;
        if (commitAttempts === 1 || status === 500) {
          throw new HubError(`failure-${status}`, status);
        }
        return counts;
      },
    } as unknown as HubClient;
    const previews = new PreviewStore<CertificateNotifyPayload>();
    const handler = makeCertificateNotifyHandler(hub, writable, previews);

    const networkPreview = await handler({ cohortId: "cohort-network" });
    const networkPreviewId = networkPreview.match(/previewId: (\S+)/)?.[1];
    expect(networkPreviewId).toBeDefined();
    await expect(
      handler({ cohortId: "cohort-network", previewId: networkPreviewId, confirm: true })
    ).rejects.toThrow("failure-0");
    const retry = await handler({
      cohortId: "cohort-network",
      previewId: networkPreviewId,
      confirm: true,
    });
    expect(retry).toContain("COMMITTED");

    status = 500;
    const serverPreview = await handler({ cohortId: "cohort-server" });
    const serverPreviewId = serverPreview.match(/previewId: (\S+)/)?.[1];
    expect(serverPreviewId).toBeDefined();
    await expect(
      handler({ cohortId: "cohort-server", previewId: serverPreviewId, confirm: true })
    ).rejects.toThrow("failure-500");
    const refused = await handler({
      cohortId: "cohort-server",
      previewId: serverPreviewId,
      confirm: true,
    });
    expect(refused).toContain("Refused: Preview");
    expect(refused).toContain("unknown, already used, or expired");
    expect(commitAttempts).toBe(3);
  });
});
