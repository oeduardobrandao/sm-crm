import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// jsdom ignores stylesheets, so the light pin on the login page is verified against the CSS source.
const loginCss = readFileSync(path.resolve(__dirname, '../login.css'), 'utf8');
const globalsCss = readFileSync(path.resolve(__dirname, '../../globals.css'), 'utf8');

/** Custom property names declared in the first `selector { ... }` block of `css`. */
function declaredProps(css: string, selector: string): string[] {
  const start = css.indexOf(`${selector} {`);
  if (start === -1) return [];
  const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start));
  return [...body.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]);
}

describe('login.css light pin', () => {
  it('re-declares every dark theme token (except charts) under .admin-login-light', () => {
    const dark = declaredProps(globalsCss, "[data-theme='dark']").filter(
      (name) => !name.startsWith('--chart-'),
    );
    const light = new Set(declaredProps(loginCss, '.admin-login-light'));

    expect(dark.length).toBeGreaterThan(10);
    expect(dark.filter((name) => !light.has(name))).toEqual([]);
  });

  it('declares color-scheme: light', () => {
    expect(loginCss).toMatch(/\.admin-login-light\s*\{[^}]*color-scheme:\s*light/);
  });

  it('forces the black logo and hides the white one', () => {
    expect(loginCss).toMatch(
      /\.admin-login-light \.admin-login-logo-black\s*\{[^}]*display:\s*block\s*!important/,
    );
    expect(loginCss).toMatch(
      /\.admin-login-light \.admin-login-logo-white\s*\{[^}]*display:\s*none\s*!important/,
    );
  });
});
