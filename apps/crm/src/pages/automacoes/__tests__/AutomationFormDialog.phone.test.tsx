import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// No useIsDesktop mock and the real ui/dialog: jsdom's matchMedia reports false, so the
// form renders its full-screen phone layout. The desktop dialog is
// AutomationFormDialog.test.tsx.

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
  return { ...actual, getInstagramPosts: mockGetInstagramPosts, syncInstagramData: vi.fn() };
});

vi.mock('../../../services/postMedia', async () => {
  const actual = await vi.importActual<typeof import('../../../services/postMedia')>(
    '../../../services/postMedia',
  );
  return { ...actual, getPostCovers: mockGetPostCovers };
});

vi.mock('../../../context/AuthContext', () => ({ useAuth: mockUseAuth }));

vi.mock('../../../services/automationMedia', () => ({
  uploadAutomationMedia: mockUploadMedia,
  deleteAutomationMedia: mockDeleteMedia,
  signAutomationMediaView: mockSignMediaView,
  validateAutomationMediaFile: mockValidateMediaFile,
}));

import { toast } from 'sonner';
import AutomationFormDialog from '../AutomationFormDialog';
import { TOUR_STEPS } from '../tour/tourSteps';
import { CONFIRM_CLOSE_DISCARD, CONFIRM_CLOSE_TITLE } from '@/components/ui/dialog';

const CLIENTES = [{ id: 7, nome: 'Clinica X', sigla: 'CX', cor: '#3ecf8e' }];

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

function renderForm({
  onSaved = vi.fn(),
  onOpenChange = vi.fn(),
  tour,
}: {
  onSaved?: () => void;
  onOpenChange?: (open: boolean) => void;
  tour?: Parameters<typeof AutomationFormDialog>[0]['tour'];
} = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <AutomationFormDialog
          open
          onOpenChange={onOpenChange}
          editing={null}
          onSaved={onSaved}
          tour={tour}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { onSaved, onOpenChange };
}

async function pickClient() {
  fireEvent.click(await screen.findByRole('button', { name: /form\.clientLabel/ }));
  const picker = await screen.findByRole('dialog', { name: 'form.clientAria' });
  fireEvent.click(await within(picker).findByRole('button', { name: 'Clinica X' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'form.clientAria' })).toBeNull());
}

function fillNameKeywordAndDm() {
  fireEvent.change(screen.getByLabelText('form.nameLabel'), {
    target: { value: 'Minha automacao' },
  });
  const keyword = screen.getByPlaceholderText('form.keywordPlaceholder');
  fireEvent.change(keyword, { target: { value: 'preco' } });
  fireEvent.keyDown(keyword, { key: 'Enter' });
  fireEvent.change(screen.getByPlaceholderText('form.dmPlaceholder'), {
    target: { value: 'Segue o link!' },
  });
}

