import { afterEach, describe, expect, it } from 'vitest';
import { i18n } from '@mesaas/i18n';
import {
  conversaPreview,
  eventLabel,
  formatTime,
  mediaNoteLabel,
  TIPO_FILTERS,
} from '../mensagensLogic';
import type { MensagemConversa, MensagemFeedItem } from '@/store';

const item: MensagemFeedItem = {
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

const conversa: MensagemConversa = {
  cliente_id: 14,
  cliente_nome: 'ACME',
  last_source: 'mensagem',
  last_action: null,
  last_content: 'hi',
  last_is_workspace_user: false,
  last_author_name: null,
  last_created_at: '2026-07-30T10:00:00Z',
  unread_count: 0,
};

describe('mensagensLogic i18n', () => {
  afterEach(async () => {
    await i18n.changeLanguage('pt');
  });

  it('pt: labels keep the Portuguese copy', () => {
    expect(TIPO_FILTERS.map((f) => f.label)).toEqual([
      'Todas',
      'Mensagens',
      'Aprovações',
      'Sugestões',
    ]);
    expect(conversaPreview({ ...conversa, last_source: null })).toBe(
      'Sem mensagens ainda. Comece a conversa!',
    );
    expect(conversaPreview({ ...conversa, last_is_workspace_user: true })).toBe('Equipe: hi');
    expect(eventLabel({ ...item, source: 'post_feedback', action: 'correcao' })).toBe(
      'Pediu correção',
    );
    expect(formatTime('2026-08-10T17:35:00')).toBe('10 de ago., 17:35');
  });

  it('en: labels follow the UI language at call time', async () => {
    await i18n.changeLanguage('en');
    expect(TIPO_FILTERS.map((f) => f.label)).toEqual([
      'All',
      'Messages',
      'Approvals',
      'Suggestions',
    ]);
    expect(conversaPreview({ ...conversa, last_source: null })).toBe(
      'No messages yet. Start the conversation!',
    );
    expect(conversaPreview({ ...conversa, last_is_workspace_user: true })).toBe('Team: hi');
    expect(
      conversaPreview({ ...conversa, last_is_workspace_user: true, last_author_name: 'Ana' }),
    ).toBe('Ana: hi');
    expect(conversaPreview({ ...conversa, last_source: 'media_note' })).toBe(
      'Comment on media: hi',
    );
    expect(
      conversaPreview({ ...conversa, last_source: 'edit_suggestion', last_action: 'accepted' }),
    ).toBe('Edit suggestion accepted');
    expect(
      conversaPreview({
        ...conversa,
        last_source: 'post_feedback',
        last_action: 'aprovado',
        last_content: null,
      }),
    ).toBe('Approved the post');
    expect(eventLabel({ ...item, source: 'post_feedback', action: 'correcao' })).toBe(
      'Requested changes',
    );
    expect(eventLabel({ ...item, source: 'edit_suggestion', action: 'weird' })).toBe(
      'Edit suggestion',
    );
    expect(mediaNoteLabel({ ...item, source: 'media_note' })).toBe('Comment on media');
    expect(mediaNoteLabel({ ...item, source: 'media_note_reply' })).toBe(
      'Reply to a media comment',
    );
    expect(formatTime('2026-08-10T17:35:00')).toBe('Aug 10, 05:35 PM');
  });
});
