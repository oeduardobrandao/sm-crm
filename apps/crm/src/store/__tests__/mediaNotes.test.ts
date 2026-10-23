import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/supabase');

import * as supabaseModule from '../../lib/supabase';
import {
  createInternalMediaNote,
  getMediaNotes,
  openNotesOnLink,
  replyToMediaNote,
  setMediaNoteStatus,
  type MediaNote,
} from '../mediaNotes';
import { getPostApprovals } from '../posts';

type MockedSupabaseModule = typeof supabaseModule & {
  __getSupabaseCalls: () => Array<{
    table: string;
    operation: string;
    payload?: unknown;
    selectArgs: unknown[][];
    modifiers: Array<{ method: string; args: unknown[] }>;
  }>;
  __queueSupabaseResult: (
    table: string,
    operation: 'select' | 'insert' | 'update' | 'delete' | 'upsert',
    ...responses: Array<{ data?: unknown; error?: unknown; count?: number | null }>
  ) => void;
  __queueSupabaseRpc: (
    name: string,
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

function viewRow(over: Record<string, unknown> = {}) {
  return {
    id: 1,
    post_id: 10,
    media_kind: 'image',
    visibility: 'client',
    author_kind: 'client',
    author_user_id: null,
    current_link_id: 5,
    current_slide_index: 0,
    slide_index_at_creation: 0,
    is_previous_version: false,
    t_seconds: null,
    x: 0.4,
    y: 0.6,
    body: 'Trocar a cor',
    status: 'open',
    resolved_by: null,
    resolved_at: null,
    created_at: '2026-10-22T10:00:00Z',
    ...over,
  };
}

function note(over: Partial<MediaNote> = {}): MediaNote {
  return { ...viewRow(), replies: [], ...over } as MediaNote;
}

describe('media notes store', () => {
  beforeEach(() => {
    mockedSupabase.__resetSupabaseMock();
    mockedSupabase.__setCurrentProfile({
      id: 'user-1',
      nome: 'Eduardo',
      role: 'owner',
      conta_id: 'conta-1',
      active_workspace_id: 'conta-1',
    });
  });

  it('getMediaNotes returns empty without querying for no post ids', async () => {
    expect(await getMediaNotes([])).toEqual([]);
    expect(getCalls('post_media_notes_v')).toHaveLength(0);
  });

  it('getMediaNotes reads the view and groups replies', async () => {
    mockedSupabase.__queueSupabaseResult('post_media_notes_v', 'select', {
      data: [viewRow({ id: 1 }), viewRow({ id: 2, body: 'Outra' })],
      error: null,
    });
    mockedSupabase.__queueSupabaseResult('post_media_note_replies', 'select', {
      data: [
        {
          id: 7,
          note_id: 1,
          author_kind: 'team',
          author_user_id: 'user-1',
          body: 'Feito',
          created_at: '2026-10-22T11:00:00Z',
        },
        {
          id: 8,
          note_id: 1,
          author_kind: 'client',
          author_user_id: null,
          body: 'Valeu',
          created_at: '2026-10-22T12:00:00Z',
        },
      ],
      error: null,
    });

    const result = await getMediaNotes([10, 11]);

    expect(result.map((n) => n.id)).toEqual([1, 2]);
    expect(result[0].replies.map((r) => r.id)).toEqual([7, 8]);
    expect(result[1].replies).toEqual([]);
    const viewCall = getCalls('post_media_notes_v', 'select').at(-1)!;
    expect(viewCall.modifiers).toContainEqual({ method: 'in', args: ['post_id', [10, 11]] });
    const repliesCall = getCalls('post_media_note_replies', 'select').at(-1)!;
    expect(repliesCall.modifiers).toContainEqual({ method: 'in', args: ['note_id', [1, 2]] });
  });

  it('getMediaNotes skips the replies query when there are no notes', async () => {
    mockedSupabase.__queueSupabaseResult('post_media_notes_v', 'select', { data: [], error: null });
    expect(await getMediaNotes([10])).toEqual([]);
    expect(getCalls('post_media_note_replies')).toHaveLength(0);
  });

  it('getMediaNotes select string excludes hub_token', async () => {
    mockedSupabase.__queueSupabaseResult('post_media_notes_v', 'select', {
      data: [viewRow()],
      error: null,
    });
    mockedSupabase.__queueSupabaseResult('post_media_note_replies', 'select', {
      data: [],
      error: null,
    });
    await getMediaNotes([10]);

    for (const table of ['post_media_notes_v', 'post_media_note_replies']) {
      const call = getCalls(table, 'select').at(-1)!;
      const text = String(call.selectArgs[0]?.[0]);
      expect(text).toContain('id');
      expect(text).not.toContain('hub_token');
      expect(text).not.toContain('*');
    }
  });

  it('getMediaNotes propagates a view error', async () => {
    mockedSupabase.__queueSupabaseResult('post_media_notes_v', 'select', {
      data: null,
      error: { message: 'boom' },
    });
    await expect(getMediaNotes([10])).rejects.toBeTruthy();
  });

  it('createInternalMediaNote calls create_team_media_note with p_link_id', async () => {
    mockedSupabase.__queueSupabaseRpc('create_team_media_note', { data: 99, error: null });

    const id = await createInternalMediaNote({
      postId: 10,
      linkId: 5,
      tSeconds: 12.5,
      x: 0.2,
      y: 0.3,
      body: 'Nota interna',
    });

    expect(id).toBe(99);
    expect(getCalls('rpc:create_team_media_note', 'rpc').at(-1)!.payload).toEqual({
      p_post_id: 10,
      p_link_id: 5,
      p_t_seconds: 12.5,
      p_x: 0.2,
      p_y: 0.3,
      p_body: 'Nota interna',
    });
  });

  it('createInternalMediaNote sends null for omitted coordinates', async () => {
    mockedSupabase.__queueSupabaseRpc('create_team_media_note', { data: 100, error: null });
    await createInternalMediaNote({ postId: 10, linkId: 5, body: 'Sem ponto' });
    expect(getCalls('rpc:create_team_media_note', 'rpc').at(-1)!.payload).toEqual({
      p_post_id: 10,
      p_link_id: 5,
      p_t_seconds: null,
      p_x: null,
      p_y: null,
      p_body: 'Sem ponto',
    });
  });

  it('replyToMediaNote inserts a team reply with the current user and workspace', async () => {
    mockedSupabase.__queueSupabaseResult('post_media_note_replies', 'insert', {
      data: null,
      error: null,
    });
    await replyToMediaNote(3, 'Ajustado');
    const call = getCalls('post_media_note_replies', 'insert').at(-1)!;
    expect(call.payload).toEqual({
      note_id: 3,
      conta_id: 'conta-1',
      author_kind: 'team',
      author_user_id: 'user-1',
      body: 'Ajustado',
    });
  });

  it('setMediaNoteStatus updates only status for the ids', async () => {
    mockedSupabase.__queueSupabaseResult('post_media_notes', 'update', { data: null, error: null });
    await setMediaNoteStatus([1, 2], 'resolved');
    const call = getCalls('post_media_notes', 'update').at(-1)!;
    expect(call.payload).toEqual({ status: 'resolved' });
    expect(call.modifiers).toContainEqual({ method: 'in', args: ['id', [1, 2]] });
  });

  it('setMediaNoteStatus does nothing for an empty id list', async () => {
    await setMediaNoteStatus([], 'open');
    expect(getCalls('post_media_notes')).toHaveLength(0);
  });

  it('openNotesOnLink excludes resolved and previous-version notes', async () => {
    const notes = [
      note({ id: 1 }),
      note({ id: 2, status: 'resolved' }),
      note({ id: 3, is_previous_version: true }),
      note({ id: 4, current_link_id: 6 }),
      note({ id: 5, current_link_id: null }),
      note({ id: 6, visibility: 'internal', author_kind: 'team' }),
    ];
    expect(openNotesOnLink(notes, 5).map((n) => n.id)).toEqual([1, 6]);
  });

  it('getPostApprovals flattens media_note_ids', async () => {
    mockedSupabase.__queueSupabaseResult('post_approvals', 'select', {
      data: [
        {
          id: 1,
          post_id: 100,
          action: 'correcao',
          comentario: 'Ver notas',
          is_workspace_user: false,
          author_user_id: null,
          created_at: '2026-10-22',
          post_approval_media_notes: [{ note_id: 4 }, { note_id: 9 }],
        },
        {
          id: 2,
          post_id: 100,
          action: 'aprovado',
          comentario: null,
          is_workspace_user: false,
          author_user_id: null,
          created_at: '2026-10-23',
          post_approval_media_notes: [],
        },
      ],
      error: null,
    });

    const result = await getPostApprovals([100]);

    expect(result[0].media_note_ids).toEqual([4, 9]);
    expect(result[1].media_note_ids).toEqual([]);
    expect(result[0]).not.toHaveProperty('post_approval_media_notes');
    const call = getCalls('post_approvals', 'select').at(-1)!;
    expect(call.modifiers).toContainEqual({ method: 'in', args: ['post_id', [100]] });
  });

  // Deploy-order hardening: the frontend can reach production before migration
  // 20261025000001. The drawers must keep the client conversation, minus the notes.
  it('getPostApprovals retries without the embed when the relation is missing', async () => {
    const approval = {
      id: 1,
      post_id: 100,
      action: 'correcao',
      comentario: 'Ajustar',
      is_workspace_user: false,
      author_user_id: null,
      created_at: '2026-10-22',
    };
    mockedSupabase.__queueSupabaseResult(
      'post_approvals',
      'select',
      {
        data: null,
        error: {
          code: 'PGRST200',
          message:
            "Could not find a relationship between 'post_approvals' and 'post_approval_media_notes' in the schema cache",
        },
      },
      { data: [approval], error: null },
    );

    const result = await getPostApprovals([100]);

    expect(result).toEqual([{ ...approval, media_note_ids: [] }]);
    const calls = getCalls('post_approvals', 'select');
    expect(calls).toHaveLength(2);
    expect(calls[0].selectArgs[0][0]).toBe('*, post_approval_media_notes(note_id)');
    expect(calls[1].selectArgs[0][0]).toBe('*');
    expect(calls[1].modifiers).toContainEqual({ method: 'in', args: ['post_id', [100]] });
  });

  it('getPostApprovals does not retry on any other error', async () => {
    mockedSupabase.__queueSupabaseResult('post_approvals', 'select', {
      data: null,
      error: { code: '57014', message: 'canceling statement due to statement timeout' },
    });
    await expect(getPostApprovals([100])).rejects.toBeTruthy();
    expect(getCalls('post_approvals', 'select')).toHaveLength(1);
  });

  // A wrong column also "does not exist" and names the relation; it is a bug, not a
  // missing migration, so it must surface instead of dropping the notes.
  it('getPostApprovals does not retry on a wrong embed column (42703)', async () => {
    mockedSupabase.__queueSupabaseResult('post_approvals', 'select', {
      data: null,
      error: {
        code: '42703',
        message: 'column post_approval_media_notes_1.noteid does not exist',
      },
    });
    await expect(getPostApprovals([100])).rejects.toBeTruthy();
    expect(getCalls('post_approvals', 'select')).toHaveLength(1);
  });

  it('getMediaNotes surfaces a wrong view column (42703)', async () => {
    mockedSupabase.__queueSupabaseResult('post_media_notes_v', 'select', {
      data: null,
      error: { code: '42703', message: 'column post_media_notes_v.nope does not exist' },
    });
    await expect(getMediaNotes([10])).rejects.toBeTruthy();
  });

  it('getMediaNotes answers no notes when the view does not exist yet', async () => {
    mockedSupabase.__queueSupabaseResult('post_media_notes_v', 'select', {
      data: null,
      error: {
        code: 'PGRST205',
        message: "Could not find the table 'public.post_media_notes_v' in the schema cache",
      },
    });
    expect(await getMediaNotes([10])).toEqual([]);
    expect(getCalls('post_media_note_replies')).toHaveLength(0);
  });
});
