import type { PostApproval, PostContentVersion, PostStatusEvent } from '../../../store';
import { STATUS_LABELS, isVisibleToClient } from '../postLabels';

// Deliberately separate from postTimeline.ts: that module feeds a passive,
// read-only popover list for a different feature. This one needs a
// *selectable* list (version nodes open a diff, status nodes don't) and its
// own filtering policy (only client-facing status transitions, so the panel
// reads as "what the client saw happen", not every internal status tweak).

export type VersionTimelineNode =
  | {
      key: string;
      kind: 'version';
      /** Anchor/sort timestamp -- last_touched_at, not created_at (see
       *  PostContentVersion doc comment: a coalesced row's "place in
       *  history" is when it was last touched, not when it started). */
      at: string;
      version: PostContentVersion;
      /** created_at, but only when it differs from last_touched_at -- the
       *  list row renders a "14:20–14:24" range when set, a single time
       *  otherwise. */
      rangeStart: string | null;
    }
  | {
      key: string;
      kind: 'status';
      at: string;
      label: string;
      actorLabel: string;
      comment: string | null;
    };

function actorLabelFor(source: PostStatusEvent['source'], actorName: string | null): string {
  if (source === 'client') return 'Cliente';
  if (source === 'system') return 'Sistema';
  return actorName ?? '—';
}

export function buildVersionTimeline(
  versions: PostContentVersion[],
  statusEvents: PostStatusEvent[],
  approvals: PostApproval[],
): VersionTimelineNode[] {
  const nodes: VersionTimelineNode[] = [];

  for (const v of versions) {
    nodes.push({
      key: `version-${v.id}`,
      kind: 'version',
      at: v.last_touched_at,
      version: v,
      rangeStart: v.created_at !== v.last_touched_at ? v.created_at : null,
    });
  }

  const approvalById = new Map(approvals.map((a) => [a.id, a]));

  for (const ev of statusEvents) {
    // Only client-facing transitions -- this panel reads as "what the
    // client saw happen", not a log of every internal status tweak.
    if (!isVisibleToClient(ev.to_status)) continue;
    const comment =
      ev.post_approval_id != null
        ? (approvalById.get(ev.post_approval_id)?.comentario ?? null)
        : null;
    nodes.push({
      key: `status-${ev.id}`,
      kind: 'status',
      at: ev.created_at,
      label: ev.to_custom_nome ?? STATUS_LABELS[ev.to_status] ?? ev.to_status,
      actorLabel: actorLabelFor(ev.source, ev.actor_name),
      comment,
    });
  }

  return nodes.sort((a, b) => {
    const diff = new Date(a.at).getTime() - new Date(b.at).getTime();
    if (diff !== 0) return diff;
    if (a.kind === b.kind) return 0;
    return a.kind === 'version' ? -1 : 1;
  });
}

/** The version node immediately preceding `node` in an already-sorted
 *  `nodes` list -- skips status nodes, since they carry nothing to diff
 *  against. Null for the very first version (renders "Versão inicial"). */
export function findPrecedingVersion(
  nodes: VersionTimelineNode[],
  node: Extract<VersionTimelineNode, { kind: 'version' }>,
): PostContentVersion | null {
  const idx = nodes.findIndex((n) => n.key === node.key);
  for (let i = idx - 1; i >= 0; i--) {
    const n = nodes[i];
    if (n.kind === 'version') return n.version;
  }
  return null;
}
