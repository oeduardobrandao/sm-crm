import { afterEach, describe, expect, it } from 'vitest';
import { chartInk, chartFont } from './chartInk';

describe('chartInk', () => {
  it('returns near-white for dark mode', () => {
    expect(chartInk('dark')).toBe('245, 245, 245');
  });

  it('returns near-black for light mode', () => {
    expect(chartInk('light')).toBe('23, 23, 23');
  });
});

describe('chartFont', () => {
  afterEach(() => {
    document.documentElement.style.removeProperty('--hub-font-sans');
  });

  it('reads the live --hub-font-sans value off :root', () => {
    document.documentElement.style.setProperty(
      '--hub-font-sans',
      "'Space Grotesk', ui-sans-serif, system-ui, sans-serif",
    );
    expect(chartFont()).toBe("'Space Grotesk', ui-sans-serif, system-ui, sans-serif");
  });

  it('falls back to the neutral Instrument Sans stack when the variable is unset', () => {
    expect(chartFont()).toBe("'Instrument Sans', sans-serif");
  });
});
