import { describe, expect, it } from 'vitest';
import { resolveHubTheme, relativeLuminance } from './theme';

describe('relativeLuminance', () => {
  it('computes near-0 for near-black and near-1 for near-white', () => {
    expect(relativeLuminance('#000000')).toBeCloseTo(0, 2);
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 2);
  });
});

describe('resolveHubTheme', () => {
  it('light mode: uses the accent as-is when safe, and derives a dark foreground', () => {
    const t = resolveHubTheme('#315c4c', false);
    expect(t.vars['--hub-acc']).toBe('#315c4c');
    expect(t.vars['--hub-acc-fg']).toBe('#ffffff');
    expect(t.vars['--hub-bg']).toBe('#FAFAFA');
    expect(t.vars['--hub-card']).toBe('#FFFFFF');
  });

  it('light mode: falls back to graphite when the accent is too close to white', () => {
    const t = resolveHubTheme('#fefefe', false);
    expect(t.vars['--hub-acc']).toBe('#171717');
    expect(t.vars['--hub-acc-fg']).toBe('#ffffff');
  });

  it('dark mode: falls back to near-white when the accent is too close to black', () => {
    const t = resolveHubTheme('#0a0a0a', true);
    expect(t.vars['--hub-acc']).toBe('#F5F5F5');
    expect(t.vars['--hub-acc-fg']).toBe('#171717');
    expect(t.vars['--hub-bg']).toBe('#0E0E0E');
  });

  it('picks a dark foreground for a light accent, and a light foreground for a dark accent', () => {
    expect(resolveHubTheme('#eab308', false).vars['--hub-acc-fg']).toBe('#171717');
    expect(resolveHubTheme('#171717', false).vars['--hub-acc-fg']).toBe('#ffffff');
  });

  it('defaults to graphite when accentColor is missing or malformed', () => {
    expect(resolveHubTheme(null, false).vars['--hub-acc']).toBe('#171717');
    expect(resolveHubTheme('not-a-color', false).vars['--hub-acc']).toBe('#171717');
    expect(resolveHubTheme('#fff', false).vars['--hub-acc']).toBe('#171717');
  });

  it('sets the dark logo filter only in dark mode', () => {
    expect(resolveHubTheme('#171717', false).vars['--hub-logo-filter']).toBe('none');
    expect(resolveHubTheme('#171717', true).vars['--hub-logo-filter']).toBe(
      'invert(1) brightness(1.6)',
    );
  });
});
