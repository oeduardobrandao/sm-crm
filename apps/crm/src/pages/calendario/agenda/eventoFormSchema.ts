import { z } from 'zod';
import { addDays, differenceInCalendarDays, format, startOfDay } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import type {
  AgendaCor,
  AgendaEscopo,
  AgendaEventoPayload,
  AgendaOcorrencia,
  AgendaRegra,
  AgendaTipo,
} from '../../../store/agenda';
import { WEEKDAY_NAMES } from '../../tarefas/recorrenciaLogic';
import { parseDateOnly, toDateOnlyString } from '../../tarefas/tarefasLogic';
import {
  emFuso,
  localIso,
  opcaoDaRegra,
  opcoesRepetir,
  ordinalDoDia,
  rederivarRegra,
  type RepetirOpcaoId,
} from './agendaLogic';

// Form state of EventoFormDialog and the pure mappings around it: form <->
// AgendaEventoPayload, AgendaRegra <-> custom-recurrence dialog state, and the
// partial edit payload (absent key = keep the stored value, null = clear).

/** Other people only: the organizer is not counted. */
export const MAX_PARTICIPANTES = 50;
export const MAX_LEMBRETES = 5;
/** Database caps on duration: timed events (elapsed) and all-day events (days). */
export const MAX_DIAS_COM_HORARIO = 14;
export const MAX_DIAS_DIA_INTEIRO = 31;

const pad = (n: number) => String(n).padStart(2, '0');

/** 96 quarter-hour slots, '00:00'..'23:45'. */
export const HORARIOS: string[] = Array.from(
  { length: 96 },
  (_, i) => `${pad(Math.floor(i / 4))}:${pad((i % 4) * 15)}`,
);

const TIPOS = ['reuniao', 'gravacao', 'captacao', 'apresentacao', 'interno', 'outro'] as const;
const CORES = ['azul', 'rosa', 'laranja', 'roxo', 'verde', 'teal', 'cinza', 'amarelo'] as const;
const REPETIR = [
  'nao',
  'diario',
  'semanal',
  'mensal_dia',
  'mensal_ordinal',
  'mensal_ultima',
  'anual',
  'dias_uteis',
  'personalizado',
] as const;

const regraSchema = z.object({
  freq: z.enum(['daily', 'weekly', 'monthly', 'yearly']),
  intervalo: z.number().int(),
  dias_semana: z.array(z.number().int()).nullable(),
  mensal_modo: z.enum(['dia_mes', 'dia_semana']).nullable(),
  mensal_ordinal: z
    .union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(-1)])
    .nullable(),
  ate: z.string().nullable(),
  contagem: z.number().int().nullable(),
});

function maxChars(n: number) {
  return z.string().max(n, `Use no máximo ${n} caracteres.`);
}

/** Date + 'HH:mm' as a local Date. */
export function combinarDataHora(data: Date, hora: string): Date {
  const [h, m] = hora.split(':').map((x) => parseInt(x, 10));
  return new Date(data.getFullYear(), data.getMonth(), data.getDate(), h || 0, m || 0, 0);
}

