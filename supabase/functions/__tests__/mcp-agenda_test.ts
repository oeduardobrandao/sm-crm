import { assert, assertEquals } from "./assert.ts";
import { McpInputError } from "../_shared/mcp-token.ts";
import {
  AGENDA_FLAG_OFF,
  AGENDA_SCOPE,
  agendaFail,
  agendaPrivados,
  buildEventoPayload,
  createAgendaEvent,
  deleteAgendaEvent,
  formatOcorrencia,
  getAgendaEvent,
  listAgendaEvents,
  resolveParticipants,
  toWallClock,
  updateAgendaEvent,
} from "../mcp/agenda.ts";
import { makeDeps, makeFakeDb, rpcArgs } from "./mcp-financeiro-helpers.ts";

const SP = "America/Sao_Paulo";

// deno-lint-ignore no-explicit-any
type Ctor = new (...a: any[]) => Error;
function check(e: unknown, cls?: Ctor, includes?: string): Error {
  if (cls) assert(e instanceof cls, `expected ${cls.name}, got ${String(e)}`);
  if (includes) assert(String((e as Error).message).includes(includes), `"${(e as Error).message}" lacks "${includes}"`);
  return e as Error;
}
function assertThrows(fn: () => unknown, cls?: Ctor, includes?: string): Error {
  try {
    fn();
  } catch (e) {
    return check(e, cls, includes);
  }
  throw new Error("expected a throw");
}
async function assertRejects(fn: () => Promise<unknown>, cls?: Ctor, includes?: string): Promise<Error> {
  try {
    await fn();
  } catch (e) {
    return check(e, cls, includes);
  }
  throw new Error("expected a rejection");
}

function row(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ocorrencia_id: 10,
    evento_id: 5,
    data_original: "2026-12-03",
    inicio: "2026-12-03T13:00:00+00:00",
    fim: "2026-12-03T14:00:00+00:00",
    dia_inteiro: false,
    data_inicio_local: "2026-12-03",
    data_fim_local: "2026-12-04",
    titulo: "Reunião",
    descricao: "Pauta",
    local: "Sala 1",
    link_reuniao: "https://meet.example/x",
    tipo: "reuniao",
    cor: "#ff0000",
    cliente_id: 7,
    cliente_nome: "Cliente X",
    privado: false,
    mascarado: false,
    recorrente: false,
    regra: null,
    lembretes: [10],
    organizador_id: "user-1",
    participantes: [{ user_id: "user-2", resposta: "sim" }],
    minha_resposta: null,
    pode_editar: true,
    pode_responder: false,
    tz: SP,
    compartilhado_cliente: false,
    cliente_resposta: null,
    remarcacao_pendente: null,
    sequencia: 0,
    convidados: [],
    ...over,
  };
}

// ---- toWallClock -------------------------------------------------------------------------------

Deno.test("toWallClock: wall clock passes through unchanged", () => {
  assertEquals(toWallClock("2026-12-03T10:00", SP), "2026-12-03T10:00");
});

Deno.test("toWallClock: seconds without offset are local wall clock, truncated", () => {
  assertEquals(toWallClock("2026-12-03T10:00:00", SP), "2026-12-03T10:00");
  assertEquals(toWallClock("2026-12-03T10:00:00.000", SP), "2026-12-03T10:00");
  assertThrows(() => toWallClock("2026-12-03T10:00:61", SP), McpInputError);
});

Deno.test("toWallClock: Z instant converts to the timezone", () => {
  assertEquals(toWallClock("2026-12-03T13:00:00Z", SP), "2026-12-03T10:00");
});

Deno.test("toWallClock: offset instant converts to the timezone", () => {
  assertEquals(toWallClock("2026-12-03T10:00:00-03:00", SP), "2026-12-03T10:00");
});

Deno.test("toWallClock: free text throws", () => {
  assertThrows(() => toWallClock("amanhã", SP), McpInputError, "Use data e hora no formato YYYY-MM-DDTHH:MM");
});

