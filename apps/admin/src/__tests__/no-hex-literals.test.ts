import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = path.resolve(__dirname, '..');

/** Files migrated to tokens in the Phase 2a revamp. Add a file here when it is migrated. */
const FILES = [
  'layouts/AdminLayout.tsx',
  'pages/LoginPage.tsx',
  'pages/AdminsPage.tsx',
  'pages/IntegrationsPage.tsx',
  'pages/KbArticlesPage.tsx',
  'pages/WorkspaceDetailPage.tsx',
  'pages/WorkspaceEventsCard.tsx',
  'pages/WorkspaceInvitesCard.tsx',
  'pages/DashboardPage.tsx',
  'pages/MetricasPage.tsx',
  'pages/metricas/DepositsSection.tsx',
  'pages/metricas/RevenueSection.tsx',
  'pages/metricas/MovementSection.tsx',
  'pages/workspaces/WorkspacesTable.tsx',
  'pages/KbVideosPage.tsx',
  'pages/KbVideoEditorPage.tsx',
  'pages/kb-videos/SeriesDialog.tsx',
];

/** Brand colours that are data, not theme: the login splash gradient and the logo mark. */
const ALLOW: Record<string, string[]> = {
  'pages/LoginPage.tsx': ['#eaf0dc', '#eab308'],
  'layouts/AdminLayout.tsx': [
    '#3984FF',
    '#FF3F3F',
    '#6AC9D0',
    '#C6229B',
    '#EA0E78',
    '#FE3452',
    '#FE7340',
    '#FFC32E',
  ],
};

/** New-design files are hex-free by convention; collected by path so page work never edits this test. */
function collect(dir: string, match: (rel: string) => boolean): string[] {
  const out: string[] = [];
  const walk = (abs: string) => {
    for (const name of readdirSync(abs)) {
      const p = path.join(abs, name);
      if (statSync(p).isDirectory()) {
        if (name !== '__tests__') walk(p);
      } else {
        const rel = path.relative(SRC, p).split(path.sep).join('/');
        if (match(rel)) out.push(rel);
      }
    }
  };
  const root = path.join(SRC, dir);
  if (!existsSync(root)) return out; // components/shell appears in B2-B4
  walk(root);
  return out;
}

const NEW_DESIGN = [
  ...collect('components/shell', (r) => r.endsWith('.tsx')),
  ...collect('pages', (r) => /(Phone|Desktop)\.tsx$/.test(r) || /\/phone\/.+\.tsx$/.test(r)),
  'components/PageHeader.tsx',
];

const ALL = Array.from(new Set([...FILES, ...NEW_DESIGN]));

describe('admin files migrated in Phase 2a carry no hex colour literals', () => {
  it.each(ALL)('%s', (file) => {
    const source = readFileSync(path.join(SRC, file), 'utf8');
    const found = source.match(/#[0-9a-fA-F]{6}\b/g) ?? [];
    const allowed = new Set(ALLOW[file] ?? []);
    expect(found.filter((hex) => !allowed.has(hex))).toEqual([]);
  });
});