export const eventoFormSchema = z
  .object({
    titulo: maxChars(200),
    tipo: z.enum(TIPOS),
    cor: z.enum(CORES).nullable(),
    /** 'none' or the cliente id as a string (Select values are strings). */
    cliente_id: z.string(),
    data_inicio: z.date(),
    hora_inicio: z.string(),
    /** Inclusive last day for all-day events; end date for timed ones. */
    data_fim: z.date(),
    hora_fim: z.string(),
    dia_inteiro: z.boolean(),
    repetir: z.enum(REPETIR),
    regra: regraSchema.nullable(),
    participantes: z
      .array(z.string())
      .max(MAX_PARTICIPANTES, `Adicione no máximo ${MAX_PARTICIPANTES} pessoas.`),
    local: maxChars(300),
    link_reuniao: maxChars(500),
    descricao: maxChars(5000),
    lembretes: z
      .array(z.number().int())
      .max(MAX_LEMBRETES, `Use no máximo ${MAX_LEMBRETES} lembretes.`),
    privado: z.boolean(),
    /** Share with the cliente (Hub + e-mail). Only meaningful with a cliente and not privado. */
    compartilhado_cliente: z.boolean(),
  })
  .superRefine((v, ctx) => {
    if (!v.titulo.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['titulo'],
        message: 'Informe um título.',
      });
    }
    const fimAntes = v.dia_inteiro
      ? toDateOnlyString(v.data_fim) < toDateOnlyString(v.data_inicio)
      : combinarDataHora(v.data_fim, v.hora_fim) <= combinarDataHora(v.data_inicio, v.hora_inicio);
    const campoFim = v.dia_inteiro ? 'data_fim' : 'hora_fim';
    if (fimAntes) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [campoFim],
        message: 'O fim precisa ser depois do início.',
      });
    } else if (v.dia_inteiro) {
      // Mirrors the database cap ('agenda: o evento é longo demais').
      if (differenceInCalendarDays(v.data_fim, v.data_inicio) + 1 > MAX_DIAS_DIA_INTEIRO) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [campoFim],
          message: `O evento pode durar no máximo ${MAX_DIAS_DIA_INTEIRO} dias.`,
        });
      }
    } else {
      const min =
        (combinarDataHora(v.data_fim, v.hora_fim).getTime() -
          combinarDataHora(v.data_inicio, v.hora_inicio).getTime()) /
        60_000;
      if (min > MAX_DIAS_COM_HORARIO * 1440) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [campoFim],
          message: `O evento pode durar no máximo ${MAX_DIAS_COM_HORARIO} dias.`,
        });
      }
    }
    const link = v.link_reuniao.trim();
    if (link && !/^https?:\/\/\S+$/i.test(link)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['link_reuniao'],
        message: 'Informe um link que comece com http:// ou https://.',
      });
    }
    if (v.repetir !== 'nao' && v.regra === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['repetir'],
        message: 'Escolha como o evento se repete.',
      });
    }
  });

export type EventoFormValues = z.infer<typeof eventoFormSchema>;

