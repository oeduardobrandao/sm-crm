import { describe, expect, it } from 'vitest';
import { mentionHref } from '../mentionHref';
import type { MentionRef } from '../types';

describe('mentionHref', () => {
  it('links a membro mention to /equipe/:id', () => {
    const ref: MentionRef = { entityType: 'membro', id: 7, label: 'Ana' };
    expect(mentionHref(ref)).toBe('/equipe/7');
  });

  it('links a cliente mention to /clientes/:id', () => {
    const ref: MentionRef = { entityType: 'cliente', id: 12, label: 'Clínica X' };
    expect(mentionHref(ref)).toBe('/clientes/12');
  });

  it('links a tarefa mention to /tarefas?tarefa=:id', () => {
    const ref: MentionRef = { entityType: 'tarefa', id: 3, label: 'Revisar copy' };
    expect(mentionHref(ref)).toBe('/tarefas?tarefa=3');
  });

  it('links a post mention with a parentId to /entregas?drawer=:parentId&post=:id', () => {
    const ref: MentionRef = {
      entityType: 'post',
      id: 2,
      label: 'Post de lançamento',
      parentId: 42,
    };
    expect(mentionHref(ref)).toBe('/entregas?drawer=42&post=2');
  });

  it('links a post mention without a parentId (avulso) to the universal /entregas?post=:id form', () => {
    const ref: MentionRef = { entityType: 'post', id: 2, label: 'Post de lançamento' };
    expect(mentionHref(ref)).toBe('/entregas?post=2');
  });

  it('links a post mention with a null parentId (avulso) to /entregas?post=:id', () => {
    const ref: MentionRef = {
      entityType: 'post',
      id: 2,
      label: 'Post de lançamento',
      parentId: null,
    };
    expect(mentionHref(ref)).toBe('/entregas?post=2');
  });
});
