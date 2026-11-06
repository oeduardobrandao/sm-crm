import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PostContentVersion } from '@/store';

const versionsMock = vi.hoisted(() => ({ rows: [] as unknown[] }));
vi.mock('../../../../store', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../store')>()),
  getPostContentVersions: vi.fn(async () => versionsMock.rows),
}));
vi.mock('../ReadOnlyTipTap', () => ({ ReadOnlyTipTap: () => null }));
vi.mock('@/services/inlineImage', () => ({
  extractR2Keys: vi.fn(() => []),
  injectSignedUrls: vi.fn((c: unknown) => c),
  resolveInlineImageUrls: vi.fn(async () => ({})),
}));

import { PostVersionHistorySheet } from '../PostVersionHistorySheet';

afterEach(cleanup);

function version(id: number, over: Partial<PostContentVersion>): PostContentVersion {
  const at = `2026-10-3${id}T12:00:00Z`;
  return {
    id,
    post_id: 1,
    conteudo: null,
    conteudo_plain: '',
    ig_caption: null,
    tiktok_caption: null,
    geral_caption: null,
    changed_fields: [],
    source: 'workspace_user',
    actor_user_id: null,
    actor_name: `Pessoa ${id}`,
    suggestion_id: null,
    created_at: at,
    last_touched_at: at,
    ...over,
  };
}

function renderSheet(rows: PostContentVersion[]) {
  versionsMock.rows = rows;
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <PostVersionHistorySheet
        postId={1}
        open
        onOpenChange={() => {}}
        statusEvents={[]}
        approvals={[]}
      />
    </QueryClientProvider>,
  );
}

describe('PostVersionHistorySheet, legenda Geral', () => {
  it('diffs the Geral caption between two recorded versions', async () => {
    renderSheet([
      version(0, { geral_caption: 'Geral antiga' }),
      version(1, { geral_caption: 'Geral nova' }),
    ]);
    const label = await screen.findByText('Legenda Geral');
    const block = label.parentElement as HTMLElement;
    expect(within(block).getByText('antiga')).toBeInTheDocument();
    expect(within(block).getByText('nova')).toBeInTheDocument();
    expect(screen.queryByText('A versão anterior não registrou a legenda Geral.')).toBeNull();
  });

  it('a predecessor that did not record it (NULL): no diff, and says so', async () => {
    renderSheet([version(0, { geral_caption: null }), version(1, { geral_caption: 'Geral nova' })]);
    expect(
      await screen.findByText('A versão anterior não registrou a legenda Geral.'),
    ).toBeInTheDocument();
    const block = screen.getByText('Legenda Geral').parentElement as HTMLElement;
    expect(block.textContent).toContain('Geral nova');
  });

  it('a version that did not record it shows no Geral block; an emptied one does', async () => {
    const user = userEvent.setup();
    renderSheet([
      version(0, { geral_caption: 'Geral antiga', ig_caption: 'a' }),
      version(1, { geral_caption: '', ig_caption: 'b' }),
      version(2, { geral_caption: null, ig_caption: 'c' }),
    ]);
    // Newest is selected first: NULL = not recorded, nothing to show.
    await screen.findByText('Legenda do Instagram');
    expect(screen.queryByText('Legenda Geral')).toBeNull();
    // '' = the Geral caption was emptied: the old text shows as removed.
    await user.click(screen.getByRole('button', { name: /Pessoa 1/ }));
    const block = (await screen.findByText('Legenda Geral')).parentElement as HTMLElement;
    expect(block.textContent).toContain('Geral antiga');
  });
});
