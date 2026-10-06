import { format, getDaysInMonth } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import type {
  AgendaCor,
  AgendaEventoPayload,
  AgendaOcorrencia,
  AgendaRegra,
  AgendaTipo,
} from '../../../store/agenda';
import { WEEKDAY_NAMES } from '../../tarefas/recorrenciaLogic';
import { parseDateOnly } from '../../tarefas/tarefasLogic';

// Pure helpers for the Agenda tab. No React. The database owns the date math
// (agenda_datas_regra); this file only labels rules, derives the Repetir
// presets from the start date and converts between instants and wall clocks.
// Weekdays: 0 = domingo; weeks start on Monday.

// ---- Tipos e cores -----------------------------------------------------------

export const TIPO_LABEL: Record<AgendaTipo, string> = {
  reuniao: 'Reunião',
  gravacao: 'Gravação',
  captacao: 'Captação',
  apresentacao: 'Apresentação',
  interno: 'Interno',
  outro: 'Outro',
};

export const TIPO_COR: Record<AgendaTipo, string> = {
  reuniao: '#3b82f6',
  gravacao: '#e1306c',
  captacao: '#f59e0b',
  apresentacao: '#8b5cf6',
  interno: '#64748b',
  outro: '#14b8a6',
};

export const COR_HEX: Record<AgendaCor, string> = {
  azul: '#3b82f6',
  rosa: '#e1306c',
  laranja: '#f97316',
  roxo: '#8b5cf6',
  verde: '#22c55e',
  teal: '#14b8a6',
  cinza: '#64748b',
  amarelo: '#eab308',
};

/** Event ink: explicit `cor` wins over the tipo colour; masked events are grey. */
export function corDoEvento(o: Pick<AgendaOcorrencia, 'cor' | 'tipo' | 'mascarado'>): string {
  if (o.mascarado) return COR_HEX.cinza;
  if (o.cor) return COR_HEX[o.cor];
  if (o.tipo) return TIPO_COR[o.tipo];
  return COR_HEX.cinza;
}

// ---- Dias da semana ------------------------------------------------------------

/** sábado (6) and domingo (0) are masculine in pt-BR. */
function masculino(dow: number): boolean {
  return dow === 0 || dow === 6;
}

/** Distinct days in Monday..Sunday order. */
function ordenarDias(dias: number[]): number[] {
  return [...new Set(dias)].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
}

function juntar(itens: string[]): string {
  if (itens.length <= 1) return itens.join('');
  return `${itens.slice(0, -1).join(', ')} e ${itens[itens.length - 1]}`;
}

/** "na segunda e na quarta", "no sábado e no domingo". */
function diasComArtigo(dias: number[]): string {
  return juntar(ordenarDias(dias).map((d) => `${masculino(d) ? 'no' : 'na'} ${WEEKDAY_NAMES[d]}`));
}

const ORDINAL_FEM = { 1: 'primeira', 2: 'segunda', 3: 'terceira', 4: 'quarta', [-1]: 'última' };
const ORDINAL_MASC = { 1: 'primeiro', 2: 'segundo', 3: 'terceiro', 4: 'quarto', [-1]: 'último' };

/** "na segunda terça", "no último sábado". */
function ordinalComArtigo(ordinal: 1 | 2 | 3 | 4 | -1, dow: number): string {
  const masc = masculino(dow);
  const palavra = (masc ? ORDINAL_MASC : ORDINAL_FEM)[ordinal];
  return `${masc ? 'no' : 'na'} ${palavra} ${WEEKDAY_NAMES[dow]}`;
}

/** 1..5: which occurrence of its weekday the date is within its month. */
export function ordinalDoDia(d: Date): 1 | 2 | 3 | 4 | 5 {
  return Math.ceil(d.getDate() / 7) as 1 | 2 | 3 | 4 | 5;
}

/** True when no later date in the month has the same weekday. */
export function ehUltimaSemanaDoMes(d: Date): boolean {
  return d.getDate() + 7 > getDaysInMonth(d);
}

function diaEMes(d: Date): string {
  return format(d, "d 'de' MMMM", { locale: ptBR });
}

// ---- Opções do Repetir ---------------------------------------------------------

export type RepetirOpcaoId =
  | 'nao'
  | 'diario'
  | 'semanal'
  | 'mensal_dia'
  | 'mensal_ordinal'
  | 'mensal_ultima'
  | 'anual'
  | 'dias_uteis'
  | 'personalizado';

export interface RepetirOpcao {
  id: RepetirOpcaoId;
  label: string;
  /** null for 'nao' and 'personalizado' (the custom dialog builds that one). */
  regra: AgendaRegra | null;
}