export function hhmm(d: Date): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** "15 min", "1 h", "1 h 30 min". */
export function duracaoRotulo(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

const BASE: Omit<
  EventoFormValues,
  'data_inicio' | 'hora_inicio' | 'data_fim' | 'hora_fim' | 'dia_inteiro' | 'lembretes'
> = {
  titulo: '',
  tipo: 'reuniao',
  cor: null,
  cliente_id: 'none',
  repetir: 'nao',
  regra: null,
  participantes: [],
  local: '',
  link_reuniao: '',
  descricao: '',
  privado: false,
  compartilhado_cliente: false,
};

/** Create mode. `fim` is exclusive for all-day selections (FullCalendar). */
export function valoresIniciaisCriar(inicial: {
  inicio: Date;
  fim: Date;
  diaInteiro: boolean;
}): EventoFormValues {
  const dataInicio = startOfDay(inicial.inicio);
  if (inicial.diaInteiro) {
    const ultimo = addDays(startOfDay(inicial.fim), -1);
    return {
      ...BASE,
      data_inicio: dataInicio,
      data_fim: ultimo < dataInicio ? dataInicio : ultimo,
      hora_inicio: '09:00',
      hora_fim: '10:00',
      dia_inteiro: true,
      lembretes: [],
    };
  }
  return {
    ...BASE,
    data_inicio: dataInicio,
    hora_inicio: hhmm(inicial.inicio),
    data_fim: startOfDay(inicial.fim),
    hora_fim: hhmm(inicial.fim),
    dia_inteiro: false,
    lembretes: [10],
  };
}

/** agenda_listar returns all 7 keys, but read defensively. */
export function normalizarRegra(r: Partial<AgendaRegra> | null | undefined): AgendaRegra | null {
  if (!r || !r.freq) return null;
  return {
    freq: r.freq,
    intervalo: r.intervalo ?? 1,
    dias_semana: r.dias_semana ?? null,
    mensal_modo: r.mensal_modo ?? null,
    mensal_ordinal: r.mensal_ordinal ?? null,
    ate: r.ate ?? null,
    contagem: r.contagem ?? null,
  };
}

/** Edit mode: dates and times shown in the series tz (emFuso). The organizer is
 *  not in the picker (the server keeps them). */
export function valoresDeOcorrencia(o: AgendaOcorrencia): EventoFormValues {
  const inicio = emFuso(o.inicio, o.tz);
  const fim = emFuso(o.fim, o.tz);
  const regra = normalizarRegra(o.regra);
  const dataInicio = startOfDay(inicio);
  const comum = {
    titulo: o.titulo,
    tipo: (o.tipo ?? 'reuniao') as AgendaTipo,
    cor: o.cor as AgendaCor | null,
    cliente_id: o.cliente_id != null ? String(o.cliente_id) : 'none',
    repetir: opcaoDaRegra(regra, dataInicio),
    regra,
    participantes: o.participantes.map((p) => p.user_id).filter((id) => id !== o.organizador_id),
    local: o.local ?? '',
    link_reuniao: o.link_reuniao ?? '',
    descricao: o.descricao ?? '',
    lembretes: [...(o.lembretes ?? [])],
    privado: o.privado,
    compartilhado_cliente: o.compartilhado_cliente === true && !o.privado,
    data_inicio: dataInicio,
  };
  if (o.dia_inteiro) {
    const ultimo = addDays(startOfDay(fim), -1);
    return {
      ...comum,
      data_fim: ultimo < dataInicio ? dataInicio : ultimo,
      hora_inicio: '09:00',
      hora_fim: '10:00',
      dia_inteiro: true,
    };
  }
  return {
    ...comum,
    hora_inicio: hhmm(inicio),
    data_fim: startOfDay(fim),
    hora_fim: hhmm(fim),
    dia_inteiro: false,
  };
}

/** Form -> p_evento (without tz; the create flow adds it). The local fields are
 *  the wall clock: browser zone on create, series tz on edit (deFuso = localIso). */
export function montarPayload(v: EventoFormValues): AgendaEventoPayload {
  const inicioLocal = v.dia_inteiro
    ? localIso(startOfDay(v.data_inicio))
    : localIso(combinarDataHora(v.data_inicio, v.hora_inicio));
  const fimLocal = v.dia_inteiro
    ? localIso(addDays(startOfDay(v.data_fim), 1))
    : localIso(combinarDataHora(v.data_fim, v.hora_fim));
  return {
    titulo: v.titulo.trim(),
    descricao: v.descricao.trim() || null,
    local: v.local.trim() || null,
    link_reuniao: v.link_reuniao.trim() || null,
    tipo: v.tipo,
    cor: v.cor,
    cliente_id: v.cliente_id === 'none' ? null : parseInt(v.cliente_id, 10),
    privado: v.privado,
    // Shared needs a cliente and a non-private event; the database enforces the same.
    compartilhado_cliente: v.cliente_id !== 'none' && !v.privado && v.compartilhado_cliente,
    dia_inteiro: v.dia_inteiro,
    inicio_local: inicioLocal,
    fim_local: fimLocal,
    lembretes: [...new Set(v.lembretes)].sort((a, b) => a - b),
    regra: v.repetir === 'nao' ? null : v.regra,
  };
}

// ---- Comparações -------------------------------------------------------------

function mesmoConjunto(a: readonly number[] | null, b: readonly number[] | null): boolean {
  if (a === null || b === null) return a === b;
  const sa = [...new Set(a)].sort((x, y) => x - y);
  const sb = [...new Set(b)].sort((x, y) => x - y);
  return sa.length === sb.length && sa.every((v, i) => v === sb[i]);
}

export function mesmaRegra(a: AgendaRegra | null, b: AgendaRegra | null): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.freq === b.freq &&
    a.intervalo === b.intervalo &&
    mesmoConjunto(a.dias_semana, b.dias_semana) &&
    a.mensal_modo === b.mensal_modo &&
    a.mensal_ordinal === b.mensal_ordinal &&
    a.ate === b.ate &&
    a.contagem === b.contagem
  );
}

