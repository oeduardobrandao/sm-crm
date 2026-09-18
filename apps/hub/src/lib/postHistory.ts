import type {
  CorrectionReason,
  PostHistoryApproval,
  PostHistoryEvent,
  PostHistoryResponse,
} from '../types';
import { extractCaptionFromScript } from './captionText';

export const CORRECTION_REASONS: readonly CorrectionReason[] = [
  'midia',
  'texto',
  'legenda',
  'outro',
];

export type HistoryEntry =
  | {
      kind: 'send';
      key: string;
      at: string;
      version: number;
      diff: { before: string; after: string } | null;
    }
  | {
      kind: 'approval';
      key: string;
      at: string;
      action: 'aprovado' | 'correcao';
      comentario: string | null;
      motivo: CorrectionReason | null;
      byTeam: boolean;
    }
  | {
      kind: 'status';
      key: string;
      at: string;
      to_status: PostHistoryEvent['to_status'];
      source: PostHistoryEvent['source'];
    };

type Stamped = { created_at: string; id: number };

/** (created_at, id): the tie-break the DB indexes and the spec both use. */
function byCreatedAtThenId(a: Stamped, b: Stamped): number {
  if (a.created_at < b.created_at) return -1;
  if (a.created_at > b.created_at) return 1;
  return a.id - b.id;
}

/**
 * True when `a` is at or after `b`. Compares timestamps only: an equal
 * created_at counts as at-or-after regardless of id, because `a` and `b`
 * come from different tables (post_approvals vs post_status_events) and
 * their ids are not comparable. `byCreatedAtThenId` is only for ordering
 * rows of the same table.
 */
function isAtOrAfter(a: Stamped, b: Stamped): boolean {
  return a.created_at >= b.created_at;
}

function sortedEvents(history: PostHistoryResponse): PostHistoryEvent[] {
  return [...history.events].sort(byCreatedAtThenId);
}

function sortedApprovals(history: PostHistoryResponse): PostHistoryApproval[] {
  return [...history.approvals].sort(byCreatedAtThenId);
}

function snapshotText(event: PostHistoryEvent): string | null {
  if (!event.snapshot) return null;
  // Compare what the client saw as the caption, not the internal script.
  return event.snapshot.ig_caption || extractCaptionFromScript(event.snapshot.conteudo_plain ?? '');
}

const KIND_ORDER: Record<HistoryEntry['kind'], number> = { send: 0, approval: 1, status: 2 };

export function buildHistoryEntries(history: PostHistoryResponse): HistoryEntry[] {
  const events = sortedEvents(history);
  const entries: Array<HistoryEntry & { id: number }> = [];

  let version = 0;
  let previousSendText: string | null = null;
  for (const event of events) {
    if (event.to_status === 'enviado_cliente') {
      version += 1;
      const text = snapshotText(event);
      const diff =
        text !== null && previousSendText !== null && text !== previousSendText
          ? { before: previousSendText, after: text }
          : null;
      entries.push({
        kind: 'send',
        key: `send-${event.id}`,
        at: event.created_at,
        version,
        diff,
        id: event.id,
      });
      previousSendText = text;
    } else if (event.post_approval_id == null) {
      // Events linked to an approval are represented by the approval row itself.
      entries.push({
        kind: 'status',
        key: `status-${event.id}`,
        at: event.created_at,
        to_status: event.to_status,
        source: event.source,
        id: event.id,
      });
    }
  }

  for (const approval of sortedApprovals(history)) {
    if (approval.action === 'mensagem') continue;
    entries.push({
      kind: 'approval',
      key: `approval-${approval.id}`,
      at: approval.created_at,
      action: approval.action,
      comentario: approval.comentario,
      motivo: approval.motivo,
      byTeam: approval.is_workspace_user,
      id: approval.id,
    });
  }

  entries.sort((a, b) => {
    if (a.at !== b.at) return a.at < b.at ? -1 : 1;
    if (KIND_ORDER[a.kind] !== KIND_ORDER[b.kind]) return KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
    return a.id - b.id;
  });

  return entries.map(({ id: _id, ...entry }) => entry as HistoryEntry);
}

/**
 * Client comments only. hub-post-history already drops team-authored mensagem
 * rows (spec §1); this repeats the rule so a stale or misconfigured endpoint
 * can never put an internal team note on the client's screen.
 */
export function selectComments(history: PostHistoryResponse): PostHistoryApproval[] {
  return sortedApprovals(history).filter((a) => a.action === 'mensagem' && !a.is_workspace_user);
}

export interface PostKpis {
  /** Client corrections (post_approvals) + team-set correcao_cliente events without an approval. */
  rounds: number;
  /** Number of sends that received a client response. 0 means "no data", never "0 hours". */
  samples: number;
  avgResponseMs: number | null;
}

/**
 * Spec §3 state machine. A send opens a clock; the FIRST client response
 * (aprovado/correcao, is_workspace_user = false) at or after it and before the
 * next send closes it. Later responses to the same send (case c: approval
 * straight from correcao_cliente; case d: 2nd/3rd correction) are not samples.
 */
export function computePostKpis(history: PostHistoryResponse): PostKpis {
  const events = sortedEvents(history);
  const approvals = sortedApprovals(history);

  const rounds =
    approvals.filter((a) => a.action === 'correcao' && !a.is_workspace_user).length +
    events.filter((e) => e.to_status === 'correcao_cliente' && e.post_approval_id == null).length;

  const sends = events.filter((e) => e.to_status === 'enviado_cliente');
  const responses = approvals.filter((a) => a.action !== 'mensagem' && !a.is_workspace_user);

  const samplesMs: number[] = [];
  sends.forEach((send, i) => {
    const nextSend = sends[i + 1];
    const first = responses.find(
      (r) => isAtOrAfter(r, send) && (!nextSend || !isAtOrAfter(r, nextSend)),
    );
    if (first) {
      samplesMs.push(new Date(first.created_at).getTime() - new Date(send.created_at).getTime());
    }
  });

  const avgResponseMs =
    samplesMs.length > 0 ? samplesMs.reduce((sum, ms) => sum + ms, 0) / samplesMs.length : null;

  return { rounds, samples: samplesMs.length, avgResponseMs };
}

export function formatDuration(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(ms / 3_600_000);
  if (hours < 48) return `${hours} h`;
  return `${Math.round(ms / 86_400_000)} d`;
}
