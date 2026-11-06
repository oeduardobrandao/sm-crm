import { describe, it, expect } from 'vitest';
import {
  conversaPreview,
  eventLabel,
  feedItemKey,
  isEventRow,
  matchesTipo,
  mediaNoteLabel,
  sortConversas,
  unreadTotal,
  TIPO_FILTERS,
} from '../mensagensLogic';
import type { MensagemConversa, MensagemFeedItem } from '@/store';

const base: MensagemFeedItem = {
  source: 'mensagem',
  item_id: 1,
  cliente_id: 14,
  cliente_nome: 'ACME',
  post_id: null,
  workflow_id: null,
  post_titulo: null,
  action: null,
  content: 'oi',
  is_workspace_user: false,
  author_user_id: null,
  author_name: null,
  author_avatar_url: null,
  created_at: '2026-07-30T10:00:00Z',
};

describe('mensagensLogic', () => {
  it('feedItemKey is unique across sources', () => {
    expect(feedItemKey(base)).toBe('mensagem-1');
    expect(feedItemKey({ ...base, source: 'post_feedback' })).toBe('post_feedback-1');
  });

  it('matchesTipo routes each source/action to the right filter', () => {
    const postMsg = { ...base, source: 'post_feedback' as const, action: 'mensagem' };
    const aprovacao = { ...base, source: 'post_feedback' as const, action: 'aprovado' };
    const sugestao = { ...base, source: 'edit_suggestion' as const };
    expect(matchesTipo(base, 'mensagens')).toBe(true);
    expect(matchesTipo(postMsg, 'mensagens')).toBe(true);
    expect(matchesTipo(aprovacao, 'mensagens')).toBe(false);
    expect(matchesTipo(aprovacao, 'aprovacoes')).toBe(true);
    expect(matchesTipo(sugestao, 'sugestoes')).toBe(true);
    for (const _f of TIPO_FILTERS) expect(matchesTipo(base, 'todas')).toBe(true);
  });

  it('matchesTipo puts media notes under todas and aprovacoes only', () => {
    const nota = { ...base, source: 'media_note' as const, action: 'nota' };
    const resposta = {
      ...base,
      source: 'media_note_reply' as const,
      action: 'resposta_nota',
      is_workspace_user: true,
    };
    for (const n of [nota, resposta]) {
      expect(matchesTipo(n, 'todas')).toBe(true);
      expect(matchesTipo(n, 'aprovacoes')).toBe(true);
      expect(matchesTipo(n, 'mensagens')).toBe(false);
      expect(matchesTipo(n, 'sugestoes')).toBe(false);
      expect(isEventRow(n)).toBe(false);
    }
  });

  it('mediaNoteLabel labels only the two media note sources', () => {
    expect(mediaNoteLabel({ ...base, source: 'media_note' })).toBe('Comentário na mídia');
    expect(mediaNoteLabel({ ...base, source: 'media_note_reply' })).toBe(
      'Resposta a um comentário na mídia',
    );
    expect(mediaNoteLabel(base)).toBeNull();
  });

  it('unreadTotal sums per-cliente rows', () => {
    expect(
      unreadTotal([
        { cliente_id: 1, unread_count: 2 },
        { cliente_id: 2, unread_count: 3 },
      ]),
    ).toBe(5);
    expect(unreadTotal([])).toBe(0);
  });

  const conversaBase: MensagemConversa = {
    cliente_id: 14,
    cliente_nome: 'ACME',
    last_source: 'mensagem',
    last_action: null,
    last_content: 'oi',
    last_is_workspace_user: false,
    last_author_name: null,
    last_created_at: '2026-07-30T10:00:00Z',
    unread_count: 0,
  };

  it('sortConversas orders by recency and can flip to oldest without mutating input', () => {
    const older = { ...conversaBase, cliente_id: 1, last_created_at: '2026-07-01T00:00:00Z' };
    const newer = { ...conversaBase, cliente_id: 2, last_created_at: '2026-07-31T00:00:00Z' };
    const input = [older, newer];
    expect(sortConversas(input, 'recentes').map((c) => c.cliente_id)).toEqual([2, 1]);
    expect(sortConversas(input, 'antigas').map((c) => c.cliente_id)).toEqual([1, 2]);
    expect(input.map((c) => c.cliente_id)).toEqual([1, 2]);
  });

  it('sortConversas sinks empty conversations to the bottom, alphabetically', () => {
    const ativa = { ...conversaBase, cliente_id: 1, last_created_at: '2026-07-01T00:00:00Z' };
    const vaziaB = {
      ...conversaBase,
      cliente_id: 2,
      cliente_nome: 'Beta',
      last_source: null,
      last_created_at: null,
    };
    const vaziaA = {
      ...conversaBase,
      cliente_id: 3,
      cliente_nome: 'Alfa',
      last_source: null,
      last_created_at: null,
    };
    expect(sortConversas([vaziaB, ativa, vaziaA], 'recentes').map((c) => c.cliente_id)).toEqual([
      1, 3, 2,
    ]);
    expect(sortConversas([vaziaB, ativa, vaziaA], 'antigas').map((c) => c.cliente_id)).toEqual([
      1, 3, 2,
    ]);
    expect(conversaPreview(vaziaA)).toBe('Sem mensagens ainda. Comece a conversa!');
  });

  it('conversaPreview prefixes agency messages and labels client events', () => {
    expect(conversaPreview(conversaBase)).toBe('oi');
    expect(
      conversaPreview({
        ...conversaBase,
        last_is_workspace_user: true,
        last_author_name: 'Ana',
        last_content: 'feito',
      }),
    ).toBe('Ana: feito');
    expect(
      conversaPreview({
        ...conversaBase,
        last_is_workspace_user: true,
        last_author_name: null,
        last_content: 'ok',
      }),
    ).toBe('Equipe: ok');
    expect(
      conversaPreview({
        ...conversaBase,
        last_source: 'post_feedback',
        last_action: 'aprovado',
        last_content: null,
      }),
    ).toBe('Aprovou o post');
    expect(
      conversaPreview({
        ...conversaBase,
        last_source: 'post_feedback',
        last_action: 'correcao',
        last_content: 'trocar foto',
      }),
    ).toBe('trocar foto');
    expect(
      conversaPreview({ ...conversaBase, last_source: 'edit_suggestion', last_action: 'pending' }),
    ).toBe('Sugestão de edição enviada');
  });

  it('conversaPreview for media_note', () => {
    expect(
      conversaPreview({
        ...conversaBase,
        last_source: 'media_note',
        last_action: 'nota',
        last_content: 'trocar a cor',
      }),
    ).toBe('Comentário na mídia: trocar a cor');
    expect(
      conversaPreview({
        ...conversaBase,
        last_source: 'media_note_reply',
        last_action: 'resposta_nota',
        last_is_workspace_user: true,
        last_author_name: 'Ana',
        last_content: 'feito',
      }),
    ).toBe('Ana: feito');
  });

  it('isEventRow/eventLabel mirror the thread event semantics', () => {
    const sugestao = { ...base, source: 'edit_suggestion' as const, action: 'pending' };
    const aprovadoSemComentario = {
      ...base,
      source: 'post_feedback' as const,
      action: 'aprovado',
      content: null,
    };
    const correcaoComComentario = {
      ...base,
      source: 'post_feedback' as const,
      action: 'correcao',
      content: 'trocar',
    };
    expect(isEventRow(sugestao)).toBe(true);
    expect(isEventRow(aprovadoSemComentario)).toBe(true);
    expect(isEventRow(correcaoComComentario)).toBe(false);
    expect(isEventRow(base)).toBe(false);
    expect(eventLabel(aprovadoSemComentario)).toBe('Aprovou o post');
    expect(eventLabel(sugestao)).toBe('Sugestão de edição enviada');
  });
});
