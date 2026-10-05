import { assert, assertEquals } from "./assert.ts";
import {
  type AgendaLembreteDb,
  type AgendaLembreteRow,
  createAgendaLembretesEmailHandler,
  runAgendaLembretesEmail,
} from "../agenda-lembretes-email/handler.ts";

function row(over: Partial<AgendaLembreteRow> = {}): AgendaLembreteRow {
  return {
    ocorrencia_id: 11,
    user_id: "u1",
    minutos: 10,
    inicio_alvo: "2026-10-05T17:00:00Z",
    notification_id: "n1",
    titulo: "Gravação",
    inicio: "2026-10-05T17:00:00Z",
    fim: "2026-10-05T19:00:00Z",
    dia_inteiro: false,
    local: null,
    link_reuniao: null,
    tz: "America/Sao_Paulo",
    tentativas: 1,
    ...over,
  };
}

function makeDb(rows: AgendaLembreteRow[], emails: Record<string, string | null>) {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const db: AgendaLembreteDb = {
    rpc(fn, args) {
      calls.push({ fn, args: args as Record<string, unknown> });
      if (fn === "agenda_claim_emails_lembrete") return Promise.resolve({ data: rows, error: null });
      return Promise.resolve({ data: null, error: null });
    },
    auth: { admin: { getUserById(id: string) {
      return Promise.resolve({ data: { user: id in emails ? { email: emails[id] } : null }, error: null });
    } } },
  };
  return { db, calls, marks: () => calls.filter((c) => c.fn === "agenda_marcar_email_lembrete") };
}

Deno.test("run: sends one e-mail per claimed row with the idempotency key and sender", async () => {
  const rows = [row(), row({ ocorrencia_id: 12, user_id: "u2", minutos: 1440 })];
  const { db, marks } = makeDb(rows, { u1: "a@x.test", u2: "b@x.test" });
  const sent: Array<unknown[]> = [];
  const result = await runAgendaLembretesEmail({
    db,
    sendEmail: (...a: unknown[]) => { sent.push(a); return Promise.resolve(); },
    appBaseUrl: "https://app.example.test",
    now: () => 0,
  });
  assertEquals(result, { enviados: 2, falhas: 0 });
  assertEquals(sent.length, 2);
  const epoch = Math.floor(Date.parse("2026-10-05T17:00:00Z") / 1000);
  assertEquals(sent[0][0], "a@x.test");
  assertEquals(sent[0][3], `agenda-lembrete:11:u1:10:${epoch}`);
  assertEquals(sent[1][3], `agenda-lembrete:12:u2:1440:${epoch}`);
  assertEquals(sent[0][4], "Mesaas <notificacoes@mesaas.com.br>");
  assert((sent[0][2] as string).includes("/calendario?evento=11"));
  assertEquals(marks().length, 2);
  assertEquals(marks()[0].args, {
    p_ocorrencia_id: 11, p_user_id: "u1", p_minutos: 10, p_inicio_alvo: "2026-10-05T17:00:00Z", p_ok: true,
  });
});

Deno.test("run: a failed send is marked p_ok=false and does not stop the others", async () => {
  const rows = [row(), row({ ocorrencia_id: 12, user_id: "u2" })];
  const { db, marks } = makeDb(rows, { u1: "a@x.test", u2: "b@x.test" });
  let n = 0;
  const result = await runAgendaLembretesEmail({
    db,
    sendEmail: () => (++n === 1 ? Promise.reject(new Error("boom")) : Promise.resolve()),
    appBaseUrl: "https://app.example.test",
    now: () => 0,
  });
  assertEquals(result, { enviados: 1, falhas: 1 });
  assertEquals(marks().map((m) => [m.args.p_user_id, m.args.p_ok]), [["u1", false], ["u2", true]]);
});

Deno.test("run: deadline exceeded leaves remaining rows unsent and unmarked", async () => {
  const rows = [row(), row({ ocorrencia_id: 12, user_id: "u2" }), row({ ocorrencia_id: 13, user_id: "u3" })];
  const { db, marks } = makeDb(rows, { u1: "a@x.test", u2: "b@x.test", u3: "c@x.test" });
  let t = 0;
  let sends = 0;
  const result = await runAgendaLembretesEmail({
    db,
    sendEmail: () => { sends++; t += 40_000; return Promise.resolve(); },
    appBaseUrl: "https://app.example.test",
    now: () => t,
    deadlineMs: 50_000,
  });
  // row 1 at t=0 sends (t=40s), row 2 at t=40s sends (t=80s), row 3 at t=80s is past the deadline
  assertEquals(sends, 2);
  assertEquals(result.enviados, 2);
  assertEquals(marks().map((m) => m.args.p_user_id), ["u1", "u2"]);
});

Deno.test("run: user without e-mail is marked p_ok=false and nothing is sent", async () => {
  const { db, marks } = makeDb([row()], { u1: null });
  let sends = 0;
  const result = await runAgendaLembretesEmail({
    db,
    sendEmail: () => { sends++; return Promise.resolve(); },
    appBaseUrl: "https://app.example.test",
    now: () => 0,
  });
  assertEquals(sends, 0);
  assertEquals(result, { enviados: 0, falhas: 1 });
  assertEquals(marks()[0].args.p_ok, false);
});

Deno.test("run: empty claim sends nothing; claim error throws", async () => {
  const { db } = makeDb([], {});
  const r = await runAgendaLembretesEmail({
    db, sendEmail: () => Promise.resolve(), appBaseUrl: "https://a.test", now: () => 0,
  });
  assertEquals(r, { enviados: 0, falhas: 0 });

  const failing: AgendaLembreteDb = {
    rpc: () => Promise.resolve({ data: null, error: { message: "db down" } }),
    auth: { admin: { getUserById: () => Promise.resolve({ data: null, error: null }) } },
  };
  let threw = false;
  try {
    await runAgendaLembretesEmail({ db: failing, sendEmail: () => Promise.resolve(), appBaseUrl: "https://a.test", now: () => 0 });
  } catch (e) {
    threw = (e as Error).message.includes("agenda_claim_emails_lembrete failed");
  }
  assert(threw);
});

Deno.test("handler: 401 without the cron secret, delegates with it", async () => {
  let called = false;
  const handler = createAgendaLembretesEmailHandler({
    cronSecret: "s",
    timingSafeEqual: (a, b) => a === b,
    run: () => { called = true; return Promise.resolve(new Response("ok")); },
  });
  assertEquals((await handler(new Request("https://x.test/"))).status, 401);
  assertEquals(called, false);
  assertEquals((await handler(new Request("https://x.test/", { headers: { "x-cron-secret": "s" } }))).status, 200);
  assertEquals(called, true);
});
