import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';
import { initI18n } from '@mesaas/i18n';
import ptCommon from '../packages/i18n/locales/pt/common.json';
import enCommon from '../packages/i18n/locales/en/common.json';
import ptDashboard from '../packages/i18n/locales/pt/dashboard.json';
import enDashboard from '../packages/i18n/locales/en/dashboard.json';
import ptClients from '../packages/i18n/locales/pt/clients.json';
import enClients from '../packages/i18n/locales/en/clients.json';
import ptLeads from '../packages/i18n/locales/pt/leads.json';
import enLeads from '../packages/i18n/locales/en/leads.json';
import ptPosts from '../packages/i18n/locales/pt/posts.json';
import enPosts from '../packages/i18n/locales/en/posts.json';

initI18n({
  pt: { common: ptCommon, dashboard: ptDashboard, clients: ptClients, leads: ptLeads, posts: ptPosts },
  en: { common: enCommon, dashboard: enDashboard, clients: enClients, leads: enLeads, posts: enPosts },
});

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }),
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
