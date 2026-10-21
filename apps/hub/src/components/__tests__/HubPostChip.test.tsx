import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../api', () => ({ fetchPosts: vi.fn(), fetchPost: vi.fn() }));

import { fetchPost, fetchPosts } from '../../api';
import { HubPostChip } from '../HubPostChip';

const shell = vi.mocked(fetchPosts);
const single = vi.mocked(fetchPost);
const post = (id: number, titulo: string) => ({
  id,
  titulo,
  tipo: 'feed',
  status: 'postado',
  media: [],
  workflow_titulo: 'Fluxo',
});

function renderChip(postId: number) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <HubPostChip postId={postId} titulo="Chip" base="/m/hub/tk" token="tk" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function hover() {
  // The hover handlers sit on the wrapper span around the link.
  fireEvent.mouseEnter(screen.getByRole('link').parentElement!);
  await act(async () => {
    vi.advanceTimersByTime(250);
  });
}

describe('HubPostChip', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    shell.mockReset();
    single.mockReset();
  });
  afterEach(() => vi.useRealTimers());

  it('previews from the shell without a single-post request', async () => {
    shell.mockResolvedValue({ posts: [post(1, 'No shell')], postApprovals: [] } as never);
    renderChip(1);
    await hover();
    expect(await screen.findByTestId('hub-post-hover-preview')).toHaveTextContent('No shell');
    expect(single).not.toHaveBeenCalled();
  });

  it('falls back to the single post for an id outside the shell', async () => {
    shell.mockResolvedValue({ posts: [post(1, 'No shell')], postApprovals: [] } as never);
    single.mockResolvedValue({ posts: [post(77, 'Post antigo')], postApprovals: [] } as never);
    renderChip(77);
    await hover();
    expect(await screen.findByTestId('hub-post-hover-preview')).toHaveTextContent('Post antigo');
    expect(single).toHaveBeenCalledWith('tk', 77);
  });
});
