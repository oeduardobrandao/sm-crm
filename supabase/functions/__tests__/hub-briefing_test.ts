import { assertEquals, readJson } from "./assert.ts";
import { createSupabaseQueryMock } from "../../../test/shared/supabaseMock.ts";
import { createHubBriefingHandler } from "../hub-briefing/handler.ts";

const buildCorsHeaders = () => ({ "Access-Control-Allow-Origin": "https://app.mesaas.com" });

function makeHandler(db: ReturnType<typeof createSupabaseQueryMock>) {
  return createHubBriefingHandler({
    buildCorsHeaders,
    createDb: () => db as never,
    now: () => "2026-06-16T12:00:00.000Z",
  });
}

function setupToken(db: ReturnType<typeof createSupabaseQueryMock>) {
  db.queue("client_hub_tokens", "select", {
    data: { cliente_id: 14, conta_id: "conta-1", is_active: true },
    error: null,
  });
  db.queueRpc("effective_plan_feature", { data: true, error: null });
}

function getReq() {
  return new Request("https://example.test/hub-briefing?token=t", { method: "GET" });
}

Deno.test("hub-briefing GET groups questions under their briefings", async () => {
  const db = createSupabaseQueryMock();
  setupToken(db);
  db.queue("briefings", "select", {
    data: [
      { id: "b1", title: "Onboarding", display_order: 0 },
      { id: "b2", title: "Campanha", display_order: 1 },
    ],
    error: null,
  });
  db.queue("hub_briefing_questions", "select", {
    data: [
      { id: "q1", question: "Marca?", answer: null, section: null, display_order: 0, briefing_id: "b1" },
      { id: "q2", question: "Verba?", answer: "1000", section: "Mídia", display_order: 0, briefing_id: "b2" },
    ],
    error: null,
  });

  const res = await makeHandler(db)(getReq());
  assertEquals(res.status, 200);
  const body = await readJson(res);
  assertEquals(body, {
    briefings: [
      {
        id: "b1",
        title: "Onboarding",
        display_order: 0,
        questions: [{ id: "q1", question: "Marca?", answer: null, section: null, display_order: 0 }],
      },
      {
        id: "b2",
        title: "Campanha",
        display_order: 1,
        questions: [{ id: "q2", question: "Verba?", answer: "1000", section: "Mídia", display_order: 0 }],
      },
    ],
  });
});

Deno.test("hub-briefing GET keeps a briefing with no questions (parent query)", async () => {
  const db = createSupabaseQueryMock();
  setupToken(db);
  db.queue("briefings", "select", {
    data: [
      { id: "b1", title: "Onboarding", display_order: 0 },
      { id: "b2", title: "Vazio", display_order: 1 },
    ],
    error: null,
  });
  db.queue("hub_briefing_questions", "select", {
    data: [
      { id: "q1", question: "Marca?", answer: null, section: null, display_order: 0, briefing_id: "b1" },
    ],
    error: null,
  });

  const body = await readJson(await makeHandler(db)(getReq()));
  assertEquals(body.briefings.length, 2);
  assertEquals(body.briefings[1].questions, []);
});

Deno.test("hub-briefing GET coalesces null briefing_id into the first briefing", async () => {
  const db = createSupabaseQueryMock();
  setupToken(db);
  db.queue("briefings", "select", {
    data: [{ id: "b1", title: "Briefing", display_order: 0 }],
    error: null,
  });
  db.queue("hub_briefing_questions", "select", {
    data: [
      { id: "q1", question: "Legacy?", answer: null, section: null, display_order: 0, briefing_id: null },
    ],
    error: null,
  });

  const body = await readJson(await makeHandler(db)(getReq()));
  assertEquals(body.briefings[0].questions.length, 1);
});