const DIAS_UTEIS = [1, 2, 3, 4, 5];

function base(freq: AgendaRegra['freq'], p: Partial<AgendaRegra> = {}): AgendaRegra {
  return {
    freq,
    intervalo: 1,
    dias_semana: null,
    mensal_modo: null,
    mensal_ordinal: null,
    ate: null,
    contagem: null,
    ...p,
  };
}

/** Repetir presets derived from the start date, in display order. The
 *  "na {N}ª {dia}" option exists only for ordinals 1..4 (the 5th weekday is
 *  always the last one), and "na última {dia}" only in the last week. */
export function opcoesRepetir(inicio: Date): RepetirOpcao[] {
  const dow = inicio.getDay();
  const ordinal = ordinalDoDia(inicio);
  const ops: RepetirOpcao[] = [
    { id: 'nao', label: 'Não se repete', regra: null },
    { id: 'diario', label: 'Todos os dias', regra: base('daily') },
    {
      id: 'semanal',
      label: `Semanal: cada ${WEEKDAY_NAMES[dow]}`,
      regra: base('weekly', { dias_semana: [dow] }),
    },
    {
      id: 'mensal_dia',
      label: `Mensal: no dia ${inicio.getDate()}`,
      regra: base('monthly', { mensal_modo: 'dia_mes' }),
    },
  ];
  if (ordinal <= 4) {
    const o = ordinal as 1 | 2 | 3 | 4;
    ops.push({
      id: 'mensal_ordinal',
      label: `Mensal: ${ordinalComArtigo(o, dow)}`,
      regra: base('monthly', { mensal_modo: 'dia_semana', mensal_ordinal: o }),
    });
  }
  if (ehUltimaSemanaDoMes(inicio)) {
    ops.push({
      id: 'mensal_ultima',
      label: `Mensal: ${ordinalComArtigo(-1, dow)}`,
      regra: base('monthly', { mensal_modo: 'dia_semana', mensal_ordinal: -1 }),
    });
  }
  ops.push(
    { id: 'anual', label: `Anual: em ${diaEMes(inicio)}`, regra: base('yearly') },
    {
      id: 'dias_uteis',
      label: 'Todos os dias úteis (segunda a sexta)',
      regra: base('weekly', { dias_semana: DIAS_UTEIS }),
    },
    { id: 'personalizado', label: 'Personalizar…', regra: null },
  );
  return ops;
}

function regraIgual(a: AgendaRegra | null, b: AgendaRegra | null): boolean {
  if (a === null || b === null) return a === b;
  const dias = (r: AgendaRegra) => (r.dias_semana ? ordenarDias(r.dias_semana).join(',') : '');
  return (
    a.freq === b.freq &&
    a.intervalo === b.intervalo &&
    dias(a) === dias(b) &&
    a.mensal_modo === b.mensal_modo &&
    a.mensal_ordinal === b.mensal_ordinal &&
    a.ate === b.ate &&
    a.contagem === b.contagem
  );
}

/** Which Repetir option a stored rule corresponds to for this start date. A
 *  preset only matches with intervalo 1 and no end; anything else is personalizado. */
export function opcaoDaRegra(regra: AgendaRegra | null, inicio: Date): RepetirOpcaoId {
  if (regra === null) return 'nao';
  const preset = opcoesRepetir(inicio).find(
    (o) => o.regra !== null && o.id !== 'personalizado' && regraIgual(o.regra, regra),
  );
  return preset?.id ?? 'personalizado';
}

/** Rule to send after the start date changed. Presets follow the new date
 *  ("Semanal: cada terça" becomes "cada quarta"); 'personalizado' keeps the
 *  current rule as is (the RPC normalizes dtstart). When the chosen monthly
 *  preset does not exist on the new date, the sibling is used: 'mensal_ultima'
 *  outside the last week becomes the ordinal of the new date, and
 *  'mensal_ordinal' on a 5th weekday becomes 'mensal_ultima'. Callers should
 *  recompute the selected option with opcaoDaRegra(result, novoInicio). */
export function rederivarRegra(
  id: RepetirOpcaoId,
  regraAtual: AgendaRegra | null,
  novoInicio: Date,
): AgendaRegra | null {
  if (id === 'personalizado') return regraAtual;
  if (id === 'nao') return null;
  const ops = opcoesRepetir(novoInicio);
  const achar = (alvo: RepetirOpcaoId) => ops.find((o) => o.id === alvo)?.regra;
  const direto = achar(id);
  if (direto) return direto;
  if (id === 'mensal_ultima') return achar('mensal_ordinal') ?? null;
  if (id === 'mensal_ordinal') return achar('mensal_ultima') ?? null;
  return null;
}

