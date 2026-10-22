import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const html = readFileSync(path.resolve(__dirname, '../../index.html'), 'utf8');
// Classic inline scripts only (no src, not type=module), minus the third-party Crisp bootstrap.
const inlineScripts = [
  ...html.matchAll(/<script(?![^>]*\bsrc=)(?![^>]*type="module")[^>]*>([\s\S]*?)<\/script>/g),
]
  .map((m) => m[1])
  .filter((code) => !code.includes('CRISP_WEBSITE_ID'));

const root = document.documentElement;

function runPrePaint() {
  for (const code of inlineScripts) new Function(code)();
}

describe('index.html pre-paint script', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
    for (const a of ['data-js', 'data-consent-stored', 'data-promo-dismissed', 'data-theme']) {
      root.removeAttribute(a);
    }
  });

  it('always sets data-js', () => {
    runPrePaint();
    expect(root.hasAttribute('data-js')).toBe(true);
    expect(root.hasAttribute('data-consent-stored')).toBe(false);
    expect(root.hasAttribute('data-promo-dismissed')).toBe(false);
  });

  it('sets data-consent-stored iff consent_v1 is stored', () => {
    localStorage.setItem('consent_v1', '{"a":1}');
    runPrePaint();
    expect(root.hasAttribute('data-consent-stored')).toBe(true);
  });

  it('sets data-promo-dismissed only when the promo key is "1"', () => {
    localStorage.setItem('mesaas_promo_dismissed', '0');
    runPrePaint();
    expect(root.hasAttribute('data-promo-dismissed')).toBe(false);
    localStorage.setItem('mesaas_promo_dismissed', '1');
    runPrePaint();
    expect(root.hasAttribute('data-promo-dismissed')).toBe(true);
  });

  it('keeps data-js and does not throw when localStorage throws', () => {
    vi.stubGlobal('localStorage', {
      getItem() {
        throw new Error('denied');
      },
      get length() {
        throw new Error('denied');
      },
      key() {
        throw new Error('denied');
      },
    });
    expect(() => runPrePaint()).not.toThrow();
    expect(root.hasAttribute('data-js')).toBe(true);
  });
});
