import { describe, expect, it } from 'vitest';
import type { GlobalPopup, PopupInteraction } from '../../store/popups';
import { isHiddenForever, pickPopup } from '../pickPopup';

function popup(over: Partial<GlobalPopup>): GlobalPopup {
  return {
    id: 'p',
    pages: [{ title: 'T', eyebrow: null, body: 'B', image_key: null }],
    cta_label: null,
    cta_url: null,
    cta_style: 'ink',
    secondary_label: null,
    frequency: 'once',
    require_ack: false,
    created_at: '2026-09-01T00:00:00Z',
    ...over,
  };
}
const session = () => ({ shownId: null, closedIds: new Set<string>(), skipped: false });
const ix = (popup_id: string, action: PopupInteraction['action']): PopupInteraction => ({
  popup_id,
  action,
});

describe('isHiddenForever', () => {
  it('once: closed, cta ou ack escondem; seen não', () => {
    const p = popup({ id: 'a' });
    expect(isHiddenForever(p, [ix('a', 'seen')])).toBe(false);
    expect(isHiddenForever(p, [ix('a', 'closed')])).toBe(true);
    expect(isHiddenForever(p, [ix('a', 'cta')])).toBe(true);
    expect(isHiddenForever(p, [ix('a', 'ack')])).toBe(true);
    expect(isHiddenForever(p, [ix('b', 'closed')])).toBe(false);
  });

  it('until_cta: só cta ou ack escondem', () => {
    const p = popup({ id: 'a', frequency: 'until_cta' });
    expect(isHiddenForever(p, [ix('a', 'closed'), ix('a', 'closed')])).toBe(false);
    expect(isHiddenForever(p, [ix('a', 'cta')])).toBe(true);
    expect(isHiddenForever(p, [ix('a', 'ack')])).toBe(true);
  });
});

describe('pickPopup', () => {
  const older = popup({ id: 'old', created_at: '2026-08-01T00:00:00Z' });
  const newer = popup({ id: 'new', created_at: '2026-09-01T00:00:00Z' });

  it('sessão pulada: null', () => {
    expect(pickPopup([newer], [], { ...session(), skipped: true })).toBeNull();
  });

  it('descarta escondidos para sempre e fechados na sessão; escolhe o mais recente', () => {
    expect(pickPopup([older, newer], [], session())?.id).toBe('new');
    expect(pickPopup([older, newer], [ix('new', 'closed')], session())?.id).toBe('old');
    const s = session();
    s.closedIds.add('new');
    expect(pickPopup([older, newer], [], s)?.id).toBe('old');
  });

  it('um por sessão: shownId ainda elegível volta (recarregou sem interagir); senão null', () => {
    expect(pickPopup([older, newer], [], { ...session(), shownId: 'old' })?.id).toBe('old');
    expect(
      pickPopup([older, newer], [ix('old', 'closed')], { ...session(), shownId: 'old' }),
    ).toBeNull();
  });

  it('nada elegível: null', () => {
    expect(pickPopup([], [], session())).toBeNull();
  });
});
