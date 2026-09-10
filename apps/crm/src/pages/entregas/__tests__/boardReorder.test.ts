import { describe, expect, it } from 'vitest';
import { insertIntoFullOrder, mergeVisibleReorder } from '../boardReorder';

describe('mergeVisibleReorder', () => {
  it('reordena só os visíveis e mantém os ocultos no lugar', () => {
    // coluna inteira: 1 2 3 4 5; visíveis: 1 3 5; usuário arrasta 5 para antes de 1
    expect(mergeVisibleReorder([1, 2, 3, 4, 5], [5, 1, 3])).toEqual([5, 2, 1, 4, 3]);
  });

  it('sem ocultos é a própria ordem visível', () => {
    expect(mergeVisibleReorder([1, 2, 3], [3, 1, 2])).toEqual([3, 1, 2]);
  });

  it('ignora ids visíveis que não estão na coluna inteira e preserva os demais', () => {
    expect(mergeVisibleReorder([1, 2, 3], [3, 99, 1])).toEqual([3, 2, 1]);
  });

  it('coluna inteira vazia retorna vazio', () => {
    expect(mergeVisibleReorder([], [1])).toEqual([]);
  });
});

describe('insertIntoFullOrder', () => {
  it('insere antes do item visível no índice do slot', () => {
    // inteira: 1 2 3 4; visíveis: 1 3; slot 1 = antes do 3 -> 1 2 [9] 3 4
    expect(insertIntoFullOrder([1, 2, 3, 4], [1, 3], 1, 9)).toEqual([1, 2, 9, 3, 4]);
  });

  it('slot no fim da lista visível vai para o fim da coluna inteira', () => {
    expect(insertIntoFullOrder([1, 2, 3, 4], [1, 3], 2, 9)).toEqual([1, 2, 3, 4, 9]);
  });

  it('slot 0 vai para o início', () => {
    expect(insertIntoFullOrder([1, 2, 3], [1, 3], 0, 9)).toEqual([9, 1, 2, 3]);
  });

  it('remove uma ocorrência anterior do mesmo id antes de inserir', () => {
    expect(insertIntoFullOrder([1, 9, 2], [1, 2], 2, 9)).toEqual([1, 2, 9]);
  });
});