/** True when the submitted rule is exactly what the original Repetir option
 *  becomes on the new start date, i.e. the user did not touch Repetir and the
 *  rule only followed a date change ("cada segunda" -> "cada quarta"). */
export function regraAcompanhouData(
  opcaoOriginal: RepetirOpcaoId,
  regraOriginal: AgendaRegra | null,
  novoInicio: Date,
  regraAtual: AgendaRegra | null,
): boolean {
  return mesmaRegra(rederivarRegra(opcaoOriginal, regraOriginal, novoInicio), regraAtual);
}

export type CampoSerie =
  | 'regra'
  | 'lembretes'
  | 'tipo'
  | 'cor'
  | 'cliente_id'
  | 'privado'
  | 'compartilhado_cliente'
  | 'dia_inteiro'
  | 'participantes';

const CAMPO_SERIE_LABEL: Record<CampoSerie, string> = {
  regra: 'a repetição',
  lembretes: 'os lembretes',
  tipo: 'o tipo',
  cor: 'a cor',
  cliente_id: 'o cliente',
  privado: 'a opção Evento privado',
  compartilhado_cliente: 'o compartilhamento com o cliente',
  dia_inteiro: 'a opção Dia inteiro',
  participantes: 'os participantes',
};

/** Series-level fields that changed, so "Este evento" is not allowed. A rule
 *  that only followed the date does not count (the "esta" payload omits it). */
export function camposDeSerieAlterados(
  antes: AgendaEventoPayload,
  depois: AgendaEventoPayload,
  opts: { participantesMudaram: boolean; regraAcompanhouData: boolean },
): CampoSerie[] {
  const out: CampoSerie[] = [];
  if (!opts.regraAcompanhouData && !mesmaRegra(antes.regra, depois.regra)) out.push('regra');
  if (!mesmoConjunto(antes.lembretes, depois.lembretes)) out.push('lembretes');
  if (antes.tipo !== depois.tipo) out.push('tipo');
  if (antes.cor !== depois.cor) out.push('cor');
  if (antes.cliente_id !== depois.cliente_id) out.push('cliente_id');
  if (antes.privado !== depois.privado) out.push('privado');
  if (!!antes.compartilhado_cliente !== !!depois.compartilhado_cliente) {
    out.push('compartilhado_cliente');
  }
  if (antes.dia_inteiro !== depois.dia_inteiro) out.push('dia_inteiro');
  if (opts.participantesMudaram) out.push('participantes');
  return out;
}

/** Helper under the disabled "Este evento" option. */
export function motivoSerie(campos: CampoSerie[]): string | null {
  if (campos.length === 0) return null;
  if (campos.length > 1) return 'Vale para toda a série.';
  return `Vale para toda a série: você mudou ${CAMPO_SERIE_LABEL[campos[0]]}.`;
}

const CHAVES_EDICAO = [
  'titulo',
  'descricao',
  'local',
  'link_reuniao',
  'tipo',
  'cor',
  'cliente_id',
  'privado',
  'compartilhado_cliente',
  'dia_inteiro',
  'inicio_local',
  'fim_local',
  'lembretes',
  'regra',
] as const satisfies readonly (keyof AgendaEventoPayload)[];

export type ChaveEdicao = (typeof CHAVES_EDICAO)[number];

const CHAVES_CONTEUDO = ['titulo', 'descricao', 'local', 'link_reuniao'] as const;
const CHAVES_SERIE = [
  'tipo',
  'cor',
  'cliente_id',
  'privado',
  'compartilhado_cliente',
  'dia_inteiro',
  'lembretes',
] as const;

/** Keys whose value differs between the form as opened and as submitted
 *  (reminders compared as a set, the rule deep). Drives the no-op check and the
 *  "Este evento" lock; the payload itself is not a pure diff (montarPayloadEdicao). */
