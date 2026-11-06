import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PostChipsBelow, hideInlineText, postBlocksOf } from '../PostChipsBelow';

vi.mock('@/store', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, getPostChipPreview: vi.fn(), getDiscussaoNaoLidas: vi.fn() };
});
vi.mock('@/services/postMedia', () => ({ listPostMedia: vi.fn().mockResolvedValue([]) }));

const t = (id: number, wf: number | null) =>
  wf != null ? `@[P${id}](post:${id}:${wf})` : `@[P${id}](post:${id})`;

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>{ui}</QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('postBlocksOf', () => {
  it('returns distinct post mentions in order, with the workflow id or null', () => {
    expect(postBlocksOf(`a ${t(1, 5)} ${t(2, null)} ${t(1, 5)} @[Ana](membro:3)`)).toEqual([
      { postId: 1, workflowId: 5, titulo: 'P1' },
      { postId: 2, workflowId: null, titulo: 'P2' },
    ]);
  });

  it('is empty without a post token or above three distinct posts', () => {
    expect(postBlocksOf('só texto')).toEqual([]);
    expect(postBlocksOf(`${t(1, 1)} ${t(2, 1)} ${t(3, 1)}`)).toHaveLength(3);
    expect(postBlocksOf(`${t(1, 1)} ${t(2, 1)} ${t(3, 1)} ${t(4, 1)}`)).toEqual([]);
  });
});

describe('hideInlineText', () => {
  it('hides only when blocks render and nothing but post tokens remains', () => {
    expect(hideInlineText(t(1, 1))).toBe(true);
    expect(hideInlineText(`${t(1, 1)}\n${t(2, 1)}`)).toBe(true);
    expect(hideInlineText(`oi\n${t(1, 1)}`)).toBe(false);
    expect(hideInlineText(`@[Ana](membro:3) ${t(1, 1)}`)).toBe(false);
    expect(hideInlineText('')).toBe(false);
    expect(hideInlineText(`${t(1, 1)} ${t(2, 1)} ${t(3, 1)} ${t(4, 1)}`)).toBe(false);
  });
});

describe('PostChipsBelow', () => {
  it('renders nothing when the text mentions no post', () => {
    wrap(<PostChipsBelow text="oi @[Ana](membro:3)" variant="desktop" />);
    expect(screen.queryByTestId('post-chips-below')).not.toBeInTheDocument();
  });

  it('renders the desktop chip per distinct post', () => {
    wrap(<PostChipsBelow text={`${t(1, 5)} ${t(2, null)} ${t(1, 5)}`} variant="desktop" />);
    expect(screen.getByRole('link', { name: 'P1' })).toHaveAttribute(
      'href',
      '/entregas?drawer=5&post=1',
    );
    expect(screen.getByRole('link', { name: 'P2' })).toHaveAttribute('href', '/entregas?post=2');
  });

  it('renders the phone chip for the phone variant', () => {
    wrap(<PostChipsBelow text={t(1, 5)} variant="phone" />);
    expect(screen.getByRole('link', { name: 'P1' })).toHaveClass('phone-msg-chip');
  });
});
