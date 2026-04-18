import { assertEquals } from "./assert.ts";
import { createAnalyticsReportCronHandler } from "../analytics-report-cron/handler.ts";
import { createInstagramRefreshCronHandler } from "../instagram-refresh-cron/handler.ts";
import { createInstagramSyncCronHandler } from "../instagram-sync-cron/handler.ts";
import { createPostMediaCleanupCronHandler } from "../post-media-cleanup-cron/handler.ts";

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
