import type { ReactNode } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const {
  mockCreate,
  mockUpdate,
  mockGetClientes,
  mockGetStatuses,
  mockGetInstagramPosts,
  mockGetClientePosts,
  mockGetPostCovers,
  mockUseAuth,
} = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockUpdate: vi.fn(),
  mockGetClientes: vi.fn(),
  mockGetStatuses: vi.fn(),
  mockGetInstagramPosts: vi.fn(),
  mockGetClientePosts: vi.fn(),
  mockGetPostCovers: vi.fn(),
  mockUseAuth: vi.fn(),
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// Mesmo padrao do AutomacoesPage.test: t devolve a CHAVE (com vars serializadas).
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) =>
      vars ? `${key}:${JSON.stringify(vars)}` : key,
    i18n: { language: 'pt' },
  }),
}));

vi.mock('../../../store', async () => {
  const actual = await vi.importActual<typeof import('../../../store')>('../../../store');
  return {
    ...actual,
    createInstagramAutomation: mockCreate,
    updateInstagramAutomation: mockUpdate,
    getClientes: mockGetClientes,
    getInstagramAccountStatuses: mockGetStatuses,
    getClientePosts: mockGetClientePosts,
  };
});

vi.mock('../../../services/instagram', async () => {
  const actual = await vi.importActual<typeof import('../../../services/instagram')>(
    '../../../services/instagram',
  );
  return {
    ...actual,
    getInstagramPosts: mockGetInstagramPosts,
  };
});

vi.mock('../../../services/postMedia', async () => {
  const actual = await vi.importActual<typeof import('../../../services/postMedia')>(
    '../../../services/postMedia',
  );
  return {
    ...actual,
    getPostCovers: mockGetPostCovers,
  };
});

vi.mock('../../../context/AuthContext', () => ({ useAuth: mockUseAuth }));

// Radix Select relies on pointer capture / portals that jsdom does not model --
// same simplified stand-in used by ClientesPage.test.tsx.
vi.mock('@/components/ui/select', async () => {
  const ReactModule = await vi.importActual<typeof import('react')>('react');

  interface SelectContextValue {
    value?: string;
    onValueChange?: (value: string) => void;
  }
  const SelectContext = ReactModule.createContext<SelectContextValue>({});

  function Select({
    value,
    onValueChange,
    children,
  }: {
    value?: string;
    onValueChange?: (value: string) => void;
    children: ReactNode;
  }) {
    return (
      <SelectContext.Provider value={{ value, onValueChange }}>
        <div>{children}</div>
      </SelectContext.Provider>
    );
  }

  const SelectTrigger = ReactModule.forwardRef<
    HTMLButtonElement,
    React.ButtonHTMLAttributes<HTMLButtonElement>
  >(({ children, type = 'button', ...props }, ref) => (
    <button ref={ref} type={type} {...props}>
      {children}
    </button>
  ));

  function SelectValue() {
    const { value } = ReactModule.useContext(SelectContext);
    return <span>{value ?? ''}</span>;
  }

  function SelectContent({ children }: { children: ReactNode }) {
    return <div>{children}</div>;
  }

  function SelectItem({ value, children }: { value: string; children: ReactNode }) {
    const { onValueChange } = ReactModule.useContext(SelectContext);
    return (
      <button type="button" onClick={() => onValueChange?.(value)}>
        {children}
      </button>
    );
  }

  return { Select, SelectTrigger, SelectValue, SelectContent, SelectItem };
});

// Radix Dialog also gets the ClientesPage.test.tsx treatment -- a plain
// open-gated div, no portal/focus-trap semantics to worry about in jsdom.
vi.mock('@/components/ui/dialog', async () => {
  const ReactModule = await vi.importActual<typeof import('react')>('react');

  interface DialogContextValue {
    open: boolean;
  }
  const DialogContext = ReactModule.createContext<DialogContextValue>({ open: false });

  function Dialog({
    open = false,
    children,
  }: {
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    children: ReactNode;
  }) {
    return (
      <DialogContext.Provider value={{ open }}>
        <div>{children}</div>
      </DialogContext.Provider>
    );
  }

  function DialogContent({ children }: { children: ReactNode; onConfirmClose?: () => void }) {
    const { open } = ReactModule.useContext(DialogContext);
    return open ? <div role="dialog">{children}</div> : null;
  }

  function DialogHeader({ children }: { children: ReactNode }) {
    return <div>{children}</div>;
  }
  function DialogFooter({ children }: { children: ReactNode }) {
    return <div>{children}</div>;
  }
  function DialogTitle({ children }: { children: ReactNode }) {
    return <h2>{children}</h2>;
  }

  return { Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle };
});