// ---- Descrição da regra ----------------------------------------------------------

/** pt-BR summary, e.g. "A cada 2 semanas na segunda e na quarta, até 30 de novembro de 2026". */
export function descreverRegra(regra: AgendaRegra, inicio: Date): string {
  const n = regra.intervalo;
  const dow = inicio.getDay();
  let texto: string;
  switch (regra.freq) {
    case 'daily':
      texto = n === 1 ? 'Todos os dias' : `A cada ${n} dias`;
      break;
    case 'weekly': {
      const dias = ordenarDias(regra.dias_semana?.length ? regra.dias_semana : [dow]);
      if (n === 1 && dias.join(',') === DIAS_UTEIS.join(',')) {
        texto = 'Todos os dias úteis';
      } else {
        texto = `${n === 1 ? 'Semanalmente' : `A cada ${n} semanas`} ${diasComArtigo(dias)}`;
      }
      break;
    }
    case 'monthly': {
      const prefixo = n === 1 ? 'Mensalmente' : `A cada ${n} meses`;
      texto =
        regra.mensal_modo === 'dia_semana' && regra.mensal_ordinal !== null
          ? `${prefixo} ${ordinalComArtigo(regra.mensal_ordinal, dow)}`
          : `${prefixo} no dia ${inicio.getDate()}`;
      break;
    }
    case 'yearly':
      texto = `${n === 1 ? 'Anualmente' : `A cada ${n} anos`} em ${diaEMes(inicio)}`;
      break;
  }
  if (regra.ate) {
    texto += `, até ${format(parseDateOnly(regra.ate), "d 'de' MMMM 'de' yyyy", { locale: ptBR })}`;
  } else if (regra.contagem !== null) {
    texto += `, ${regra.contagem} ${regra.contagem === 1 ? 'vez' : 'vezes'}`;
  }
  return texto;
}

// ---- Lembretes -------------------------------------------------------------------

/** Minutes before `inicio` offered for timed events. */
export const LEMBRETES_HORARIO: number[] = [0, 5, 10, 15, 30, 60, 1440];
/** All-day: minutes before 00:00 of the first day ("no dia às 9h" = -540). */
export const LEMBRETES_DIA_INTEIRO: number[] = [-540, 900, 9540];

function plural(n: number, um: string, varios: string): string {
  return `${n} ${n === 1 ? um : varios}`;
}

function duracaoAntes(min: number): string {
  if (min % 10080 === 0) return plural(min / 10080, 'semana', 'semanas');
  if (min % 1440 === 0) return plural(min / 1440, 'dia', 'dias');
  if (min % 60 === 0) return plural(min / 60, 'hora', 'horas');
  return plural(min, 'minuto', 'minutos');
}

