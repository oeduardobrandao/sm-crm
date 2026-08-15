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
      keywords: ['quero', 'link'],
      dm_message: 'Oi! Aqui está o link.',
      public_reply: 'Te chamei no direct!',
    });

    expect(result).toMatchObject({ id: 'auto-1' });
    const call = getCalls('instagram_comment_automations', 'insert').at(-1)!;
    expect(call.payload).toMatchObject({
      client_id: 1,
      name: 'Promo verão',
      keywords: ['quero', 'link'],
      dm_message: 'Oi! Aqui está o link.',
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
