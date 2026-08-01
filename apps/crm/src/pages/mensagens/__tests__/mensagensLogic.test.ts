import { describe, it, expect } from 'vitest';
import { feedItemKey, matchesTipo, unreadTotal, TIPO_FILTERS } from '../mensagensLogic';
import type { MensagemFeedItem } from '@/store';

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

  it('unreadTotal sums per-cliente rows', () => {
    expect(
      unreadTotal([
        { cliente_id: 1, unread_count: 2 },
        { cliente_id: 2, unread_count: 3 },
      ]),
    ).toBe(5);
    expect(unreadTotal([])).toBe(0);
  });
});
