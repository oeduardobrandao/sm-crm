import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase');

import {
  __queueSupabaseResult,
  __resetSupabaseMock,
  __setCurrentSession,
} from '@/lib/__mocks__/supabase';
import { clearImageUrlCachesForTest, resolveImageUrls } from '../useFileUrl';

describe('resolveImageUrls', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    __resetSupabaseMock();
    __setCurrentSession({ access_token: 'jwt', user: { id: 'user-1' } });
    clearImageUrlCachesForTest();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  it('pula arquivo perdido e arquivo que não é imagem, sem assinar nada', async () => {
    __queueSupabaseResult('files', 'select', {
      data: [
        { id: 1, r2_key: 'contas/x/files/a.png', kind: 'image', media_lost_at: '2026-08-01' },
        { id: 2, r2_key: 'contas/x/files/v.mp4', kind: 'video', media_lost_at: null },
      ],
    });

    const map = await resolveImageUrls([1, 2]);

    expect(map.size).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
