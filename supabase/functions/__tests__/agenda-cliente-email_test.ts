import { assert, assertEquals } from "./assert.ts";
import {
  type AgendaClienteEmailItem,
  type AgendaClienteOcorrencia,
  AVISO_ALTERACAO,
  AVISO_CANCELAMENTO,
  base64Utf8,
  formatarQuandoAgenda,
  mesDiaAgenda,
  montarEmailAgendaCliente,
  SnapshotVazioError,
} from "../_shared/agenda-cliente-email.ts";
import {
  type AgendaClienteEmailDb,
  chaveIdempotenciaAgendaCliente,
  createAgendaClienteEmailHandler,
  runAgendaClienteEmail,
} from "../agenda-cliente-email/handler.ts";
import { signUnsubToken, signUnsubTokenFor } from "../_shared/client-event-email.ts";

const HUB = "https://app.mesaas.com.br/agencia-x/hub/tok123";
const UNSUB = "https://x.supabase.co/functions/v1/client-email-unsub/abc";
const AGORA = new Date("2026-10-07T12:00:00Z");

function oc(over: Partial<AgendaClienteOcorrencia> = {}): AgendaClienteOcorrencia {
  return {
    ocorrencia_id: 11,
    estado: "ativa",
    sequencia: 2,
    inicio: "2026-10-09T17:00:00+00:00",
    fim: "2026-10-09T18:00:00+00:00",
    dia_inteiro: false,
    data_inicio_local: "2026-10-09",
    data_fim_local: "2026-10-09",
    tz: "America/Sao_Paulo",
    titulo: "Gravação",
    descricao: null,
    local: null,
    link_reuniao: null,
    ...over,
  };
}

function item(over: Partial<AgendaClienteEmailItem> = {}): AgendaClienteEmailItem {
  return {
    id: 5,
    versao: 3,
    tipo: "convite",
    conta_id: "ws1",
    cliente_id: 42,
    ocorrencias: [oc()],
    remarcacao: null,
    cliente_email: "cliente@x.test",
    cliente_nome: "Ana Cliente",
    workspace_nome: "Agencia X",
    brand_color: "#ffbf30",
    logo_url: null,
    ...over,
  };
}

const CTX = { hubUrl: HUB, unsubUrl: UNSUB, agora: AGORA };

