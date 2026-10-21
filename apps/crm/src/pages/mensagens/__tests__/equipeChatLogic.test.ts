import { describe, it, expect } from 'vitest';
import {
  agruparEquipeMensagens,
  equipeConversaPreview,
  sortEquipeConversas,
} from '../equipeChatLogic';
import type { EquipeConversa, EquipeMensagem } from '@/store';

const conversaBase: EquipeConversa = {
  conversa_id: 1,
  tipo: 'grupo',
  nome: 'Time de Criação',
  display_nome: 'Time de Criação',
  avatar_url: null,
  participantes_count: 4,
  last_author_name: null,
  last_author_id: null,
  last_content: 'oi',
  last_has_anexo: false,
  last_created_at: '2026-07-30T10:00:00Z',
  last_message_id: 1,
  unread_count: 0,
};

describe('equipeChatLogic', () => {
  it('equipeConversaPreview says "Você" when the last message is the current user\'s', () => {
    const minha = { ...conversaBase, last_author_name: 'Eduardo Brandão', last_author_id: 'u-1' };
    expect(equipeConversaPreview({ ...minha, last_content: 'oi' }, 'u-1')).toBe('Você: oi');
    expect(
      equipeConversaPreview({ ...minha, last_content: null, last_has_anexo: true }, 'u-1'),
    ).toBe('Você: Anexo');
    // Someone else's message keeps their name.
    expect(equipeConversaPreview({ ...minha, last_content: 'oi' }, 'u-2')).toBe(
      'Eduardo Brandão: oi',
    );
  });

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
        last_author_id: null,
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
        last_author_id: null,
        last_content: '   ',
        last_has_anexo: false,
      }),
    ).toBe('Ana');
  });

  it('equipeConversaPreview strips raw mention tokens, showing @Label instead of @[Label](tipo:id)', () => {
    expect(
      equipeConversaPreview({
        ...conversaBase,
        last_author_name: 'Ana',
        last_author_id: null,
        last_content: 'chama o @[Bruno](membro:6) aqui',
      }),
    ).toBe('Ana: chama o @Bruno aqui');
  });

  it('equipeConversaPreview shows the empty-conversation copy when there are no messages yet', () => {
    expect(
      equipeConversaPreview({ ...conversaBase, last_created_at: null, last_message_id: null }),
    ).toBe('Sem mensagens ainda. Comece a conversa!');
  });
});

describe('agruparEquipeMensagens', () => {
  // Local-time instants, so the day boundaries hold in any TZ the suite runs in.
  const at = (d: number, h: number, m: number) => new Date(2026, 9, d, h, m).toISOString();
  const msg = (id: number, author: string, created_at: string) =>
    ({ id, author_user_id: author, created_at }) as EquipeMensagem;
  const now = new Date(2026, 9, 21, 15, 0);

  it('stacks consecutive messages from one author and opens each day with a divider', () => {
    const rows = agruparEquipeMensagens(
      [
        msg(1, 'ana', at(19, 9, 0)),
        msg(2, 'eu', at(20, 18, 0)),
        msg(3, 'eu', at(21, 11, 57)),
        msg(4, 'eu', at(21, 11, 57)),
        msg(5, 'eu', at(21, 11, 59)),
        msg(6, 'ana', at(21, 12, 0)),
      ],
      now,
    );
    expect(
      rows.map((r) => (r.kind === 'dia' ? r.label : `${r.mensagem.id}:${+r.inicio}${+r.fim}`)),
    ).toEqual([
      'Segunda-feira, 19 de outubro',
      '1:11',
      'Ontem',
      '2:11',
      'Hoje',
      '3:10',
      '4:00',
      '5:01',
      '6:11',
    ]);
  });

  it('breaks a run after a 5 minute pause from the same author', () => {
    const rows = agruparEquipeMensagens(
      [msg(1, 'eu', at(21, 10, 0)), msg(2, 'eu', at(21, 10, 5)), msg(3, 'eu', at(21, 10, 11))],
      now,
    );
    expect(
      rows.filter((r) => r.kind === 'msg').map((r) => r.kind === 'msg' && [r.inicio, r.fim]),
    ).toEqual([
      [true, false],
      [false, true],
      [true, true],
    ]);
  });

  it('labels another year with the year', () => {
    const [dia] = agruparEquipeMensagens(
      [msg(1, 'eu', new Date(2025, 11, 31, 9).toISOString())],
      now,
    );
    expect(dia).toEqual({ kind: 'dia', key: 'dia-2025-12-31', label: '31 de dezembro de 2025' });
  });
});
