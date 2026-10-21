import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/supabase');

import * as supabaseModule from '../../lib/supabase';
import {
  TIKTOK_TARGET_STATE_EMBED,
  applyTikTokTargetState,
  getActivePosts,
  getAllWorkflowPosts,
  getAwaitingClientePosts,
  getScheduledPosts,
  getStandalonePost,
  getWorkflowPosts,
  getWorkflowPostsWithProperties,
  mapPostContextRow,
  tiktokLegacyState,
} from '../posts';

type MockedSupabaseModule = typeof supabaseModule & {
  __getSupabaseCalls: () => Array<{
    table: string;
    operation: string;
    selectArgs?: unknown[][];
    modifiers: Array<{ method: string; args: unknown[] }>;
  }>;
  __queueSupabaseResult: (
    table: string,
    operation: 'select' | 'insert' | 'update' | 'delete' | 'upsert',
    ...responses: Array<{ data?: unknown; error?: unknown }>
  ) => void;
  __resetSupabaseMock: () => void;
};
const mocked = supabaseModule as MockedSupabaseModule;
const selects = () =>
  mocked
    .__getSupabaseCalls()
    .filter((c) => c.table === 'workflow_posts' && c.operation === 'select')
    .map((c) => String(c.selectArgs?.[0]?.[0]));

const target = (status: string, extra: Record<string, unknown> = {}) => ({
  platform: 'tiktok',
  status,
  error: null,
  permalink: null,
  external_id: null,
  retry_count: 0,
  processing_at: null,
  ...extra,
});

/** A raw row as select('*') returns it: frozen legacy columns + the destination embed. */
const frozenRow = (targets: unknown[]) => ({
  id: 7,
  workflow_id: 3,
  cliente_id: 9,
  titulo: 'P',
  tipo: 'reels',
  status: 'agendado',
  platform: 'tiktok',
  tiktok_publish_status: 'failed',
  tiktok_publish_error: 'velho',
  tiktok_post_url: 'https://velho',
  tiktok_post_id: 'velho',
  tiktok_publish_id: 'pub-velho',
  tiktok_publish_retry_count: 3,
  targets_state: targets,
});

describe('tiktokLegacyState (spec §1 mapping)', () => {
  it.each([
    ['pendente', null],
    ['agendado', null],
    ['processando', 'processing'],
    ['publicado', 'published'],
    ['falha', 'failed'],
  ])('maps %s to %s', (status, legacy) => {
    expect(tiktokLegacyState([target(status)]).tiktok_publish_status).toBe(legacy);
  });

  it('copies error, permalink, external_id, retry_count and processing_at', () => {
    expect(
      tiktokLegacyState([
        { platform: 'instagram', status: 'publicado' },
        target('falha', {
          error: 'boom',
          permalink: 'https://www.tiktok.com/@x/video/1',
          external_id: '1',
          retry_count: 2,
          processing_at: '2026-10-13T10:00:00Z',
        }),
      ]),
    ).toEqual({
      tiktok_publish_status: 'failed',
      tiktok_publish_error: 'boom',
      tiktok_post_url: 'https://www.tiktok.com/@x/video/1',
      tiktok_post_id: '1',
      tiktok_publish_retry_count: 2,
      tiktok_publish_processing_at: '2026-10-13T10:00:00Z',
      tiktok_publish_id: null,
    });
  });

  it('nulls everything when there is no TikTok destination (or no embed at all)', () => {
    const empty = {
      tiktok_publish_status: null,
      tiktok_publish_error: null,
      tiktok_post_url: null,
      tiktok_post_id: null,
      tiktok_publish_retry_count: 0,
      tiktok_publish_processing_at: null,
      tiktok_publish_id: null,
    };
    expect(tiktokLegacyState([{ platform: 'instagram', status: 'publicado' }])).toEqual(empty);
    expect(tiktokLegacyState(undefined)).toEqual(empty);
  });
});

describe('applyTikTokTargetState', () => {
  it('overwrites the frozen columns and strips the embed', () => {
    const out = applyTikTokTargetState(frozenRow([target('pendente')]));
    expect(out).not.toHaveProperty('targets_state');
    expect(out).toMatchObject({
      id: 7,
      titulo: 'P',
      tiktok_publish_status: null,
      tiktok_publish_error: null,
      tiktok_post_url: null,
      tiktok_post_id: null,
      tiktok_publish_id: null,
      tiktok_publish_retry_count: 0,
    });
  });
});

