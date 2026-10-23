import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFetchMock } from '../../../../../test/shared/fetchMock';
import {
  hasUnsavedWork,
  resetUnsavedWorkForTests,
} from '../../../../../packages/app-lifecycle/src/unsaved-work';
import { createMediaNote, replyMediaNote } from '../mediaNotes';

const fetchHarness = createFetchMock();

describe('media note services', () => {
  beforeEach(() => {
    fetchHarness.reset();
    resetUnsavedWorkForTests();
    vi.stubGlobal('fetch', fetchHarness.fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('createMediaNote posts op create to hub-media-notes', async () => {
    fetchHarness.queueResponse({ json: { ok: true, note_id: 7 } });
    const res = await createMediaNote('tk', {
      post_id: 3,
      link_id: 11,
      t_seconds: 42,
      x: 0.25,
      y: 0.5,
      body: 'Trocar a cor',
    });
    expect(res).toEqual({ ok: true, note_id: 7 });
    expect(fetchHarness.calls).toHaveLength(1);
    const { input, init } = fetchHarness.calls[0];
    expect(String(input)).toMatch(/\/functions\/v1\/hub-media-notes$/);
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init?.body as string)).toEqual({
      token: 'tk',
      op: 'create',
      post_id: 3,
      link_id: 11,
      t_seconds: 42,
      x: 0.25,
      y: 0.5,
      body: 'Trocar a cor',
    });
  });

  it('createMediaNote omits the optional anchor fields it was not given', async () => {
    fetchHarness.queueResponse({ json: { ok: true, note_id: 8 } });
    await createMediaNote('tk', { post_id: 3, link_id: 11, body: 'Slide inteiro' });
    expect(JSON.parse(fetchHarness.calls[0].init?.body as string)).toEqual({
      token: 'tk',
      op: 'create',
      post_id: 3,
      link_id: 11,
      body: 'Slide inteiro',
    });
  });

  it('replyMediaNote posts op reply with the note id', async () => {
    fetchHarness.queueResponse({ json: { ok: true, reply_id: 4 } });
    const res = await replyMediaNote('tk', 7, 'Feito');
    expect(res).toEqual({ ok: true, reply_id: 4 });
    expect(String(fetchHarness.calls[0].input)).toMatch(/hub-media-notes$/);
    expect(JSON.parse(fetchHarness.calls[0].init?.body as string)).toEqual({
      token: 'tk',
      op: 'reply',
      note_id: 7,
      body: 'Feito',
    });
  });

  it('holds the unsaved-work registry while the write is in flight', async () => {
    fetchHarness.queueResponse({ json: { ok: true, note_id: 9 } });
    const pending = createMediaNote('tk', { post_id: 3, link_id: 11, body: 'x' });
    expect(hasUnsavedWork()).toBe(true);
    await pending;
    expect(hasUnsavedWork()).toBe(false);
  });

  it('rejects with the server error and releases the registry', async () => {
    fetchHarness.queueResponse({ ok: false, status: 403, json: { error: 'not_visible' } });
    await expect(createMediaNote('tk', { post_id: 3, link_id: 11, body: 'x' })).rejects.toThrow(
      'not_visible',
    );
    expect(hasUnsavedWork()).toBe(false);
  });
});
