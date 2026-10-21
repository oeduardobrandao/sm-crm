import { describe, expect, it } from 'vitest';
import type { GlobalPopup, PopupInteraction } from '../../store/popups';
import { isHiddenForever, isHiddenToday, pickPopup, sameLocalDay } from '../pickPopup';

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
    trigger: null,
    created_at: '2026-09-01T00:00:00Z',
    ...over,
  };
}
const session = () => ({ shownId: null, closedIds: new Set<string>(), skipped: false });
const ix = (
  popup_id: string,
  action: PopupInteraction['action'],
  created_at = '2026-09-01T00:00:00Z',
): PopupInteraction => ({ popup_id, action, created_at });
/** ISO de um instante LOCAL: os testes não podem depender do fuso da máquina. */
const at = (y: number, m: number, d: number, h: number) => new Date(y, m, d, h, 0, 0).toISOString();

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

describe('daily', () => {
  const p = popup({ id: 'd', frequency: 'daily' });

  it('nunca some para sempre, mesmo com closed, cta ou ack', () => {
    expect(isHiddenForever(p, [ix('d', 'closed'), ix('d', 'cta'), ix('d', 'ack')])).toBe(false);
  });

  it('sameLocalDay compara ano, mês e dia locais', () => {
    expect(sameLocalDay(new Date(2026, 8, 6, 0, 1), new Date(2026, 8, 6, 23, 59))).toBe(true);
    expect(sameLocalDay(new Date(2026, 8, 6, 23, 59), new Date(2026, 8, 7, 0, 1))).toBe(false);
    expect(sameLocalDay(new Date(2026, 8, 6), new Date(2025, 8, 6))).toBe(false);
  });

  it('isHiddenToday: seen no mesmo dia local esconde; dia seguinte libera; closed não conta; só para daily', () => {
    const seen18 = ix('d', 'seen', at(2026, 8, 6, 18));
    expect(isHiddenToday(p, [seen18], new Date(2026, 8, 6, 23, 59))).toBe(true);
    expect(isHiddenToday(p, [seen18], new Date(2026, 8, 7, 0, 1))).toBe(false);
    expect(
      isHiddenToday(p, [ix('d', 'closed', at(2026, 8, 6, 18))], new Date(2026, 8, 6, 20)),
    ).toBe(false);
    expect(isHiddenToday(p, [ix('x', 'seen', at(2026, 8, 6, 18))], new Date(2026, 8, 6, 20))).toBe(
      false,
    );
    const once = popup({ id: 'o' });
    expect(
      isHiddenToday(once, [ix('o', 'seen', at(2026, 8, 6, 18))], new Date(2026, 8, 6, 20)),
    ).toBe(false);
  });

  it('pickPopup com now: daily visto hoje é pulado; visto ontem volta', () => {
    const now = new Date(2026, 8, 6, 20);
    expect(pickPopup([p], [ix('d', 'seen', at(2026, 8, 6, 18))], session(), now)).toBeNull();
    expect(pickPopup([p], [ix('d', 'seen', at(2026, 8, 5, 18))], session(), now)?.id).toBe('d');
    // shownId de um daily já visto hoje também não volta (recarregar não reabre)
    expect(
      pickPopup([p], [ix('d', 'seen', at(2026, 8, 6, 18))], { ...session(), shownId: 'd' }, now),
    ).toBeNull();
  });
});

describe('prioridade do gatilho', () => {
  it('popup com gatilho vence popup comum mais recente; entre gatilhos, o mais recente; escondido cede', () => {
    const plain = popup({ id: 'plain', created_at: '2026-09-05T00:00:00Z' });
    const trig = popup({
      id: 'trig',
      created_at: '2026-08-01T00:00:00Z',
      trigger: 'payment_pending',
    });
    const trig2 = popup({
      id: 'trig2',
      created_at: '2026-08-15T00:00:00Z',
      trigger: 'trial_ending',
    });
    expect(pickPopup([plain, trig], [], session())?.id).toBe('trig');
    expect(pickPopup([plain, trig, trig2], [], session())?.id).toBe('trig2');
    expect(pickPopup([plain, trig], [ix('trig', 'closed')], session())?.id).toBe('plain');
  });
});