// ---- buildEventoPayload ------------------------------------------------------------------------

Deno.test("buildEventoPayload: all-day inclusive end becomes exclusive", () => {
  const { evento } = buildEventoPayload(
    { title: "Feriado", all_day: true, start_date: "2026-12-03", end_date: "2026-12-03" },
    { tz: SP, isUpdate: false },
  );
  assertEquals(evento.inicio_local, "2026-12-03");
  assertEquals(evento.fim_local, "2026-12-04");
  assertEquals(evento.dia_inteiro, true);
});

Deno.test("buildEventoPayload: all-day end crosses month and year", () => {
  const { evento } = buildEventoPayload(
    { all_day: true, start_date: "2026-12-30", end_date: "2026-12-31" },
    { tz: SP, isUpdate: true },
  );
  assertEquals(evento.fim_local, "2027-01-01");
});

Deno.test("buildEventoPayload: update with only title emits only titulo", () => {
  const out = buildEventoPayload({ title: "Novo" }, { tz: SP, isUpdate: true });
  assertEquals(out.evento, { titulo: "Novo" });
  assertEquals(out.participantesMemberIds, undefined);
});

Deno.test("buildEventoPayload: update with start and no end throws", () => {
  assertThrows(
    () => buildEventoPayload({ start: "2026-12-03T10:00" }, { tz: SP, isUpdate: true }),
    McpInputError,
  );
});

Deno.test("buildEventoPayload: start_date without end_date throws", () => {
  assertThrows(
    () => buildEventoPayload({ all_day: true, start_date: "2026-12-03" }, { tz: SP, isUpdate: false }),
    McpInputError,
  );
});

Deno.test("buildEventoPayload: update ignores timezone", () => {
  const out = buildEventoPayload({ title: "x", timezone: "Europe/Lisbon" } as never, { tz: SP, isUpdate: true });
  assertEquals(out.evento, { titulo: "x" });
});

Deno.test("buildEventoPayload: create maps every field", () => {
  const out = buildEventoPayload(
    {
      title: "T",
      description: "D",
      location: "L",
      meeting_link: "https://m",
      type: "reuniao",
      color: "#000",
      client_id: 3,
      share_with_client: true,
      private: false,
      reminders: [10, 60],
      start: "2026-12-03T13:00:00Z",
      end: "2026-12-03T14:30",
      timezone: SP,
      recurrence: { freq: "weekly", interval: 2, weekdays: [1, 3], until: "2027-01-31" },
      participant_member_ids: [4, 5],
    },
    { tz: SP, isUpdate: false },
  );
  assertEquals(out.evento, {
    titulo: "T",
    descricao: "D",
    local: "L",
    link_reuniao: "https://m",
    tipo: "reuniao",
    cor: "#000",
    cliente_id: 3,
    compartilhado_cliente: true,
    privado: false,
    lembretes: [10, 60],
    tz: SP,
    inicio_local: "2026-12-03T10:00",
    fim_local: "2026-12-03T14:30",
    regra: { freq: "weekly", intervalo: 2, dias_semana: [1, 3], ate: "2027-01-31" },
  });
  assertEquals(out.participantesMemberIds, [4, 5]);
});

Deno.test("buildEventoPayload: monthly recurrence and count; null recurrence clears", () => {
  const a = buildEventoPayload(
    { recurrence: { freq: "monthly", monthly_mode: "dia_semana", monthly_ordinal: -1, count: 6 } },
    { tz: SP, isUpdate: true },
  );
  assertEquals(a.evento.regra, { freq: "monthly", mensal_modo: "dia_semana", mensal_ordinal: -1, contagem: 6 });
  const b = buildEventoPayload({ recurrence: null }, { tz: SP, isUpdate: true });
  assertEquals(b.evento, { regra: null });
});

// ---- formatOcorrencia --------------------------------------------------------------------------

