import { assertEquals } from "./assert.ts";
import {
  validateMedia,
  CAROUSEL_MAX_ITEMS,
  IMAGE_MAX_BYTES,
  VIDEO_MAX_BYTES,
} from "../_shared/instagram-limits.ts";

function img(overrides: Partial<Parameters<typeof validateMedia>[0][0]> = {}) {
  return {
    id: 1, kind: "image", mime_type: "image/jpeg", size_bytes: 1024,
    width: 1080, height: 1350, duration_seconds: null, r2_key: "k", sort_order: 0,
    ...overrides,
  };
}
function vid(overrides: Partial<Parameters<typeof validateMedia>[0][0]> = {}) {
  return {
    id: 2, kind: "video", mime_type: "video/mp4", size_bytes: 1024,
    width: 1080, height: 1920, duration_seconds: 30, r2_key: "k", sort_order: 0,
    ...overrides,
  };
}

Deno.test("instagram-limits: mídia válida passa sem erros", () => {
  assertEquals(validateMedia([img(), vid()]), []);
});

Deno.test("instagram-limits: imagem acima de 8 MB é recusada", () => {
  const errors = validateMedia([img({ size_bytes: IMAGE_MAX_BYTES + 1 })]);
  assertEquals(errors.length, 1);
  assertEquals(errors[0].message, "Imagem excede 8 MB (limite do Instagram)");
});

Deno.test("instagram-limits: vídeo acima de 300 MB é recusado", () => {
  const errors = validateMedia([vid({ size_bytes: VIDEO_MAX_BYTES + 1 })]);
  assertEquals(errors.length, 1);
  assertEquals(errors[0].message, "Vídeo excede 300 MB (limite do Instagram)");
});

Deno.test("instagram-limits: story valida duração de 60s", () => {
  const ok = validateMedia([vid({ duration_seconds: 75 })]);
  assertEquals(ok, []); // feed aceita até 900s
  const errors = validateMedia([vid({ duration_seconds: 75 })], { forStories: true });
  assertEquals(errors.length, 1);
});

Deno.test("instagram-limits: CAROUSEL_MAX_ITEMS é 10", () => {
  assertEquals(CAROUSEL_MAX_ITEMS, 10);
});

Deno.test("instagram-limits: updated publishing boundaries", () => {
  assertEquals(validateMedia([img({ height: 1440 })]), []);
  assertEquals(validateMedia([img({ height: 1441 })]).length, 1);
  assertEquals(validateMedia([vid({ width: 1920, height: 1080, duration_seconds: 900, size_bytes: 300 * 1024 * 1024 })]), []);
  assertEquals(validateMedia([vid({ duration_seconds: 901 })]).length, 1);
  assertEquals(validateMedia([vid({ size_bytes: 100 * 1024 * 1024, duration_seconds: 60 })], { forStories: true }), []);
  assertEquals(validateMedia([vid({ size_bytes: 100 * 1024 * 1024 + 1 })], { forStories: true }).length, 1);
  assertEquals(validateMedia([img({ mime_type: "image/png" })]).length, 1);
  assertEquals(validateMedia([img({ width: 300, height: 300 })]), []);
  assertEquals(validateMedia([img({ height: 2200 })], { forStories: true }), []);
});