export function chavesAlteradas(
  antes: AgendaEventoPayload,
  depois: AgendaEventoPayload,
): ChaveEdicao[] {
  return CHAVES_EDICAO.filter((k) => {
    if (k === 'lembretes') return !mesmoConjunto(antes.lembretes, depois.lembretes);
    if (k === 'regra') return !mesmaRegra(antes.regra, depois.regra);
    if (k === 'compartilhado_cliente') return !!antes[k] !== !!depois[k];
    return antes[k] !== depois[k];
  });
}

/** p_evento for agenda_evento_editar (absent key = keep, null = clear; never `tz`).
 *  - The times travel as a pair: both when either (or dia_inteiro) changed,
 *    neither otherwise, so an occurrence moved by hand never pushes its time
 *    onto the series and the RPC never sees a lone inicio_local/fim_local.
 *  - "esta": the four content keys always (the RPC compares them with the
 *    occurrence's effective values), never series fields, so a rule that only
 *    followed the date stays out.
 *  - "todas"/"seguintes": the rule (always explicit) and every series field;
 *    content keys only when changed, so an occurrence's title override is not
 *    promoted to the series. */
export function montarPayloadEdicao(
  antes: AgendaEventoPayload,
  depois: AgendaEventoPayload,
  opts: { escopo: AgendaEscopo },
): Partial<AgendaEventoPayload> {
  const mudou = new Set(chavesAlteradas(antes, depois));
  const out: Partial<AgendaEventoPayload> = {};
  const por = <K extends ChaveEdicao>(k: K) => {
    (out as Record<string, unknown>)[k] = depois[k];
  };
  if (opts.escopo === 'esta') {
    CHAVES_CONTEUDO.forEach(por);
  } else {
    CHAVES_CONTEUDO.filter((k) => mudou.has(k)).forEach(por);
    por('regra');
    CHAVES_SERIE.forEach(por);
  }
  if (mudou.has('inicio_local') || mudou.has('fim_local') || mudou.has('dia_inteiro')) {
    por('inicio_local');
    por('fim_local');
  }
  return out;
}

export function mesmasPessoas(a: string[], b: string[]): boolean {
  const sa = new Set(a);
  const sb = new Set(b);
  return sa.size === sb.size && [...sa].every((x) => sb.has(x));
}

// ---- Repetição personalizada ----------------------------------------------------

export type ModoMensal = 'mensal_dia' | 'mensal_ordinal' | 'mensal_ultima';

/** State of RecorrenciaPersonalizadaDialog. Numbers stay raw strings so the
 *  inputs can be cleared while typing; validarPersonalizada checks them. */
export interface RecorrenciaPersonalizada {
  freq: AgendaRegra['freq'];
  intervalo: string;
  dias_semana: number[];
  mensal: ModoMensal;
  termina: 'nunca' | 'em' | 'apos';
  ate: Date | undefined;
  contagem: string;
}

/** Monthly modes available on this start date ("No dia 5", "Na primeira segunda",
 *  "Na última segunda"), from the Repetir presets. */
export function opcoesMensaisPersonalizadas(inicio: Date): { id: ModoMensal; label: string }[] {
  return opcoesRepetir(inicio)
    .filter(
      (o): o is typeof o & { id: ModoMensal } =>
        o.id === 'mensal_dia' || o.id === 'mensal_ordinal' || o.id === 'mensal_ultima',
    )
    .map((o) => {
      const texto = o.label.replace(/^Mensal: /, '');
      return { id: o.id, label: texto.charAt(0).toUpperCase() + texto.slice(1) };
    });
}

function modoMensalDisponivel(desejado: ModoMensal, inicio: Date): ModoMensal {
  const ids = opcoesMensaisPersonalizadas(inicio).map((o) => o.id);
  if (ids.includes(desejado)) return desejado;
  if (desejado === 'mensal_ordinal' && ids.includes('mensal_ultima')) return 'mensal_ultima';
  if (desejado === 'mensal_ultima' && ids.includes('mensal_ordinal')) return 'mensal_ordinal';
  return 'mensal_dia';
}

