import { getIntlLocale, i18n } from '@mesaas/i18n';
import type { Membro, TarefaEvento, TarefaEventoTipo, TarefaStatus } from '../../store';
import { STATUS_LABELS, parseDateOnly } from './tarefasLogic';

/** The day migration `tarefa_eventos` started recording; nothing older is in the history. */
export const HISTORICO_DESDE = '28/10/2026';

export type TarefaTimelineTone = 'neutral' | 'success' | 'warning' | 'info' | 'primary';

export interface TarefaTimelineNode {
  key: string;
  tipo: TarefaEventoTipo;
  /** Whole sentence, actor included ("Ana moveu o prazo de 12/10 para 15/10"). */
  text: string;
  actorLabel: string;
  /** Raw ISO timestamp of the (last) event; the list formats it. */
  at: string;
  tone: TarefaTimelineTone;
}

/** A tag remove + add of the same tag by the same actor this close is a re-save, not a change. */
const TAG_NET_WINDOW_MS = 5_000;
/** Consecutive same-type changes by the same actor this close read as one (dragging a task). */
const COLLAPSE_WINDOW_MS = 2 * 60_000;

/** Types whose `de`/`para` are the field's values, so a run of them reduces to first de / last
 *  para. List events (subtasks, tags) and `criada` never collapse: each one is its own fact. */
const COLLAPSIBLE: ReadonlySet<TarefaEventoTipo> = new Set([
  'status',
  'responsavel',
  'prazo',
  'titulo',
  'descricao',
  'cliente',
  'recorrencia',
]);

const t = (key: string, opts?: Record<string, unknown>) =>
  i18n.t(key, { ns: 'tasksForm', ...opts });

/** Short due date for history sentences ("15/10" in pt-BR), parsed as a local calendar day. */
export function formatTimelinePrazo(isoDate: string): string {
  return parseDateOnly(isoDate).toLocaleDateString(getIntlLocale(), {
    day: '2-digit',
    month: '2-digit',
  });
}

function obj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function actorKey(e: TarefaEvento): string {
  if (e.actor_user_id) return `u:${e.actor_user_id}`;
  if (e.actor_nome) return `n:${e.actor_nome}`;
  return 'system';
}

/** A workspace user (`getWorkspaceUsers`, query key ['workspace-users']): the fallback for an
 *  actor with no membro row, e.g. an owner who never added themselves to the team. */
export interface TimelineUser {
  id: string;
  nome: string | null;
}

/** membro -> workspace user -> the stored snapshot. Only a NULL actor is "Automação" (the
 *  recurrence cron, the MCP); a known actor that no longer resolves is a removed user. */
function actorLabelOf(e: TarefaEvento, membros: Membro[], workspaceUsers: TimelineUser[]): string {
  if (!e.actor_user_id) return str(e.actor_nome) ?? t('historico.automation');
  const membro = membros.find((m) => m.crm_user_id === e.actor_user_id);
  if (membro?.nome) return membro.nome;
  const wsUser = workspaceUsers.find((u) => u.id === e.actor_user_id);
  return str(wsUser?.nome) ?? str(e.actor_nome) ?? t('historico.removedUser');
}

function timeOf(e: TarefaEvento): number {
  return new Date(e.created_at).getTime();
}

function tagId(e: TarefaEvento): unknown {
  return obj(e.para)?.id ?? null;
}

/** Drops tag remove + add pairs for the same tag: same transaction (the series RPC's
 *  delete-all + reinsert), or same actor within 5 s (the old two-request form save). */
function netTagPairs(events: TarefaEvento[]): TarefaEvento[] {
  const dropped = new Set<number>();
  for (let i = 0; i < events.length; i++) {
    const a = events[i];
    if (dropped.has(a.id) || (a.tipo !== 'tag_removida' && a.tipo !== 'tag_adicionada')) continue;
    const opposite = a.tipo === 'tag_removida' ? 'tag_adicionada' : 'tag_removida';
    for (let j = i + 1; j < events.length; j++) {
      const b = events[j];
      if (dropped.has(b.id) || b.tipo !== opposite || tagId(b) !== tagId(a)) continue;
      const sameTx = a.txid === b.txid;
      const sameActorClose =
        actorKey(a) === actorKey(b) && Math.abs(timeOf(b) - timeOf(a)) <= TAG_NET_WINDOW_MS;
      if (sameTx || sameActorClose) {
        dropped.add(a.id);
        dropped.add(b.id);
        break;
      }
    }
  }
  return events.filter((e) => !dropped.has(e.id));
}

interface Run {
  first: TarefaEvento;
  last: TarefaEvento;
}

/** Collapses runs of adjacent events (chronological order, nothing else in between) with the
 *  same collapsible type and actor, each within 2 min of the previous one. */
function collapseRuns(events: TarefaEvento[]): Run[] {
  const runs: Run[] = [];
  for (const e of events) {
    const prev = runs[runs.length - 1];
    if (
      prev &&
      COLLAPSIBLE.has(e.tipo) &&
      prev.last.tipo === e.tipo &&
      actorKey(prev.last) === actorKey(e) &&
      timeOf(e) - timeOf(prev.last) <= COLLAPSE_WINDOW_MS
    ) {
      prev.last = e;
    } else {
      runs.push({ first: e, last: e });
    }
  }
  // A run that ends where it started (status there and back) changed nothing.
  return runs.filter(
    (r) =>
      r.first === r.last ||
      r.first.tipo === 'descricao' ||
      JSON.stringify(r.first.de ?? null) !== JSON.stringify(r.last.para ?? null),
  );
}

