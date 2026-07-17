import { assert, assertEquals } from "./assert.ts";
import { createRetentionRadarCronHandler } from "../retention-radar-cron/handler.ts";
import { buildRadarEmail } from "../retention-radar-cron/email.ts";

const timingSafeEqual = (a: string, b: string) => a === b;

Deno.test("retention-radar-cron rejects requests without the shared cron secret", async () => {
  const handler = createRetentionRadarCronHandler({
    cronSecret: "segredo-cron",
    timingSafeEqual,
    run: async () => new Response("ok"),
  });
  const response = await handler(new Request("https://example.test/retention-radar-cron"));
  assertEquals(response.status, 401);
});

Deno.test("retention-radar-cron runs with the correct secret", async () => {
  const handler = createRetentionRadarCronHandler({
    cronSecret: "segredo-cron",
    timingSafeEqual,
    run: async () => new Response("ok"),
  });
  const response = await handler(
    new Request("https://example.test/retention-radar-cron", {
      headers: { "x-cron-secret": "segredo-cron" },
    }),
  );
  assertEquals(response.status, 200);
});

Deno.test("buildRadarEmail: groups rows by bucket and escapes names", () => {
  const html = buildRadarEmail([
    {
      bucket: "past_due",
      workspaceName: "<b>DK</b>",
      ownerEmail: "dono@example.com",
      planId: "pro",
      status: "past_due",
      lastActivityAt: "2026-07-16T10:00:00.000Z",
      failedPaymentCount: 2,
    },
    {
      bucket: "dormant",
      workspaceName: "Outra",
      ownerEmail: "b@example.com",
      planId: "start",
      status: "active",
      lastActivityAt: null,
      failedPaymentCount: 0,
    },
  ]);
  assert(html.includes("Pagamento falhando"));
  assert(html.includes("Dormentes"));
  assert(!html.includes("<b>DK</b>"));
  assert(html.includes("&lt;b&gt;DK&lt;/b&gt;"));
});

Deno.test("buildRadarEmail: says so plainly when nothing is at risk", () => {
  const html = buildRadarEmail([]);
  assert(html.includes("Nenhum workspace em risco"));
});
