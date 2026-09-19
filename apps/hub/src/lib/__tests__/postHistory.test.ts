import { describe, expect, it } from 'vitest';
import type { PostHistoryApproval, PostHistoryEvent, PostHistoryResponse } from '../../types';
import {
  buildHistoryEntries,
  computePostKpis,
  formatDuration,
  selectComments,
} from '../postHistory';

const HOUR = 60 * 60 * 1000;

function ev(
  overrides: Partial<PostHistoryEvent> & {
    id: number;
    to_status: PostHistoryEvent['to_status'];
    created_at: string;
  },
): PostHistoryEvent {
  return { source: 'team', post_approval_id: null, snapshot: null, ...overrides };
}

function send(id: number, created_at: string, caption: string | null): PostHistoryEvent {
  return ev({
    id,
    to_status: 'enviado_cliente',
    created_at,
    snapshot: { conteudo_plain: 'texto', ig_caption: caption },
  });
}

function ap(
  overrides: Partial<PostHistoryApproval> & {
    id: number;
    action: PostHistoryApproval['action'];
    created_at: string;
  },
): PostHistoryApproval {
  return { comentario: null, motivo: null, is_workspace_user: false, ...overrides };
}

function history(
  events: PostHistoryEvent[],
  approvals: PostHistoryApproval[],
): PostHistoryResponse {
  return { events, approvals };
}

describe('computePostKpis', () => {
  it('(a) send then first client response: one sample, zero rounds on approval', () => {
    const h = history(
      [
        send(1, '2026-09-01T10:00:00.000Z', 'v1'),
        ev({
          id: 2,
          to_status: 'aprovado_cliente',
          source: 'client',
          post_approval_id: 10,
          created_at: '2026-09-01T13:00:00.000Z',
        }),
      ],
      [ap({ id: 10, action: 'aprovado', created_at: '2026-09-01T13:00:00.000Z' })],
    );
    expect(computePostKpis(h)).toEqual({ rounds: 0, samples: 1, avgResponseMs: 3 * HOUR });
  });

  it('(b) correction, resend, next response: two samples averaged, one round', () => {
    const h = history(
      [
        send(1, '2026-09-01T10:00:00.000Z', 'v1'),
        ev({
          id: 2,
          to_status: 'correcao_cliente',
          source: 'client',
          post_approval_id: 10,
          created_at: '2026-09-01T12:00:00.000Z',
        }),
        send(3, '2026-09-02T10:00:00.000Z', 'v2'),
        ev({
          id: 4,
          to_status: 'aprovado_cliente',
          source: 'client',
          post_approval_id: 11,
          created_at: '2026-09-02T14:00:00.000Z',
        }),
      ],
      [
        ap({
          id: 10,
          action: 'correcao',
          motivo: 'legenda',
          comentario: 'ajustar',
          created_at: '2026-09-01T12:00:00.000Z',
        }),
        ap({ id: 11, action: 'aprovado', created_at: '2026-09-02T14:00:00.000Z' }),
      ],
    );
    expect(computePostKpis(h)).toEqual({ rounds: 1, samples: 2, avgResponseMs: 3 * HOUR });
  });

  it('(c) approval straight from correcao_cliente without a resend is not a new sample', () => {
    const h = history(
      [
        send(1, '2026-09-01T10:00:00.000Z', 'v1'),
        ev({
          id: 2,
          to_status: 'correcao_cliente',
          source: 'client',
          post_approval_id: 10,
          created_at: '2026-09-01T11:00:00.000Z',
        }),
        ev({
          id: 3,
          to_status: 'aprovado_cliente',
          source: 'client',
          post_approval_id: 11,
          created_at: '2026-09-03T11:00:00.000Z',
        }),
      ],
      [
        ap({ id: 10, action: 'correcao', motivo: 'data', created_at: '2026-09-01T11:00:00.000Z' }),
        ap({ id: 11, action: 'aprovado', created_at: '2026-09-03T11:00:00.000Z' }),
      ],
    );
    expect(computePostKpis(h)).toEqual({ rounds: 1, samples: 1, avgResponseMs: 1 * HOUR });
  });

  it('(d) second and third corrections while already correcao_cliente count as rounds but not samples', () => {
    const h = history(
      [
        send(1, '2026-09-01T10:00:00.000Z', 'v1'),
        ev({
          id: 2,
          to_status: 'correcao_cliente',
          source: 'client',
          post_approval_id: 10,
          created_at: '2026-09-01T11:00:00.000Z',
        }),
      ],
      [
        ap({
          id: 10,
          action: 'correcao',
          motivo: 'legenda',
          created_at: '2026-09-01T11:00:00.000Z',
        }),
        ap({ id: 11, action: 'correcao', motivo: 'outro', created_at: '2026-09-01T12:00:00.000Z' }),
        ap({ id: 12, action: 'correcao', motivo: 'data', created_at: '2026-09-01T13:00:00.000Z' }),
      ],
    );
    expect(computePostKpis(h)).toEqual({ rounds: 3, samples: 1, avgResponseMs: 1 * HOUR });
  });

  it('counts a team-set correcao_cliente event without post_approval_id as a round', () => {
    const h = history(
      [
        send(1, '2026-09-01T10:00:00.000Z', 'v1'),
        ev({
          id: 2,
          to_status: 'correcao_cliente',
          source: 'team',
          created_at: '2026-09-01T11:00:00.000Z',
        }),
      ],
      [],
    );
    expect(computePostKpis(h)).toEqual({ rounds: 1, samples: 0, avgResponseMs: null });
  });

  it('treats a response created in the same instant as the send as a valid sample (timestamp tie, ids from different tables)', () => {
    const h = history(
      [send(5, '2026-09-01T10:00:00.000Z', 'v1')],
      [ap({ id: 6, action: 'aprovado', created_at: '2026-09-01T10:00:00.000Z' })],
    );
    expect(computePostKpis(h)).toEqual({ rounds: 0, samples: 1, avgResponseMs: 0 });
  });

  it('ignores team-authored approvals and mensagem rows as responses', () => {
    const h = history(
      [send(1, '2026-09-01T10:00:00.000Z', 'v1')],
      [
        ap({
          id: 10,
          action: 'mensagem',
          comentario: 'oi',
          created_at: '2026-09-01T10:30:00.000Z',
        }),
        ap({
          id: 11,
          action: 'aprovado',
          is_workspace_user: true,
          created_at: '2026-09-01T11:00:00.000Z',
        }),
      ],
    );
    expect(computePostKpis(h)).toEqual({ rounds: 0, samples: 0, avgResponseMs: null });
  });

  it('excludes a workspace-authored correcao row from rounds (defensive, mirrors selectComments)', () => {
    const h = history(
      [send(1, '2026-09-01T10:00:00.000Z', 'v1')],
      [
        ap({
          id: 10,
          action: 'correcao',
          motivo: 'legenda',
          is_workspace_user: true,
          created_at: '2026-09-01T11:00:00.000Z',
        }),
      ],
    );
    expect(computePostKpis(h)).toEqual({ rounds: 0, samples: 0, avgResponseMs: null });
  });

  it('pre-20260606 post with approvals but no events: rounds from approvals, no samples (missing, not zero)', () => {
    const h = history(
      [],
      [ap({ id: 10, action: 'correcao', created_at: '2026-05-01T10:00:00.000Z' })],
    );
    expect(computePostKpis(h)).toEqual({ rounds: 1, samples: 0, avgResponseMs: null });
  });
});