Deno.test("formatOcorrencia: masked row keeps only the masked fields", () => {
  const out = formatOcorrencia(row({ mascarado: true, privado: true, titulo: null }), new Map());
  assertEquals(Object.keys(out).sort(), [
    "all_day", "can_edit", "end", "end_date", "event_id", "masked", "occurrence_id", "private", "start", "start_date",
    "timezone", "title",
  ]);
  assertEquals(out.title, "Ocupado");
  assertEquals(out.masked, true);
  assertEquals(out.private, true);
  assertEquals(out.can_edit, false);
});

Deno.test("formatOcorrencia: all-day end_date is inclusive", () => {
  const out = formatOcorrencia(
    row({ dia_inteiro: true, data_inicio_local: "2026-12-03", data_fim_local: "2026-12-04" }),
    new Map(),
  );
  assertEquals(out.start_date, "2026-12-03");
  assertEquals(out.end_date, "2026-12-03");
  assertEquals(out.all_day, true);
});

Deno.test("formatOcorrencia: guests counted, emails never emitted", () => {
  const out = formatOcorrencia(
    row({
      convidados: [
        { id: 1, email: "a@x.com", nome: "A", resposta: null },
        { id: 2, email: "b@x.com", nome: "B", resposta: "sim" },
      ],
    }),
    new Map(),
  );
  assertEquals(out.guest_count, 2);
  assert(!JSON.stringify(out).includes("email"));
  assert(!JSON.stringify(out).includes("a@x.com"));
});

Deno.test("formatOcorrencia: people resolved from the map, unknown as nulls", () => {
  const people = new Map([["user-1", { member_id: 3, name: "Ana" }]]);
  const out = formatOcorrencia(row(), people);
  assertEquals(out.organizer, { user_id: "user-1", member_id: 3, name: "Ana" });
  assertEquals(out.participants, [{ user_id: "user-2", member_id: null, name: null, answer: "sim" }]);
});

Deno.test("formatOcorrencia: recurrence mapped back to English keys", () => {
  const out = formatOcorrencia(
    row({
      recorrente: true,
      regra: {
        freq: "weekly", intervalo: 1, dias_semana: [2], mensal_modo: null, mensal_ordinal: null, ate: null, contagem: 4,
      },
    }),
    new Map(),
  );
  assertEquals(out.recurring, true);
  assertEquals(out.recurrence, {
    freq: "weekly", interval: 1, weekdays: [2], monthly_mode: null, monthly_ordinal: null, until: null, count: 4,
  });
});

Deno.test("formatOcorrencia: timed end_date is the inclusive last day", () => {
  const out = formatOcorrencia(row({ data_inicio_local: "2026-12-03", data_fim_local: "2026-12-04" }), new Map());
  assertEquals(out.start_date, "2026-12-03");
  assertEquals(out.end_date, "2026-12-03");
});

// ---- agendaPrivados / list ---------------------------------------------------------------------

Deno.test("agendaPrivados: only OAuth connections see private events", () => {
  assertEquals(agendaPrivados({ key_id: "oauth:abc" } as never), true);
  assertEquals(agendaPrivados({ key_id: "k1" } as never), false);
});

Deno.test("listAgendaEvents: API key passes p_privados false with actor and workspace", async () => {
  const { db, calls } = makeFakeDb({ membros: [{ data: [], error: null }] }, {
    agenda_listar_as: [{ data: [row()], error: null }],
  });
  const out = await listAgendaEvents(makeDeps(db, { key_id: "mesaas_sk_1" }), {
    from: "2026-12-01T00:00:00Z",
    to: "2026-12-10T00:00:00Z",
  });
  const args = rpcArgs(calls, "agenda_listar_as")!;
  assertEquals(args.p_conta, "workspace-A");
  assertEquals(args.p_user, "user-1");
  assertEquals(args.p_privados, false);
  assertEquals(args.p_ocorrencia_id, null);
  assertEquals(out.events.length, 1);
});

Deno.test("listAgendaEvents: OAuth passes p_privados true", async () => {
  const { db, calls } = makeFakeDb({}, { agenda_listar_as: [{ data: [], error: null }] });
  await listAgendaEvents(makeDeps(db, { key_id: "oauth:x" }), { from: "2026-12-01", to: "2026-12-10" });
  assertEquals(rpcArgs(calls, "agenda_listar_as")!.p_privados, true);
});