describe('AutomationFormDialog on phones', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetClientes.mockResolvedValue(CLIENTES);
    mockGetStatuses.mockResolvedValue(
      new Map([[7, { revoked: false, expired: false, canPublish: true, canAutomate: true }]]),
    );
    mockGetInstagramPosts.mockResolvedValue({ posts: [POST], total: 1 });
    mockGetClientePosts.mockResolvedValue([]);
    mockGetPostCovers.mockResolvedValue(new Map());
    mockCreate.mockResolvedValue({ id: 'auto-new' });
    mockUseAuth.mockReturnValue({
      role: 'owner',
      profile: { id: 'user-1', conta_id: 'w-1', role: 'owner' },
    });
    mockValidateMediaFile.mockReturnValue(null);
    mockUploadMedia.mockResolvedValue({
      key: 'automation-media/w-1/foto.jpg',
      content_type: 'image/jpeg',
      size_bytes: 100,
    });
    mockDeleteMedia.mockResolvedValue(undefined);
    URL.createObjectURL = vi.fn(() => 'blob:mock-preview');
    URL.revokeObjectURL = vi.fn();
  });

  it('is a full-screen pushed screen with the grouped sections and a bottom Salvar', async () => {
    renderForm();
    const dialog = await screen.findByRole('dialog', { name: 'form.createTitle' });
    expect(dialog).toHaveClass('phone-af', 'phone-kit');
    expect(dialog.className).toContain('inset-0');
    expect(screen.getByRole('button', { name: 'Voltar' })).toBeInTheDocument();
    for (const header of [
      'form.targetLabel',
      'form.keywordsLabel',
      'form.dmLabel',
      'form.mediaLabel',
      'form.buttonsLabel',
      'form.repliesLabel',
    ]) {
      expect(screen.getByRole('heading', { name: header })).toHaveClass('phone-group__header');
    }
    const bar = document.querySelector('.phone-bottom-bar')!;
    expect(within(bar as HTMLElement).getByRole('button', { name: 'form.save' })).toBeVisible();
    expect(within(bar as HTMLElement).getByRole('button', { name: 'form.cancel' })).toBeVisible();
  });

  it('Salvar runs the same validation and create as desktop', async () => {
    const { onSaved } = renderForm();
    await screen.findByRole('dialog', { name: 'form.createTitle' });
    fireEvent.click(screen.getByRole('button', { name: 'form.save' }));
    expect(toast.error).toHaveBeenCalledWith('form.validationClient');
    expect(mockCreate).not.toHaveBeenCalled();

    await pickClient();
    fillNameKeywordAndDm();
    fireEvent.click(screen.getByRole('button', { name: 'form.save' }));
    await waitFor(() =>
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          client_id: 7,
          name: 'Minha automacao',
          keywords: ['preco'],
          dm_message: 'Segue o link!',
          ig_media_id: null,
          workflow_post_id: null,
        }),
      ),
    );
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  it('picks a published post in the picker sheet and saves its Instagram media id', async () => {
    renderForm();
    await pickClient();
    fireEvent.click(screen.getByRole('radio', { name: 'form.targetPost' }));
    fireEvent.click(screen.getByRole('radio', { name: 'form.targetSourcePublished' }));
    fireEvent.click(screen.getByRole('button', { name: /phone\.post/ }));
    const picker = await screen.findByRole('dialog', { name: 'phone.pickPostTitle' });
    expect(within(picker).getByRole('button', { name: /form\.refreshPosts/ })).toBeInTheDocument();
    fireEvent.click(await within(picker).findByRole('button', { pressed: false }));
    // A pick closes the sheet, like a picker.
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'phone.pickPostTitle' })).toBeNull(),
    );
    expect(screen.getByRole('button', { name: /Post de teste/ })).toBeInTheDocument();

    fillNameKeywordAndDm();
    fireEvent.click(screen.getByRole('button', { name: 'form.save' }));
    await waitFor(() =>
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ ig_media_id: '17900000000000001', workflow_post_id: null }),
      ),
    );
  });

  it('blocks a specific-post target with no post picked', async () => {
    renderForm();
    await pickClient();
    fireEvent.click(screen.getByRole('radio', { name: 'form.targetPost' }));
    fillNameKeywordAndDm();
    fireEvent.click(screen.getByRole('button', { name: 'form.save' }));
    expect(toast.error).toHaveBeenCalledWith('form.validationPost');
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('the Prévia row opens a sheet with the DM and reply previews', async () => {
    renderForm();
    await screen.findByRole('dialog', { name: 'form.createTitle' });
    fireEvent.click(screen.getByRole('button', { name: /phone\.preview/ }));
    const sheet = await screen.findByRole('dialog', { name: 'phone.preview' });
    expect(within(sheet).getByText('form.previewTitle')).toBeInTheDocument();
    expect(within(sheet).getByText('form.repliesPreviewTitle')).toBeInTheDocument();
  });

  it('Cancelar on a clean form closes at once', async () => {
    const { onOpenChange } = renderForm();
    await screen.findByRole('dialog', { name: 'form.createTitle' });
    fireEvent.click(screen.getByRole('button', { name: 'form.cancel' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('Back on a dirty form asks first; "Fechar mesmo assim" closes', async () => {
    const { onOpenChange } = renderForm();
    await screen.findByRole('dialog', { name: 'form.createTitle' });
    fireEvent.change(screen.getByLabelText('form.nameLabel'), { target: { value: 'Rascunho' } });
    fireEvent.click(screen.getByRole('button', { name: 'Voltar' }));
    expect(onOpenChange).not.toHaveBeenCalled();
    const confirm = await screen.findByRole('dialog', { name: CONFIRM_CLOSE_TITLE });
    fireEvent.click(within(confirm).getByRole('button', { name: CONFIRM_CLOSE_DISCARD }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it('uploads and removes DM media; the subtitle field appears with media', async () => {
    renderForm();
    await screen.findByRole('dialog', { name: 'form.createTitle' });
    const input = document.getElementById('automacao-midia') as HTMLInputElement;
    fireEvent.change(input, {
      target: { files: [new File(['a'], 'foto.jpg', { type: 'image/jpeg' })] },
    });
    expect(await screen.findByRole('button', { name: 'form.mediaRemove' })).toBeInTheDocument();
    expect(mockUploadMedia).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('form.subtitleLabel')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'form.cardTitleLabel' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'form.mediaRemove' }));
    // Uploaded in this session and never saved: trashed at once, as on desktop.
    expect(mockDeleteMedia).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'automation-media/w-1/foto.jpg' }),
    );
    expect(screen.queryByLabelText('form.subtitleLabel')).toBeNull();
  });

  it('adds and removes DM buttons and reply variations', async () => {
    renderForm();
    await screen.findByRole('dialog', { name: 'form.createTitle' });
    fireEvent.click(screen.getByRole('button', { name: 'form.addButton' }));
    expect(screen.getByLabelText('form.buttonTitleLabel')).toBeInTheDocument();
    expect(screen.getByLabelText('form.buttonUrlLabel')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'form.removeButton' }));
    expect(screen.queryByLabelText('form.buttonTitleLabel')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'form.addReply' }));
    expect(screen.getByLabelText('form.replyVariationLabel:{"index":2}')).toBeInTheDocument();
  });

  it('keeps every tour anchor and renders the tour inside the scroll container it measures', async () => {
    renderForm({
      tour: {
        step: TOUR_STEPS[1],
        index: 1,
        total: TOUR_STEPS.length,
        onNext: vi.fn(),
        onBack: vi.fn(),
        onSkip: vi.fn(),
        onFinish: vi.fn(),
      },
    });
    await screen.findByRole('dialog', { name: 'form.createTitle' });
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
    const overlay = await screen.findByTestId('tour-overlay');
    const scroller = overlay.closest('[data-dialog-scroll]');
    expect(scroller).toHaveClass('phone-af__scroll');
    expect(scroller).toContainElement(
      document.querySelector('[data-tour="campo-nome"]') as HTMLElement,
    );
    expect(await screen.findByText('tour.step2Title')).toBeInTheDocument();
  });
});
