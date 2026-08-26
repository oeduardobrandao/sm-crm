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
});