Deno.test("listAgendaEvents: date-only window is São Paulo days, end exclusive next day", async () => {
  const { db, calls } = makeFakeDb({}, { agenda_listar_as: [{ data: [], error: null }] });
  await listAgendaEvents(makeDeps(db), { from: "2026-12-01", to: "2026-12-10" });
  const args = rpcArgs(calls, "agenda_listar_as")!;
  assertEquals(args.p_de, "2026-12-01T03:00:00.000Z");
  assertEquals(args.p_ate, "2026-12-11T03:00:00.000Z");
});

Deno.test("listAgendaEvents: client_id filters rows", async () => {
  const { db } = makeFakeDb({}, {
    agenda_listar_as: [{
      data: [row({ ocorrencia_id: 1, cliente_id: 7 }), row({ ocorrencia_id: 2, cliente_id: 8 })],
      error: null,
    }],
  });
  const out = await listAgendaEvents(makeDeps(db), { from: "2026-12-01", to: "2026-12-10", client_id: 8 });
  assertEquals(out.events.map((e) => e.occurrence_id), [2]);
});

Deno.test("listAgendaEvents: people resolved with one membros query", async () => {
  const { db, calls } = makeFakeDb({
    membros: [{ data: [{ id: 3, nome: "Ana", crm_user_id: "user-1" }], error: null }],
    profiles: [{ data: [{ id: "user-2", nome: "Beto" }], error: null }],
  }, {
    agenda_listar_as: [{ data: [row({ ocorrencia_id: 1 }), row({ ocorrencia_id: 2 })], error: null }],
  });
  const out = await listAgendaEvents(makeDeps(db), { from: "2026-12-01", to: "2026-12-10" });
  assertEquals(calls.filter((c) => c.table === "membros" && c.method === "from").length, 1);
  assertEquals(calls.filter((c) => c.table === "profiles" && c.method === "from").length, 1);
  assert(calls.some((c) => c.table === "membros" && c.method === "eq" && c.args[0] === "conta_id" && c.args[1] === "workspace-A"));
  assertEquals(out.events[0].organizer, { user_id: "user-1", member_id: 3, name: "Ana" });
  assertEquals(out.events[1].participants, [{ user_id: "user-2", member_id: null, name: "Beto", answer: "sim" }]);
});

Deno.test("listAgendaEvents: flag off returns an empty list with the note", async () => {
  const { db } = makeFakeDb({}, {
    agenda_listar_as: [{ data: null, error: { message: "feature_disabled:feature_agenda" } }],
  });
  const out = await listAgendaEvents(makeDeps(db), { from: "2026-12-01", to: "2026-12-10" });
  assertEquals(out, { events: [], note: AGENDA_FLAG_OFF });
});

Deno.test("listAgendaEvents: bad from throws", async () => {
  const { db } = makeFakeDb({});
  await assertRejects(() => listAgendaEvents(makeDeps(db), { from: "ontem", to: "2026-12-10" }), McpInputError);
});

Deno.test("getAgendaEvent: missing occurrence is an input error", async () => {
  const { db, calls } = makeFakeDb({}, { agenda_listar_as: [{ data: [], error: null }] });
  await assertRejects(() => getAgendaEvent(makeDeps(db), { occurrence_id: 99 }), McpInputError, "Evento não encontrado.");
  assertEquals(rpcArgs(calls, "agenda_listar_as")!.p_ocorrencia_id, 99);
});

// ---- resolveParticipants -----------------------------------------------------------------------

Deno.test("resolveParticipants: maps membros ids to logins", async () => {
  const { db, calls } = makeFakeDb({
    membros: [{ data: [{ id: 4, nome: "Ana", crm_user_id: "u4" }, { id: 5, nome: "Beto", crm_user_id: "u5" }], error: null }],
  });
  assertEquals(await resolveParticipants(makeDeps(db), [5, 4]), ["u5", "u4"]);
  assert(calls.some((c) => c.table === "membros" && c.method === "eq" && c.args[0] === "conta_id"));
});

