// deno-lint-ignore-file no-explicit-any
// Agenda do workspace para o MCP. Tudo passa pelas RPCs `agenda_*_as`, que julgam permissão, escopo
// de cliente e privacidade em `p_conta` com o usuário da chave como ator. A única consulta direta é a
// resolução de pessoas, com lista fechada de campos: `membros` sempre filtrado por
// `conta_id = ctx.conta_id` (o service role ignora RLS, então o filtro é a barreira); o fallback em
// `profiles` só busca nomes de user ids que vieram das linhas do RPC, já restritas a `p_conta`.
import { McpInputError } from "../_shared/mcp-token.ts";
import type { McpKeyContext } from "../_shared/mcp-token.ts";
import type { Deps } from "./queries.ts";

export const AGENDA_DEFAULT_TZ = "America/Sao_Paulo";
export const AGENDA_FLAG_OFF = "A Agenda não está ativa neste workspace.";
export const AGENDA_MASKED_TITLE = "Ocupado";

const NOT_FOUND = "Evento não encontrado.";
const NOT_EDITABLE = "Você não pode editar este evento.";
const WALL_CLOCK_COPY = "Use data e hora no formato YYYY-MM-DDTHH:MM";
const DATE_COPY = "Use datas no formato YYYY-MM-DD";

export type AgendaScope = "this" | "this_and_following" | "all";

export const AGENDA_SCOPE: Record<AgendaScope, "esta" | "seguintes" | "todas"> = {
  this: "esta",
  this_and_following: "seguintes",
  all: "todas",
};

export interface AgendaRecurrenceArgs {
  freq: "daily" | "weekly" | "monthly" | "yearly";
  interval?: number;
  weekdays?: number[];
  monthly_mode?: "dia_mes" | "dia_semana";
  monthly_ordinal?: number;
  until?: string | null;
  count?: number | null;
}

export interface AgendaWriteArgs {
  title?: string;
  description?: string | null;
  location?: string | null;
  meeting_link?: string | null;
  type?: string;
  color?: string | null;
  client_id?: number | null;
  share_with_client?: boolean;
  private?: boolean;
  reminders?: number[] | null;
  all_day?: boolean;
  start?: string;
  end?: string;
  start_date?: string;
  end_date?: string;
  /** Create only: a series' timezone is fixed at creation. */
  timezone?: string;
  recurrence?: AgendaRecurrenceArgs | null;
  participant_member_ids?: number[];
}

export interface AgendaPerson {
  user_id: string;
  member_id: number | null;
  name: string | null;
}

export type AgendaOccurrence = Record<string, any>;

type People = Map<string, { member_id: number | null; name: string | null }>;

// ---- erros -------------------------------------------------------------------------------------

/** Relança um erro da Agenda em português; o resto segue como veio (vira o erro genérico do MCP). */
export function agendaFail(error: unknown): never {
  const message = error !== null && typeof error === "object" ? (error as { message?: unknown }).message : undefined;
  if (typeof message === "string") {
    if (message === "feature_disabled:feature_agenda") throw new McpInputError(AGENDA_FLAG_OFF);
    if (message.startsWith("agenda: ")) throw new McpInputError(message.slice("agenda: ".length));
    if (message === "client_scope_restricted") throw new McpInputError("Você não tem acesso a esse cliente.");
  }
  throw error;
}

/** Eventos privados só aparecem numa conexão OAuth (a pessoa autorizou no navegador); chave de API nunca. */
export function agendaPrivados(ctx: Pick<McpKeyContext, "key_id">): boolean {
  return ctx.key_id.startsWith("oauth:");
}

async function rpcAs(d: Deps, name: string, params: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await (d.db as any).rpc(name, {
    p_conta: d.ctx.conta_id,
    p_user: d.ctx.created_by,
    p_privados: agendaPrivados(d.ctx),
    ...params,
  });
  if (error) agendaFail(error);
  return data;
}

// ---- tempo -------------------------------------------------------------------------------------

const WALL_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const INSTANT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/i;
const pad = (n: number) => String(n).padStart(2, "0");

