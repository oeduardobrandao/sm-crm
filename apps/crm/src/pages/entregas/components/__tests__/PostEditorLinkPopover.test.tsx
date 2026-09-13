import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { isAllowedRichTextLinkUrl } from '@mesaas/link-policy';
import { PostEditor } from '../PostEditor';

// PostEditor pulls mention data through useMentionSearch (@/store, @/store/posts) via
// TanStack Query on every mount -- stubbed here so the component can render without a
// real Supabase client. None of these tests exercise mentions.
vi.mock('@/store', () => ({
  getMembros: vi.fn(async () => []),
  getClientes: vi.fn(async () => []),
  getTarefas: vi.fn(async () => []),
}));
vi.mock('@/store/posts', () => ({
  searchPostsForMention: vi.fn(async () => []),
}));

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
import { toast } from 'sonner';

afterEach(() => vi.clearAllMocks());

function renderEditor(initialContent: Record<string, unknown> | null = null) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <PostEditor initialContent={initialContent} onUpdate={vi.fn()} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// PostEditor's only Link control lives in its BubbleMenu (@tiptap/react/menus) -- there
// is no separate fixed-toolbar Link button like PaginaRichTextEditor's. The menu only
// mounts once the plugin's own `shouldShow` (focus + non-empty selection) resolves,
// which happens ~250ms (its internal updateDelay) after the selection change -- hence
// the `waitFor` instead of asserting on the button synchronously.
async function applyLinkViaToolbar(href: string) {
  renderEditor({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'abc' }] }],
  });
  const textbox = screen.getByRole('textbox');
  await userEvent.click(textbox);
  await userEvent.keyboard('{Control>}a{/Control}');
  const linkButton = await waitFor(() => {
    const btn = document.querySelector('[data-tooltip="Inserir link"]');
    expect(btn).not.toBeNull();
    return btn as HTMLElement;
  });
  await userEvent.click(linkButton);
  const input = await screen.findByLabelText('Endereço do link');
  await userEvent.type(input, href);
  await userEvent.keyboard('{Enter}');
  return textbox;
}

/**
 * Finding (task-11, fix round 4): the toolbar's link popover called
 * `setLink({ href: url })` with the RAW typed value. `isAllowedUri` on this editor's
 * Link extension (isAllowedRichTextAutolinkUrl, @mesaas/link-policy) resolves a
 * schemeless candidate ONLY to decide yes/no -- it never rewrites what `setLink`
 * actually persists. So typing "mesaas.com.br" passed the check (it resolves to
 * https://mesaas.com.br internally, just for validation) but stored the href as the
 * raw, unresolved "mesaas.com.br" -- exactly the shape the Hub's read-side policy
 * (isAllowedRichTextLinkUrl) rejects, rendering a dead `href=""` in the client portal.
 * These tests drive the real popover and read the resulting anchor's `href`.
 */
describe('normalização de href do popover de link do PostEditor (fix round 4)', () => {
  it.each([
    ['mesaas.com.br', 'https://mesaas.com.br'],
    ['www.exemplo.com', 'https://www.exemplo.com'],
    ['exemplo.com/pagina', 'https://exemplo.com/pagina'],
    ['contato@exemplo.com', 'mailto:contato@exemplo.com'],
    ['https://exemplo.com', 'https://exemplo.com'],
  ])(
    'digitar %s no popover grava o href normalizado %s, Hub-renderizável',
    async (typed, expectedHref) => {
      const textbox = await applyLinkViaToolbar(typed);
      const anchor = textbox.querySelector('a');
      expect(anchor).not.toBeNull();
      expect(anchor?.getAttribute('href')).toBe(expectedHref);
      expect(isAllowedRichTextLinkUrl(anchor!.getAttribute('href'))).toBe(true);
    },
  );

  it.each([
    ['javascript:alert(1)'],
    ['data:text/html,<script>alert(1)</script>'],
    ['ftp://exemplo.com/segredo'],
    ['https://user:pass@exemplo.com'],
    ['/pagina-interna'],
    ['#ancora'],
  ])('recusa %s pelo popover e avisa o usuário (não fica em silêncio)', async (typed) => {
    const textbox = await applyLinkViaToolbar(typed);
    expect(textbox.querySelector('a')).toBeNull();
    expect(toast.error).toHaveBeenCalledWith(
      'Não foi possível aplicar o link. Use um endereço válido (http, https, e-mail ou telefone).',
    );
  });
});

describe('autolink ao digitar no PostEditor (baseline preservado)', () => {
  it('digitar um e-mail seguido de espaço ainda vira link mailto: de verdade', async () => {
    renderEditor({ type: 'doc', content: [] });
    const textbox = screen.getByRole('textbox');
    await userEvent.click(textbox);
    await userEvent.type(textbox, 'contato@exemplo.com ');
    expect(textbox.querySelector('a[href="mailto:contato@exemplo.com"]')).not.toBeNull();
  });

  it('digitar um domínio nu seguido de espaço ainda vira link http de verdade', async () => {
    renderEditor({ type: 'doc', content: [] });
    const textbox = screen.getByRole('textbox');
    await userEvent.click(textbox);
    await userEvent.type(textbox, 'www.exemplo.com ');
    expect(textbox.querySelector('a[href="http://www.exemplo.com"]')).not.toBeNull();
  });
});
