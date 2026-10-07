import { describe, it, expect } from 'vitest';
import { instagramProfileUrl } from '../profileUrl';
import { buildContactsCsv, contactsCsvFilename } from '../contactsCsv';
import type { InstagramContact } from '@/store';

const base: InstagramContact = {
  id: 'c1',
  client_id: 14,
  commenter_username: 'ana.souza',
  first_interaction_at: '2026-10-01T13:05:00.000Z',
  last_interaction_at: '2026-10-02T13:05:00.000Z',
  interactions_count: 2,
  reached: true,
  last_comment_text: 'quero; o link',
  automation_id: 'a1',
  automation_name: 'Promo',
  automation_deleted: false,
  created_at: '2026-10-01T13:05:01.000Z',
};

describe('instagramProfileUrl', () => {
  it('builds a link only for valid handles', () => {
    expect(instagramProfileUrl('ana.souza_1')).toBe('https://instagram.com/ana.souza_1');
    expect(instagramProfileUrl(null)).toBeNull();
    expect(instagramProfileUrl('ana/../x')).toBeNull();
    expect(instagramProfileUrl('a'.repeat(31))).toBeNull();
  });
});

describe('buildContactsCsv', () => {
  it('writes BOM, pt-BR header, ; separator, CRLF, sorted by last interaction desc', () => {
    const older = {
      ...base,
      id: 'c2',
      commenter_username: 'bia',
      last_interaction_at: '2026-09-01T10:00:00.000Z',
      reached: false,
    };
    const csv = buildContactsCsv([older, base], new Map([[14, 'ACME']]));
    expect(csv.startsWith('﻿')).toBe(true);
    const lines = csv.slice(1).split('\r\n');
    expect(lines[0]).toBe(
      'usuario;perfil_url;cliente;recebeu_dm;interacoes;primeira_interacao;ultima_interacao;automacao;ultimo_comentario',
    );
    expect(lines[1].startsWith('ana.souza;https://instagram.com/ana.souza;ACME;sim;2;')).toBe(true);
    expect(lines[1].endsWith(';Promo;"quero; o link"')).toBe(true);
    expect(lines[2]).toContain('bia;https://instagram.com/bia;ACME;não;');
  });

  it('handles unknown usernames, removed automations, removed clients and formulas', () => {
    const row = {
      ...base,
      commenter_username: null,
      automation_deleted: true,
      last_comment_text: '=HYPERLINK("x")',
    };
    const line = buildContactsCsv([row], new Map()).slice(1).split('\r\n')[1];
    expect(line.startsWith(';;;sim;')).toBe(true);
    expect(line).toContain('Promo (removida)');
    expect(line.endsWith(`;"'=HYPERLINK(""x"")"`)).toBe(true);
  });
});

describe('contactsCsvFilename', () => {
  it('slugs the client name or uses todos', () => {
    const now = new Date(2026, 9, 7);
    expect(contactsCsvFilename('Clínica Sorriso', now)).toBe(
      'contatos-clinica-sorriso-2026-10-07.csv',
    );
    expect(contactsCsvFilename(null, now)).toBe('contatos-todos-2026-10-07.csv');
  });
});
