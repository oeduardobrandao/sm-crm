import { describe, expect, it } from 'vitest';
import type { IgComment } from '../../../../services/instagramComments';
import { groupComments } from '../groupComments';

function c(id: string, parent_id?: string | null): IgComment {
  return {
    id,
    text: `texto ${id}`,
    timestamp: '2026-11-20T12:00:00Z',
    username: `user_${id}`,
    like_count: 0,
    replies_count: 0,
    replies_more: false,
    ...(parent_id === undefined ? {} : { parent_id }),
  };
}

function shape(groups: ReturnType<typeof groupComments>) {
  return groups.map((g) => [g.comment.id, g.replies.map((r) => r.id)]);
}

describe('groupComments', () => {
  it('aninha respostas sob o pai, mantendo a ordem original', () => {
    const groups = groupComments([c('a'), c('a1', 'a'), c('b'), c('a2', 'a'), c('b1', 'b')]);
    expect(shape(groups)).toEqual([
      ['a', ['a1', 'a2']],
      ['b', ['b1']],
    ]);
  });

  it('resposta cujo pai não está na lista vira item de topo, na posição dela', () => {
    const groups = groupComments([c('a'), c('orfa', 'sumiu'), c('b')]);
    expect(shape(groups)).toEqual([
      ['a', []],
      ['orfa', []],
      ['b', []],
    ]);
  });

  it('sem parent_id em nenhum item (function antiga) devolve tudo como topo', () => {
    const groups = groupComments([c('a'), c('b'), c('c')]);
    expect(shape(groups)).toEqual([
      ['a', []],
      ['b', []],
      ['c', []],
    ]);
  });

  it('parent_id nulo conta como topo', () => {
    expect(shape(groupComments([c('a', null), c('a1', 'a')]))).toEqual([['a', ['a1']]]);
  });

  it('a resposta aparece antes do pai na lista: ainda fica sob o pai', () => {
    expect(shape(groupComments([c('a1', 'a'), c('a')]))).toEqual([['a', ['a1']]]);
  });

  it('nunca perde linha: resposta de resposta, auto-referência e ciclo viram topo', () => {
    const input = [
      c('a'),
      c('a1', 'a'),
      c('a1x', 'a1'), // pai é resposta: só um nível
      c('self', 'self'), // aponta para si mesma
      c('x', 'y'), // ciclo x <-> y
      c('y', 'x'),
      c('orfa', 'nao-existe'),
    ];
    const groups = groupComments(input);
    const ids = groups.flatMap((g) => [g.comment.id, ...g.replies.map((r) => r.id)]);
    expect(ids.slice().sort()).toEqual(input.map((i) => i.id).sort());
    expect(new Set(ids).size).toBe(input.length);
    expect(shape(groups)).toEqual([
      ['a', ['a1']],
      ['a1x', []],
      ['self', []],
      ['x', []],
      ['y', []],
      ['orfa', []],
    ]);
  });
});