export function rotuloLembrete(min: number, diaInteiro: boolean): string {
  if (!diaInteiro) {
    if (min === 0) return 'Na hora';
    return min > 0 ? `${duracaoAntes(min)} antes` : `${duracaoAntes(-min)} depois`;
  }
  // Reminder fires at (00:00 of the event day) - min.
  const t = -min;
  const dia = Math.floor(t / 1440);
  const horaMin = t - dia * 1440;
  const h = Math.floor(horaMin / 60);
  const m = horaMin % 60;
  const hora = m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, '0')}`;
  if (dia === 0) return `No dia às ${hora}`;
  if (dia > 0) return `${plural(dia, 'dia', 'dias')} depois às ${hora}`;
  const antes = -dia;
  const quando =
    antes % 7 === 0 ? plural(antes / 7, 'semana', 'semanas') : plural(antes, 'dia', 'dias');
  return `${quando} antes às ${hora}`;
}

// ---- FullCalendar ----------------------------------------------------------------

/** Structurally compatible with FullCalendar's EventInput (Task 9 passes it). */
export interface AgendaEventInput {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  editable: boolean;
  backgroundColor: string;
  borderColor: string;
  textColor: string;
  classNames: string[];
  extendedProps: { ocorrencia: AgendaOcorrencia };
}

/** Timed events use the ISO instants (FC in 'local' converts them); all-day
 *  events use the series-local date strings so the day never shifts for a
 *  viewer in another zone. Colours: borderColor is the solid event ink,
 *  backgroundColor a ~14% tint of it, text uses the CRM text token. */
export function toEventInput(o: AgendaOcorrencia, meuId: string): AgendaEventInput {
  const cor = corDoEvento(o);
  const classNames = ['agenda-ev'];
  if (o.mascarado) classNames.push('agenda-ev--mascarado');
  else if (o.organizador_id !== meuId) {
    if (o.minha_resposta === 'pendente') classNames.push('agenda-ev--pendente');
    else if (o.minha_resposta === 'nao') classNames.push('agenda-ev--recusado');
  }
  return {
    id: String(o.ocorrencia_id),
    title: o.titulo,
    start: o.dia_inteiro ? o.data_inicio_local : o.inicio,
    end: o.dia_inteiro ? o.data_fim_local : o.fim,
    allDay: o.dia_inteiro,
    editable: o.pode_editar && !o.mascarado,
    backgroundColor: `${cor}24`,
    borderColor: cor,
    textColor: 'var(--text-main)',
    classNames,
    extendedProps: { ocorrencia: o },
  };
}

/** Occurrences where any of `ids` is organizer or participant (masked events
 *  carry participant ids without answers). null = no filter. */
export function filtrarPorPessoas(
  os: AgendaOcorrencia[],
  ids: string[] | null,
): AgendaOcorrencia[] {
  if (ids === null) return os;
  const set = new Set(ids);
  return os.filter(
    (o) =>
      (o.organizador_id !== null && set.has(o.organizador_id)) ||
      o.participantes.some((p) => set.has(p.user_id)),
  );
}

// ---- Escopo ----------------------------------------------------------------------

function mesmoConjunto(a: number[], b: number[]): boolean {
  const sa = [...new Set(a)].sort((x, y) => x - y);
  const sb = [...new Set(b)].sort((x, y) => x - y);
  return sa.length === sb.length && sa.every((v, i) => v === sb[i]);
}

/** True when a field that only exists at series level changed, so "Este evento"
 *  is not allowed. Participants are compared by the caller. */
export function camposDeSerieMudaram(
  antes: AgendaEventoPayload,
  depois: AgendaEventoPayload,
): boolean {
  return (
    antes.tipo !== depois.tipo ||
    antes.cor !== depois.cor ||
    antes.cliente_id !== depois.cliente_id ||
    antes.privado !== depois.privado ||
    antes.dia_inteiro !== depois.dia_inteiro ||
    !mesmoConjunto(antes.lembretes, depois.lembretes) ||
    !regraIgual(antes.regra, depois.regra)
  );
}

// ---- Fusos -------------------------------------------------------------------------

const pad = (n: number) => String(n).padStart(2, '0');

/** 'yyyy-MM-ddTHH:mm:ss' from the local (browser zone) fields, no offset. */
export function localIso(d: Date): string {
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

const formatadores = new Map<string, Intl.DateTimeFormat>();

function formatador(tz: string): Intl.DateTimeFormat {
  let f = formatadores.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatadores.set(tz, f);
  }
  return f;
}

interface Parede {
  y: number;
  mo: number;
  d: number;
  h: number;
  mi: number;
  s: number;
}

function paredeDe(instante: Date, tz: string): Parede {
  const partes: Record<string, number> = {};
  for (const p of formatador(tz).formatToParts(instante)) {
    if (p.type !== 'literal') partes[p.type] = parseInt(p.value, 10);
  }
  return {
    y: partes.year,
    mo: partes.month,
    d: partes.day,
    // Some ICU builds still print "24" at midnight.
    h: partes.hour % 24,
    mi: partes.minute,
    s: partes.second,
  };
}

/** Instant -> wall clock in tz, 'yyyy-MM-ddTHH:mm:ss' (drag payloads). */
export function paredeNoFuso(d: Date, tz: string): string {
  const p = paredeDe(d, tz);
  return `${p.y}-${pad(p.mo)}-${pad(p.d)}T${pad(p.h)}:${pad(p.mi)}:${pad(p.s)}`;
}

/** Instant -> a Date whose LOCAL fields equal the wall clock in tz, so the form
 *  can show and edit the time in the series tz. Not a real instant: convert
 *  back with deFuso. A wall time that falls in a DST gap of the browser zone
 *  shifts by the gap (Date cannot represent it). */
export function emFuso(iso: string, tz: string): Date {
  const p = paredeDe(new Date(iso), tz);
  return new Date(p.y, p.mo - 1, p.d, p.h, p.mi, p.s);
}

/** Inverse of emFuso: the local fields of `d` (as entered in the form) are the
 *  wall clock meant in tz, so this is their 'yyyy-MM-ddTHH:mm:ss'. The RPC
 *  interprets inicio_local in the series tz, which is why no offset math is done. */
export function deFuso(d: Date, _tz: string): string {
  return localIso(d);
}

export function fusoDoNavegador(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Sao_Paulo';
  } catch {
    return 'America/Sao_Paulo';
  }
}
