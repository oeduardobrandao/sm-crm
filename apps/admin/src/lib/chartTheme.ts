import { useSyncExternalStore } from 'react';
import {
  BarController,
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Legend,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  Tooltip,
} from 'chart.js';

// Explicit controllers: react-chartjs-2 only auto-registers the controller of the typed
// component it renders, and production tree-shaking drops the rest (CRM incident 2026-09-02,
// `"line" is not a registered controller`).
ChartJS.register(
  CategoryScale,
  LinearScale,
  BarController,
  BarElement,
  LineController,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
);

function subscribe(callback: () => void): () => void {
  const observer = new MutationObserver(callback);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  return () => observer.disconnect();
}

/** True while <html data-theme="dark">; re-renders on theme toggle so colours re-resolve. */
export function useIsDark(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => document.documentElement.getAttribute('data-theme') === 'dark',
    () => false,
  );
}

/**
 * Admin tokens are bare HSL triplets ("48 96% 53%"); canvas cannot read CSS variables, so this
 * wraps them in hsl(). Falls back to a neutral grey where the variable is absent (jsdom).
 */
export function tokenColor(name: string, alpha = 1): string {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim();
  return raw ? `hsl(${raw} / ${alpha})` : `hsl(0 0% 50% / ${alpha})`;
}

export interface AdminChartTheme {
  text: string;
  grid: string;
  font: { family: string; size: number };
  provider: { stripe: string; pagarme: string };
  categorical: string[];
  movement: {
    new: string;
    expansion: string;
    recovered: string;
    switch: string;
    contraction: string;
    past_due: string;
    churn: string;
  };
  line: { logo: string; revenue: string };
  tooltip: {
    backgroundColor: string;
    titleColor: string;
    bodyColor: string;
    borderColor: string;
    borderWidth: number;
    padding: number;
  };
}

/** Call inside a component that also calls useIsDark(), so a theme flip re-resolves. */
export function getAdminChartTheme(): AdminChartTheme {
  return {
    text: tokenColor('muted-foreground'),
    grid: tokenColor('border', 0.6),
    font: { family: "'SF Pro Text', -apple-system, sans-serif", size: 11 },
    provider: { stripe: tokenColor('chart-1'), pagarme: tokenColor('chart-2') },
    categorical: [
      tokenColor('chart-1'),
      tokenColor('chart-2'),
      tokenColor('chart-3'),
      tokenColor('primary'),
      tokenColor('muted-foreground'),
    ],
    movement: {
      new: tokenColor('success'),
      expansion: tokenColor('success', 0.55),
      recovered: tokenColor('chart-2'),
      switch: tokenColor('chart-1'),
      contraction: tokenColor('warning', 0.6),
      past_due: tokenColor('warning'),
      churn: tokenColor('destructive'),
    },
    line: { logo: tokenColor('chart-3'), revenue: tokenColor('destructive') },
    tooltip: {
      backgroundColor: tokenColor('popover'),
      titleColor: tokenColor('popover-foreground'),
      bodyColor: tokenColor('muted-foreground'),
      borderColor: tokenColor('border'),
      borderWidth: 1,
      padding: 10,
    },
  };
}
