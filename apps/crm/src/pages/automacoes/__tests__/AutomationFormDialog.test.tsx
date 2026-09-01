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
  mockUploadMedia,
  mockDeleteMedia,
  mockSignMediaView,
  mockValidateMediaFile,
} = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockUpdate: vi.fn(),
  mockGetClientes: vi.fn(),
  mockGetStatuses: vi.fn(),
  mockGetInstagramPosts: vi.fn(),
  mockGetClientePosts: vi.fn(),
  mockGetPostCovers: vi.fn(),
  mockUseAuth: vi.fn(),
  mockUploadMedia: vi.fn(),
  mockDeleteMedia: vi.fn(),
  mockSignMediaView: vi.fn(),
  mockValidateMediaFile: vi.fn(),
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

vi.mock('../../../services/automationMedia', () => ({
  uploadAutomationMedia: mockUploadMedia,
  deleteAutomationMedia: mockDeleteMedia,
  signAutomationMediaView: mockSignMediaView,
  validateAutomationMediaFile: mockValidateMediaFile,
}));

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

  // className/overlayClassName are surfaced (rather than dropped) so the
  // stacking-order contract above the Entregas drawer is assertable in jsdom.
  function DialogContent({
    children,
    className,
    overlayClassName,
  }: {
    children: ReactNode;
    className?: string;
    overlayClassName?: string;
    onConfirmClose?: () => void;
  }) {
    const { open } = ReactModule.useContext(DialogContext);
    return open ? (
      <div role="dialog" className={className} data-overlay-class={overlayClassName}>
        {/* Mirrors dialog.tsx's real scroll wrapper -- TourOverlay's
         * measure() (surface: 'dialog') looks up its containing block via
         * `closest('[data-dialog-scroll]')`, so this mock needs the same
         * marker or every dialog-surface tour step silently fails to
         * resolve its layout in this suite. */}
        <div data-dialog-scroll>{children}</div>
      </div>
    ) : null;
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
import AutomationFormDialog, { type SelectedTarget } from '../AutomationFormDialog';
import type { TourOverlayProps } from '../tour/TourOverlay';
import { TOUR_STEPS } from '../tour/tourSteps';
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
  dm_media: null,
  dm_subtitle: null,
  public_reply: null,
  public_replies: [],
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

function renderDialog(
  onSaved = vi.fn(),
  editing: InstagramCommentAutomation | null = null,
  initialTarget?: { clientId: number; target: SelectedTarget },
  elevated?: boolean,
  tour?: Omit<TourOverlayProps, 'onCta'>,
) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    qc,
    ...render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <AutomationFormDialog
            open
            onOpenChange={vi.fn()}
            editing={editing}
            initialTarget={initialTarget}
            elevated={elevated}
            onSaved={onSaved}
            tour={tour}
          />
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  };
}

/** Everything the submit validation wants except the client, which a seeded
 * dialog already carries (and whose Select is locked there). */
function fillNameKeywordAndDm() {
  fireEvent.change(screen.getByLabelText('form.nameLabel'), {
    target: { value: 'Minha automacao' },
  });
  fireEvent.change(screen.getByPlaceholderText('form.keywordPlaceholder'), {
    target: { value: 'preco' },
  });
  fireEvent.keyDown(screen.getByPlaceholderText('form.keywordPlaceholder'), { key: 'Enter' });
  fireEvent.change(screen.getByLabelText('form.dmLabel'), {
    target: { value: 'Segue o link!' },
  });
}

/** Fills the fields the submit validation requires, leaving the target alone.
 * Picking the client resets the target, so it has to come first. */
