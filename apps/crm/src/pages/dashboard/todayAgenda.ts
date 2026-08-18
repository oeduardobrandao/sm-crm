import type {
  AssignedPendingPost,
  AwaitingClientePost,
  Cliente,
  ClienteData,
  Membro,
  ScheduledPost,
  TarefaWithRelations,
  WorkflowEtapa,
} from '../../store';
import type { FinancialAccess } from '../../lib/financialAccess';
import { dayNum, etapaDeadlineDateOf } from '../entregas/etapaPrazo';
import { STATUS_LABELS as POST_STATUS_LABELS } from '../entregas/postLabels';
import { dueBadge, parseDateOnly } from '../tarefas/tarefasLogic';

// Pure logic for the dashboard "Hoje" card. No React, no fetching. Every
// bucketing decision is made on LOCAL calendar days (dayNum), never on ms
// arithmetic against a UTC-parsed date, so the bucket and the badge agree at
// 23:59 as much as at noon. Unit-tested in __tests__/todayAgenda.test.ts.

export type AgendaBucket = 'atrasado' | 'hoje' | 'proximos';
export const AGENDA_BUCKETS: AgendaBucket[] = ['atrasado', 'hoje', 'proximos'];

export type AgendaScope = 'workspace' | 'mine';

export type AgendaKind =
  | 'tarefa'
  | 'etapa'
  | 'post_agendado'
  | 'post_aguardando_cliente'
  | 'post_pendente'
  | 'income'
  | 'expense'
  | 'birthday'
  | 'data';

export type AgendaBadgeClass =
  | 'deadline-overdue'
  | 'deadline-warning'
  | 'deadline-caution'
  | 'deadline-ok';

export interface AgendaItem {
  key: string;
  kind: AgendaKind;
  bucket: AgendaBucket;
  title: string;
  context: string;
  when: Date | null;
  href: string;
  responsavel?: { id: number; nome: string } | null;
  badge?: { label: string; className: AgendaBadgeClass } | null;
  /** Present only for kind 'tarefa' (enables the inline "concluir" checkbox). */
  tarefaId?: number;
  tarefaStatus?: TarefaWithRelations['status'];
}

export type ActiveEtapa = WorkflowEtapa & {
  workflow_titulo?: string;
  cliente_nome?: string;
  cliente_id?: number;
};

export interface AgendaInput {
  now: Date;
  scope: AgendaScope;
  membroId: number | null;
  canSeeFinancials: FinancialAccess;
  tarefas: TarefaWithRelations[];
  etapas: ActiveEtapa[];
  scheduledPosts: ScheduledPost[];
  awaitingClientePosts: AwaitingClientePost[];
  assignedPendingPosts: AssignedPendingPost[];
  clientes: Cliente[];
  membros: Membro[];
  datas: ClienteData[];
}

export type AgendaBuckets = Record<AgendaBucket, AgendaItem[]>;

export const HORIZON_DAYS = 7;
/** Posts sent to the client and unanswered for this many full days count as overdue. */
export const AWAITING_CLIENT_OVERDUE_DAYS = 3;

function addDays(d: Date, n: number): Date {
  const c = new Date(d);
  c.setDate(c.getDate() + n);
  return c;
}

/** Local start of day; used for ISO range boundaries handed to queries. */
export function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** [start of today, start of today + HORIZON_DAYS + 1) as ISO strings. */
export function agendaRangeISO(now: Date): { startISO: string; endISO: string } {
  const start = startOfLocalDay(now);
  return { startISO: start.toISOString(), endISO: addDays(start, HORIZON_DAYS + 1).toISOString() };
}

