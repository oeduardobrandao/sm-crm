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
