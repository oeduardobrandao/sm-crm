import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';

const html = readFileSync('apps/crm/index.html', 'utf8');
const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
  .map((m) => m[1])
  .find((s) => s.includes("getItem('theme')"));
if (!script) throw new Error('theme pre-paint script not found');

function runPrePaint() {
  new Function(script!)();
}

afterEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-look');
  document.documentElement.removeAttribute('data-theme');
});

const SESSION_KEY = 'sb-abcdefgh-auth-token';
const session = (id: string) => JSON.stringify({ access_token: 'x', user: { id } });

describe('index.html pre-paint', () => {
  it('sets data-look="vidro" when the cache matches the signed-in user', () => {
    localStorage.setItem(SESSION_KEY, session('u1'));
    localStorage.setItem('look-vidro', 'u1');
    runPrePaint();
    expect(document.documentElement.getAttribute('data-look')).toBe('vidro');
  });

  it('ignores a cache written for another user', () => {
    localStorage.setItem(SESSION_KEY, session('u2'));
    localStorage.setItem('look-vidro', 'u1');
    runPrePaint();
    expect(document.documentElement.hasAttribute('data-look')).toBe(false);
  });

  it('ignores the cache with no session or a malformed session', () => {
    localStorage.setItem('look-vidro', 'u1');
    runPrePaint();
    expect(document.documentElement.hasAttribute('data-look')).toBe(false);
    localStorage.setItem(SESSION_KEY, '{not json');
    expect(() => runPrePaint()).not.toThrow();
    expect(document.documentElement.hasAttribute('data-look')).toBe(false);
  });

  it('does not read the PKCE code-verifier entry as a session', () => {
    localStorage.setItem('sb-abcdefgh-auth-token-code-verifier', session('u1'));
    localStorage.setItem('look-vidro', 'u1');
    runPrePaint();
    expect(document.documentElement.hasAttribute('data-look')).toBe(false);
  });

  it('matches any project session (dev may hold both prod and staging keys)', () => {
    localStorage.setItem('sb-aaaaaaaa-auth-token', session('other'));
    localStorage.setItem('sb-zzzzzzzz-auth-token', session('u1'));
    localStorage.setItem('look-vidro', 'u1');
    runPrePaint();
    expect(document.documentElement.getAttribute('data-look')).toBe('vidro');
  });

  it('leaves the attribute alone without the cache', () => {
    localStorage.setItem(SESSION_KEY, session('u1'));
    runPrePaint();
    expect(document.documentElement.hasAttribute('data-look')).toBe(false);
  });
});
