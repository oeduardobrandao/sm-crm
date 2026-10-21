import { assertEquals, readJson } from "./assert.ts";
import { createSupabaseQueryMock } from "../../../test/shared/supabaseMock.ts";
import { createBriefingAudioHandler } from "../briefing-audio/handler.ts";

const buildCorsHeaders = () => ({ "Access-Control-Allow-Origin": "https://app.mesaas.com" });
const Q = "11111111-1111-1111-1111-111111111111";
const KEY = `briefing-audio/conta-1/${Q}/a.webm`;

// deno-lint-ignore no-explicit-any
function makeHandler(db: any) {
  return createBriefingAudioHandler({
    buildCorsHeaders,
    createDb: () => db as never,
    signGetUrl: async (key: string) => `https://get.example.com/${key}`,
  });
}

function req(questionId: string | null, token: string | null = "jwt") {
  const url = new URL("https://example.test/briefing-audio");
  if (questionId) url.searchParams.set("question_id", questionId);
  return new Request(url.toString(), { headers: token ? { Authorization: `Bearer ${token}` } : {} });
}

// deno-lint-ignore no-explicit-any
function setupAuth(db: any, member = true) {
  db.withAuth({ id: "user-1" });
  db.queue("profiles", "select", { data: { active_workspace_id: "conta-1" }, error: null });
  db.queue("workspace_members", "select", { data: member ? { user_id: "user-1", role: "agent" } : null, error: null });
}

Deno.test("briefing-audio: 401 sem token, 403 sem membership, 400 sem question_id", async () => {
  const db = createSupabaseQueryMock();
  assertEquals((await makeHandler(db)(req(Q, null))).status, 401);
  const db2 = createSupabaseQueryMock();
  setupAuth(db2, false);
  assertEquals((await makeHandler(db2)(req(Q))).status, 403);
  const db3 = createSupabaseQueryMock();
  setupAuth(db3);
  assertEquals((await makeHandler(db3)(req(null))).status, 400);
});

Deno.test("briefing-audio: 404 sem áudio ou pergunta de outra workspace; 200 com url assinada", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  db.queue("hub_briefing_questions", "select", { data: { audio_r2_key: null }, error: null });
  assertEquals((await makeHandler(db)(req(Q))).status, 404);

  const db2 = createSupabaseQueryMock();
  setupAuth(db2);
  db2.queue("hub_briefing_questions", "select", {
    data: {
      audio_r2_key: KEY, audio_mime: "audio/webm", audio_duration_seconds: 12,
      audio_transcription_status: "done", audio_recorded_at: "2026-09-03T00:00:00Z",
    },
    error: null,
  });
  const res = await makeHandler(db2)(req(Q));
  assertEquals(res.status, 200);
  assertEquals(await readJson(res), {
    url: `https://get.example.com/${KEY}`, mime: "audio/webm", duration_seconds: 12,
    transcription_status: "done", recorded_at: "2026-09-03T00:00:00Z",
  });
  const sel = db2.calls.find((c) => c.table === "hub_briefing_questions");
  assertEquals(sel?.modifiers.some((m) => m.method === "eq" && m.args[0] === "conta_id" && m.args[1] === "conta-1"), true);
});