/** Whole local days from `now`'s day to `when`'s day (negative = past). */
export function dayDiff(when: Date, now: Date): number {
  const a = startOfLocalDay(now);
  const b = startOfLocalDay(when);
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

/** null when outside the horizon (further than HORIZON_DAYS ahead). */
export function bucketFor(when: Date | null, now: Date): AgendaBucket | null {
  if (!when) return 'hoje';
  const w = dayNum(when);
  const n = dayNum(now);
  if (w < n) return 'atrasado';
  if (w === n) return 'hoje';
  if (w <= dayNum(addDays(now, HORIZON_DAYS))) return 'proximos';
  return null;
}

function etapaBadge(when: Date, now: Date): AgendaItem['badge'] {
  const diff = dayDiff(when, now);
  if (diff < 0) {
    const d = Math.abs(diff);
    return {
      label: d === 1 ? '1 dia de atraso' : `${d} dias de atraso`,
      className: 'deadline-overdue',
    };
  }
  if (diff === 0) return { label: 'Hoje', className: 'deadline-warning' };
  if (diff === 1) return { label: 'Amanhã', className: 'deadline-caution' };
  return { label: `${diff} dias`, className: diff <= 3 ? 'deadline-caution' : 'deadline-ok' };
}

function joinContext(...parts: (string | null | undefined)[]): string {
  return parts.filter((p) => p && p.trim().length > 0).join(' · ');
}

function fmtTime(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function sortItems(items: AgendaItem[]): AgendaItem[] {
  return items.sort((a, b) => {
    if (a.when && b.when && a.when.getTime() !== b.when.getTime()) {
      return a.when.getTime() - b.when.getTime();
    }
    if (a.when && !b.when) return -1;
    if (!a.when && b.when) return 1;
    return a.title.localeCompare(b.title, 'pt-BR');
  });
}

export function buildTodayAgenda(input: AgendaInput): AgendaBuckets {
  const { now, scope, membroId, canSeeFinancials } = input;
  const mine = scope === 'mine';
  const items: AgendaItem[] = [];

  const membroById = new Map<number, Membro>();
  for (const m of input.membros) if (m.id != null) membroById.set(m.id, m);
  const responsavelOf = (id: number | null | undefined): AgendaItem['responsavel'] => {
    if (mine || id == null) return null;
    const m = membroById.get(id);
    return m ? { id, nome: m.nome } : null;
  };
  const clienteById = new Map<number, Cliente>();
  for (const c of input.clientes) if (c.id != null) clienteById.set(c.id, c);

  const push = (item: Omit<AgendaItem, 'bucket'>, bucket: AgendaBucket | null) => {
    if (!bucket) return;
    items.push({ ...item, bucket });
  };

  // ---- tarefas ------------------------------------------------------------
  for (const t of input.tarefas) {
    if (t.status === 'concluida' || !t.data_limite) continue;
    if (mine && t.responsavel_id !== membroId) continue;
    const when = parseDateOnly(t.data_limite);
    push(
      {
        key: `tarefa:${t.id}`,
        kind: 'tarefa',
        title: t.titulo,
        context: t.cliente_nome ?? '',
        when,
        href: `/tarefas?tarefa=${t.id}`,
        responsavel: responsavelOf(t.responsavel_id),
        badge: dueBadge(t, now),
        tarefaId: t.id,
        tarefaStatus: t.status,
      },
      bucketFor(when, now),
    );
  }

  // ---- etapas -------------------------------------------------------------
  for (const e of input.etapas) {
    if (e.status !== 'ativo') continue;
    if (mine && e.responsavel_id !== membroId) continue;
    const when = etapaDeadlineDateOf(e);
    if (!when) continue;
    push(
      {
        key: `etapa:${e.id}`,
        kind: 'etapa',
        title: e.nome,
        context: joinContext(e.workflow_titulo, e.cliente_nome),
        when,
        href: `/entregas?drawer=${e.workflow_id}`,
        responsavel: responsavelOf(e.responsavel_id),
        badge: etapaBadge(when, now),
      },
      bucketFor(when, now),
    );
  }

  // ---- posts agendados ----------------------------------------------------
  // Any post whose publish date falls in the horizon, whatever its status
  // (except already postado). Context = time + real status so a rascunho due
  // to publish today reads as the risk it is. One row per post: a post that
  // is also aguardando cliente is folded into this row (see below).
  const scheduledIds = new Set<number>();
  for (const p of input.scheduledPosts) {
    if (p.status === 'postado') continue;
    if (mine && p.responsavel_id !== membroId) continue;
    const when = new Date(p.scheduled_at);
    // Only today/próximos: a past scheduled_at is a publish state, not a deadline.
    const bucket = bucketFor(when, now);
    if (bucket === 'atrasado') continue;
    scheduledIds.add(p.id);
    const ready = p.status === 'agendado' || p.status === 'aprovado_cliente';
    push(
      {
        key: `post_agendado:${p.id}`,
        kind: 'post_agendado',
        title: p.titulo,
        context: joinContext(
          `Publica ${fmtTime(when)}`,
          POST_STATUS_LABELS[p.status] ?? p.status,
          p.cliente_nome,
        ),
        when,
        href: `/entregas?drawer=${p.workflow_id}&post=${p.id}`,
        responsavel: responsavelOf(p.responsavel_id),
        badge: ready
          ? { label: 'Agendado', className: 'deadline-ok' }
          : {
              label: 'Não aprovado',
              className: bucket === 'hoje' ? 'deadline-warning' : 'deadline-caution',
            },
      },
      bucket,
    );
  }

  // ---- posts aguardando cliente (workspace only) --------------------------
  if (!mine) {
    for (const p of input.awaitingClientePosts) {
      if (scheduledIds.has(p.id)) continue; // already listed with its publish time
      const since = p.waiting_since ? new Date(p.waiting_since) : null;
      const days = since ? Math.max(0, -dayDiff(since, now)) : null;
      const overdue = days != null && days >= AWAITING_CLIENT_OVERDUE_DAYS;
      push(
        {
          key: `post_aguardando_cliente:${p.id}`,
          kind: 'post_aguardando_cliente',
          title: p.titulo,
          context: joinContext(
            days != null && days > 0 ? `Aguardando cliente há ${days}d` : 'Aguardando cliente',
            p.cliente_nome,
          ),
          when: null,
          href: `/entregas?drawer=${p.workflow_id}&post=${p.id}`,
          responsavel: responsavelOf(p.responsavel_id),
          badge: overdue
            ? { label: `${days}d sem resposta`, className: 'deadline-warning' }
            : { label: 'Aguardando', className: 'deadline-caution' },
        },
        overdue ? 'atrasado' : 'hoje',
      );
    }
  }

  // ---- posts pendentes (mine only) ----------------------------------------
  if (mine) {
    for (const p of input.assignedPendingPosts) {
      const urgent = p.status === 'correcao_cliente' || p.status === 'falha_publicacao';
      push(
        {
          key: `post_pendente:${p.id}`,
          kind: 'post_pendente',
          title: p.titulo,
          context: joinContext(p.workflow_titulo, p.cliente_nome),
          when: null,
          href: `/entregas?drawer=${p.workflow_id}&post=${p.id}`,
          responsavel: null,
          badge: {
            label: POST_STATUS_LABELS[p.status] ?? p.status,
            className: urgent ? 'deadline-warning' : 'deadline-caution',
          },
        },
        'hoje',
      );
    }
  }

  // ---- financeiro / aniversários / datas (workspace only) -----------------
  if (!mine) {
    const todayDay = now.getDate();
    const todayMonth = now.getMonth();
    const today = startOfLocalDay(now);

    if (canSeeFinancials === true) {
      for (const c of input.clientes) {
        if (c.data_pagamento !== todayDay || c.status !== 'ativo') continue;
        push(
          {
            key: `income:${c.id}`,
            kind: 'income',
            title: c.nome,
            context: 'Recebimento',
            when: today,
            href: `/clientes/${c.id}`,
            responsavel: null,
            badge: null,
          },
          'hoje',
        );
      }
      for (const m of input.membros) {
        if (m.data_pagamento !== todayDay) continue;
        push(
          {
            key: `expense:${m.id}`,
            kind: 'expense',
            title: m.nome,
            context: 'Despesa',
            when: today,
            href: `/equipe/${m.id}`,
            responsavel: null,
            badge: null,
          },
          'hoje',
        );
      }
    }

    for (const c of input.clientes) {
      if (!c.data_aniversario) continue;
      const [mm, dd] = c.data_aniversario.split('-').map(Number);
      if (mm - 1 !== todayMonth || dd !== todayDay) continue;
      push(
        {
          key: `birthday:${c.id}`,
          kind: 'birthday',
          title: c.nome,
          context: 'Aniversário',
          when: today,
          href: `/clientes/${c.id}`,
          responsavel: null,
          badge: null,
        },
        'hoje',
      );
    }

    for (const d of input.datas) {
      const when = parseDateOnly(d.data);
      if (dayNum(when) !== dayNum(now)) continue;
      const cliente = d.cliente_id != null ? clienteById.get(d.cliente_id) : undefined;
      push(
        {
          key: `data:${d.id}`,
          kind: 'data',
          title: d.titulo,
          context: cliente?.nome ?? '',
          when: today,
          href: cliente ? `/clientes/${cliente.id}` : '/calendario',
          responsavel: null,
          badge: null,
        },
        'hoje',
      );
    }
  }

  const buckets: AgendaBuckets = { atrasado: [], hoje: [], proximos: [] };
  for (const item of items) buckets[item.bucket].push(item);
  for (const b of AGENDA_BUCKETS) sortItems(buckets[b]);
  return buckets;
}
