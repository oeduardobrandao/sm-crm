import { describe, it, expect, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useIsDark, resolveCssColor, getChartTheme } from '../chartTheme';

afterEach(() => {
  document.documentElement.removeAttribute('data-theme');
});

describe('useIsDark', () => {
  it('is false without data-theme and true with data-theme=dark', async () => {
    const { result } = renderHook(() => useIsDark());
    expect(result.current).toBe(false);
    await act(async () => {
      document.documentElement.setAttribute('data-theme', 'dark');
      // MutationObserver delivers asynchronously
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(result.current).toBe(true);
  });
});

describe('resolveCssColor', () => {
  it('falls back when the CSS var is not defined (jsdom)', () => {
    expect(resolveCssColor('--success', '#3ecf8e')).toBe('#3ecf8e');
  });
});

describe('getChartTheme', () => {
  it('returns dark and light gridlines and resolved semantic colors', () => {
    const dark = getChartTheme(true);
    const light = getChartTheme(false);
    expect(dark.grid).toBe('rgba(255,255,255,0.06)');
    expect(light.grid).toBe('rgba(0,0,0,0.06)');
    expect(dark.semantic.success).toBe('#3ecf8e'); // jsdom fallback path
    expect(dark.font.family).toContain('SF Pro Text');
    expect(dark.tooltip.borderWidth).toBe(1);
  });
});