import { toast } from 'sonner';
import AutomationFormDialog from '../AutomationFormDialog';
import type { InstagramCommentAutomation } from '../../../store';

const CLIENTES = [{ id: 7, nome: 'Clinica X', sigla: 'CX', cor: '#3ecf8e' }];

function productionPost(over: Record<string, unknown>) {
  return {
    id: 0,
    workflow_id: 9,
    titulo: 'Sem titulo',
    tipo: 'feed',
    status: 'rascunho',
    custom_status_id: null,
    scheduled_at: null,
    ordem: 1,
    workflow_titulo: 'Agosto',
    platform: 'instagram',
    ...over,
  };
}

// Two eligible, three that must never reach the grid.
const PRODUCTION_POSTS = [
  productionPost({ id: 501, titulo: 'Carrossel de agosto', tipo: 'carrossel' }),
  // falha_publicacao still ships eventually -- it stays eligible.
  productionPost({
    id: 502,
    titulo: 'Reels que falhou',
    tipo: 'reels',
    status: 'falha_publicacao',
  }),
  productionPost({ id: 601, titulo: 'Ja publicado', status: 'postado' }),
  productionPost({ id: 602, titulo: 'Story do dia', tipo: 'stories' }),
  productionPost({ id: 603, titulo: 'So no TikTok', platform: 'tiktok' }),
];

const EDITING_BASE: InstagramCommentAutomation = {
  id: 'auto-1',
  conta_id: 'w-1',
  client_id: 7,
  name: 'Automacao existente',
  ig_media_id: null,
  media_permalink: null,
  media_caption: null,
  workflow_post_id: null,
  pending_post_deleted_at: null,
  keywords: ['preco'],
  dm_message: 'Segue o link!',
  public_reply: null,
  ativo: true,
  dms_sent_count: 0,
  last_triggered_at: null,
  created_at: '2026-08-18T00:00:00.000Z',
  updated_at: '2026-08-18T00:00:00.000Z',
};

const POST = {
  id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  posted_at: '2026-08-10T12:00:00.000Z',
  media_type: 'IMAGE',
  caption: 'Post de teste',
  thumbnail_url: 'https://images.example/post.jpg',
  permalink: 'https://instagram.com/p/teste',
  likes: 10,
  comments: 1,
  reach: 100,
  impressions: 200,
  instagram_post_id: '17900000000000001',
};

/** 15 eligible posts, so the client-side pagination spans two blocks of 12. */
const MANY_PRODUCTION = Array.from({ length: 15 }, (_, i) =>
  productionPost({ id: 700 + i, titulo: `Post ${i + 1}` }),
);
/** The 13th eligible post -- first card of the second page. */
const THIRTEENTH = MANY_PRODUCTION[12];

function renderDialog(onSaved = vi.fn(), editing: InstagramCommentAutomation | null = null) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    qc,
    ...render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <AutomationFormDialog open onOpenChange={vi.fn()} editing={editing} onSaved={onSaved} />
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  };
}

/** Fills the fields the submit validation requires, leaving the target alone. */
async function fillRequiredFields() {
  fireEvent.change(screen.getByLabelText('form.nameLabel'), {
    target: { value: 'Minha automacao' },
  });
  fireEvent.click(await screen.findByRole('button', { name: 'Clinica X' }));
  fireEvent.change(screen.getByPlaceholderText('form.keywordPlaceholder'), {
    target: { value: 'preco' },
  });
  fireEvent.keyDown(screen.getByPlaceholderText('form.keywordPlaceholder'), { key: 'Enter' });
  fireEvent.change(screen.getByLabelText('form.dmLabel'), {
    target: { value: 'Segue o link!' },
  });
}

