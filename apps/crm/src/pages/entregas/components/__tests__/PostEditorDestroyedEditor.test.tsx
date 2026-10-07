import { useEffect, useState } from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi, afterAll } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { PostEditor } from '../PostEditor';

vi.mock('@/store', () => ({
  getMembros: vi.fn(async () => []),
  getClientes: vi.fn(async () => []),
  getTarefas: vi.fn(async () => []),
}));
vi.mock('@/store/posts', () => ({
  searchPostsForMention: vi.fn(async () => []),
}));

// useEditor's instance manager schedules a destroy 1ms after creating the editor and only
// cancels it from its own passive effect. When React runs passive effects later than that
// (a slow phone, or WebKit yielding to paint first), the editor handed to the first render
// is already destroyed when PostEditor's effects run, and useEditor swaps in a fresh one on
// the next render. jsdom flushes effects inside act(), so the race can't happen here on its
// own: this mock reproduces it by handing the first render an editor that is already
// destroyed, then the live one.
vi.mock('@tiptap/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tiptap/react')>();
  return {
    ...actual,
    useEditor: (options: Parameters<typeof actual.useEditor>[0]) => {
      const live = actual.useEditor(options);
      const [stale] = useState(() => {
        const ed = new Editor({ extensions: [StarterKit] });
        ed.destroy();
        return ed;
      });
      const [firstRender, setFirstRender] = useState(true);
      useEffect(() => setFirstRender(false), []);
      return firstRender ? stale : live;
    },
  };
});

afterAll(() => new Promise((resolve) => setTimeout(resolve, 300)));

describe('PostEditor com o editor destruído antes dos efeitos', () => {
  it('não quebra e monta o conteúdo no editor novo', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <PostEditor
            initialContent={{
              type: 'doc',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'fotos abaixo' }] }],
            }}
            onUpdate={vi.fn()}
          />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(await screen.findByText('fotos abaixo')).toBeInTheDocument();
  });
});
