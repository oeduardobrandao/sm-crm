import { assertEquals } from "./assert.ts";

const files = [
  "../file-manage/handler.ts",
  "../file-upload-finalize/handler.ts",
  "../post-media-manage/handler.ts",
  "../hub-briefing/handler.ts",
  "../hub-ideias/handler.ts",
  "../instagram-publish/handler.ts",
  "../instagram-report-generator/index.ts",
  "../instagram-analytics/index.ts",
  "../invite-user/index.ts",
];

const cronFiles = [
  "../analytics-report-cron/index.ts",
  "../instagram-publish-cron/index.ts",
  "../instagram-refresh-cron/index.ts",
  "../instagram-sync-cron/index.ts",
];

Deno.test("interactive 500 responses do not interpolate raw exception messages", async () => {
  for (const relative of files) {
    const source = await Deno.readTextFile(new URL(relative, import.meta.url));
    assertEquals(
      /json\(\{\s*error:\s*(?:\w+\??\.message|msg|err\.message)/.test(source),
      false,
      relative,
    );
    assertEquals(source.includes("message: err.message ||"), false, relative);
    assertEquals(source.includes("error: err.message ??"), false, relative);
    assertEquals(source.includes("Erro interno do servidor: ${detail}"), false, relative);
  }
});

Deno.test("cron responses do not expose raw exception details", async () => {
  for (const relative of cronFiles) {
    const source = await Deno.readTextFile(new URL(relative, import.meta.url));
    assertEquals(
      /(?:json|JSON\.stringify)\(\{\s*error:\s*err\.message/.test(source),
      false,
      relative,
    );
  }

  const syncCron = await Deno.readTextFile(
    new URL("../instagram-sync-cron/index.ts", import.meta.url),
  );
  assertEquals(/total:\s*eligible\.length,\s*errors\s*\}/s.test(syncCron), false);
});
