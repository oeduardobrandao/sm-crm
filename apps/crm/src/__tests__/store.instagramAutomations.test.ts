import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/supabase');

import * as supabaseModule from '../lib/supabase';
import * as store from '../store';

type MockedSupabaseModule = typeof supabaseModule & {
  __getSupabaseCalls: () => Array<{
    table: string;
    operation: string;
    payload?: unknown;
    modifiers: Array<{ method: string; args: unknown[] }>;
  }>;
  __queueSupabaseResult: (
    table: string,
    operation: 'select' | 'insert' | 'update' | 'delete' | 'upsert',
    ...responses: Array<{ data?: unknown; error?: unknown; count?: number | null }>
  ) => void;
  __resetSupabaseMock: () => void;
  __setCurrentProfile: (profile: Record<string, unknown> | null) => void;
};

const mockedSupabase = supabaseModule as MockedSupabaseModule;

function getCalls(table: string, operation?: string) {
  return mockedSupabase
    .__getSupabaseCalls()
    .filter((entry) => entry.table === table && (!operation || entry.operation === operation));
}

const AUTOMATION = {
  id: 'auto-1',
  conta_id: 'conta-1',
  client_id: 1,
  name: 'Promo verão',
  ig_media_id: 'media-1',
  media_permalink: 'https://instagram.com/p/media-1',
  media_caption: 'Legenda do post',
  workflow_post_id: null,
  pending_post_deleted_at: null,
  keywords: ['quero', 'link'],
  dm_message: 'Oi! Aqui está o link.',
  public_reply: 'Te chamei no direct!',
  ativo: true,
  dms_sent_count: 0,
  last_triggered_at: null,
  created_at: '2026-08-14T00:00:00.000Z',
  updated_at: '2026-08-14T00:00:00.000Z',
};

const SEND = {
  id: 'send-1',
  comment_id: 'comment-1',
  automation_id: 'auto-1',
  conta_id: 'conta-1',
  media_id: 'media-1',
  commenter_id: 'ig-user-1',
  commenter_username: 'usuario_teste',
  comment_text: 'quero o link',
  comment_created_at: '2026-08-14T00:00:00.000Z',
  status: 'sent',
  skip_reason: null,
  error_code: null,
  dm_status: 'sent',
  public_reply_status: 'sent',
  attempts: 1,
  created_at: '2026-08-14T00:00:00.000Z',
};

