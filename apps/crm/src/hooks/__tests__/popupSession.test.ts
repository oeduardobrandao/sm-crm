import { beforeEach, describe, expect, it } from 'vitest';
import {
  markPopupClosed,
  markPopupShown,
  markPopupsSkipped,
  readPopupSession,
} from '../popupSession';

describe('popupSession', () => {
  beforeEach(() => sessionStorage.clear());

  it('vazio por padrão', () => {
    expect(readPopupSession()).toEqual({ shownId: null, closedIds: new Set(), skipped: false });
  });

  it('grava shown, closed e skipped', () => {
    markPopupShown('p1');
    markPopupClosed('p1');
    markPopupClosed('p2');
    markPopupsSkipped();
    const s = readPopupSession();
    expect(s.shownId).toBe('p1');
    expect([...s.closedIds].sort()).toEqual(['p1', 'p2']);
    expect(s.skipped).toBe(true);
  });
});
