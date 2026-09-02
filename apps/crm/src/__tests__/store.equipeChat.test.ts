import { describe, it, expect, beforeEach, vi } from 'vitest';
vi.mock('@/lib/supabase');
import * as mockedSupabase from '@/lib/supabase';
import {
  getEquipeConversas, getEquipeMensagens, createEquipeConversa,
  manageEquipeConversa, markEquipeConversaSeen, getEquipeChatUnread,
  getEquipeChatMembers, sendEquipeMensagem,
} from '@/store/equipeChat';

type Mocked = typeof mockedSupabase & {
  __resetSupabaseMock: () => void;
  __queueSupabaseRpc: (name: string, ...r: { data: unknown; error: unknown }[]) => void;
  __getSupabaseCalls: () => Array<{ table: string; operation: string; payload: unknown }>;
};
const m = mockedSupabase as unknown as Mocked;

function rpcCalls(name: string) {
  return m.__getSupabaseCalls().filter((c) => c.table === `rpc:${name}`);
}

beforeEach(() => m.__resetSupabaseMock());

describe('store/equipeChat', () => {
  it('getEquipeConversas devolve as linhas da RPC', async () => {
    const row = {
      conversa_id: 1, tipo: 'grupo', nome: 'Time', display_nome: 'Time',
      avatar_url: null, participantes_count: 3, last_author_name: 'Ana',
      last_content: 'oi', last_has_anexo: false,
      last_created_at: '2026-09-02T10:00:00Z', last_message_id: 9, unread_count: 2,
    };
    m.__queueSupabaseRpc('get_equipe_conversas', { data: [row], error: null });
    expect(await getEquipeConversas()).toEqual([row]);
  });

  it('getEquipeMensagens passa o cursor composto', async () => {
    m.__queueSupabaseRpc('get_equipe_mensagens', { data: [], error: null });
    await getEquipeMensagens({
      conversaId: 7,
      cursor: { before: '2026-09-01T00:00:00Z', beforeId: 5 },
    });
    expect(rpcCalls('get_equipe_mensagens').at(-1)!.payload).toEqual({
      p_conversa_id: 7,
      p_before: '2026-09-01T00:00:00Z',
      p_before_id: 5,
      p_limit: 50,
    });
  });

  it('getEquipeMensagens sem cursor omite os params de before', async () => {
    m.__queueSupabaseRpc('get_equipe_mensagens', { data: [], error: null });
    await getEquipeMensagens({ conversaId: 7 });
    expect(rpcCalls('get_equipe_mensagens').at(-1)!.payload).toEqual({
      p_conversa_id: 7,
      p_limit: 50,
    });
  });

  it('createEquipeConversa dm devolve o id', async () => {
    m.__queueSupabaseRpc('create_equipe_conversa', { data: 42, error: null });
    expect(await createEquipeConversa('dm', null, ['uid-b'])).toBe(42);
    expect(rpcCalls('create_equipe_conversa').at(-1)!.payload).toEqual({
      p_tipo: 'dm', p_nome: null, p_user_ids: ['uid-b'],
    });
  });

  it('manageEquipeConversa monta o payload da acao', async () => {
    m.__queueSupabaseRpc('manage_equipe_conversa', { data: null, error: null });
    await manageEquipeConversa(3, 'add', { userId: 'uid-c' });
    expect(rpcCalls('manage_equipe_conversa').at(-1)!.payload).toEqual({
      p_conversa_id: 3, p_action: 'add', p_nome: null, p_user_id: 'uid-c',
    });
  });

  it('markEquipeConversaSeen envia o high-water mark', async () => {
    m.__queueSupabaseRpc('mark_equipe_conversa_seen', { data: null, error: null });
    await markEquipeConversaSeen(3, 99);
    expect(rpcCalls('mark_equipe_conversa_seen').at(-1)!.payload).toEqual({
      p_conversa_id: 3, p_last_message_id: 99,
    });
  });

  it('getEquipeChatUnread devolve o total', async () => {
    m.__queueSupabaseRpc('get_equipe_chat_unread', { data: 5, error: null });
    expect(await getEquipeChatUnread()).toBe(5);
  });

  it('getEquipeChatMembers devolve a lista', async () => {
    const member = { user_id: 'u1', nome: 'Ana', avatar_url: null, role: 'admin' };
    m.__queueSupabaseRpc('get_equipe_chat_members', { data: [member], error: null });
    expect(await getEquipeChatMembers()).toEqual([member]);
  });

  it('sendEquipeMensagem envia anexos e devolve o id', async () => {
    m.__queueSupabaseRpc('send_equipe_mensagem', { data: 11, error: null });
    expect(await sendEquipeMensagem(3, 'oi', [8, 9])).toBe(11);
    expect(rpcCalls('send_equipe_mensagem').at(-1)!.payload).toEqual({
      p_conversa_id: 3, p_content: 'oi', p_anexo_ids: [8, 9],
    });
  });

  it('propaga erro da RPC', async () => {
    m.__queueSupabaseRpc('send_equipe_mensagem', {
      data: null, error: { message: 'Forbidden' },
    });
    await expect(sendEquipeMensagem(3, 'oi')).rejects.toBeTruthy();
  });
});
