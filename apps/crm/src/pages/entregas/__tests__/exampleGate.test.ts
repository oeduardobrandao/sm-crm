import { describe, expect, it } from 'vitest';
import { shouldShowExample } from '../tour/exampleGate';

describe('shouldShowExample', () => {
  it('mostra o exemplo no primeiro acesso sem nenhum card', () => {
    expect(shouldShowExample({ activeBoardCount: 0, tourDone: false, replayActive: false })).toBe(
      true,
    );
  });

  it('não mostra quando existe qualquer card ativo, mesmo antes do tour', () => {
    expect(shouldShowExample({ activeBoardCount: 1, tourDone: false, replayActive: false })).toBe(
      false,
    );
  });

  it('não mostra depois do tour, exceto em replay', () => {
    expect(shouldShowExample({ activeBoardCount: 0, tourDone: true, replayActive: false })).toBe(
      false,
    );
    expect(shouldShowExample({ activeBoardCount: 0, tourDone: true, replayActive: true })).toBe(
      true,
    );
  });

  it('replay com cards ativos não mostra o exemplo', () => {
    expect(shouldShowExample({ activeBoardCount: 2, tourDone: true, replayActive: true })).toBe(
      false,
    );
  });
});
