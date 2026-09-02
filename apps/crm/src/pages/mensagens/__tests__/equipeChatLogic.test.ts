import { describe, it, expect } from 'vitest';
import { equipeConversaPreview, sortEquipeConversas } from '../equipeChatLogic';
import type { EquipeConversa } from '@/store';

const conversaBase: EquipeConversa = {
  conversa_id: 1,
  tipo: 'grupo',
  nome: 'Time de Criação',
  display_nome: 'Time de Criação',
  avatar_url: null,
  participantes_count: 4,
  last_author_name: null,
  last_content: 'oi',
  last_has_anexo: false,
  last_created_at: '2026-07-30T10:00:00Z',
  last_message_id: 1,
  unread_count: 0,
};

describe('equipeChatLogic', () => {
  it('sortEquipeConversas orders by recency and can flip to oldest without mutating input', () => {
    const older = { ...conversaBase, conversa_id: 1, last_created_at: '2026-07-01T00:00:00Z' };
    const newer = { ...conversaBase, conversa_id: 2, last_created_at: '2026-07-31T00:00:00Z' };
    const input = [older, newer];
    expect(sortEquipeConversas(input, 'recentes').map((c) => c.conversa_id)).toEqual([2, 1]);
    expect(sortEquipeConversas(input, 'antigas').map((c) => c.conversa_id)).toEqual([1, 2]);
    expect(input.map((c) => c.conversa_id)).toEqual([1, 2]);
  });

  it('sortEquipeConversas sinks empty conversations to the bottom, alphabetically', () => {
    const ativa = { ...conversaBase, conversa_id: 1, last_created_at: '2026-07-01T00:00:00Z' };
    const vaziaB = {
      ...conversaBase,
      conversa_id: 2,
      display_nome: 'Beta',
      last_created_at: null,
      last_message_id: null,
    };
    const vaziaA = {
      ...conversaBase,
      conversa_id: 3,
      display_nome: 'Alfa',
      last_created_at: null,
      last_message_id: null,
    };
    expect(
      sortEquipeConversas([vaziaB, ativa, vaziaA], 'recentes').map((c) => c.conversa_id),
    ).toEqual([1, 3, 2]);
    expect(
      sortEquipeConversas([vaziaB, ativa, vaziaA], 'antigas').map((c) => c.conversa_id),
    ).toEqual([1, 3, 2]);
    expect(equipeConversaPreview(vaziaA)).toBe('Sem mensagens ainda. Comece a conversa!');
  });

  it('equipeConversaPreview prefixes the author, falling back to Equipe', () => {
    expect(
      equipeConversaPreview({ ...conversaBase, last_author_name: 'Ana', last_content: 'oi' }),
    ).toBe('Ana: oi');
    expect(
      equipeConversaPreview({ ...conversaBase, last_author_name: null, last_content: 'oi' }),
    ).toBe('Equipe: oi');
  });

  it('equipeConversaPreview shows "Anexo" when there is no text but there is an attachment', () => {
    expect(
      equipeConversaPreview({
        ...conversaBase,
        last_author_name: 'Ana',
        last_content: null,
        last_has_anexo: true,
      }),
    ).toBe('Ana: Anexo');
  });

  it('equipeConversaPreview falls back to just the author when there is neither text nor attachment', () => {
    expect(
      equipeConversaPreview({
        ...conversaBase,
        last_author_name: 'Ana',
        last_content: '   ',
        last_has_anexo: false,
      }),
    ).toBe('Ana');
  });

  it('equipeConversaPreview shows the empty-conversation copy when there are no messages yet', () => {
    expect(
      equipeConversaPreview({ ...conversaBase, last_created_at: null, last_message_id: null }),
    ).toBe('Sem mensagens ainda. Comece a conversa!');
  });
});
