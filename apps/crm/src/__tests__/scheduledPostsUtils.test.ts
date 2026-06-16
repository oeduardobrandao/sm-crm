import { describe, expect, it } from 'vitest';
import {
  monthRangeISO,
  dateDayKey,
  localDayKey,
  bucketByLocalDay,
  summarizeDay,
} from '../pages/entregas/hooks/scheduledPostsUtils';
import type { ScheduledPost } from '../store';

function mk(
  partial: Partial<ScheduledPost> & {
    id: number;
    scheduled_at: string;
    status: ScheduledPost['status'];
  },
): ScheduledPost {
  return {
    workflow_id: 1,
    cliente_id: 1,
    cliente_nome: 'C',
    workflow_titulo: 'W',
    titulo: 'T',
    tipo: 'feed',
    published_at: null,
    ig_caption: null,
    instagram_permalink: null,
    publish_error: null,
    ordem: 0,
    responsavel_id: null,
    ...partial,
  };
}

describe('scheduledPostsUtils', () => {
  it('monthRangeISO returns local-midnight bounds for the month', () => {
    const { startISO, endISO } = monthRangeISO(new Date(2026, 5, 1));
    expect(startISO).toBe(new Date(2026, 5, 1).toISOString());
    expect(endISO).toBe(new Date(2026, 6, 1).toISOString());
  });

  it('buckets by LOCAL day (an 11pm-local post stays on its local day)', () => {
    const lateNight = new Date(2026, 5, 16, 23, 0, 0);
    expect(dateDayKey(lateNight)).toBe('2026-5-16');
    expect(localDayKey(lateNight.toISOString())).toBe('2026-5-16');
  });

  it('bucketByLocalDay groups posts by local day key', () => {
    const a = mk({
      id: 1,
      scheduled_at: new Date(2026, 5, 16, 9, 0).toISOString(),
      status: 'aprovado_cliente',
    });
    const b = mk({
      id: 2,
      scheduled_at: new Date(2026, 5, 16, 20, 0).toISOString(),
      status: 'agendado',
    });
    const c = mk({
      id: 3,
      scheduled_at: new Date(2026, 5, 17, 9, 0).toISOString(),
      status: 'postado',
    });
    const map = bucketByLocalDay([a, b, c]);
    expect(map.get('2026-5-16')?.map((p) => p.id)).toEqual([1, 2]);
    expect(map.get('2026-5-17')?.map((p) => p.id)).toEqual([3]);
  });

  it('summarizeDay counts total, postados and falhas', () => {
    const posts = [
      mk({ id: 1, scheduled_at: '2026-06-16T12:00:00.000Z', status: 'aprovado_cliente' }),
      mk({ id: 2, scheduled_at: '2026-06-16T12:00:00.000Z', status: 'postado' }),
      mk({ id: 3, scheduled_at: '2026-06-16T12:00:00.000Z', status: 'postado' }),
      mk({ id: 4, scheduled_at: '2026-06-16T12:00:00.000Z', status: 'falha_publicacao' }),
    ];
    expect(summarizeDay(posts)).toEqual({ total: 4, postados: 2, falhas: 1 });
  });
});
