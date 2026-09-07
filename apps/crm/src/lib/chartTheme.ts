import { useSyncExternalStore } from 'react';

/**
 * Theme-aware colors for Chart.js configs. This module is the ONLY place that
 * may hold chart color literals: canvas cannot read CSS variables, so tokens
 * are resolved here at render time and re-resolved when the theme flips.
 */

function subscribe(callback: () => void): () => void {
  const observer = new MutationObserver(callback);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  });
  return () => observer.disconnect();
}

function getSnapshot(): boolean {
  return document.documentElement.getAttribute('data-theme') === 'dark';
}

/** True while <html data-theme="dark">. Re-renders on theme toggle. */
export function useIsDark(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}

/** Reads a CSS custom property off :root; falls back where vars are absent (jsdom). */
export function resolveCssColor(cssVar: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(cssVar).trim();
  return value || fallback;
}

export interface ChartTheme {
  text: string;
  grid: string;
  font: { family: string; size: number };
  semantic: { success: string; warning: string; danger: string };
  /**
   * Series colours with no good/bad meaning, in draw order. Use these when a
   * dataset is just "another series" (volume, counts) instead of borrowing a
   * semantic colour, which would read as a verdict the data does not carry.
   */
  categorical: string[];
  tooltip: {
    backgroundColor: string;
    titleColor: string;
    bodyColor: string;
    borderColor: string;
    borderWidth: number;
    padding: number;
  };
}

export function getChartTheme(isDark: boolean): ChartTheme {
  return {
    text: isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.55)',
    grid: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
    font: { family: "'SF Pro Text', -apple-system, sans-serif", size: 11 },
    semantic: {
      success: resolveCssColor('--success', '#3ecf8e'),
      warning: resolveCssColor('--warning', '#f5a342'),
      danger: resolveCssColor('--danger', '#f55a42'),
    },
    categorical: [
      resolveCssColor('--teal', '#42c8f5'),
      resolveCssColor('--pink', '#f542c8'),
      resolveCssColor('--primary-color', '#ffbf30'),
    ],
    tooltip: {
      backgroundColor: resolveCssColor('--card-bg', isDark ? '#12151a' : '#ffffff'),
      titleColor: resolveCssColor('--text-main', isDark ? '#e8eaf0' : '#12151a'),
      bodyColor: resolveCssColor('--text-muted', isDark ? '#9ca3af' : '#374151'),
      borderColor: resolveCssColor('--border-color', isDark ? '#1e2430' : 'rgba(30,36,48,.102)'),
      borderWidth: 1,
      padding: 10,
    },
  };
}