describe('loaders embed the TikTok destination and map it', () => {
  beforeEach(() => mocked.__resetSupabaseMock());

  it('getWorkflowPosts', async () => {
    mocked.__queueSupabaseResult('workflow_posts', 'select', {
      data: [frozenRow([target('publicado', { permalink: 'https://t/1' })])],
      error: null,
    });
    const [post] = await getWorkflowPosts(3);
    expect(selects()).toEqual([`*, ${TIKTOK_TARGET_STATE_EMBED}`]);
    expect(post.tiktok_publish_status).toBe('published');
    expect(post.tiktok_post_url).toBe('https://t/1');
    expect(post).not.toHaveProperty('targets_state');
  });

  it('getAllWorkflowPosts', async () => {
    mocked.__queueSupabaseResult('workflow_posts', 'select', {
      data: [frozenRow([target('falha', { error: 'boom', retry_count: 1 })])],
      error: null,
    });
    const [post] = await getAllWorkflowPosts();
    expect(selects()).toEqual([`*, ${TIKTOK_TARGET_STATE_EMBED}`]);
    expect(post.tiktok_publish_status).toBe('failed');
    expect(post.tiktok_publish_error).toBe('boom');
    expect(post.tiktok_publish_retry_count).toBe(1);
  });

  it('getWorkflowPostsWithProperties', async () => {
    mocked.__queueSupabaseResult('workflow_posts', 'select', {
      data: [
        { ...frozenRow([target('processando')]), post_property_values: [], post_file_links: [] },
      ],
      error: null,
    });
    const [post] = await getWorkflowPostsWithProperties(3);
    expect(selects()[0]).toContain(TIKTOK_TARGET_STATE_EMBED);
    expect(post.tiktok_publish_status).toBe('processing');
    expect(post).not.toHaveProperty('targets_state');
    expect(post.has_media).toBe(false);
  });

  it('getStandalonePost', async () => {
    mocked.__queueSupabaseResult('workflow_posts', 'select', {
      data: { ...frozenRow([]), workflow_id: null, clientes: { nome: 'Beto' } },
      error: null,
    });
    const post = await getStandalonePost(7);
    expect(selects()).toEqual([`*, clientes(nome), ${TIKTOK_TARGET_STATE_EMBED}`]);
    expect(post).toMatchObject({
      cliente_nome: 'Beto',
      tiktok_publish_status: null,
      tiktok_post_url: null,
    });
    expect(post).not.toHaveProperty('targets_state');
  });

  it('getScheduledPosts, getActivePosts and getAwaitingClientePosts (POST_CONTEXT_COLUMNS)', async () => {
    const row = {
      ...frozenRow([target('publicado', { permalink: 'https://t/2' })]),
      scheduled_at: '2026-10-13T10:00:00Z',
      workflows: { titulo: 'F', cliente_id: 9, status: 'ativo', clientes: { nome: 'C' } },
    };
    mocked.__queueSupabaseResult(
      'workflow_posts',
      'select',
      { data: [row], error: null },
      { data: [], error: null },
    );
    const [scheduled] = await getScheduledPosts('2026-10-01T00:00:00Z', '2026-11-01T00:00:00Z');
    expect(scheduled.tiktok_publish_status).toBe('published');
    expect(scheduled.tiktok_post_url).toBe('https://t/2');

    mocked.__queueSupabaseResult(
      'workflow_posts',
      'select',
      { data: [row], error: null },
      { data: [], error: null },
    );
    const [active] = await getActivePosts();
    expect(active.tiktok_publish_status).toBe('published');

    mocked.__queueSupabaseResult(
      'workflow_posts',
      'select',
      {
        data: [{ ...row, status: 'enviado_cliente', created_at: '2026-10-01T00:00:00Z' }],
        error: null,
      },
      { data: [], error: null },
    );
    const [awaiting] = await getAwaitingClientePosts();
    expect(awaiting.tiktok_post_url).toBe('https://t/2');

    for (const select of selects()) {
      expect(select).toContain(TIKTOK_TARGET_STATE_EMBED);
      expect(select).not.toMatch(/(^|[ ,])tiktok_publish_status/);
    }
  });

  it('mapPostContextRow (postProcesses embeds) maps the embed', () => {
    const post = mapPostContextRow({
      ...frozenRow([target('falha', { error: 'x' })]),
      clientes: { nome: 'C' },
    });
    expect(post.tiktok_publish_status).toBe('failed');
    expect(post.tiktok_publish_error).toBe('x');
    expect(post).not.toHaveProperty('targets_state');
  });
});