function statusLabel(v: unknown): string {
  const s = str(v);
  return s ? (STATUS_LABELS[s as TarefaStatus] ?? s) : '';
}

function refName(v: unknown, membros: Membro[] | null, unknownKey: string): string {
  const o = obj(v);
  const nome = str(o?.nome);
  if (nome) return nome;
  if (membros && typeof o?.id === 'number') {
    const membro = membros.find((m) => m.id === o.id);
    if (membro?.nome) return membro.nome;
  }
  return t(`historico.${unknownKey}`);
}

function sentence(
  tipo: TarefaEventoTipo,
  de: unknown,
  para: unknown,
  actor: string,
  membros: Membro[],
  formatDate: (isoDate: string) => string,
): string {
  switch (tipo) {
    case 'criada':
      return obj(para)?.serie === true
        ? t('historico.criadaSerie')
        : t('historico.criada', { actor });
    case 'status':
      return de == null
        ? t('historico.statusSet', { actor, para: statusLabel(para) })
        : t('historico.status', { actor, de: statusLabel(de), para: statusLabel(para) });
    case 'prazo': {
      const d = str(de);
      const p = str(para);
      if (!p) return t('historico.prazoRemoved', { actor });
      if (!d) return t('historico.prazoSet', { actor, para: formatDate(p) });
      return t('historico.prazo', { actor, de: formatDate(d), para: formatDate(p) });
    }
    case 'responsavel':
    case 'cliente': {
      const base = tipo;
      const unknown = tipo === 'responsavel' ? 'unknownMember' : 'unknownClient';
      const lookup = tipo === 'responsavel' ? membros : null;
      const hasDe = obj(de)?.id != null;
      const hasPara = obj(para)?.id != null;
      if (!hasPara) {
        return t(`historico.${base}Removed`, { actor, de: refName(de, lookup, unknown) });
      }
      if (!hasDe) return t(`historico.${base}Set`, { actor, para: refName(para, lookup, unknown) });
      return t(`historico.${base}`, {
        actor,
        de: refName(de, lookup, unknown),
        para: refName(para, lookup, unknown),
      });
    }
    case 'titulo':
      return t('historico.titulo', { actor, de: str(de) ?? '', para: str(para) ?? '' });
    case 'descricao':
      return t('historico.descricao', { actor });
    case 'recorrencia':
      if (para == null) return t('historico.recorrenciaRemoved', { actor });
      if (de == null) return t('historico.recorrenciaSet', { actor });
      return t('historico.recorrenciaChanged', { actor });
    case 'subtarefa_adicionada':
    case 'subtarefa_concluida':
    case 'subtarefa_reaberta':
    case 'subtarefa_removida':
      return t(`historico.${tipo}`, { actor, titulo: str(obj(para)?.titulo) ?? '' });
    case 'tag_adicionada':
    case 'tag_removida':
      return t(`historico.${tipo}`, { actor, nome: str(obj(para)?.nome) ?? '' });
  }
}

function toneOf(tipo: TarefaEventoTipo, para: unknown): TarefaTimelineTone {
  switch (tipo) {
    case 'criada':
      return 'primary';
    case 'status':
      return para === 'concluida' ? 'success' : 'info';
    case 'subtarefa_concluida':
      return 'success';
    case 'responsavel':
    case 'prazo':
    case 'cliente':
    case 'recorrencia':
      return 'info';
    case 'subtarefa_removida':
    case 'tag_removida':
      return 'warning';
    default:
      return 'neutral';
  }
}

/**
 * The task history as display nodes, newest first. Order of operations matters: sort
 * chronologically, net tag re-save pairs, collapse runs, then reverse, so a netted pair can
 * never be swallowed into (or split) a collapse run. No `now` parameter: collapsing uses the
 * gaps between events, and the list formats the timestamps.
 */
export function buildTarefaTimeline(
  eventos: TarefaEvento[],
  membros: Membro[],
  formatDate: (isoDate: string) => string,
  workspaceUsers: TimelineUser[] = [],
): TarefaTimelineNode[] {
  const sorted = [...eventos].sort((a, b) => timeOf(a) - timeOf(b) || a.id - b.id);
  const runs = collapseRuns(netTagPairs(sorted));
  return runs
    .map(({ first, last }) => {
      const recurrenceCreated = first.tipo === 'criada' && obj(first.para)?.serie === true;
      const actor = recurrenceCreated
        ? t('historico.recurrence')
        : actorLabelOf(first, membros, workspaceUsers);
      return {
        key: first === last ? String(first.id) : `${first.id}-${last.id}`,
        tipo: first.tipo,
        text: sentence(first.tipo, first.de, last.para, actor, membros, formatDate),
        actorLabel: actor,
        at: last.created_at,
        tone: toneOf(first.tipo, last.para),
      };
    })
    .reverse();
}
