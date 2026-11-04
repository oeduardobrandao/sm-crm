import { assertEquals, readJson } from "./assert.ts";
import { createSupabaseQueryMock } from "../../../test/shared/supabaseMock.ts";
import { createBriefingAudioHandler } from "../briefing-audio/handler.ts";
import { allClientsScope, type ClientScope } from "../_shared/client-scope.ts";

const buildCorsHeaders = () => ({ "Access-Control-Allow-Origin": "https://app.mesaas.com" });
const Q = "11111111-1111-1111-1111-111111111111";
const KEY = `briefing-audio/conta-1/${Q}/a.webm`;

// deno-lint-ignore no-explicit-any
function makeHandler(db: any, scope: () => Promise<ClientScope> = () => Promise.resolve(allClientsScope())) {
  return createBriefingAudioHandler({
    buildCorsHeaders,
    createDb: () => db as never,
    signGetUrl: async (key: string) => `https://get.example.com/${key}`,
    // Acesso por cliente: unrestricted unless a test passes a scope.
    loadClientScope: scope,
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

// ── acesso por cliente ───────────────────────────────────────────────────────

const AUDIO_ROW = {
  audio_r2_key: KEY, audio_mime: "audio/webm", audio_duration_seconds: 12,
  audio_transcription_status: "done", audio_recorded_at: "2026-09-03T00:00:00Z", cliente_id: 5,
};
const restricted = (ids: number[]) => () =>
  Promise.resolve<ClientScope>({ all: false, ids: new Set(ids), membroIds: new Set([7]) });

Deno.test("briefing-audio: restricted member, hidden client -> 404; assigned -> 200; scope error -> 500", async () => {
  const hidden = createSupabaseQueryMock();
  setupAuth(hidden);
  hidden.queue("hub_briefing_questions", "select", { data: AUDIO_ROW, error: null });
  const res = await makeHandler(hidden, restricted([9]))(req(Q));
  assertEquals(res.status, 404);
  assertEquals(await readJson(res), { error: "Áudio não encontrado." });

  const assigned = createSupabaseQueryMock();
  setupAuth(assigned);
  assigned.queue("hub_briefing_questions", "select", { data: AUDIO_ROW, error: null });
  assertEquals((await makeHandler(assigned, restricted([5]))(req(Q))).status, 200);

  const broken = createSupabaseQueryMock();
  setupAuth(broken);
  const res3 = await makeHandler(broken, () => Promise.reject(new Error("boom")))(req(Q));
  assertEquals(res3.status, 500);
  assertEquals(broken.calls.some((c) => c.table === "hub_briefing_questions"), false);
});
