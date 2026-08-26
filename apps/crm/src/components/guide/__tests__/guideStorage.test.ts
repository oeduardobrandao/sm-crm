import { beforeEach, describe, expect, it } from 'vitest';
import {
  EMPTY_PROGRESS,
  guideStorageKey,
  loadGuideProgress,
  saveGuideProgress,
} from '../guideStorage';

describe('guideStorage', () => {
  beforeEach(() => localStorage.clear());

  it('usa a chave versionada por workspace', () => {
    expect(guideStorageKey('ws-1')).toBe('guia_v1_ws-1');
  });

  it('devolve progresso vazio quando não há nada salvo', () => {
    expect(loadGuideProgress('ws-1')).toEqual(EMPTY_PROGRESS);
  });

  it('faz round-trip de um progresso salvo', () => {
    saveGuideProgress('ws-1', {
      ...EMPTY_PROGRESS,
      pagesSeen: ['t1p1'],
      pagesDone: ['t1p1'],
      lastPageId: 't1p2',
    });
    const loaded = loadGuideProgress('ws-1');
    expect(loaded.pagesSeen).toEqual(['t1p1']);
    expect(loaded.lastPageId).toBe('t1p2');
  });

  it('reseta para vazio em JSON corrompido', () => {
    localStorage.setItem('guia_v1_ws-1', '{nope');
    expect(loadGuideProgress('ws-1')).toEqual(EMPTY_PROGRESS);
  });

  it('preenche arrays ausentes em payload parcial antigo', () => {
    localStorage.setItem('guia_v1_ws-1', JSON.stringify({ lastPageId: 't1p3' }));
    const loaded = loadGuideProgress('ws-1');
    expect(loaded.pagesSeen).toEqual([]);
    expect(loaded.trailsCompleted).toEqual([]);
    expect(loaded.lastPageId).toBe('t1p3');
  });

  it('não vaza progresso entre workspaces', () => {
    saveGuideProgress('ws-1', { ...EMPTY_PROGRESS, pagesSeen: ['t1p1'] });
    expect(loadGuideProgress('ws-2')).toEqual(EMPTY_PROGRESS);
  });

  it('loadGuideProgress não compartilha array references com EMPTY_PROGRESS', () => {
    // Duas chamadas consecutivas sem dados salvos devem retornar objetos com arrays
    // que NÃO são a mesma referência entre si, nem com EMPTY_PROGRESS
    const p1 = loadGuideProgress('ws-1');
    const p2 = loadGuideProgress('ws-1');

    expect(p1.pagesSeen).not.toBe(EMPTY_PROGRESS.pagesSeen);
    expect(p2.pagesSeen).not.toBe(EMPTY_PROGRESS.pagesSeen);
    expect(p1.pagesSeen).not.toBe(p2.pagesSeen);

    expect(p1.pagesDone).not.toBe(EMPTY_PROGRESS.pagesDone);
    expect(p2.pagesDone).not.toBe(EMPTY_PROGRESS.pagesDone);
    expect(p1.pagesDone).not.toBe(p2.pagesDone);

    expect(p1.trailsCompleted).not.toBe(EMPTY_PROGRESS.trailsCompleted);
    expect(p2.trailsCompleted).not.toBe(EMPTY_PROGRESS.trailsCompleted);
    expect(p1.trailsCompleted).not.toBe(p2.trailsCompleted);

    // Verificar que mutação em-place não vaza estado
    p1.pagesSeen.push('leaked-item');
    expect(EMPTY_PROGRESS.pagesSeen).toEqual([]);
    expect(p2.pagesSeen).toEqual([]);
  });
});