describe('store instagram automations', () => {
  beforeEach(() => {
    mockedSupabase.__resetSupabaseMock();
    mockedSupabase.__setCurrentProfile({
      id: 'user-1',
      nome: 'Eduardo Souza',
      role: 'owner',
      conta_id: 'conta-1',
    });
  });

  it('getInstagramAutomations orders by created_at ascending', async () => {
    mockedSupabase.__queueSupabaseResult('instagram_comment_automations', 'select', {
      data: [AUTOMATION],
      error: null,
    });

    const result = await store.getInstagramAutomations();

    expect(result).toHaveLength(1);
    const call = getCalls('instagram_comment_automations', 'select').at(-1)!;
    expect(call.modifiers).toContainEqual({
      method: 'order',
      args: ['created_at', { ascending: true }],
    });
  });

  it('createInstagramAutomation inserts with conta_id', async () => {
    mockedSupabase.__queueSupabaseResult('instagram_comment_automations', 'insert', {
      data: AUTOMATION,
      error: null,
    });

    const result = await store.createInstagramAutomation({
      client_id: 1,
      name: 'Promo verão',
      ig_media_id: 'media-1',
      media_permalink: 'https://instagram.com/p/media-1',
      media_caption: 'Legenda do post',
      workflow_post_id: null,
      keywords: ['quero', 'link'],
      dm_message: 'Oi! Aqui está o link.',
      dm_buttons: [{ title: 'Agendar', url: 'https://agenda.x' }],
      public_reply: 'Te chamei no direct!',
    });

    expect(result).toMatchObject({ id: 'auto-1' });
    const call = getCalls('instagram_comment_automations', 'insert').at(-1)!;
    expect(call.payload).toMatchObject({
      client_id: 1,
      name: 'Promo verão',
      keywords: ['quero', 'link'],
      dm_message: 'Oi! Aqui está o link.',
      dm_buttons: [{ title: 'Agendar', url: 'https://agenda.x' }],
      conta_id: 'conta-1',
    });
  });

  it('createInstagramAutomation carries workflow_post_id for a post still in production', async () => {
    mockedSupabase.__queueSupabaseResult('instagram_comment_automations', 'insert', {
      data: { ...AUTOMATION, ig_media_id: null, workflow_post_id: 501 },
      error: null,
    });

    await store.createInstagramAutomation({
      client_id: 1,
      name: 'Aguardando publicação',
      ig_media_id: null,
      media_permalink: null,
      media_caption: 'Carrossel de agosto',
      workflow_post_id: 501,
      keywords: ['quero'],
      dm_message: 'Oi!',
      public_reply: null,
    });

    const call = getCalls('instagram_comment_automations', 'insert').at(-1)!;
    expect(call.payload).toMatchObject({
      workflow_post_id: 501,
      ig_media_id: null,
      conta_id: 'conta-1',
    });
  });

  it('updateInstagramAutomation patches by id', async () => {
    mockedSupabase.__queueSupabaseResult('instagram_comment_automations', 'update', {
      data: { ...AUTOMATION, ativo: false },
      error: null,
    });

    await store.updateInstagramAutomation('auto-1', { ativo: false });

    const call = getCalls('instagram_comment_automations', 'update').at(-1)!;
    expect(call.payload).toEqual({ ativo: false });
    expect(call.modifiers).toContainEqual({ method: 'eq', args: ['id', 'auto-1'] });
  });

  it('updateInstagramAutomation forwards workflow_post_id and omits pending_post_deleted_at when not given', async () => {
    mockedSupabase.__queueSupabaseResult('instagram_comment_automations', 'update', {
      data: { ...AUTOMATION, workflow_post_id: 501 },
      error: null,
    });

    await store.updateInstagramAutomation('auto-1', {
      workflow_post_id: 501,
      ig_media_id: null,
    });

    const call = getCalls('instagram_comment_automations', 'update').at(-1)!;
    expect(call.payload).toEqual({ workflow_post_id: 501, ig_media_id: null });
    expect(call.payload).not.toHaveProperty('pending_post_deleted_at');
  });

  it('updateInstagramAutomation can clear the tombstone when a new target is chosen', async () => {
    mockedSupabase.__queueSupabaseResult('instagram_comment_automations', 'update', {
      data: AUTOMATION,
      error: null,
    });

    await store.updateInstagramAutomation('auto-1', {
      workflow_post_id: null,
      ig_media_id: null,
      pending_post_deleted_at: null,
    });

    const call = getCalls('instagram_comment_automations', 'update').at(-1)!;
    expect(call.payload).toMatchObject({ pending_post_deleted_at: null });
  });

  it('getAutomationsForPost filters by workflow_post_id alone while the post has no media id', async () => {
    mockedSupabase.__queueSupabaseResult('instagram_comment_automations', 'select', {
      data: [{ ...AUTOMATION, ig_media_id: null, workflow_post_id: 501 }],
      error: null,
    });

    const result = await store.getAutomationsForPost(501, null);

    expect(result).toHaveLength(1);
    const call = getCalls('instagram_comment_automations', 'select').at(-1)!;
    expect(call.modifiers).toContainEqual({ method: 'eq', args: ['workflow_post_id', 501] });
    expect(call.modifiers.some((m) => m.method === 'or')).toBe(false);
    expect(call.modifiers).toContainEqual({
      method: 'order',
      args: ['created_at', { ascending: true }],
    });
  });

  it('getAutomationsForPost also matches the media id once the post has published', async () => {
    mockedSupabase.__queueSupabaseResult('instagram_comment_automations', 'select', {
      data: [AUTOMATION],
      error: null,
    });

    await store.getAutomationsForPost(501, '17900000000000001');

    const call = getCalls('instagram_comment_automations', 'select').at(-1)!;
    expect(call.modifiers).toContainEqual({
      method: 'or',
      args: ['workflow_post_id.eq.501,ig_media_id.eq.17900000000000001'],
    });
    // The `or` replaces the equality filter -- keeping both would AND them and
    // hide every automation created straight against the published media.
    expect(call.modifiers.some((m) => m.method === 'eq')).toBe(false);
  });

  it('getAutomationsForPost surfaces the error instead of swallowing it', async () => {
    mockedSupabase.__queueSupabaseResult('instagram_comment_automations', 'select', {
      data: null,
      error: { message: 'boom' },
    });

    await expect(store.getAutomationsForPost(501, null)).rejects.toBeTruthy();
  });

  it('deleteInstagramAutomation deletes by id', async () => {
    mockedSupabase.__queueSupabaseResult('instagram_comment_automations', 'delete', {
      data: null,
      error: null,
    });

    await store.deleteInstagramAutomation('auto-1');

    const call = getCalls('instagram_comment_automations', 'delete').at(-1)!;
    expect(call.modifiers).toContainEqual({ method: 'eq', args: ['id', 'auto-1'] });
  });

  it('getInstagramAutomationSends filters by automation_id, orders by created_at desc, defaults limit to 20', async () => {
    mockedSupabase.__queueSupabaseResult('instagram_automation_sends', 'select', {
      data: [SEND],
      error: null,
    });

    const result = await store.getInstagramAutomationSends('auto-1');

    expect(result).toHaveLength(1);
    const call = getCalls('instagram_automation_sends', 'select').at(-1)!;
    expect(call.modifiers).toContainEqual({ method: 'eq', args: ['automation_id', 'auto-1'] });
    expect(call.modifiers).toContainEqual({
      method: 'order',
      args: ['created_at', { ascending: false }],
    });
    expect(call.modifiers).toContainEqual({ method: 'limit', args: [20] });
  });

  it('getInstagramAutomationSends respects a custom limit', async () => {
    mockedSupabase.__queueSupabaseResult('instagram_automation_sends', 'select', {
      data: [SEND],
      error: null,
    });

    await store.getInstagramAutomationSends('auto-1', 5);

    const call = getCalls('instagram_automation_sends', 'select').at(-1)!;
    expect(call.modifiers).toContainEqual({ method: 'limit', args: [5] });
  });

  it('countInstagramAutomations uses head+count select', async () => {
    mockedSupabase.__queueSupabaseResult('instagram_comment_automations', 'select', {
      data: null,
      error: null,
      count: 3,
    });

    const result = await store.countInstagramAutomations();

    expect(result).toBe(3);
    const call = getCalls('instagram_comment_automations', 'select').at(-1)!;
    expect(call.selectArgs.at(-1)).toEqual(['*', { count: 'exact', head: true }]);
  });

  it('countInstagramAutomations falls back to 0 when count is null', async () => {
    mockedSupabase.__queueSupabaseResult('instagram_comment_automations', 'select', {
      data: null,
      error: null,
      count: null,
    });

    const result = await store.countInstagramAutomations();

    expect(result).toBe(0);
  });
});