function decodeAnexo(b64: string): string {
  const bin = atob(b64);
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

function contar(texto: string, trecho: string): number {
  return texto.split(trecho).length - 1;
}

// ─── montarEmailAgendaCliente ──────────────────────────────────────────────────

Deno.test("convite with one occurrence: subject, .ics with SEQUENCE, button to the occurrence", () => {
  const { subject, html, attachments } = montarEmailAgendaCliente(item(), CTX);
  assertEquals(subject, "Novo evento: Gravação");
  assertEquals(attachments.length, 1);
  assertEquals(attachments[0].filename, "evento.ics");
  assertEquals(attachments[0].content_type, "text/calendar; charset=utf-8");
  const ics = decodeAnexo(attachments[0].content);
  assertEquals(contar(ics, "BEGIN:VEVENT"), 1);
  assert(ics.includes("UID:agenda-oc-11@mesaas.com.br"));
  assert(ics.includes("SEQUENCE:2"));
  assert(ics.includes("METHOD:PUBLISH"));
  assert(!ics.includes("ORGANIZER") && !ics.includes("ATTENDEE") && !ics.includes("RRULE"));
  assert(html.includes(`href="${HUB}/agenda?ocorrencia=11"`), "button to the occurrence in the Hub");
  assert(html.includes("Confirmar presença"));
  assert(html.includes("Sexta, 9 de outubro · 14:00 a 15:00"), "time in the event zone");
  assert(html.includes("Olá, Ana Cliente!"));
  assert(html.includes(UNSUB), "unsubscribe link in the footer");
  assert(!html.includes("—") && !subject.includes("—"));
});

Deno.test("no Hub URL: no button, attachment still present", () => {
  const { html, attachments } = montarEmailAgendaCliente(item(), { ...CTX, hubUrl: "" });
  assert(!html.includes("Confirmar presença"));
  assert(!html.includes("/agenda?ocorrencia="));
  assertEquals(attachments.length, 1);
});

Deno.test("all occurrences cancelled: cancel subject, no attachment, removal hint, portal button", () => {
  const { subject, html, attachments } = montarEmailAgendaCliente(
    item({ tipo: "cancelamento", ocorrencias: [oc({ estado: "cancelada" })] }),
    CTX,
  );
  assertEquals(subject, "Evento cancelado: Gravação");
  assertEquals(attachments, []);
  assert(html.includes("Se você adicionou este evento ao seu calendário, remova-o."));
  assert(html.includes(AVISO_CANCELAMENTO));
  assert(html.includes("Ver no portal"));
  assert(html.includes(`href="${HUB}/agenda"`));
});

Deno.test("convite whose entries were all cancelled before send reads as a cancellation", () => {
  const { subject } = montarEmailAgendaCliente(
    item({ tipo: "convite", ocorrencias: [oc({ estado: "cancelada" })] }),
    CTX,
  );
  assertEquals(subject, "Evento cancelado: Gravação");
});

Deno.test("mixed active + cancelled: updated subject, update hint, only active entries attached", () => {
  const { subject, html, attachments } = montarEmailAgendaCliente(
    item({
      tipo: "alteracao",
      ocorrencias: [
        oc({ ocorrencia_id: 11 }),
        oc({ ocorrencia_id: 12, estado: "cancelada", inicio: "2026-10-16T17:00:00+00:00", fim: "2026-10-16T18:00:00+00:00" }),
      ],
    }),
    CTX,
  );
  assertEquals(subject, "Evento atualizado: Gravação");
  assert(html.includes("abra o arquivo anexo para atualizá-lo"));
  assert(html.includes(AVISO_ALTERACAO));
  assert(html.includes("Datas canceladas"));
  assert(html.includes("Confirmar presença"));
  const ics = decodeAnexo(attachments[0].content);
  assertEquals(contar(ics, "BEGIN:VEVENT"), 1);
  assert(ics.includes("UID:agenda-oc-11@mesaas.com.br"));
  assert(!ics.includes("agenda-oc-12@"));
});

Deno.test("remarcacao_aceita: own subject, new time attached, team message escaped", () => {
  const { subject, html, attachments } = montarEmailAgendaCliente(
    item({
      tipo: "remarcacao_aceita",
      remarcacao: {
        remarcacao_id: 3,
        inicio_sugerido: "2026-10-09T17:00:00+00:00",
        fim_sugerido: "2026-10-09T18:00:00+00:00",
        mensagem: "pode ser?",
        resposta_equipe: "Combinado <b>!</b>",
      },
    }),
    CTX,
  );
  assertEquals(subject, "Remarcação aceita: Gravação");
  assertEquals(attachments.length, 1);
  assert(html.includes("aceitou seu pedido de remarcação"));
  assert(html.includes("Combinado &lt;b&gt;!&lt;/b&gt;") && !html.includes("<b>!</b>"));
  assert(html.includes("Ver no portal"));
});

Deno.test("remarcacao_recusada: own subject, suggested time, escaped team message, valid time kept, no attachment", () => {
  const { subject, html, attachments } = montarEmailAgendaCliente(
    item({
      tipo: "remarcacao_recusada",
      remarcacao: {
        remarcacao_id: 3,
        inicio_sugerido: "2026-10-10T13:00:00+00:00",
        fim_sugerido: "2026-10-10T14:00:00+00:00",
        mensagem: null,
        resposta_equipe: "<script>alert(1)</script>",
      },
    }),
    CTX,
  );
  assertEquals(subject, "Remarcação não aceita: Gravação");
  assertEquals(attachments, []);
  assert(html.includes("não pôde aceitar o horário que você sugeriu (Sábado, 10 de outubro · 10:00)"));
  assert(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;") && !html.includes("<script>"));
  assert(html.includes("O horário que continua valendo"));
  assert(html.includes("Sexta, 9 de outubro · 14:00 a 15:00"));
  assert(html.includes("Ver no portal"));
});

Deno.test("remarcacao_recusada with an empty snapshot does not throw", () => {
  const { subject, attachments } = montarEmailAgendaCliente(
    item({
      tipo: "remarcacao_recusada",
      ocorrencias: [],
      remarcacao: {
        remarcacao_id: 3,
        inicio_sugerido: "2026-10-10T13:00:00+00:00",
        fim_sugerido: null,
        mensagem: null,
        resposta_equipe: null,
      },
    }),
    CTX,
  );
  assertEquals(subject, "Remarcação não aceita: Evento");
  assertEquals(attachments, []);
});

Deno.test("non-reschedule item with an empty snapshot throws SnapshotVazioError", () => {
  let nome = "";
  try {
    montarEmailAgendaCliente(item({ ocorrencias: [] }), CTX);
  } catch (e) {
    nome = (e as Error).name;
    assert(e instanceof SnapshotVazioError);
  }
  assertEquals(nome, "SnapshotVazioError");
});

Deno.test("HTML in titulo is escaped and CR/LF never reaches the subject", () => {
  const { subject, html } = montarEmailAgendaCliente(
    item({ ocorrencias: [oc({ titulo: "Reunião <img src=x onerror=alert(1)>\r\nBcc: x@y.z" })] }),
    CTX,
  );
  assert(!subject.includes("\r") && !subject.includes("\n"), "CR/LF in subject");
  assert(subject.startsWith("Novo evento: Reunião"));
  assert(html.includes("&lt;img src=x onerror=alert(1)&gt;"));
  assert(!html.includes("<img src=x"));
});

Deno.test("attachment is UTF-8 base64: non-Latin-1 titles round-trip", () => {
  const titulo = "Reunião de criação 🎬";
  const { attachments } = montarEmailAgendaCliente(item({ ocorrencias: [oc({ titulo })] }), CTX);
  const ics = decodeAnexo(attachments[0].content);
  assert(ics.includes(`SUMMARY:${titulo}`), "SUMMARY must survive base64 as UTF-8");
  assertEquals(decodeAnexo(base64Utf8("ção ✓")), "ção ✓");
});

Deno.test("series: body lists 10 dates and 'e mais N datas'; attachment carries every entry", () => {
  const ocorrencias = Array.from({ length: 12 }, (_, i) => {
    const dia = String(9 + i).padStart(2, "0");
    return oc({
      ocorrencia_id: 100 + i,
      inicio: `2026-10-${dia}T17:00:00+00:00`,
      fim: `2026-10-${dia}T18:00:00+00:00`,
      data_inicio_local: `2026-10-${dia}`,
      data_fim_local: `2026-10-${dia}`,
    });
  });
  const { html, attachments } = montarEmailAgendaCliente(item({ ocorrencias }), CTX);
  assert(html.includes("e mais 2 datas"));
  assertEquals(contar(html, "<li"), 10);
  assertEquals(contar(decodeAnexo(attachments[0].content), "BEGIN:VEVENT"), 12);
});

Deno.test("all-day entries: date-only line and VALUE=DATE with the exclusive end", () => {
  const { html, attachments } = montarEmailAgendaCliente(
    item({
      ocorrencias: [oc({
        dia_inteiro: true,
        inicio: "2026-10-09T03:00:00+00:00",
        fim: "2026-10-11T03:00:00+00:00",
        data_inicio_local: "2026-10-09",
        data_fim_local: "2026-10-11",
      })],
    }),
    CTX,
  );
  assert(html.includes("Sexta, 9 de outubro a Sábado, 10 de outubro · dia inteiro"));
  const ics = decodeAnexo(attachments[0].content);
  assert(ics.includes("DTSTART;VALUE=DATE:20261009"));
  assert(ics.includes("DTEND;VALUE=DATE:20261011"));
});

Deno.test("formatarQuandoAgenda: other zones carry the zone name", () => {
  assertEquals(
    formatarQuandoAgenda({ ...oc(), tz: "America/Manaus" }),
    "Sexta, 9 de outubro · 13:00 a 14:00 (America/Manaus)",
  );
  assertEquals(formatarQuandoAgenda(oc()), "Sexta, 9 de outubro · 14:00 a 15:00");
});

Deno.test("location, safe meeting link and description are shown; unsafe link is dropped", () => {
  const { html } = montarEmailAgendaCliente(
    item({ ocorrencias: [oc({ local: "Estúdio <2>", link_reuniao: "https://meet.x/abc", descricao: "Trazer roteiro" })] }),
    CTX,
  );
  assert(html.includes("Estúdio &lt;2&gt;"));
  assert(html.includes('href="https://meet.x/abc"'));
  assert(html.includes("Trazer roteiro"));
  const inseguro = montarEmailAgendaCliente(
    item({ ocorrencias: [oc({ link_reuniao: "javascript:alert(1)" })] }),
    CTX,
  );
  assert(!inseguro.html.includes("javascript:"));
});

// ─── runAgendaClienteEmail ─────────────────────────────────────────────────────

function makeDb(items: unknown[], claimError: string | null = null) {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const db: AgendaClienteEmailDb = {
    rpc(fn, args) {
      calls.push({ fn, args });
      if (fn === "agenda_cliente_claim_emails") {
        return Promise.resolve(
          claimError ? { data: null, error: { message: claimError } } : { data: items, error: null },
        );
      }
      return Promise.resolve({ data: null, error: null });
    },
  };
  return { db, calls, marks: () => calls.filter((c) => c.fn === "agenda_cliente_marcar_email") };
}

function baseDeps(db: AgendaClienteEmailDb, over: Record<string, unknown> = {}) {
  const sent: unknown[][] = [];
  const deps = {
    db,
    sendEmail: (...a: unknown[]) => {
      sent.push(a);
      return Promise.resolve();
    },
    resolveHubUrl: () => Promise.resolve(HUB),
    tokenSecret: "test-secret",
    unsubBaseUrl: "https://x.supabase.co",
    now: () => AGORA.getTime(),
    ...over,
  };
  // deno-lint-ignore no-explicit-any
  return { deps: deps as any, sent };
}

Deno.test("run: sends each claimed item with key, sender, unsubscribe headers and attachment, then marks ok", async () => {
  const { db, calls, marks } = makeDb([item()]);
  const { deps, sent } = baseDeps(db);
  const r = await runAgendaClienteEmail(deps);
  assertEquals(r, { enviados: 1, falhas: 0 });
  assertEquals(calls[0], { fn: "agenda_cliente_claim_emails", args: { p_limit: 20 } });
  assertEquals(sent.length, 1);
  const [to, subject, html, key, from, replyTo, headers, attachments] = sent[0] as [
    string,
    string,
    string,
    string,
    string,
    unknown,
    Record<string, string>,
    Array<{ filename: string }>,
  ];
  assertEquals(to, "cliente@x.test");
  assertEquals(subject, "Novo evento: Gravação");
  assert(html.includes(`${HUB}/agenda?ocorrencia=11`));
  assertEquals(key, "agenda-cliente:5:3");
  assertEquals(key, chaveIdempotenciaAgendaCliente(5, 3));
  assertEquals(from, '"Agencia X" <notificacoes@mesaas.com.br>');
  assertEquals(replyTo, undefined);
  const token = await signUnsubToken(42, "test-secret");
  const unsubUrl = `https://x.supabase.co/functions/v1/client-email-unsub/${token}`;
  assertEquals(headers, { "List-Unsubscribe": `<${unsubUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" });
  assert(html.includes(unsubUrl));
  assertEquals(attachments.map((a) => a.filename), ["evento.ics"]);
  assertEquals(marks().map((m) => m.args), [{ p_id: 5, p_versao: 3, p_ok: true, p_erro: null }]);
});

Deno.test("run: send throws -> marked not ok with the error name only", async () => {
  const { db, marks } = makeDb([item(), item({ id: 6, versao: 1 })]);
  let n = 0;
  const { deps } = baseDeps(db, {
    sendEmail: () => {
      n++;
      if (n === 1) {
        const e = new Error("Resend send failed: 500 cliente@x.test");
        e.name = "TimeoutError";
        return Promise.reject(e);
      }
      return Promise.resolve();
    },
  });
  const r = await runAgendaClienteEmail(deps);
  assertEquals(r, { enviados: 1, falhas: 1 });
  assertEquals(marks().map((m) => m.args), [
    { p_id: 5, p_versao: 3, p_ok: false, p_erro: "TimeoutError" },
    { p_id: 6, p_versao: 1, p_ok: true, p_erro: null },
  ]);
});

Deno.test("run: no Hub URL sends without a button", async () => {
  const { db } = makeDb([item()]);
  const { deps, sent } = baseDeps(db, { resolveHubUrl: () => Promise.resolve("") });
  await runAgendaClienteEmail(deps);
  assert(!(sent[0][2] as string).includes("Confirmar presença"));
  assertEquals((sent[0][7] as unknown[]).length, 1);
});

Deno.test("run: hostile workspace name cannot inject headers through From", async () => {
  const { db } = makeDb([item({ workspace_nome: 'Ag "X"\r\nBcc: evil@x.test' })]);
  const { deps, sent } = baseDeps(db);
  await runAgendaClienteEmail(deps);
  const from = sent[0][4] as string;
  assert(!from.includes("\r") && !from.includes("\n"));
  assertEquals(from, '"Ag \\"X\\" Bcc: evil@x.test" <notificacoes@mesaas.com.br>');
});

Deno.test("run: empty snapshot is not sent and is marked with SnapshotVazioError", async () => {
  const { db, marks } = makeDb([item({ ocorrencias: [] })]);
  const { deps, sent } = baseDeps(db);
  const r = await runAgendaClienteEmail(deps);
  assertEquals(sent.length, 0);
  assertEquals(r, { enviados: 0, falhas: 1 });
  assertEquals(marks()[0].args.p_erro, "SnapshotVazioError");
});

Deno.test("run: deadline leaves remaining items unsent, unmarked and released", async () => {
  const { db, marks, calls } = makeDb([item({ id: 1 }), item({ id: 2 }), item({ id: 3 })]);
  let t = 0;
  let sends = 0;
  const { deps } = baseDeps(db, {
    sendEmail: () => {
      sends++;
      t += 40_000;
      return Promise.resolve();
    },
    now: () => t,
    deadlineMs: 50_000,
  });
  const r = await runAgendaClienteEmail(deps);
  // item 1 at t=0 sends (t=40s), item 2 at t=40s sends (t=80s), item 3 at t=80s is past the deadline
  assertEquals(sends, 2);
  assertEquals(r.enviados, 2);
  assertEquals(marks().map((m) => m.args.p_id), [1, 2]);
  const rel = calls.filter((c) => c.fn === "agenda_cliente_liberar_emails");
  assertEquals(rel.map((c) => c.args.p_ids), [[3]]);
});

Deno.test("run: empty claim is a no-op; claim error throws", async () => {
  const { db, calls } = makeDb([]);
  const { deps } = baseDeps(db);
  assertEquals(await runAgendaClienteEmail(deps), { enviados: 0, falhas: 0 });
  assertEquals(calls.length, 1);

  const failing = makeDb([], "db down");
  let threw = false;
  try {
    await runAgendaClienteEmail(baseDeps(failing.db).deps);
  } catch (e) {
    threw = (e as Error).message.includes("agenda_cliente_claim_emails failed");
  }
  assert(threw);
});

// ─── Auth wrapper ──────────────────────────────────────────────────────────────

Deno.test("handler: 401 without the right cron secret, before any work", async () => {
  let called = false;
  const handler = createAgendaClienteEmailHandler({
    cronSecret: "s",
    timingSafeEqual: (a, b) => a === b,
    run: () => {
      called = true;
      return Promise.resolve(new Response("ok"));
    },
  });
  assertEquals((await handler(new Request("https://x.test/"))).status, 401);
  assertEquals((await handler(new Request("https://x.test/", { headers: { "x-cron-secret": "errado" } }))).status, 401);
  assertEquals(called, false);
  assertEquals((await handler(new Request("https://x.test/", { headers: { "x-cron-secret": "s" } }))).status, 200);
  assertEquals(called, true);
});

Deno.test("montarEmailAgendaCliente: greets the client by the full name", () => {
  const e = montarEmailAgendaCliente(item({ cliente_nome: "Clínica Sorriso" }), CTX);
  assert(e.html.includes("Olá, Clínica Sorriso!"));
});

// ─── Guest recipients (sub-project 4, spec §3.5/§3.6) ─────────────────────────

const TOKEN_CONVIDADO = "a".repeat(64);
const APP = "https://app.mesaas.com.br";

function guest(over: Partial<AgendaClienteEmailItem> = {}): AgendaClienteEmailItem {
  return item({
    cliente_id: null,
    cliente_email: null,
    cliente_nome: null,
    destinatario: "convidado",
    email: "convidada@fora.test",
    nome: "Bia Convidada",
    convidado_id: 77,
    convidado_token: TOKEN_CONVIDADO,
    organizador_nome: "Carla Organizadora",
    organizador_email: "carla@agencia.test",
    ...over,
  });
}

const GUEST_CTX = { hubUrl: "", botaoUrl: `${APP}/convite/${TOKEN_CONVIDADO}?ocorrencia=11`, unsubUrl: UNSUB, agora: AGORA };

Deno.test("guest convite: greeting by name, organizer line, invite button, no Hub copy", () => {
  const { subject, html, attachments } = montarEmailAgendaCliente(guest(), GUEST_CTX);
  assertEquals(subject, "Convite: Gravação");
  assert(html.includes("Olá, Bia Convidada!"));
  assert(html.includes("Carla Organizadora convidou você em nome de Agencia X."));
  assert(html.includes(`href="${APP}/convite/${TOKEN_CONVIDADO}?ocorrencia=11"`));
  assert(html.includes("Responder ao convite"));
  for (const hub of ["compartilhou", "Confirmar presença", "Ver no portal", "portal", "/agenda?ocorrencia="]) {
    assert(!html.includes(hub), `guest e-mail must not carry Hub copy: ${hub}`);
  }
  assertEquals(attachments.length, 1);
  assert(decodeAnexo(attachments[0].content).includes("SEQUENCE:2"));
  assert(html.includes(UNSUB));
  assert(!html.includes("—") && !subject.includes("—"));
});

Deno.test("guest convite without a name greets 'Olá!' and without an organizer names the workspace", () => {
  const { html } = montarEmailAgendaCliente(guest({ nome: null, organizador_nome: null }), GUEST_CTX);
  assert(html.includes("Olá! Agencia X convidou você para um evento."));
  assert(!html.includes("Olá, "));
  assert(!html.includes("em nome de"));
});

Deno.test("guest organizer and name are escaped", () => {
  const { html } = montarEmailAgendaCliente(
    guest({ nome: "<b>Bia</b>", organizador_nome: "<img src=x>" }),
    GUEST_CTX,
  );
  assert(html.includes("Olá, &lt;b&gt;Bia&lt;/b&gt;!"));
  assert(html.includes("&lt;img src=x&gt; convidou você"));
  assert(!html.includes("<img src=x>"));
});

Deno.test("guest alteracao: no organizer line (only on convite), button kept, update hint", () => {
  const { subject, html, attachments } = montarEmailAgendaCliente(guest({ tipo: "alteracao" }), GUEST_CTX);
  assertEquals(subject, "Evento atualizado: Gravação");
  assert(!html.includes("convidou você"));
  assert(html.includes("Agencia X atualizou um evento."));
  assert(html.includes(AVISO_ALTERACAO));
  assert(html.includes("Responder ao convite"));
  assertEquals(attachments.length, 1);
});

Deno.test("guest cancelamento: no button even with a URL, no attachment, removal hint", () => {
  const { subject, html, attachments } = montarEmailAgendaCliente(
    guest({ tipo: "cancelamento", convidado_token: null, ocorrencias: [oc({ estado: "cancelada" })] }),
    GUEST_CTX,
  );
  assertEquals(subject, "Evento cancelado: Gravação");
  assertEquals(attachments, []);
  assert(html.includes(AVISO_CANCELAMENTO));
  assert(!html.includes("Responder ao convite"));
  assert(!html.includes("/convite/"));
  assert(!html.includes("convidou você"));
});

Deno.test("guest with botaoUrl null: no button, attachment kept", () => {
  const { html, attachments } = montarEmailAgendaCliente(guest(), { ...GUEST_CTX, botaoUrl: null });
  assert(!html.includes("Responder ao convite"));
  assertEquals(attachments.length, 1);
});

function guestDeps(db: AgendaClienteEmailDb, over: Record<string, unknown> = {}) {
  let hubCalls = 0;
  const built = baseDeps(db, {
    resolveHubUrl: () => {
      hubCalls++;
      return Promise.resolve(HUB);
    },
    appBaseUrl: () => APP,
    ...over,
  });
  return { ...built, hubCalls: () => hubCalls };
}

type Sent = [string, string, string, string, string, string | undefined, Record<string, string>, Array<{ filename: string }>];

Deno.test("run guest: to the guest address, invite button, Reply-To = organizer (positional), {g} unsubscribe, no Hub lookup", async () => {
  const { db, marks } = makeDb([guest()]);
  const { deps, sent, hubCalls } = guestDeps(db);
  const r = await runAgendaClienteEmail(deps);
  assertEquals(r, { enviados: 1, falhas: 0 });
  const [to, subject, html, key, from, replyTo, headers, attachments] = sent[0] as Sent;
  assertEquals(to, "convidada@fora.test");
  assertEquals(subject, "Convite: Gravação");
  assert(html.includes(`href="${APP}/convite/${TOKEN_CONVIDADO}?ocorrencia=11"`));
  assert(html.includes("Olá, Bia Convidada!"));
  assertEquals(key, "agenda-cliente:5:3");
  assertEquals(from, '"Agencia X" <notificacoes@mesaas.com.br>');
  assertEquals(replyTo, "carla@agencia.test");
  const unsubUrl = `https://x.supabase.co/functions/v1/client-email-unsub/${await signUnsubTokenFor({ g: 77 }, "test-secret")}`;
  assertEquals(headers, { "List-Unsubscribe": `<${unsubUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" });
  assert(!("Reply-To" in headers));
  assert(html.includes(unsubUrl));
  assert(!html.includes(await signUnsubToken(77, "test-secret")), "never a {c} token for a guest");
  assertEquals(attachments.map((a) => a.filename), ["evento.ics"]);
  assertEquals(hubCalls(), 0);
  assertEquals(marks().map((m) => m.args), [{ p_id: 5, p_versao: 3, p_ok: true, p_erro: null }]);
});

Deno.test("run guest: the button deep-links the first ACTIVE occurrence", async () => {
  const { db } = makeDb([guest({
    tipo: "alteracao",
    ocorrencias: [oc({ ocorrencia_id: 10, estado: "cancelada" }), oc({ ocorrencia_id: 12 })],
  })]);
  const { deps, sent } = guestDeps(db, { appBaseUrl: () => `${APP}/` });
  await runAgendaClienteEmail(deps);
  assert((sent[0][2] as string).includes(`href="${APP}/convite/${TOKEN_CONVIDADO}?ocorrencia=12"`));
});

Deno.test("run guest: appBaseUrl throwing sends without a button, .ics still attached", async () => {
  const { db, marks } = makeDb([guest()]);
  const { deps, sent } = guestDeps(db, {
    appBaseUrl: () => {
      throw new Error("APP_BASE_URL environment variable is required");
    },
  });
  const r = await runAgendaClienteEmail(deps);
  assertEquals(r, { enviados: 1, falhas: 0 });
  const html = sent[0][2] as string;
  assert(!html.includes("Responder ao convite"));
  assert(!html.includes("/convite/"));
  assertEquals((sent[0][7] as unknown[]).length, 1);
  assertEquals(marks()[0].args.p_ok, true);
});

Deno.test("run guest: no Reply-To when the organizer is gone or the address is unsafe", async () => {
  for (const organizador_email of [null, "", "a@b.c\r\nBcc: x@y.z", "dois@a.test, tres@b.test"]) {
    const { db } = makeDb([guest({ organizador_email })]);
    const { deps, sent } = guestDeps(db);
    await runAgendaClienteEmail(deps);
    assertEquals(sent[0][5], undefined, String(organizador_email));
  }
});

Deno.test("run guest: removed guest's cancelamento (token NULL) still goes out, no button, no appBaseUrl call", async () => {
  let appCalls = 0;
  const { db } = makeDb([guest({ tipo: "cancelamento", convidado_token: null, ocorrencias: [oc({ estado: "cancelada" })] })]);
  const { deps, sent, hubCalls } = guestDeps(db, {
    appBaseUrl: () => {
      appCalls++;
      return APP;
    },
  });
  const r = await runAgendaClienteEmail(deps);
  assertEquals(r, { enviados: 1, falhas: 0 });
  assert(!(sent[0][2] as string).includes("Responder ao convite"));
  assertEquals(sent[0][7], []);
  assertEquals(appCalls, 0);
  assertEquals(hubCalls(), 0);
});

Deno.test("run guest: a guest row without e-mail or id is marked failed, never sent", async () => {
  const { db, marks } = makeDb([guest({ email: null }), guest({ id: 6, convidado_id: null })]);
  const { deps, sent } = guestDeps(db);
  const r = await runAgendaClienteEmail(deps);
  assertEquals(r, { enviados: 0, falhas: 2 });
  assertEquals(sent.length, 0);
  assertEquals(marks().map((m) => m.args.p_ok), [false, false]);
});

Deno.test("run: a client item tagged destinatario 'cliente' keeps the Hub path and no Reply-To", async () => {
  const { db } = makeDb([item({ destinatario: "cliente", organizador_email: "carla@agencia.test" })]);
  const { deps, sent, hubCalls } = guestDeps(db);
  await runAgendaClienteEmail(deps);
  assert((sent[0][2] as string).includes(`${HUB}/agenda?ocorrencia=11`));
  assertEquals(sent[0][5], undefined);
  assertEquals(hubCalls(), 1);
  const unsubUrl = `https://x.supabase.co/functions/v1/client-email-unsub/${await signUnsubToken(42, "test-secret")}`;
  assert((sent[0][2] as string).includes(unsubUrl));
});

Deno.test("mesDiaAgenda: timed event uses its zone; all-day uses data_inicio_local", () => {
  assertEquals(mesDiaAgenda({ inicio: "2026-10-15T13:00:00Z", fim: "2026-10-15T14:00:00Z", dia_inteiro: false, tz: "America/Sao_Paulo" }), { mes: "OUT", dia: "15" });
  // 02:30Z on the 16th is still the 15th in Manaus (UTC-4).
  assertEquals(mesDiaAgenda({ inicio: "2026-10-16T02:30:00Z", fim: "2026-10-16T03:30:00Z", dia_inteiro: false, tz: "America/Manaus" }), { mes: "OUT", dia: "15" });
  // All-day: the stored local date wins, never inicio converted.
  assertEquals(mesDiaAgenda({ inicio: "2026-10-16T04:00:00Z", fim: "2026-10-17T04:00:00Z", dia_inteiro: true, data_inicio_local: "2026-10-16", tz: "America/Manaus" }), { mes: "OUT", dia: "16" });
});

Deno.test("agenda-cliente: tile day equals the 'quando' day for an all-day event in another zone", () => {
  const feriado = oc({
    ocorrencia_id: 1,
    dia_inteiro: true,
    inicio: "2026-11-02T04:00:00Z",
    fim: "2026-11-03T04:00:00Z",
    data_inicio_local: "2026-11-02",
    data_fim_local: "2026-11-03",
    tz: "America/Manaus",
    titulo: "Feriado",
  });
  const { html } = montarEmailAgendaCliente(item({ tipo: "convite", ocorrencias: [feriado] }), CTX);
  assert(html.includes(">NOV<") && html.includes(">2<"), "tile");
  assert(html.includes("Segunda, 2 de novembro · dia inteiro"), "quando");
});

Deno.test("agenda-cliente: brand band kept, light brand flips tile/button text, organizer line, no emoji", () => {
  const { html } = montarEmailAgendaCliente(item({ tipo: "convite", brand_color: "#facc15", organizador_nome: "Ana Souza" }), CTX);
  assert(html.includes("background: #facc15"), "band");
  assert(html.split("color: #171717;").length - 1 >= 3, "dark text on light brand: band, tile and button");
  assert(html.includes("Organizado por Ana Souza"));
  assert(!/[📅💬]/u.test(html));
  assert(html.includes(`<meta name="color-scheme" content="light">`));
});
