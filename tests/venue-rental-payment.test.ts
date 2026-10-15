import { describe, expect, test } from "bun:test";
import type { Config } from "../src/config.js";
import { HubError, type HubClient } from "../src/hub-client.js";
import { PreviewStore } from "../src/preview-store.js";
import {
  makeVenueRentalPaymentCreateHandler,
  makeVenueRentalPaymentDeactivateHandler,
  type VenueRentalPaymentCreateInput,
  type VenueRentalPaymentDeactivateInput,
} from "../src/tools/venue-rental-payment-create.js";

const config: Config = {
  hubBaseUrl: "http://localhost:3000",
  hubToken: "test",
  readOnly: false,
  envLabel: "LOCAL",
  defaultTimezone: "America/Los_Angeles",
};

type CreateSpec = Omit<VenueRentalPaymentCreateInput, "dryRun" | "previewId" | "confirm">;
type DeactivateSpec = Omit<VenueRentalPaymentDeactivateInput, "dryRun" | "previewId" | "confirm">;

function createInput(
  overrides: Partial<VenueRentalPaymentCreateInput> = {}
): VenueRentalPaymentCreateInput {
  return {
    venueEventId: "ve_1",
    feeCents: 47500,
    dryRun: true,
    ...overrides,
  };
}

function deactivateInput(
  overrides: Partial<VenueRentalPaymentDeactivateInput> = {}
): VenueRentalPaymentDeactivateInput {
  return {
    venueEventId: "ve_1",
    dryRun: true,
    ...overrides,
  };
}

function paidResult(overrides: Record<string, unknown> = {}) {
  return {
    rentalFeeCents: 47500,
    rentalDepositCents: 25000,
    rentalPaymentLinkId: "plink_1",
    rentalPaymentUrl: "https://buy.stripe.com/test_abc123",
    rentalPaymentStatus: "pending",
    ...overrides,
  };
}

function extractPreviewId(text: string): string {
  const previewId = text.match(/previewId: (pv_\w+)/)?.[1];
  expect(previewId).toBeTruthy();
  return previewId as string;
}

function fakeHub(
  options: {
    createImpl?: (payload: unknown) => Promise<unknown>;
    deactivateImpl?: (payload: unknown) => Promise<unknown>;
  } = {}
) {
  const calls: string[] = [];
  const createPayloads: unknown[] = [];
  const deactivatePayloads: unknown[] = [];

  return {
    calls,
    createPayloads,
    deactivatePayloads,
    hub: {
      createVenueRentalPayment: async (payload: unknown) => {
        calls.push("createVenueRentalPayment");
        createPayloads.push(payload);
        if (options.createImpl) {
          return options.createImpl(payload);
        }
        return paidResult();
      },
      deactivateVenueRentalPayment: async (payload: unknown) => {
        calls.push("deactivateVenueRentalPayment");
        deactivatePayloads.push(payload);
        if (options.deactivateImpl) {
          return options.deactivateImpl(payload);
        }
        return paidResult({
          rentalFeeCents: null,
          rentalDepositCents: null,
          rentalPaymentLinkId: null,
          rentalPaymentUrl: null,
          rentalPaymentStatus: null,
        });
      },
    } as unknown as HubClient,
  };
}