function validCalendar(y: number, m: number, d: number): boolean {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function wallParts(date: Date, tz: string): Record<string, number> {
  let fmt: Intl.DateTimeFormat;
  try {
    fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
  } catch {
    throw new McpInputError("Fuso horário inválido.");
  }
  const p = Object.fromEntries(fmt.formatToParts(date).filter((x) => x.type !== "literal").map((x) => [x.type, Number(x.value)]));
  return p as Record<string, number>;
}

/** Hora local `YYYY-MM-DDTHH:MM` no fuso do evento. Segundos sem offset são truncados; um instante com `Z`/offset é convertido. */
export function toWallClock(input: string, tz: string): string {
  const s = String(input ?? "").trim();
  const w = WALL_RE.exec(s);
  if (w) {
    const [y, m, d, h, mi] = w.slice(1, 6).map(Number);
    const sec = w[6] === undefined ? 0 : Number(w[6]);
    if (!validCalendar(y, m, d) || h > 23 || mi > 59 || sec > 59) throw new McpInputError(WALL_CLOCK_COPY);
    // Segundos sem offset são hora local; o banco trunca no minuto de qualquer jeito.
    return s.slice(0, 16);
  }
  if (INSTANT_RE.test(s)) {
    const t = new Date(s);
    if (Number.isNaN(t.getTime())) throw new McpInputError(WALL_CLOCK_COPY);
    const p = wallParts(t, tz);
    return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
  }
  throw new McpInputError(WALL_CLOCK_COPY);
}

function checkDate(s: unknown): string {
  const m = typeof s === "string" ? DATE_RE.exec(s) : null;
  if (!m || !validCalendar(Number(m[1]), Number(m[2]), Number(m[3]))) throw new McpInputError(DATE_COPY);
  return s as string;
}

function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

/** Instante (ISO UTC) de uma hora local no fuso: duas passadas de offset, o bastante sem DST no meio. */
function zonedToInstant(wall: string, tz: string): string {
  const [datePart, timePart = "00:00"] = wall.split("T");
  const [y, m, d] = datePart.split("-").map(Number);
  const [h, mi] = timePart.split(":").map(Number);
  const target = Date.UTC(y, m - 1, d, h, mi);
  let guess = target;
  for (let i = 0; i < 2; i++) {
    const p = wallParts(new Date(guess), tz);
    const seen = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
    guess += target - seen;
  }
  return new Date(guess).toISOString();
}

/** Limite da janela de listagem: data pura vira início do dia (ou do dia seguinte, no `to`) em São Paulo. */
function windowBound(input: string, isEnd: boolean): string {
  const s = String(input ?? "").trim();
  if (DATE_RE.test(s)) {
    const date = checkDate(s);
    return zonedToInstant(`${isEnd ? addDays(date, 1) : date}T00:00`, AGENDA_DEFAULT_TZ);
  }
  if (WALL_RE.test(s)) return zonedToInstant(toWallClock(s, AGENDA_DEFAULT_TZ), AGENDA_DEFAULT_TZ);
  if (INSTANT_RE.test(s)) {
    const t = new Date(s);
    if (!Number.isNaN(t.getTime())) return t.toISOString();
  }
  throw new McpInputError("Use datas no formato YYYY-MM-DD ou data e hora ISO em from e to.");
}

// ---- payload -----------------------------------------------------------------------------------

const has = (o: object, k: string) => Object.hasOwn(o, k) && (o as any)[k] !== undefined;

function mapRecurrence(r: AgendaRecurrenceArgs | null): Record<string, unknown> | null {
  if (r === null) return null;
  const out: Record<string, unknown> = { freq: r.freq };
  if (has(r, "interval")) out.intervalo = r.interval;
  if (has(r, "weekdays")) out.dias_semana = r.weekdays;
  if (has(r, "monthly_mode")) out.mensal_modo = r.monthly_mode;
  if (has(r, "monthly_ordinal")) out.mensal_ordinal = r.monthly_ordinal;
  if (has(r, "until")) out.ate = r.until;
  if (has(r, "count")) out.contagem = r.count;
  return out;
}

/** Monta o `p_evento` do RPC. Só as chaves presentes nos args saem (a edição é patch). */
export function buildEventoPayload(
  args: AgendaWriteArgs,
  opts: { tz: string; isUpdate: boolean },
): { evento: Record<string, unknown>; participantesMemberIds?: number[] } {
  const evento: Record<string, unknown> = {};
  const simple: [keyof AgendaWriteArgs, string][] = [
    ["title", "titulo"],
    ["description", "descricao"],
    ["location", "local"],
    ["meeting_link", "link_reuniao"],
    ["type", "tipo"],
    ["color", "cor"],
    ["client_id", "cliente_id"],
    ["share_with_client", "compartilhado_cliente"],
    ["private", "privado"],
    ["reminders", "lembretes"],
    ["all_day", "dia_inteiro"],
  ];
  for (const [from, to] of simple) if (has(args, from)) evento[to] = args[from];
  if (!opts.isUpdate) evento.tz = has(args, "timezone") ? args.timezone : AGENDA_DEFAULT_TZ;

  const hasStart = has(args, "start");
  const hasEnd = has(args, "end");
  const hasStartDate = has(args, "start_date");
  const hasEndDate = has(args, "end_date");
  if (hasStart !== hasEnd) throw new McpInputError("Informe start e end juntos.");
  if (hasStartDate !== hasEndDate) throw new McpInputError("Informe start_date e end_date juntos.");
  if (hasStart && hasStartDate) {
    throw new McpInputError("Use start/end para evento com horário ou start_date/end_date para dia inteiro, não os dois.");
  }
  if (hasStart) {
    if (args.all_day === true) throw new McpInputError("Evento de dia inteiro usa start_date e end_date.");
    evento.inicio_local = toWallClock(args.start!, opts.tz);
    evento.fim_local = toWallClock(args.end!, opts.tz);
  } else if (hasStartDate) {
    if (args.all_day === false) throw new McpInputError("Evento com horário usa start e end.");
    evento.inicio_local = checkDate(args.start_date);
    evento.fim_local = addDays(checkDate(args.end_date), 1);
  }

  if (has(args, "recurrence")) evento.regra = mapRecurrence(args.recurrence ?? null);

  const out: { evento: Record<string, unknown>; participantesMemberIds?: number[] } = { evento };
  if (has(args, "participant_member_ids")) out.participantesMemberIds = args.participant_member_ids;
  return out;
}

/** Modo implícito no par de horário: start/end é com horário, start_date/end_date é dia inteiro. */
function pairMode(a: AgendaWriteArgs): boolean | undefined {
  if (has(a, "start_date") || has(a, "end_date")) return true;
  if (has(a, "start") || has(a, "end")) return false;
  return undefined;
}

// ---- pessoas -----------------------------------------------------------------------------------

/** `membros.id` → login (`crm_user_id`) no workspace da chave; membro sem login é erro com o nome dele. */
export async function resolveParticipants(d: Deps, memberIds: number[]): Promise<string[]> {
  const ids = [...new Set(memberIds)];
  if (ids.length === 0) return [];
  const { data, error } = await (d.db as any)
    .from("membros")
    .select("id,nome,crm_user_id")
    .eq("conta_id", d.ctx.conta_id)
    .in("id", ids);
  if (error) agendaFail(error);
  const byId = new Map<number, { nome: string | null; crm_user_id: string | null }>();
  for (const r of (data ?? []) as any[]) byId.set(Number(r.id), r);
  const out: string[] = [];
  for (const id of ids) {
    const m = byId.get(Number(id));
    if (!m) throw new McpInputError(`Membro ${id} não encontrado neste workspace.`);
    if (!m.crm_user_id) {
      throw new McpInputError(`O membro ${m.nome ?? id} não tem login no Mesaas e não pode participar de eventos.`);
    }
    out.push(m.crm_user_id);
  }
  return out;
}

/** Nomes de organizador e participantes de todas as linhas: uma consulta em membros, uma em profiles. */
async function loadPeople(d: Deps, rows: any[]): Promise<People> {
  const ids = new Set<string>();
  for (const r of rows) {
    if (r.mascarado) continue;
    if (r.organizador_id) ids.add(String(r.organizador_id));
    for (const p of (r.participantes ?? []) as any[]) if (p?.user_id) ids.add(String(p.user_id));
  }
  const people: People = new Map();
  if (ids.size === 0) return people;
  const list = [...ids];
  const { data, error } = await (d.db as any)
    .from("membros")
    .select("id,nome,crm_user_id")
    .eq("conta_id", d.ctx.conta_id)
    .in("crm_user_id", list);
  if (error) agendaFail(error);
  for (const m of (data ?? []) as any[]) {
    if (m.crm_user_id) people.set(String(m.crm_user_id), { member_id: Number(m.id), name: m.nome ?? null });
  }
  const missing = list.filter((id) => !people.has(id));
  if (missing.length > 0) {
    const prof = await (d.db as any).from("profiles").select("id,nome").in("id", missing);
    if (prof.error) agendaFail(prof.error);
    for (const p of (prof.data ?? []) as any[]) people.set(String(p.id), { member_id: null, name: p.nome ?? null });
  }
  return people;
}

const person = (people: People, userId: string): AgendaPerson => {
  const p = people.get(userId);
  return { user_id: userId, member_id: p?.member_id ?? null, name: p?.name ?? null };
};

// ---- saída -------------------------------------------------------------------------------------

function mapRegraOut(regra: any): Record<string, unknown> | null {
  if (!regra || typeof regra !== "object" || !regra.freq) return null;
  return {
    freq: regra.freq,
    interval: regra.intervalo ?? null,
    weekdays: regra.dias_semana ?? null,
    monthly_mode: regra.mensal_modo ?? null,
    monthly_ordinal: regra.mensal_ordinal ?? null,
    until: regra.ate ?? null,
    count: regra.contagem ?? null,
  };
}

/** Uma ocorrência no formato do MCP. Linha mascarada sai reduzida; e-mail de convidado nunca sai. */
export function formatOcorrencia(row: any, people: People): AgendaOccurrence {
  const allDay = row.dia_inteiro === true;
  // data_fim_local é exclusivo nos dois modos (_agenda_listar_core: com horário é o dia do fim menos
  // 1 microssegundo, mais um dia); no MCP end_date é o último dia, inclusivo.
  const endDate = row.data_fim_local ? addDays(String(row.data_fim_local), -1) : null;
  const base = {
    occurrence_id: row.ocorrencia_id,
    event_id: row.evento_id,
    start: row.inicio ?? null,
    end: row.fim ?? null,
    all_day: allDay,
    start_date: row.data_inicio_local ?? null,
    end_date: endDate,
    timezone: row.tz ?? null,
  };
  if (row.mascarado) {
    return { ...base, private: true, masked: true, title: AGENDA_MASKED_TITLE, can_edit: false };
  }
  return {
    ...base,
    title: row.titulo ?? null,
    type: row.tipo ?? null,
    color: row.cor ?? null,
    description: row.descricao ?? null,
    location: row.local ?? null,
    meeting_link: row.link_reuniao ?? null,
    client_id: row.cliente_id ?? null,
    client_name: row.cliente_nome ?? null,
    private: row.privado === true,
    masked: false,
    recurring: row.recorrente === true,
    recurrence: mapRegraOut(row.regra),
    reminders: row.lembretes ?? [],
    organizer: row.organizador_id ? person(people, String(row.organizador_id)) : null,
    participants: ((row.participantes ?? []) as any[])
      .filter((p) => p?.user_id)
      .map((p) => ({ ...person(people, String(p.user_id)), answer: p.resposta ?? null })),
    my_answer: row.minha_resposta ?? null,
    can_edit: row.pode_editar === true,
    shared_with_client: row.compartilhado_cliente === true,
    client_answer: row.cliente_resposta ?? null,
    guest_count: Array.isArray(row.convidados) ? row.convidados.length : 0,
  };
}

// ---- ferramentas -------------------------------------------------------------------------------

async function readOccurrence(d: Deps, occurrenceId: number): Promise<any> {
  const data = await rpcAs(d, "agenda_listar_as", { p_de: null, p_ate: null, p_ocorrencia_id: occurrenceId });
  const row = ((data ?? []) as any[])[0];
  if (!row) throw new McpInputError(NOT_FOUND);
  return row;
}

export async function listAgendaEvents(
  d: Deps,
  a: { from: string; to: string; client_id?: number },
): Promise<{ events: AgendaOccurrence[]; note?: string }> {
  const de = windowBound(a.from, false);
  const ate = windowBound(a.to, true);
  let data: unknown;
  try {
    data = await rpcAs(d, "agenda_listar_as", { p_de: de, p_ate: ate, p_ocorrencia_id: null });
  } catch (e) {
    if (e instanceof McpInputError && e.message === AGENDA_FLAG_OFF) return { events: [], note: AGENDA_FLAG_OFF };
    throw e;
  }
  let rows = (data ?? []) as any[];
  if (a.client_id != null) rows = rows.filter((r) => !r.mascarado && Number(r.cliente_id) === Number(a.client_id));
  const people = await loadPeople(d, rows);
  return { events: rows.map((r) => formatOcorrencia(r, people)) };
}

export async function getAgendaEvent(d: Deps, a: { occurrence_id: number }): Promise<{ event: AgendaOccurrence }> {
  const row = await readOccurrence(d, a.occurrence_id);
  const people = await loadPeople(d, [row]);
  return { event: formatOcorrencia(row, people) };
}

export async function createAgendaEvent(
  d: Deps,
  a: AgendaWriteArgs,
): Promise<{ event_id: number; occurrence_id: number }> {
  const mode = pairMode(a);
  const args = !has(a, "all_day") && mode !== undefined ? { ...a, all_day: mode } : a;
  const { evento, participantesMemberIds } = buildEventoPayload(args, {
    tz: a.timezone ?? AGENDA_DEFAULT_TZ,
    isUpdate: false,
  });
  const participantes = participantesMemberIds ? await resolveParticipants(d, participantesMemberIds) : [];
  const data = await rpcAs(d, "agenda_evento_criar_as", { p_evento: evento, p_participantes: participantes });
  const row = (Array.isArray(data) ? data[0] : data) as any;
  return { event_id: row?.evento_id, occurrence_id: row?.ocorrencia_id };
}

export async function updateAgendaEvent(
  d: Deps,
  a: AgendaWriteArgs & { occurrence_id: number; scope: AgendaScope },
): Promise<{ occurrence_id: number }> {
  const escopo = AGENDA_SCOPE[a.scope];
  if (!escopo) throw new McpInputError("Escopo inválido. Use this, this_and_following ou all.");
  const current = await readOccurrence(d, a.occurrence_id);
  if (current.mascarado || current.pode_editar !== true) throw new McpInputError(NOT_EDITABLE);
  const { occurrence_id: _o, scope: _s, timezone: _tz, ...rest } = a;
  // Trocar o par (start/end <-> start_date/end_date) troca o modo; o RPC só aceita a troca com dia_inteiro.
  const mode = pairMode(rest);
  const fields = !has(rest, "all_day") && mode !== undefined && mode !== (current.dia_inteiro === true)
    ? { ...rest, all_day: mode }
    : rest;
  const { evento, participantesMemberIds } = buildEventoPayload(fields, {
    tz: current.tz ?? AGENDA_DEFAULT_TZ,
    isUpdate: true,
  });
  const participantes = participantesMemberIds ? await resolveParticipants(d, participantesMemberIds) : null;
  const data = await rpcAs(d, "agenda_evento_editar_as", {
    p_ocorrencia_id: a.occurrence_id,
    p_escopo: escopo,
    p_evento: evento,
    p_participantes: participantes,
  });
  return { occurrence_id: Number(data ?? a.occurrence_id) };
}

export async function deleteAgendaEvent(
  d: Deps,
  a: { occurrence_id: number; scope: AgendaScope },
): Promise<{ deleted: true; occurrence_id: number; scope: AgendaScope }> {
  const escopo = AGENDA_SCOPE[a.scope];
  if (!escopo) throw new McpInputError("Escopo inválido. Use this, this_and_following ou all.");
  await rpcAs(d, "agenda_evento_excluir_as", { p_ocorrencia_id: a.occurrence_id, p_escopo: escopo });
  return { deleted: true, occurrence_id: a.occurrence_id, scope: a.scope };
}
