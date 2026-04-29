import { assertEquals } from "./assert.ts";
import { createAnalyticsReportCronHandler } from "../analytics-report-cron/handler.ts";
import { createExpressPostCleanupCronHandler } from "../express-post-cleanup-cron/handler.ts";
import { createInstagramRefreshCronHandler } from "../instagram-refresh-cron/handler.ts";
import { createInstagramSyncCronHandler } from "../instagram-sync-cron/handler.ts";
import { createPostMediaCleanupCronHandler } from "../post-media-cleanup-cron/handler.ts";
import { createPublishCronHandler } from "../instagram-publish-cron/handler.ts";

const buildCorsHeaders = () => ({ "Access-Control-Allow-Origin": "https://app.mesaas.com" });
const timingSafeEqual = (a: string, b: string) => a === b;

Deno.test("analytics-report-cron rejects requests without the shared cron secret", async () => {
  const handler = createAnalyticsReportCronHandler({
    buildCorsHeaders,
    cronSecret: "segredo-cron",
    timingSafeEqual,
    run: async () => new Response("ok"),
  });

  const response = await handler(new Request("https://example.test/analytics-report-cron"));
  assertEquals(response.status, 401);
});

Deno.test("instagram-refresh-cron rejects requests without the shared cron secret", async () => {
  const handler = createInstagramRefreshCronHandler({
    cronSecret: "segredo-cron",
    timingSafeEqual,
    run: async () => new Response("ok"),
  });

  const response = await handler(new Request("https://example.test/instagram-refresh-cron"));
  assertEquals(response.status, 401);
});

Deno.test("instagram-sync-cron rejects requests without the shared cron secret", async () => {
  const handler = createInstagramSyncCronHandler({
    cronSecret: "segredo-cron",
    timingSafeEqual,
    run: async () => new Response("ok"),
  });

  const response = await handler(new Request("https://example.test/instagram-sync-cron"));
  assertEquals(response.status, 401);
});

Deno.test("post-media-cleanup-cron rejects requests without the shared cron secret", async () => {
  const handler = createPostMediaCleanupCronHandler({
    buildCorsHeaders,
    cronSecret: "segredo-cron",
    timingSafeEqual,
    run: async () => new Response("ok"),
  });

  const response = await handler(new Request("https://example.test/post-media-cleanup-cron"));
  assertEquals(response.status, 401);
});

// ─── instagram-publish-cron ──────────────────────────────────

Deno.test("express-post-cleanup-cron rejects requests without the shared cron secret", async () => {
  const handler = createExpressPostCleanupCronHandler({
    buildCorsHeaders,
    cronSecret: "segredo-cron",
    timingSafeEqual,
    run: async () => new Response("ok"),
  });

  const response = await handler(new Request("https://example.test/express-post-cleanup-cron"));
  assertEquals(response.status, 401);
});

// ─── instagram-publish-cron ──────────────────────────────────

Deno.test("instagram-publish-cron rejects requests without the shared cron secret", async () => {
  const handler = createPublishCronHandler({
    cronSecret: "segredo-cron",
    timingSafeEqual,
    run: async () => new Response("ok"),
  });

  const response = await handler(new Request("https://example.test/instagram-publish-cron"));
  assertEquals(response.status, 401);
});

Deno.test("instagram-publish-cron rejects requests with wrong cron secret", async () => {
  const handler = createPublishCronHandler({
    cronSecret: "segredo-cron",
    timingSafeEqual,
    run: async () => new Response("ok"),
  });

  const response = await handler(new Request("https://example.test/instagram-publish-cron", {
    headers: { "x-cron-secret": "wrong-secret" },
  }));
  assertEquals(response.status, 401);
});

Deno.test("instagram-publish-cron delegates to run callback when secret is valid", async () => {
  let called = false;
  const handler = createPublishCronHandler({
    cronSecret: "segredo-cron",
    timingSafeEqual,
    run: async () => { called = true; return new Response("ok"); },
  });

  const response = await handler(new Request("https://example.test/instagram-publish-cron", {
    headers: { "x-cron-secret": "segredo-cron" },
  }));
  assertEquals(response.status, 200);
  assertEquals(called, true);
});