describe('AutomationFormDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetClientes.mockResolvedValue(CLIENTES);
    mockGetStatuses.mockResolvedValue(
      new Map([[7, { revoked: false, expired: false, canPublish: true, canAutomate: true }]]),
    );
    mockGetInstagramPosts.mockResolvedValue({ posts: [POST], total: 1 });
    mockGetClientePosts.mockResolvedValue(PRODUCTION_POSTS);
    // No covers -> every production card falls back to titulo + tipo.
    mockGetPostCovers.mockResolvedValue(new Map());
    mockCreate.mockResolvedValue({ id: 'auto-new' });
    mockUpdate.mockResolvedValue({ id: 'auto-1' });
    mockUseAuth.mockReturnValue({
      role: 'owner',
      profile: { id: 'user-1', conta_id: 'w-1', role: 'owner' },
    });
  });

  it('saves the real Instagram media id (instagram_post_id), not the internal uuid, when a specific post is targeted', async () => {
    const onSaved = vi.fn();
    renderDialog(onSaved);

    fireEvent.change(screen.getByLabelText('form.nameLabel'), {
      target: { value: 'Minha automacao' },
    });

    fireEvent.click(await screen.findByRole('button', { name: 'Clinica X' }));

    fireEvent.click(screen.getByRole('radio', { name: 'form.targetPost' }));
    // "Em producao" is the default tab now -- the synced-feed grid lives behind
    // the "Publicados" one.
    fireEvent.click(screen.getByRole('radio', { name: 'form.targetSourcePublished' }));

    // The published post-grid button carries no accessible text (thumbnail
    // alt=""); it's the only element with aria-pressed at this point in the tree.
    const postButton = await screen.findByRole('button', { pressed: false });
    fireEvent.click(postButton);

    fireEvent.change(screen.getByPlaceholderText('form.keywordPlaceholder'), {
      target: { value: 'preco' },
    });
    fireEvent.keyDown(screen.getByPlaceholderText('form.keywordPlaceholder'), { key: 'Enter' });

    fireEvent.change(screen.getByLabelText('form.dmLabel'), {
      target: { value: 'Segue o link!' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'form.save' }));

    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ ig_media_id: '17900000000000001', workflow_post_id: null }),
    );
    expect(mockCreate).not.toHaveBeenCalledWith(expect.objectContaining({ ig_media_id: POST.id }));
  });

  it('lists only eligible posts under "Em producao" (no postado, stories or tiktok-only)', async () => {
    renderDialog();

    fireEvent.click(await screen.findByRole('button', { name: 'Clinica X' }));
    fireEvent.click(screen.getByRole('radio', { name: 'form.targetPost' }));

    expect(await screen.findByRole('button', { name: 'Carrossel de agosto' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reels que falhou' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Ja publicado' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Story do dia' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'So no TikTok' })).toBeNull();
    expect(screen.getByText('form.productionHint')).toBeTruthy();
  });

  it('saves a production post as workflow_post_id with a truncated titulo snapshot', async () => {
    renderDialog();

    await fillRequiredFields();
    fireEvent.click(screen.getByRole('radio', { name: 'form.targetPost' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Carrossel de agosto' }));

    fireEvent.click(screen.getByRole('button', { name: 'form.save' }));

    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        workflow_post_id: 501,
        ig_media_id: null,
        media_permalink: null,
        media_caption: 'Carrossel de agosto',
      }),
    );
  });

  it('shows the empty state when the client has no eligible production posts', async () => {
    mockGetClientePosts.mockResolvedValue([productionPost({ id: 601, status: 'postado' })]);
    renderDialog();

    fireEvent.click(await screen.findByRole('button', { name: 'Clinica X' }));
    fireEvent.click(screen.getByRole('radio', { name: 'form.targetPost' }));

    expect(await screen.findByText('form.noProductionPosts')).toBeTruthy();
  });

  it('seeds a pending automation into the production tab with its post selected', async () => {
    renderDialog(vi.fn(), {
      ...EDITING_BASE,
      workflow_post_id: 501,
      media_caption: 'Carrossel de agosto',
    });

    const card = await screen.findByRole('button', { name: 'Carrossel de agosto' });
    expect(card.getAttribute('aria-pressed')).toBe('true');
    expect(
      (screen.getByRole('radio', { name: 'form.targetPost' }) as HTMLInputElement).checked,
    ).toBe(true);
  });

  it('opens on the page that actually holds the seeded target, not page 1', async () => {
    mockGetClientePosts.mockResolvedValue(MANY_PRODUCTION);
    renderDialog(vi.fn(), {
      ...EDITING_BASE,
      workflow_post_id: THIRTEENTH.id,
      media_caption: THIRTEENTH.titulo,
    });

    const card = await screen.findByRole('button', { name: 'Post 13' });
    expect(card.getAttribute('aria-pressed')).toBe('true');
    // Page 2 is showing, so the first block is off screen.
    expect(screen.queryByRole('button', { name: 'Post 1' })).toBeNull();
  });

  it('pins the seeded target to the top when it dropped out of the eligible list', async () => {
    // 999 is in no page of the list: derived to stories/tiktok, or its workflow
    // left 'ativo' (getClientePosts only returns active workflows).
    renderDialog(vi.fn(), {
      ...EDITING_BASE,
      workflow_post_id: 999,
      media_caption: 'Post arquivado',
    });

    const pinned = await screen.findByRole('button', { name: 'Post arquivado' });
    expect(pinned.getAttribute('aria-pressed')).toBe('true');
    // The regular grid still renders underneath, so retargeting stays possible.
    expect(screen.getByRole('button', { name: 'Carrossel de agosto' })).toBeTruthy();
  });

  it('does not drag the user back to the seeded page after they paginate', async () => {
    mockGetClientePosts.mockResolvedValue(MANY_PRODUCTION);
    const { qc } = renderDialog(vi.fn(), {
      ...EDITING_BASE,
      workflow_post_id: THIRTEENTH.id,
      media_caption: THIRTEENTH.titulo,
    });

    await screen.findByRole('button', { name: 'Post 13' });
    fireEvent.click(screen.getByRole('button', { name: 'form.previous' }));
    expect(await screen.findByRole('button', { name: 'Post 1' })).toBeTruthy();

    // A refetch hands the effect a brand new list identity -- the seed must stay
    // spent, or the user gets yanked off the page they just chose.
    await act(async () => {
      await qc.invalidateQueries({ queryKey: ['clientePosts', 7] });
    });

    expect(screen.getByRole('button', { name: 'Post 1' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Post 13' })).toBeNull();
  });

  it('blocks submit on a tombstoned automation until a new target is picked', async () => {
    renderDialog(vi.fn(), {
      ...EDITING_BASE,
      ativo: false,
      pending_post_deleted_at: '2026-08-19T10:00:00.000Z',
    });

    expect(await screen.findByText('form.deletedTargetHint')).toBeTruthy();
    // Neither radio is checked while the target is a tombstone.
    expect(
      (screen.getByRole('radio', { name: 'form.targetAll' }) as HTMLInputElement).checked,
    ).toBe(false);
    expect(
      (screen.getByRole('radio', { name: 'form.targetPost' }) as HTMLInputElement).checked,
    ).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'form.save' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('form.validationDeletedTarget'));
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('clears the tombstone (and never touches ativo) once a new target is chosen', async () => {
    renderDialog(vi.fn(), {
      ...EDITING_BASE,
      ativo: false,
      pending_post_deleted_at: '2026-08-19T10:00:00.000Z',
    });

    fireEvent.click(await screen.findByRole('radio', { name: 'form.targetAll' }));
    fireEvent.click(screen.getByRole('button', { name: 'form.save' }));

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
    const [id, patch] = mockUpdate.mock.calls[0];
    expect(id).toBe('auto-1');
    expect(patch).toMatchObject({
      pending_post_deleted_at: null,
      ig_media_id: null,
      workflow_post_id: null,
    });
    // Reactivation stays a deliberate act on the listing toggle.
    expect(patch).not.toHaveProperty('ativo');
  });

  it('leaves pending_post_deleted_at out of the patch for a plain published automation', async () => {
    renderDialog(vi.fn(), {
      ...EDITING_BASE,
      ig_media_id: '17900000000000001',
      media_permalink: 'https://instagram.com/p/teste',
      media_caption: 'Post de teste',
    });

    fireEvent.click(await screen.findByRole('button', { name: 'form.save' }));

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
    const patch = mockUpdate.mock.calls[0][1];
    expect(patch).not.toHaveProperty('pending_post_deleted_at');
    expect(patch).toMatchObject({ ig_media_id: '17900000000000001', workflow_post_id: null });
  });
});