describe("venue_rental_payment_create / venue_rental_payment_deactivate", () => {
  test("a dry run writes nothing and returns a previewId", async () => {
    const { hub, calls } = fakeHub();
    const previews = new PreviewStore<CreateSpec>();
    const handler = makeVenueRentalPaymentCreateHandler(hub, config, previews);

    const preview = await handler(createInput());

    expect(preview).toContain("PREVIEW");
    expect(preview).toContain("$475.00");
    expect(preview).toContain("LIVE-mode Stripe link");
    expect(calls).toEqual([]);
    extractPreviewId(preview);
  });

  test("preview names the deposit and the checkout total", async () => {
    const { hub } = fakeHub();
    const previews = new PreviewStore<CreateSpec>();
    const handler = makeVenueRentalPaymentCreateHandler(hub, config, previews);

    const preview = await handler(createInput({ depositCents: 25000 }));

    expect(preview).toContain("rental fee: $475.00");
    expect(preview).toContain("refundable deposit: $250.00");
    expect(preview).toContain("total charged at checkout: $725.00");
    expect(preview).toContain("NOT sent to the organizer automatically");
  });

  test("preview without a deposit says so explicitly", async () => {
    const { hub } = fakeHub();
    const previews = new PreviewStore<CreateSpec>();
    const handler = makeVenueRentalPaymentCreateHandler(hub, config, previews);

    const preview = await handler(createInput());

    expect(preview).toContain("no security deposit");
    expect(preview).toContain("total charged at checkout: $475.00");
  });

  test("confirm without a previewId is refused for both tools", async () => {
    const { hub, calls } = fakeHub();
    const createPreviews = new PreviewStore<CreateSpec>();
    const deactivatePreviews = new PreviewStore<DeactivateSpec>();

    const createResult = await makeVenueRentalPaymentCreateHandler(hub, config, createPreviews)(
      createInput({ confirm: true, dryRun: undefined })
    );
    const deactivateResult = await makeVenueRentalPaymentDeactivateHandler(
      hub,
      config,
      deactivatePreviews
    )(deactivateInput({ confirm: true, dryRun: undefined }));

    expect(createResult).toContain("Refused: confirm requires the previewId");
    expect(deactivateResult).toContain("Refused: confirm requires the previewId");
    expect(calls).toEqual([]);
  });

  test("readOnly blocks the commit path of both tools", async () => {
    const { hub, calls } = fakeHub();
    const createPreviews = new PreviewStore<CreateSpec>();
    const deactivatePreviews = new PreviewStore<DeactivateSpec>();

    const createPreviewId = extractPreviewId(
      await makeVenueRentalPaymentCreateHandler(hub, config, createPreviews)(createInput())
    );
    const deactivatePreviewId = extractPreviewId(
      await makeVenueRentalPaymentDeactivateHandler(hub, config, deactivatePreviews)(
        deactivateInput()
      )
    );

    calls.length = 0;
    const readOnlyConfig = { ...config, readOnly: true };

    const results = await Promise.all([
      makeVenueRentalPaymentCreateHandler(hub, readOnlyConfig, createPreviews)(
        createInput({ previewId: createPreviewId, confirm: true, dryRun: undefined })
      ),
      makeVenueRentalPaymentDeactivateHandler(hub, readOnlyConfig, deactivatePreviews)(
        deactivateInput({ previewId: deactivatePreviewId, confirm: true, dryRun: undefined })
      ),
    ]);

    expect(results[0]).toContain("HUB_MCP_READONLY=true");
    expect(results[1]).toContain("HUB_MCP_READONLY=true");
    expect(calls).toEqual([]);
  });

  test("commit uses the stored preview payload, not resent arguments", async () => {
    const { hub, createPayloads } = fakeHub();
    const previews = new PreviewStore<CreateSpec>();
    const handler = makeVenueRentalPaymentCreateHandler(hub, config, previews);

    const preview = await handler(createInput({ feeCents: 47500, depositCents: 25000 }));
    const previewId = extractPreviewId(preview);

    await handler(
      createInput({
        feeCents: 99999,
        depositCents: 1,
        previewId,
        confirm: true,
        dryRun: undefined,
      })
    );

    expect(createPayloads).toEqual([{ venueEventId: "ve_1", feeCents: 47500, depositCents: 25000 }]);
  });

  test("commit renders the payment URL, amounts, and hand-off instruction", async () => {
    const { hub } = fakeHub();
    const previews = new PreviewStore<CreateSpec>();
    const handler = makeVenueRentalPaymentCreateHandler(hub, config, previews);
    const previewId = extractPreviewId(await handler(createInput({ depositCents: 25000 })));

    const committed = await handler(createInput({ previewId, confirm: true, dryRun: undefined }));

    expect(committed).toContain("COMMITTED");
    expect(committed).toContain("Rental payment link created.");
    expect(committed).toContain("Status: pending");
    expect(committed).toContain("Fee: $475.00");
    expect(committed).toContain("Deposit: $250.00");
    expect(committed).toContain("Payment URL: https://buy.stripe.com/test_abc123");
    expect(committed).toContain("Hand the URL to the venue operator");
  });

  test("deactivate commit reflects the cleared fields", async () => {
    const { hub } = fakeHub();
    const previews = new PreviewStore<DeactivateSpec>();
    const handler = makeVenueRentalPaymentDeactivateHandler(hub, config, previews);
    const previewId = extractPreviewId(await handler(deactivateInput()));

    const committed = await handler(deactivateInput({ previewId, confirm: true, dryRun: undefined }));

    expect(committed).toContain("COMMITTED");
    expect(committed).toContain("Rental payment link deactivated.");
    expect(committed).toContain("Status: none");
    expect(committed).not.toContain("Payment URL:");
    expect(committed).not.toContain("Hand the URL to the venue operator");
  });

  test("a HubError with status 0 restores the preview for a second commit attempt", async () => {
    let attempts = 0;
    const { hub, calls } = fakeHub({
      createImpl: async () => {
        attempts += 1;
        if (attempts === 1) {
          throw new HubError("network down", 0);
        }
        return paidResult();
      },
    });
    const previews = new PreviewStore<CreateSpec>();
    const handler = makeVenueRentalPaymentCreateHandler(hub, config, previews);
    const previewId = extractPreviewId(await handler(createInput()));

    try {
      await handler(createInput({ previewId, confirm: true, dryRun: undefined }));
      expect("expected HubError").toBe("received success");
    } catch (err) {
      expect(err).toBeInstanceOf(HubError);
      expect((err as HubError).status).toBe(0);
    }

    const committed = await handler(createInput({ previewId, confirm: true, dryRun: undefined }));
    expect(committed).toContain("COMMITTED");
    expect(calls).toEqual(["createVenueRentalPayment", "createVenueRentalPayment"]);
  });

  test("a 409 duplicate is rewritten to point at deactivate, and does not restore the preview", async () => {
    const { hub, calls } = fakeHub({
      createImpl: async () => {
        throw new HubError(
          "An unpaid rental payment link already exists. Deactivate it with DELETE before issuing a new one.",
          409
        );
      },
    });
    const previews = new PreviewStore<CreateSpec>();
    const handler = makeVenueRentalPaymentCreateHandler(hub, config, previews);
    const previewId = extractPreviewId(await handler(createInput()));

    try {
      await handler(createInput({ previewId, confirm: true, dryRun: undefined }));
      expect("expected HubError").toBe("received success");
    } catch (err) {
      expect(err).toBeInstanceOf(HubError);
      expect((err as HubError).status).toBe(409);
      expect((err as HubError).message).toContain("venue_rental_payment_deactivate first");
    }

    const replay = await handler(createInput({ previewId, confirm: true, dryRun: undefined }));
    expect(replay).toContain("unknown, already used, or expired");
    expect(calls).toEqual(["createVenueRentalPayment"]);
  });

  test("a 400 dealType error passes through verbatim, and 503 explains Stripe is unconfigured", async () => {
    const { hub: hub400 } = fakeHub({
      createImpl: async () => {
        throw new HubError("Venue rental payments only apply to PAID_RENTAL deals.", 400);
      },
    });
    const previews400 = new PreviewStore<CreateSpec>();
    const handler400 = makeVenueRentalPaymentCreateHandler(hub400, config, previews400);
    const previewId400 = extractPreviewId(await handler400(createInput()));

    try {
      await handler400(createInput({ previewId: previewId400, confirm: true, dryRun: undefined }));
      expect("expected HubError").toBe("received success");
    } catch (err) {
      expect((err as HubError).message).toBe(
        "Venue rental payments only apply to PAID_RENTAL deals."
      );
    }

    const { hub: hub503 } = fakeHub({
      createImpl: async () => {
        throw new HubError("Stripe not configured", 503);
      },
    });
    const previews503 = new PreviewStore<CreateSpec>();
    const handler503 = makeVenueRentalPaymentCreateHandler(hub503, config, previews503);
    const previewId503 = extractPreviewId(await handler503(createInput()));

    try {
      await handler503(createInput({ previewId: previewId503, confirm: true, dryRun: undefined }));
      expect("expected HubError").toBe("received success");
    } catch (err) {
      expect((err as HubError).message).toContain("Set STRIPE_SECRET_KEY there, then retry.");
    }
  });

  test("deactivate 404 and 409 are rewritten to operator guidance", async () => {
    const { hub } = fakeHub({
      deactivateImpl: async () => {
        throw new HubError("Rental payment already paid.", 409);
      },
    });
    const previews = new PreviewStore<DeactivateSpec>();
    const handler = makeVenueRentalPaymentDeactivateHandler(hub, config, previews);
    const previewId = extractPreviewId(await handler(deactivateInput()));

    try {
      await handler(deactivateInput({ previewId, confirm: true, dryRun: undefined }));
      expect("expected HubError").toBe("received success");
    } catch (err) {
      expect((err as HubError).message).toContain("refund it in Stripe instead");
    }

    const { hub: hub404 } = fakeHub({
      deactivateImpl: async () => {
        throw new HubError("Not found", 404);
      },
    });
    const previews404 = new PreviewStore<DeactivateSpec>();
    const handler404 = makeVenueRentalPaymentDeactivateHandler(hub404, config, previews404);
    const previewId404 = extractPreviewId(await handler404(deactivateInput()));

    try {
      await handler404(deactivateInput({ previewId: previewId404, confirm: true, dryRun: undefined }));
      expect("expected HubError").toBe("received success");
    } catch (err) {
      expect((err as HubError).message).toContain("no active rental payment link");
    }
  });
});
