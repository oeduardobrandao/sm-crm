import { readFileSync } from 'node:fs';
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
  'pages/workspaces/WorkspacesTable.tsx',
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

describe('admin files migrated in Phase 2a carry no hex colour literals', () => {
  it.each(FILES)('%s', (file) => {
    const source = readFileSync(path.join(SRC, file), 'utf8');
    const found = source.match(/#[0-9a-fA-F]{6}\b/g) ?? [];
    const allowed = new Set(ALLOW[file] ?? []);
    expect(found.filter((hex) => !allowed.has(hex))).toEqual([]);
  });
});
