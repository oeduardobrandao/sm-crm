import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFetchMock } from '../../../../../test/shared/fetchMock';

vi.mock('../../lib/supabase');

import { __setCurrentSession, __resetSupabaseMock } from '../../lib/__mocks__/supabase';
import { pickThumbKey, importDesignFromMedia, DesignImportError } from '../designs';

const attached = { coverKey: 'contas/c/designs/1/2/f1.jpg', videoThumbKey: 'thumb.jpg' };

describe('pickThumbKey', () => {
  it('prefers the stored render manifest (unattached designs keep it)', () => {
    expect(
      pickThumbKey(
        { render_manifest: [{ r2_key: 'manifest.jpg' }], post_id: null, format: 'feed' },
        attached,
      ),
    ).toBe('manifest.jpg');
  });

  it('attached feed/carrossel falls back to the post design cover link', () => {
    expect(pickThumbKey({ render_manifest: null, post_id: 42, format: 'feed' }, attached)).toBe(
      attached.coverKey,
    );
    expect(
      pickThumbKey({ render_manifest: null, post_id: 42, format: 'carrossel' }, attached),
    ).toBe(attached.coverKey);
  });

  it('attached reel_cover uses the post video thumbnail', () => {
    expect(
      pickThumbKey({ render_manifest: null, post_id: 42, format: 'reel_cover' }, attached),
    ).toBe(attached.videoThumbKey);
  });

  it('null when unattached with no manifest (never rendered / failed)', () => {
    expect(pickThumbKey({ render_manifest: null, post_id: null, format: 'livre' })).toBe(null);
    expect(pickThumbKey({ render_manifest: [], post_id: null, format: 'feed' })).toBe(null);
  });

  it('null when attached but media sources are empty', () => {
    expect(
      pickThumbKey(
        { render_manifest: null, post_id: 42, format: 'feed' },
        { coverKey: null, videoThumbKey: null },
      ),
    ).toBe(null);
  });
});

// ============================================================
// importDesignFromMedia (Task 6 — image → editable design entry point)
// ============================================================

describe('importDesignFromMedia', () => {
  const fetchHarness = createFetchMock();

  beforeEach(() => {
    __resetSupabaseMock();
    fetchHarness.reset();
    vi.stubGlobal('fetch', fetchHarness.fetchMock);
    __setCurrentSession({ access_token: 'test-jwt', user: { id: 'user-1' } });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('posts post_id/link_id and returns design_id + quota on success', async () => {
    fetchHarness.queueResponse({
      ok: true,
      status: 201,
      json: { design_id: 99, quota: { used: 1, limit: 20 } },
    });

    const result = await importDesignFromMedia(42, 7);

    expect(result).toEqual({ design_id: 99, quota: { used: 1, limit: 20 } });
    const call = fetchHarness.calls[0];
    expect(String(call.input)).toContain('/functions/v1/design-import');
    expect(JSON.parse(String(call.init?.body))).toEqual({ post_id: 42, link_id: 7 });
    expect((call.init?.headers as Record<string, string>).Authorization).toBe('Bearer test-jwt');
  });

  it('throws a DesignImportError carrying the server code + PT message on failure', async () => {
    fetchHarness.queueResponse({
      ok: false,
      status: 402,
      json: { error: { code: 'quota_exhausted', message: 'Cota mensal esgotada.' } },
    });

    await expect(importDesignFromMedia(42, 7)).rejects.toMatchObject({
      name: 'DesignImportError',
      code: 'quota_exhausted',
      message: 'Cota mensal esgotada.',
    });
  });

  it('falls back to a generic DesignImportError when the body has no error envelope', async () => {
    fetchHarness.queueResponse({ ok: false, status: 500, json: {} });

    const err = await importDesignFromMedia(42, 7).catch((e) => e);
    expect(err).toBeInstanceOf(DesignImportError);
    expect((err as DesignImportError).code).toBe('generic');
    expect((err as DesignImportError).message).toContain('500');
  });
});