export function regraParaPersonalizada(
  regra: AgendaRegra | null,
  inicio: Date,
): RecorrenciaPersonalizada {
  const dow = inicio.getDay();
  if (!regra) {
    return {
      freq: 'weekly',
      intervalo: '1',
      dias_semana: [dow],
      mensal: 'mensal_dia',
      termina: 'nunca',
      ate: undefined,
      contagem: '13',
    };
  }
  let mensal: ModoMensal = 'mensal_dia';
  if (regra.mensal_modo === 'dia_semana') {
    mensal = modoMensalDisponivel(
      regra.mensal_ordinal === -1 ? 'mensal_ultima' : 'mensal_ordinal',
      inicio,
    );
  }
  return {
    freq: regra.freq,
    intervalo: String(regra.intervalo),
    dias_semana: regra.dias_semana?.length ? [...regra.dias_semana] : [dow],
    mensal,
    termina: regra.ate ? 'em' : regra.contagem !== null ? 'apos' : 'nunca',
    ate: regra.ate ? parseDateOnly(regra.ate) : undefined,
    contagem: regra.contagem !== null ? String(regra.contagem) : '13',
  };
}

function inteiroEntre(s: string, min: number, max: number): number | null {
  if (!/^\d{1,4}$/.test(s.trim())) return null;
  const n = parseInt(s, 10);
  return n >= min && n <= max ? n : null;
}

/** First problem with the custom state, or null when Concluir can proceed. */
export function validarPersonalizada(s: RecorrenciaPersonalizada, inicio: Date): string | null {
  if (inteiroEntre(s.intervalo, 1, 99) === null) return 'Use um número de 1 a 99.';
  if (s.freq === 'weekly' && s.dias_semana.length === 0) {
    return 'Escolha ao menos um dia da semana.';
  }
  if (s.termina === 'em') {
    if (!s.ate) return 'Escolha a data final.';
    if (toDateOnlyString(s.ate) < toDateOnlyString(inicio)) {
      return 'A data final precisa ser igual ou depois do início.';
    }
  }
  if (s.termina === 'apos' && inteiroEntre(s.contagem, 1, 730) === null) {
    return 'Use um número de 1 a 730.';
  }
  return null;
}

/** Custom state -> rule. Call only after validarPersonalizada returned null.
 *  The monthly ordinal and weekday come from the start date. */
export function personalizadaParaRegra(s: RecorrenciaPersonalizada, inicio: Date): AgendaRegra {
  const mensal = modoMensalDisponivel(s.mensal, inicio);
  const ordinal = ordinalDoDia(inicio);
  return {
    freq: s.freq,
    intervalo: parseInt(s.intervalo, 10),
    dias_semana:
      s.freq === 'weekly'
        ? [...new Set(s.dias_semana)].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7))
        : null,
    mensal_modo: s.freq !== 'monthly' ? null : mensal === 'mensal_dia' ? 'dia_mes' : 'dia_semana',
    mensal_ordinal:
      s.freq !== 'monthly' || mensal === 'mensal_dia'
        ? null
        : mensal === 'mensal_ultima' || ordinal === 5
          ? -1
          : ordinal,
    ate: s.termina === 'em' && s.ate ? toDateOnlyString(s.ate) : null,
    contagem: s.termina === 'apos' ? parseInt(s.contagem, 10) : null,
  };
}

// ---- Copy --------------------------------------------------------------------------

/** "segunda, 6 de outubro" from a 'yyyy-MM-dd...' timestamp (the RPC's dtstart). */
export function rotuloDtstart(dtstart: string): string {
  const d = parseDateOnly(dtstart.slice(0, 10));
  return `${WEEKDAY_NAMES[d.getDay()]}, ${format(d, "d 'de' MMMM", { locale: ptBR })}`;
}