describe('buildHistoryEntries', () => {
  it('numbers sends, attaches a diff only when the previous send text differs, and merges approvals and unlinked status events in order', () => {
    const h = history(
      [
        send(1, '2026-09-01T10:00:00.000Z', 'legenda v1'),
        ev({
          id: 2,
          to_status: 'correcao_cliente',
          source: 'client',
          post_approval_id: 10,
          created_at: '2026-09-01T12:00:00.000Z',
        }),
        send(3, '2026-09-02T10:00:00.000Z', 'legenda v1'),
        ev({
          id: 4,
          to_status: 'correcao_cliente',
          source: 'team',
          created_at: '2026-09-02T11:00:00.000Z',
        }),
        send(5, '2026-09-03T10:00:00.000Z', 'legenda v2'),
        ev({
          id: 6,
          to_status: 'aprovado_cliente',
          source: 'client',
          post_approval_id: 11,
          created_at: '2026-09-03T12:00:00.000Z',
        }),
        ev({
          id: 7,
          to_status: 'postado',
          source: 'system',
          created_at: '2026-09-04T12:00:00.000Z',
        }),
      ],
      [
        ap({
          id: 10,
          action: 'correcao',
          motivo: 'legenda',
          comentario: 'ajustar',
          created_at: '2026-09-01T12:00:00.000Z',
        }),
        ap({ id: 11, action: 'aprovado', created_at: '2026-09-03T12:00:00.000Z' }),
        ap({
          id: 12,
          action: 'mensagem',
          comentario: 'oi',
          created_at: '2026-09-03T13:00:00.000Z',
        }),
      ],
    );
    const entries = buildHistoryEntries(h);
    expect(entries.map((e) => e.kind)).toEqual([
      'send',
      'approval',
      'send',
      'status',
      'send',
      'approval',
      'status',
    ]);
    expect(entries[0]).toMatchObject({ kind: 'send', version: 1, diff: null });
    expect(entries[2]).toMatchObject({ kind: 'send', version: 2, diff: null });
    expect(entries[4]).toMatchObject({
      kind: 'send',
      version: 3,
      diff: { before: 'legenda v1', after: 'legenda v2' },
    });
    expect(entries[1]).toMatchObject({
      kind: 'approval',
      action: 'correcao',
      motivo: 'legenda',
      comentario: 'ajustar',
      byTeam: false,
    });
    expect(entries[3]).toMatchObject({
      kind: 'status',
      to_status: 'correcao_cliente',
      source: 'team',
    });
    expect(entries[6]).toMatchObject({ kind: 'status', to_status: 'postado', source: 'system' });
    expect(
      entries.some(
        (e) => e.kind === 'approval' && e.action !== 'correcao' && e.action !== 'aprovado',
      ),
    ).toBe(false);
  });

  it('falls back to conteudo_plain when ig_caption is null and skips the diff when a snapshot is missing', () => {
    const h = history(
      [
        ev({
          id: 1,
          to_status: 'enviado_cliente',
          created_at: '2026-09-01T10:00:00.000Z',
          snapshot: null,
        }),
        ev({
          id: 2,
          to_status: 'enviado_cliente',
          created_at: '2026-09-02T10:00:00.000Z',
          snapshot: { conteudo_plain: 'texto a', ig_caption: null },
        }),
        ev({
          id: 3,
          to_status: 'enviado_cliente',
          created_at: '2026-09-03T10:00:00.000Z',
          snapshot: { conteudo_plain: 'texto b', ig_caption: null },
        }),
      ],
      [],
    );
    const entries = buildHistoryEntries(h);
    expect(entries[1]).toMatchObject({ kind: 'send', version: 2, diff: null });
    expect(entries[2]).toMatchObject({
      kind: 'send',
      version: 3,
      diff: { before: 'texto a', after: 'texto b' },
    });
  });

  it('falls back to conteudo_plain when ig_caption is an empty string, not just null', () => {
    const h = history(
      [
        ev({
          id: 1,
          to_status: 'enviado_cliente',
          created_at: '2026-09-01T10:00:00.000Z',
          snapshot: { conteudo_plain: 'texto a', ig_caption: '' },
        }),
        ev({
          id: 2,
          to_status: 'enviado_cliente',
          created_at: '2026-09-02T10:00:00.000Z',
          snapshot: { conteudo_plain: 'texto b', ig_caption: '' },
        }),
      ],
      [],
    );
    const entries = buildHistoryEntries(h);
    expect(entries[1]).toMatchObject({
      kind: 'send',
      version: 2,
      diff: { before: 'texto a', after: 'texto b' },
    });
  });

  it('diffs only the text after LEGENDA when ig_caption is empty', () => {
    const h = history(
      [
        ev({
          id: 1,
          to_status: 'enviado_cliente',
          created_at: '2026-09-01T10:00:00.000Z',
          snapshot: {
            conteudo_plain: 'GANCHO: segredo interno\nLEGENDA: legenda antiga',
            ig_caption: '',
          },
        }),
        ev({
          id: 2,
          to_status: 'enviado_cliente',
          created_at: '2026-09-02T10:00:00.000Z',
          snapshot: {
            conteudo_plain: 'GANCHO: outro segredo interno\nLegenda:\n\nlegenda nova',
            ig_caption: null,
          },
        }),
      ],
      [],
    );
    const entries = buildHistoryEntries(h);
    expect(entries[1]).toMatchObject({
      kind: 'send',
      version: 2,
      diff: { before: 'legenda antiga', after: 'legenda nova' },
    });
  });

  it('produces no diff when only the pre-LEGENDA internal notes changed', () => {
    const h = history(
      [
        ev({
          id: 1,
          to_status: 'enviado_cliente',
          created_at: '2026-09-01T10:00:00.000Z',
          snapshot: { conteudo_plain: 'notas v1\nLEGENDA: mesma legenda', ig_caption: '' },
        }),
        ev({
          id: 2,
          to_status: 'enviado_cliente',
          created_at: '2026-09-02T10:00:00.000Z',
          snapshot: {
            conteudo_plain: 'notas v2 bem diferentes\nLEGENDA: mesma legenda',
            ig_caption: '',
          },
        }),
      ],
      [],
    );
    expect(buildHistoryEntries(h)[1]).toMatchObject({ kind: 'send', version: 2, diff: null });
  });
});

describe('selectComments', () => {
  it('returns only client mensagem rows in (created_at, id) order and drops team messages', () => {
    const h = history(
      [],
      [
        ap({ id: 3, action: 'mensagem', comentario: 'c', created_at: '2026-09-01T10:00:00.000Z' }),
        ap({ id: 1, action: 'aprovado', created_at: '2026-09-01T09:00:00.000Z' }),
        ap({ id: 2, action: 'mensagem', comentario: 'b', created_at: '2026-09-01T10:00:00.000Z' }),
        ap({
          id: 4,
          action: 'mensagem',
          comentario: 'interno',
          is_workspace_user: true,
          created_at: '2026-09-01T11:00:00.000Z',
        }),
      ],
    );
    expect(selectComments(h).map((c) => c.id)).toEqual([2, 3]);
  });
});

describe('formatDuration', () => {
  it('picks minutes, hours or days', () => {
    expect(formatDuration(0)).toBe('0 min');
    expect(formatDuration(12 * 60 * 1000)).toBe('12 min');
    expect(formatDuration(5 * HOUR)).toBe('5 h');
    expect(formatDuration(47 * HOUR)).toBe('47 h');
    expect(formatDuration(72 * HOUR)).toBe('3 d');
  });
});
