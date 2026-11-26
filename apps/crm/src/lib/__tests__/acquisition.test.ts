import { describe, expect, it } from 'vitest';
import {
  ACQUISITION_STORAGE_KEY,
  ACQUISITION_TTL_MS,
  buildTouch,
  captureAcquisition,
  clearStoredAcquisition,
  getStoredAcquisition,
  isNonDirect,
  tokenRoutePrefix,
} from '../acquisition';

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    map,
  };
}

const T0 = Date.parse('2026-11-01T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const AD = 'https://mesaas.com.br/?utm_source=Meta&utm_medium=paid&utm_campaign=lp&fbclid=XYZ';

describe('acquisition capture', () => {
  it('first visit stores first and, when non-direct, last', () => {
    const s = memoryStorage();
    const out = captureAcquisition(AD, '', s, T0);
    expect(out?.first.utm_source).toBe('meta');
    expect(out?.first.click).toBe('fbclid');
    expect(out?.last).toEqual(out?.first);
    expect(s.map.get(ACQUISITION_STORAGE_KEY)).not.toContain('XYZ');
  });

  it('a direct first visit stores first and no last', () => {
    const s = memoryStorage();
    const out = captureAcquisition('https://mesaas.com.br/', '', s, T0);
    expect(out?.first.landing_path).toBe('/');
    expect(out?.last).toBeNull();
  });

  it('direct return keeps first and last', () => {
    const s = memoryStorage();
    const a = captureAcquisition(AD, '', s, T0);
    const b = captureAcquisition('https://mesaas.com.br/precos', '', s, T0 + 3 * DAY);
    expect(b).toEqual(a);
  });

  it('a later non-direct visit replaces last only', () => {
    const s = memoryStorage();
    const a = captureAcquisition(AD, '', s, T0);
    const b = captureAcquisition(
      'https://mesaas.com.br/?utm_source=ig&utm_medium=social',
      '',
      s,
      T0 + DAY,
    );
    expect(b?.first).toEqual(a?.first);
    expect(b?.last?.utm_source).toBe('ig');
  });

  it('own and payment referrers are not a source', () => {
    const own = buildTouch('https://mesaas.com.br/', 'https://www.mesaas.com.br/blog/x', T0);
    expect(own.referrer_host).toBeNull();
    expect(isNonDirect(own)).toBe(false);
    const pay = buildTouch('https://mesaas.com.br/', 'https://checkout.stripe.com/c/pay', T0);
    expect(pay.referrer_host).toBeNull();
    expect(isNonDirect(pay)).toBe(false);
    const pagarme = buildTouch('https://mesaas.com.br/', 'https://x.pagar.me/y', T0);
    expect(pagarme.referrer_host).toBeNull();
    const preview = buildTouch('https://mesaas.com.br/', 'https://foo-abc.vercel.app/', T0);
    expect(preview.referrer_host).toBeNull();
    const page = buildTouch(
      'https://staging-x.example.dev/precos',
      'https://staging-x.example.dev/',
      T0,
    );
    expect(page.referrer_host).toBeNull();
  });

  it('keeps host only and pathname only', () => {
    const t = buildTouch('/precos?x=1#y', 'https://l.instagram.com/?u=abc', T0);
    expect(t.referrer_host).toBe('l.instagram.com');
    expect(t.landing_path).toBe('/precos');
    expect(isNonDirect(t)).toBe(true);
  });

  it('flags the affiliate ref without storing the code', () => {
    const t = buildTouch('https://mesaas.com.br/?ref=ana7k3f', '', T0);
    expect(t.ref).toBe(true);
    expect(JSON.stringify(t)).not.toContain('ana7k3f');
  });

  it('click is the first present param in order', () => {
    const t = buildTouch('https://mesaas.com.br/?msclkid=a&gclid=b', '', T0);
    expect(t.click).toBe('gclid');
  });

  it('cuts strings to 200 chars', () => {
    const long = 'a'.repeat(300);
    const t = buildTouch(`https://mesaas.com.br/?utm_campaign=${long}`, '', T0);
    expect(t.utm_campaign).toHaveLength(200);
  });

  it('utm_campaign alone is direct', () => {
    expect(isNonDirect(buildTouch('https://mesaas.com.br/?utm_campaign=x', '', T0))).toBe(false);
  });

  it('expires after 90 days from first.at and starts fresh', () => {
    const s = memoryStorage();
    captureAcquisition(AD, '', s, T0);
    expect(getStoredAcquisition(s, T0 + ACQUISITION_TTL_MS - 1)).not.toBeNull();
    expect(getStoredAcquisition(s, T0 + ACQUISITION_TTL_MS + 1)).toBeNull();
    const fresh = captureAcquisition(
      'https://mesaas.com.br/precos',
      '',
      s,
      T0 + ACQUISITION_TTL_MS + 1,
    );
    expect(fresh?.first.utm_source).toBeNull();
    expect(fresh?.last).toBeNull();
  });

  it('treats corrupt or old values as empty', () => {
    for (const bad of ['not json', '{"v":2}', '{"v":1}']) {
      const s = memoryStorage();
      s.setItem(ACQUISITION_STORAGE_KEY, bad);
      expect(getStoredAcquisition(s, T0)).toBeNull();
      const out = captureAcquisition(AD, '', s, T0);
      expect(out?.first.utm_source).toBe('meta');
    }
  });

  it('does nothing when storage throws', () => {
    const boom = {
      getItem: () => {
        throw new Error('x');
      },
      setItem: () => {
        throw new Error('x');
      },
      removeItem: () => {
        throw new Error('x');
      },
    };
    expect(captureAcquisition(AD, '', boom, T0)).toBeNull();
    expect(getStoredAcquisition(boom, T0)).toBeNull();
    expect(() => clearStoredAcquisition(boom)).not.toThrow();
  });

  it('clear removes the entry', () => {
    const s = memoryStorage();
    captureAcquisition(AD, '', s, T0);
    clearStoredAcquisition(s);
    expect(s.map.size).toBe(0);
  });
});

describe('token routes', () => {
  const SECRET = 'S3CR3T-token-value';
  const MAIL = 'https://mail.google.com/';
  const TOKENED = [
    ['afiliados/painel', '/afiliados/painel'],
    ['conectar', '/conectar'],
    ['descadastrar', '/descadastrar'],
    ['cancelar-avisos', '/cancelar-avisos'],
  ] as const;

  it.each(TOKENED)('buildTouch collapses /%s/:token to the bare prefix', (route, prefix) => {
    const t = buildTouch(
      `https://mesaas.com.br/${route}/${SECRET}?utm_source=x&utm_medium=email&gclid=1&ref=abc`,
      MAIL,
      T0,
    );
    expect(t.landing_path).toBe(prefix);
    expect(JSON.stringify(t)).not.toContain(SECRET);
    expect(isNonDirect(t)).toBe(false);
  });

  it('matches case-insensitively, across repeated slashes and trailing segments', () => {
    expect(tokenRoutePrefix(`/Conectar/${SECRET}`)).toBe('/conectar');
    expect(tokenRoutePrefix(`//afiliados//painel/${SECRET}`)).toBe('/afiliados/painel');
    expect(tokenRoutePrefix(`/descadastrar/${SECRET}/extra`)).toBe('/descadastrar');
    expect(buildTouch(`https://mesaas.com.br/CANCELAR-AVISOS/${SECRET}`, '', T0).landing_path).toBe(
      '/cancelar-avisos',
    );
  });

  it('leaves look-alike and bare prefixes alone', () => {
    expect(tokenRoutePrefix('/conectar-x/abc')).toBeNull();
    expect(tokenRoutePrefix('/afiliados/painel')).toBeNull();
    expect(tokenRoutePrefix('/afiliados')).toBeNull();
    expect(tokenRoutePrefix('/blog/conectar/abc')).toBeNull();
    const t = buildTouch('https://mesaas.com.br/conectar-x/abc', MAIL, T0);
    expect(t.landing_path).toBe('/conectar-x/abc');
    expect(t.referrer_host).toBe('mail.google.com');
  });

  it('a token route with a referrer and UTMs writes nothing on a first visit', () => {
    const s = memoryStorage();
    const out = captureAcquisition(
      `https://mesaas.com.br/afiliados/painel/${SECRET}?utm_source=x&utm_medium=email`,
      MAIL,
      s,
      T0,
    );
    expect(out).toBeNull();
    expect(s.map.size).toBe(0);
  });

  it('a token route keeps an existing first and last untouched', () => {
    const s = memoryStorage();
    const before = captureAcquisition(AD, '', s, T0);
    const raw = s.map.get(ACQUISITION_STORAGE_KEY);
    const out = captureAcquisition(`https://mesaas.com.br/conectar/${SECRET}`, MAIL, s, T0 + DAY);
    expect(out).toEqual(before);
    expect(s.map.get(ACQUISITION_STORAGE_KEY)).toBe(raw);
    expect(raw).not.toContain(SECRET);
  });
});
