import { afterEach, describe, expect, it } from 'vitest';
import { i18n } from '@mesaas/i18n';
import {
  equipeConversaPreview,
  equipeSemMensagens,
  horaMensagem,
  rotuloDia,
} from '../equipeChatLogic';
import type { EquipeConversa } from '@/store';

const conversa: EquipeConversa = {
  conversa_id: 1,
  tipo: 'grupo',
  nome: 'Time',
  display_nome: 'Time',
  avatar_url: null,
  participantes_count: 4,
  last_author_name: null,
  last_author_id: null,
  last_content: 'oi',
  last_has_anexo: false,
  last_created_at: '2026-07-30T10:00:00Z',
  last_message_id: 1,
  unread_count: 0,
  dm_user_id: null,
};

const now = new Date(2026, 9, 21, 12, 0);

describe('equipeChatLogic i18n', () => {
  afterEach(async () => {
    await i18n.changeLanguage('pt');
  });

  it('pt: keeps the Portuguese copy', () => {
    expect(equipeSemMensagens()).toBe('Sem mensagens ainda. Comece a conversa!');
    expect(equipeConversaPreview({ ...conversa, last_author_id: 'me' }, 'me')).toBe('Você: oi');
    expect(rotuloDia(new Date(2026, 9, 21, 9), now)).toBe('Hoje');
    expect(rotuloDia(new Date(2026, 9, 19, 9), now)).toBe('Segunda-feira, 19 de outubro');
    expect(rotuloDia(new Date(2025, 9, 19, 9), now)).toBe('19 de outubro de 2025');
    expect(horaMensagem(new Date(2026, 9, 21, 14, 7).toISOString())).toBe('14:07');
  });

  it('en: follows the UI language at call time', async () => {
    await i18n.changeLanguage('en');
    expect(equipeSemMensagens()).toBe('No messages yet. Start the conversation!');
    expect(equipeConversaPreview({ ...conversa, last_created_at: null })).toBe(
      'No messages yet. Start the conversation!',
    );
    expect(equipeConversaPreview({ ...conversa, last_author_id: 'me' }, 'me')).toBe('You: oi');
    expect(equipeConversaPreview(conversa)).toBe('Team: oi');
    expect(
      equipeConversaPreview({
        ...conversa,
        last_author_name: 'Ana',
        last_content: '',
        last_has_anexo: true,
      }),
    ).toBe('Ana: Attachment');
    expect(rotuloDia(new Date(2026, 9, 21, 9), now)).toBe('Today');
    expect(rotuloDia(new Date(2026, 9, 20, 9), now)).toBe('Yesterday');
    expect(rotuloDia(new Date(2026, 9, 19, 9), now)).toBe('Monday, October 19');
    expect(rotuloDia(new Date(2025, 9, 19, 9), now)).toBe('October 19, 2025');
    expect(horaMensagem(new Date(2026, 9, 21, 14, 7).toISOString())).toBe('2:07 PM');
  });
});