Deno.test("resolveParticipants: member without login names them", async () => {
  const { db } = makeFakeDb({ membros: [{ data: [{ id: 4, nome: "Carla", crm_user_id: null }], error: null }] });
  await assertRejects(() => resolveParticipants(makeDeps(db), [4]), McpInputError, "Carla");
});

Deno.test("resolveParticipants: unknown id is an error", async () => {
  const { db } = makeFakeDb({ membros: [{ data: [], error: null }] });
  await assertRejects(() => resolveParticipants(makeDeps(db), [42]), McpInputError, "42");
});

// ---- writes ------------------------------------------------------------------------------------

Deno.test("createAgendaEvent: calls the _as RPC with payload, participants and default tz", async () => {
  const { db, calls } = makeFakeDb({
    membros: [{ data: [{ id: 4, nome: "Ana", crm_user_id: "u4" }], error: null }],
  }, {
    agenda_evento_criar_as: [{ data: [{ evento_id: 5, ocorrencia_id: 10, dtstart: "2026-12-03T10:00:00" }], error: null }],
  });
  const out = await createAgendaEvent(makeDeps(db, { key_id: "oauth:z" }), {
    title: "R",
    start: "2026-12-03T10:00",
    end: "2026-12-03T11:00",
    participant_member_ids: [4],
  });
  const args = rpcArgs(calls, "agenda_evento_criar_as")!;
  assertEquals(args.p_conta, "workspace-A");
  assertEquals(args.p_user, "user-1");
  assertEquals(args.p_privados, true);
  assertEquals(args.p_evento, {
    titulo: "R", dia_inteiro: false, tz: SP, inicio_local: "2026-12-03T10:00", fim_local: "2026-12-03T11:00",
  });
  assertEquals(args.p_participantes, ["u4"]);
  assertEquals(out, { event_id: 5, occurrence_id: 10 });
});

Deno.test("createAgendaEvent: flag off maps to the flag copy", async () => {
  const { db } = makeFakeDb({}, {
    agenda_evento_criar_as: [{ data: null, error: { message: "feature_disabled:feature_agenda" } }],
  });
  await assertRejects(
    () => createAgendaEvent(makeDeps(db), { title: "R", start: "2026-12-03T10:00", end: "2026-12-03T11:00" }),
    McpInputError,
    AGENDA_FLAG_OFF,
  );
});

Deno.test("updateAgendaEvent: reads first, converts with the event tz, maps scope", async () => {
  const { db, calls } = makeFakeDb({}, {
    agenda_listar_as: [{ data: [row({ tz: "Europe/Lisbon" })], error: null }],
    agenda_evento_editar_as: [{ data: 10, error: null }],
  });
  const out = await updateAgendaEvent(makeDeps(db), {
    occurrence_id: 10,
    scope: "this_and_following",
    start: "2026-12-03T13:00:00Z",
    end: "2026-12-03T14:00:00Z",
  });
  const args = rpcArgs(calls, "agenda_evento_editar_as")!;
  assertEquals(args.p_ocorrencia_id, 10);
  assertEquals(args.p_escopo, "seguintes");
  assertEquals(args.p_evento, { inicio_local: "2026-12-03T13:00", fim_local: "2026-12-03T14:00" });
  assertEquals(args.p_participantes, null);
  assertEquals(out, { occurrence_id: 10 });
});