async function fillRequiredFields() {
  fireEvent.click(await screen.findByRole('button', { name: 'Clinica X' }));
  fillNameKeywordAndDm();
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
    mockValidateMediaFile.mockReturnValue(null);
    mockUploadMedia.mockResolvedValue({
      key: 'automation-media/w-1/x.jpg',
      content_type: 'image/jpeg',
      size_bytes: 100,
    });
    mockDeleteMedia.mockResolvedValue(undefined);
    mockSignMediaView.mockResolvedValue('https://signed.example/x.jpg');
    // jsdom doesn't implement either -- same stub used by postMedia.test.ts et al.
    URL.createObjectURL = vi.fn(() => 'blob:mock-preview');
    URL.revokeObjectURL = vi.fn();
  });

  /** Anexa um arquivo de imagem fake ao input de mídia e espera o upload
   * (mockado, resolve na hora) terminar -- o botão "remover mídia" só existe
   * depois que `dmMedia` aterrissa no form. */
  async function attachMedia(fileName = 'foto.jpg') {
    const file = new File(['a'], fileName, { type: 'image/jpeg' });
    fireEvent.change(screen.getByLabelText('form.mediaLabel'), {
      target: { files: [file] },
    });
    await screen.findByRole('button', { name: 'form.mediaRemove' });
  }

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

  // ── initialTarget (entry point from the post editor) ───────────────────────

  it('opens seeded on the production post it was handed, with the client locked', async () => {
    renderDialog(vi.fn(), null, {
      clientId: 7,
      target: { kind: 'production', workflow_post_id: 501, titulo: 'Carrossel de agosto' },
    });

    const card = await screen.findByRole('button', { name: 'Carrossel de agosto' });
    expect(card.getAttribute('aria-pressed')).toBe('true');
    expect(
      (screen.getByRole('radio', { name: 'form.targetPost' }) as HTMLInputElement).checked,
    ).toBe(true);
    expect((screen.getByLabelText('form.clientAria') as HTMLButtonElement).disabled).toBe(true);
  });

  it('creates against the seeded production post without ever touching the client select', async () => {
    renderDialog(vi.fn(), null, {
      clientId: 7,
      target: { kind: 'production', workflow_post_id: 501, titulo: 'Carrossel de agosto' },
    });

    await screen.findByRole('button', { name: 'Carrossel de agosto' });
    fillNameKeywordAndDm();
    fireEvent.click(screen.getByRole('button', { name: 'form.save' }));

    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        client_id: 7,
        workflow_post_id: 501,
        ig_media_id: null,
        media_permalink: null,
        media_caption: 'Carrossel de agosto',
      }),
    );
  });

  it('opens seeded on the published tab when the post already has a media id', async () => {
    renderDialog(vi.fn(), null, {
      clientId: 7,
      target: {
        kind: 'published',
        ig_media_id: '17900000000000001',
        media_permalink: 'https://instagram.com/p/teste',
        media_caption: 'Post de teste',
        workflow_post_id: 501,
      },
    });

    expect(
      (await screen.findByRole('radio', { name: 'form.targetSourcePublished' })).getAttribute(
        'aria-checked',
      ),
    ).toBe('true');
    // The published grid's tiles carry no accessible text, so the selected one
    // is identified by its pressed state.
    expect(await screen.findByRole('button', { pressed: true })).toBeTruthy();

    fillNameKeywordAndDm();
    fireEvent.click(screen.getByRole('button', { name: 'form.save' }));

    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        client_id: 7,
        ig_media_id: '17900000000000001',
        // The internal link survives the round trip, so the post keeps showing
        // the automation after it publishes.
        workflow_post_id: 501,
      }),
    );
  });

  // The published grid is fed by `instagram_posts`, which a DAILY sync fills, so
  // a post published today is missing from it for up to 24h -- exactly when the
  // user opens the drawer to arm an automation for it.
  const OFF_FEED_TARGET: SelectedTarget = {
    kind: 'published',
    ig_media_id: '17911111111111111',
    media_permalink: 'https://instagram.com/p/fora-do-feed',
    media_caption: 'Post fora do feed',
    workflow_post_id: 501,
  };

  it('pins a published target the synced feed has not caught up with yet', async () => {
    renderDialog(vi.fn(), null, { clientId: 7, target: OFF_FEED_TARGET });

    const pinned = await screen.findByRole('button', { name: 'Post fora do feed' });
    expect(pinned.getAttribute('aria-pressed')).toBe('true');
    // The synced grid still renders underneath, so retargeting stays possible.
    expect(screen.getByRole('link', { name: 'viewPost' }).getAttribute('href')).toBe(
      'https://instagram.com/p/fora-do-feed',
    );

    fillNameKeywordAndDm();
    fireEvent.click(screen.getByRole('button', { name: 'form.save' }));

    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        ig_media_id: '17911111111111111',
        media_permalink: 'https://instagram.com/p/fora-do-feed',
        media_caption: 'Post fora do feed',
        workflow_post_id: 501,
      }),
    );
  });

  it('keeps the pinned published target out of the way once the feed does hold it', async () => {
    renderDialog(vi.fn(), null, {
      clientId: 7,
      target: { ...OFF_FEED_TARGET, ig_media_id: POST.instagram_post_id },
    });

    // The live tile carries the selection; no stand-in is drawn for it.
    expect(await screen.findByRole('button', { pressed: true })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Post fora do feed' })).toBeNull();
  });

  it('drops the pinned target the moment another card is picked', async () => {
    renderDialog(vi.fn(), null, { clientId: 7, target: OFF_FEED_TARGET });

    await screen.findByRole('button', { name: 'Post fora do feed' });
    fireEvent.click(screen.getByRole('button', { pressed: false }));

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Post fora do feed' })).toBeNull(),
    );
    fillNameKeywordAndDm();
    fireEvent.click(screen.getByRole('button', { name: 'form.save' }));

    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ ig_media_id: POST.instagram_post_id }),
    );
  });

  it('treats a click on the pinned target as a no-op, not a retarget', async () => {
    renderDialog(vi.fn(), null, { clientId: 7, target: OFF_FEED_TARGET });

    const pinned = await screen.findByRole('button', { name: 'Post fora do feed' });
    fireEvent.click(pinned);

    expect(
      screen.getByRole('button', { name: 'Post fora do feed' }).getAttribute('aria-pressed'),
    ).toBe('true');
    fillNameKeywordAndDm();
    fireEvent.click(screen.getByRole('button', { name: 'form.save' }));

    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ ig_media_id: '17911111111111111' }),
    );
  });

  it('does not claim "nothing synced" while the pinned target is standing there', async () => {
    mockGetInstagramPosts.mockResolvedValue({ posts: [], total: 0 });
    renderDialog(vi.fn(), null, { clientId: 7, target: OFF_FEED_TARGET });

    expect(await screen.findByRole('button', { name: 'Post fora do feed' })).toBeTruthy();
    expect(screen.queryByText('form.noPostsSynced')).toBeNull();
  });

  it('pins the target again as soon as the user pages away from it', async () => {
    mockGetInstagramPosts.mockResolvedValue({ posts: [POST], total: 40 });
    renderDialog(vi.fn(), null, {
      clientId: 7,
      target: { ...OFF_FEED_TARGET, ig_media_id: POST.instagram_post_id },
    });

    await screen.findByRole('button', { pressed: true });
    expect(screen.queryByRole('button', { name: 'Post fora do feed' })).toBeNull();

    // Page 2 is server-side and the mock hands back the same single post, which
    // stands in for "the target is not on this page".
    mockGetInstagramPosts.mockResolvedValue({
      posts: [{ ...POST, id: 'other', instagram_post_id: '17922222222222222' }],
      total: 40,
    });
    fireEvent.click(screen.getByRole('button', { name: 'form.next' }));

    expect(await screen.findByRole('button', { name: 'Post fora do feed' })).toBeTruthy();
  });

  // ── Stacking above the Entregas drawer ────────────────────────────────────

  it('lifts overlay and content above the drawer when opened elevated', async () => {
    renderDialog(vi.fn(), null, undefined, true);

    const content = await screen.findByRole('dialog');
    // .drawer-panel is z-index 9001 and .drawer-overlay 9000; the default z-50
    // leaves the dialog buried under both.
    expect(content.className).toContain('z-[9005]');
    expect(content.getAttribute('data-overlay-class')).toBe('z-[9005]');
  });

  it('keeps the default stacking on the Automações page, which has no drawer', async () => {
    renderDialog();

    const content = await screen.findByRole('dialog');
    // Base DialogContent now carries z-[9011] by default (dialogs always sit
    // above the Entregas drawer); the assertion pins only that no per-instance
    // elevation override is applied here.
    expect(content.className).not.toContain('z-[9005]');
    expect(content.getAttribute('data-overlay-class')).toBeNull();
  });

  it('leaves the dialog untouched when no initialTarget is given', async () => {
    renderDialog();

    await screen.findByRole('button', { name: 'Clinica X' });
    expect((screen.getByLabelText('form.clientAria') as HTMLButtonElement).disabled).toBe(false);
    expect(
      (screen.getByRole('radio', { name: 'form.targetAll' }) as HTMLInputElement).checked,
    ).toBe(true);
  });

  it('lets an edit win over a stale initialTarget', async () => {
    // Reopening the same section in edit mode must not drag the post seed along.
    renderDialog(
      vi.fn(),
      { ...EDITING_BASE, workflow_post_id: 999, media_caption: 'Post arquivado' },
      {
        clientId: 7,
        target: { kind: 'production', workflow_post_id: 501, titulo: 'Carrossel de agosto' },
      },
    );

    const pinned = await screen.findByRole('button', { name: 'Post arquivado' });
    expect(pinned.getAttribute('aria-pressed')).toBe('true');
    expect(
      screen.getByRole('button', { name: 'Carrossel de agosto' }).getAttribute('aria-pressed'),
    ).toBe('false');
    // Editing keeps the client select usable.
    expect((screen.getByLabelText('form.clientAria') as HTMLButtonElement).disabled).toBe(false);
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

  // ── Variações de resposta pública ────────────────────────────────────────

  describe('variações de resposta pública', () => {
    it('salva variações preenchidas como public_replies e espelha a primeira em public_reply', async () => {
      renderDialog();
      await fillRequiredFields();

      fireEvent.change(screen.getByLabelText('form.replyVariationLabel:{"index":1}'), {
        target: { value: 'Te chamei na DM!' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'form.addReply' }));
      fireEvent.change(screen.getByLabelText('form.replyVariationLabel:{"index":2}'), {
        target: { value: 'Olha o direct!' },
      });

      fireEvent.click(screen.getByRole('button', { name: 'form.save' }));

      await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          public_replies: ['Te chamei na DM!', 'Olha o direct!'],
          public_reply: 'Te chamei na DM!',
        }),
      );
    });

    it('variações vazias são descartadas; tudo vazio vira public_replies [] e public_reply null', async () => {
      renderDialog();
      await fillRequiredFields();
      fireEvent.click(screen.getByRole('button', { name: 'form.save' }));
      await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ public_replies: [], public_reply: null }),
      );
    });

    it('editar automação legada abre public_reply como lista de 1 variação', async () => {
      renderDialog(vi.fn(), { ...EDITING_BASE, public_reply: 'legada', public_replies: [] });
      expect(await screen.findByLabelText('form.replyVariationLabel:{"index":1}')).toHaveValue(
        'legada',
      );
    });

    it('botão de adicionar some com 5 variações', async () => {
      renderDialog(vi.fn(), {
        ...EDITING_BASE,
        public_replies: ['a', 'b', 'c', 'd', 'e'],
      });
      await screen.findByLabelText('form.replyVariationLabel:{"index":5}');
      expect(screen.queryByRole('button', { name: 'form.addReply' })).not.toBeInTheDocument();
    });

    it('remover a única variação preenchida deixa uma linha vazia funcional (estado, não só visual)', async () => {
      renderDialog();
      await fillRequiredFields();

      fireEvent.change(screen.getByLabelText('form.replyVariationLabel:{"index":1}'), {
        target: { value: 'Te chamei na DM!' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'form.removeReply' }));

      const field = screen.getByLabelText('form.replyVariationLabel:{"index":1}');
      expect(field).toHaveValue('');
      fireEvent.change(field, { target: { value: 'Nova variação' } });
      expect(field).toHaveValue('Nova variação');

      fireEvent.click(screen.getByRole('button', { name: 'form.save' }));

      await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          public_replies: ['Nova variação'],
          public_reply: 'Nova variação',
        }),
      );
    });
  });

  // ── Mídia do cartão de DM ────────────────────────────────────────────────

  describe('mídia do cartão', () => {
    it('anexar imagem troca o campo de mensagem para título com limite 80 e mostra subtítulo', async () => {
      renderDialog();

      await fillRequiredFields();
      await attachMedia();

      expect(mockUploadMedia).toHaveBeenCalledTimes(1);
      const dmField = screen.getByLabelText('form.cardTitleLabel') as HTMLTextAreaElement;
      expect(dmField.maxLength).toBe(80);
      expect(screen.getByLabelText('form.subtitleLabel')).toBeInTheDocument();
    });

    it('submit com mídia envia dm_media e dm_subtitle', async () => {
      renderDialog();

      await fillRequiredFields();
      await attachMedia();
      fireEvent.change(screen.getByLabelText('form.subtitleLabel'), {
        target: { value: 'sub' },
      });

      fireEvent.click(screen.getByRole('button', { name: 'form.save' }));

      await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          dm_media: {
            key: 'automation-media/w-1/x.jpg',
            content_type: 'image/jpeg',
            size_bytes: 100,
          },
          dm_subtitle: 'sub',
        }),
      );
    });

    it('submit sem mídia envia dm_media e dm_subtitle como null', async () => {
      renderDialog();

      await fillRequiredFields();
      fireEvent.click(screen.getByRole('button', { name: 'form.save' }));

      await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ dm_media: null, dm_subtitle: null }),
      );
    });

    it('mensagem acima de 80 com mídia bloqueia o submit com toast', async () => {
      renderDialog(vi.fn(), {
        ...EDITING_BASE,
        dm_message: 'x'.repeat(100),
      });

      await attachMedia();
      fireEvent.click(screen.getByRole('button', { name: 'form.save' }));

      await waitFor(() => expect(toast.error).toHaveBeenCalledWith('form.validationDmWithMedia'));
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('remover mídia persistida não apaga o objeto antes do save; apaga só após o update com sucesso', async () => {
      renderDialog(vi.fn(), {
        ...EDITING_BASE,
        dm_media: {
          key: 'automation-media/w-1/old.jpg',
          content_type: 'image/jpeg',
          size_bytes: 50,
        },
        dm_subtitle: 'Antiga',
      });

      fireEvent.click(await screen.findByRole('button', { name: 'form.mediaRemove' }));
      expect(mockDeleteMedia).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole('button', { name: 'form.save' }));

      await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
      await waitFor(() =>
        expect(mockDeleteMedia).toHaveBeenCalledWith({
          key: 'automation-media/w-1/old.jpg',
          content_type: 'image/jpeg',
          size_bytes: 50,
        }),
      );
    });

    it('fechar o dialog sem salvar depois de remover mídia persistida nunca apaga o objeto', async () => {
      const onOpenChange = vi.fn();
      const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      render(
        <QueryClientProvider client={qc}>
          <MemoryRouter>
            <AutomationFormDialog
              open
              onOpenChange={onOpenChange}
              editing={{
                ...EDITING_BASE,
                dm_media: {
                  key: 'automation-media/w-1/old.jpg',
                  content_type: 'image/jpeg',
                  size_bytes: 50,
                },
                dm_subtitle: 'Antiga',
              }}
              onSaved={vi.fn()}
            />
          </MemoryRouter>
        </QueryClientProvider>,
      );

      fireEvent.click(await screen.findByRole('button', { name: 'form.mediaRemove' }));
      fireEvent.click(screen.getByRole('button', { name: 'form.cancel' }));

      expect(mockDeleteMedia).not.toHaveBeenCalled();
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  // ── Tour guiado ──────────────────────────────────────────────────────────

  describe('tour', () => {
    it('expõe as âncoras data-tour dos 8 campos', async () => {
      renderDialog();
      await screen.findByLabelText('form.nameLabel');
      for (const anchor of [
        'campo-nome',
        'campo-cliente',
        'campo-alvo',
        'campo-palavras',
        'campo-dm',
        'campo-midia',
        'campo-botoes',
        'campo-resposta',
      ]) {
        expect(document.querySelector(`[data-tour="${anchor}"]`)).not.toBeNull();
      }
    });

    it('renderiza o TourOverlay quando a prop tour está presente', async () => {
      const step = TOUR_STEPS[1]; // campo-nome
      renderDialog(vi.fn(), null, undefined, undefined, {
        step,
        index: 1,
        total: TOUR_STEPS.length,
        onNext: vi.fn(),
        onBack: vi.fn(),
        onSkip: vi.fn(),
        onFinish: vi.fn(),
      });
      expect(await screen.findByTestId('tour-overlay')).toBeInTheDocument();
      expect(screen.getByText('tour.step2Title')).toBeInTheDocument();
    });

    it('sem a prop tour, nenhum overlay', async () => {
      renderDialog();
      await screen.findByLabelText('form.nameLabel');
      expect(screen.queryByTestId('tour-overlay')).not.toBeInTheDocument();
    });
  });
});
