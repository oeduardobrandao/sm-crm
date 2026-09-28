import { assert, assertEquals } from "./assert.ts";
import {
  hasStreamColumns,
  KB_VIDEO_COLUMNS,
  normalizeKbVideoRow,
  pickColumns,
  validateKbVideo,
  validateKbVideoSeries,
} from "../_shared/admin-kb-videos.ts";

const SERIES = { title: "Primeiros passos", slug: "primeiros-passos", status: "draft" };
const VIDEO = { title: "Primeiro acesso", slug: "primeiro-acesso", series_id: "s1", status: "draft" };

Deno.test("validateKbVideoSeries: title 1..200, slug format and reserved slugs", () => {
  assertEquals(validateKbVideoSeries(SERIES), null);
  assert(validateKbVideoSeries({ ...SERIES, title: "" }) !== null);
  assert(validateKbVideoSeries({ ...SERIES, title: "x".repeat(201) }) !== null);
  assert(validateKbVideoSeries({ ...SERIES, slug: "Com Espaço" }) !== null);
  assert(validateKbVideoSeries({ ...SERIES, slug: "novo" }) !== null);
  assert(validateKbVideoSeries({ ...SERIES, slug: "video" }) !== null);
});

Deno.test("validateKbVideoSeries: description max 500, display_order integer 0..10000, status enum", () => {
  assert(validateKbVideoSeries({ ...SERIES, description: "x".repeat(501) }) !== null);
  assertEquals(validateKbVideoSeries({ ...SERIES, description: null }), null);
  assert(validateKbVideoSeries({ ...SERIES, display_order: -1 }) !== null);
  assert(validateKbVideoSeries({ ...SERIES, display_order: 1.5 }) !== null);
  assert(validateKbVideoSeries({ ...SERIES, display_order: 10_001 }) !== null);
  assertEquals(validateKbVideoSeries({ ...SERIES, display_order: 10_000 }), null);
  assert(validateKbVideoSeries({ ...SERIES, status: "archived" }) !== null);
});

Deno.test("validateKbVideo: requires a series and a string article id when present", () => {
  assertEquals(validateKbVideo(VIDEO), null);
  assert(validateKbVideo({ ...VIDEO, series_id: "" }) !== null);
  assert(validateKbVideo({ ...VIDEO, series_id: undefined }) !== null);
  assert(validateKbVideo({ ...VIDEO, article_id: 42 }) !== null);
  assertEquals(validateKbVideo({ ...VIDEO, article_id: null }), null);
});

Deno.test("validateKbVideo: publishing requires a ready video with an HLS url", () => {
  assert(validateKbVideo({ ...VIDEO, status: "published" }) !== null);
  assert(validateKbVideo({ ...VIDEO, status: "published", stream_status: "pending" }) !== null);
  assert(validateKbVideo({ ...VIDEO, status: "published", stream_status: "ready", hls_url: null }) !== null);
  assertEquals(
    validateKbVideo({ ...VIDEO, status: "published", stream_status: "ready", hls_url: "https://x/v.m3u8" }),
    null,
  );
});

Deno.test("pickColumns + normalizeKbVideoRow: allowlist, trim, '' → null", () => {
  const picked = pickColumns(
    { title: " T ", slug: " t ", description: "", article_id: "", series_id: "s1", hls_url: "x", action: "y" },
    KB_VIDEO_COLUMNS,
  );
  assertEquals(Object.keys(picked).sort(), ["article_id", "description", "series_id", "slug", "title"]);
  assertEquals(normalizeKbVideoRow(picked), {
    title: "T",
    slug: "t",
    description: null,
    article_id: null,
    series_id: "s1",
  });
});

Deno.test("hasStreamColumns: any Stream-owned column in the body is flagged", () => {
  assertEquals(hasStreamColumns({ title: "x" }), false);
  assert(hasStreamColumns({ hls_url: "x" }));
  assert(hasStreamColumns({ stream_status: "ready" }));
  assert(hasStreamColumns({ stream_upload_expires_at: null }));
});