Deno.test("updateAgendaEvent: not found and not editable", async () => {
  const a = makeFakeDb({}, { agenda_listar_as: [{ data: [], error: null }] });
  await assertRejects(
    () => updateAgendaEvent(makeDeps(a.db), { occurrence_id: 1, scope: "this", title: "x" }),
    McpInputError,
    "Evento não encontrado.",
  );
  const b = makeFakeDb({}, { agenda_listar_as: [{ data: [row({ pode_editar: false })], error: null }] });
  await assertRejects(
    () => updateAgendaEvent(makeDeps(b.db), { occurrence_id: 1, scope: "this", title: "x" }),
    McpInputError,
    "Você não pode editar este evento.",
  );
  const c = makeFakeDb({}, { agenda_listar_as: [{ data: [row({ mascarado: true, pode_editar: true })], error: null }] });
  await assertRejects(
    () => updateAgendaEvent(makeDeps(c.db), { occurrence_id: 1, scope: "all", title: "x" }),
    McpInputError,
    "Você não pode editar este evento.",
  );
  assert(!b.calls.some((x) => x.table === "rpc:agenda_evento_editar_as"));
});

Deno.test("updateAgendaEvent: switching to all-day sends dia_inteiro", async () => {
  const { db, calls } = makeFakeDb({}, {
    agenda_listar_as: [{ data: [row({ dia_inteiro: false })], error: null }],
    agenda_evento_editar_as: [{ data: 10, error: null }],
  });
  await updateAgendaEvent(makeDeps(db), {
    occurrence_id: 10, scope: "this", start_date: "2026-12-03", end_date: "2026-12-04",
  });
  assertEquals(rpcArgs(calls, "agenda_evento_editar_as")!.p_evento, {
    dia_inteiro: true, inicio_local: "2026-12-03", fim_local: "2026-12-05",
  });
});

Deno.test("updateAgendaEvent: participants replaced when given", async () => {
  const { db, calls } = makeFakeDb({
    membros: [{ data: [{ id: 4, nome: "Ana", crm_user_id: "u4" }], error: null }],
  }, {
    agenda_listar_as: [{ data: [row()], error: null }],
    agenda_evento_editar_as: [{ data: 10, error: null }],
  });
  await updateAgendaEvent(makeDeps(db), { occurrence_id: 10, scope: "all", participant_member_ids: [4] });
  const args = rpcArgs(calls, "agenda_evento_editar_as")!;
  assertEquals(args.p_participantes, ["u4"]);
  assertEquals(args.p_escopo, "todas");
});

Deno.test("deleteAgendaEvent: maps scope and calls the _as RPC", async () => {
  const { db, calls } = makeFakeDb({}, { agenda_evento_excluir_as: [{ data: null, error: null }] });
  const out = await deleteAgendaEvent(makeDeps(db), { occurrence_id: 10, scope: "this" });
  const args = rpcArgs(calls, "agenda_evento_excluir_as")!;
  assertEquals(args, { p_conta: "workspace-A", p_user: "user-1", p_privados: false, p_ocorrencia_id: 10, p_escopo: "esta" });
  assertEquals(out, { deleted: true, occurrence_id: 10, scope: "this" });
});

// ---- agendaFail --------------------------------------------------------------------------------

Deno.test("AGENDA_SCOPE maps the three scopes", () => {
  assertEquals(AGENDA_SCOPE, { this: "esta", this_and_following: "seguintes", all: "todas" });
});

Deno.test("agendaFail: flag off", () => {
  assertThrows(() => agendaFail({ message: "feature_disabled:feature_agenda" }), McpInputError, AGENDA_FLAG_OFF);
});

Deno.test("agendaFail: agenda: prefix stripped", () => {
  const e = assertThrows(() => agendaFail({ message: "agenda: período inválido" }), McpInputError);
  assertEquals(e.message, "período inválido");
});

Deno.test("agendaFail: client scope", () => {
  assertThrows(
    () => agendaFail({ message: "client_scope_restricted", code: "42501" }),
    McpInputError,
    "Você não tem acesso a esse cliente.",
  );
});

Deno.test("agendaFail: anything else rethrown as is (generic)", () => {
  const raw = { message: "duplicate key value violates unique constraint", code: "23505" };
  try {
    agendaFail(raw);
  } catch (e) {
    assertEquals(e, raw);
    assert(!(e instanceof McpInputError));
    return;
  }
  throw new Error("did not throw");
});
