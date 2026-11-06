// Post Express no celular (PLAN F4.5). jsdom responde false a todo matchMedia, então
// useIsDesktop(768) é false e a página renderiza o ramo do celular sem mock.
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => vi.fn() };
});

// As ações do cabeçalho (ajuda + sino) precisam da KB e das notificações; as suítes
// delas cobrem isso.
vi.mock('@/components/layout/PhoneShellHeader', () => ({
  PhoneShellActions: () => <div data-testid="shell-actions" />,
}));

vi.mock('../../../store', () => ({
  getClientes: vi.fn(),
  createAvulsoPost: vi.fn(),
  updateWorkflowPost: vi.fn(),
  removeWorkflowPost: vi.fn(),
  getHubToken: vi.fn(),
}));

vi.mock('../../../services/instagram', () => ({
  publishInstagramPostNow: vi.fn(),
}));

vi.mock('../../../hooks/useWorkspaceLimits', () => ({
  useWorkspaceLimits: vi.fn(),
}));

const { igAccountRef, igClientsRef } = vi.hoisted(() => ({
  igAccountRef: { current: null as Record<string, unknown> | null },
  igClientsRef: { current: [{ client_id: 1 }, { client_id: 2 }] as { client_id: number }[] },
}));
vi.mock('../../../lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        data: igClientsRef.current,
        eq: () => ({
          maybeSingle: async () => ({ data: igAccountRef.current }),
        }),
      }),
    }),
  },
}));

const { galleryProps } = vi.hoisted(() => ({
  galleryProps: { current: null as Record<string, unknown> | null },
}));
vi.mock('../../entregas/components/PostMediaGallery', () => ({
  PostMediaGallery: (props: { onChange?: (m: unknown[]) => void; variant?: string }) => {
    galleryProps.current = props;
    return (
      <div data-testid="media-gallery" data-variant={props.variant}>
        <button
          type="button"
          onClick={() =>
            props.onChange?.([
              { id: 1, kind: 'image', url: 'test.jpg', original_filename: 'test.jpg' },
            ])
          }
        >
          Simulate Upload
        </button>
      </div>
    );
  },
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import ExpressPostPage from '../ExpressPostPage';
import {
  getClientes,
  createAvulsoPost,
  updateWorkflowPost,
  removeWorkflowPost,
  getHubToken,
} from '../../../store';
import { publishInstagramPostNow } from '../../../services/instagram';
import { useWorkspaceLimits } from '../../../hooks/useWorkspaceLimits';
import { toast } from 'sonner';

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>
        <ExpressPostPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

const FUTURE = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

const cliente = (id: number, nome: string) => ({
  id,
  nome,
  sigla: nome.slice(0, 2),
  cor: '#000',
  plano: 'pro',
  email: '',
  telefone: '',
  status: 'ativo' as const,
  valor_mensal: 100,
});

const okAccount = {
  id: 9,
  username: 'clienta',
  profile_picture_url: null,
  authorization_status: 'active',
  token_expires_at: FUTURE,
  permissions: ['instagram_business_content_publish'],
};

const limits = (feature_hub_portal: boolean) => ({
  limits: null,
  features: { feature_hub_portal } as never,
  planName: 'pro',
  isLoading: false,
  isUnlimited: false,
});

beforeEach(() => {
  vi.clearAllMocks();
  galleryProps.current = null;
  igAccountRef.current = okAccount;
  igClientsRef.current = [{ client_id: 1 }, { client_id: 2 }];
  vi.mocked(getClientes).mockResolvedValue([cliente(1, 'Client A'), cliente(2, 'Client B')]);
  vi.mocked(useWorkspaceLimits).mockReturnValue(limits(true));
  vi.mocked(getHubToken).mockResolvedValue({
    id: 't1',
    token: 'tok-1',
    is_active: true,
    expires_at: FUTURE,
  });
  vi.mocked(createAvulsoPost).mockResolvedValue({
    id: 30,
    workflow_id: null,
    cliente_id: 1,
    titulo: 'Post Express',
    conteudo: null,
    conteudo_plain: '',
    tipo: 'feed',
    ordem: 0,
    status: 'rascunho',
    is_express: true,
  });
  vi.mocked(removeWorkflowPost).mockResolvedValue(undefined);
  vi.mocked(updateWorkflowPost).mockResolvedValue({} as never);
});

async function pickClientA() {
  await waitFor(() => expect(screen.getByTestId('express-client')).toBeEnabled());
  fireEvent.click(screen.getByTestId('express-client'));
  const sheet = screen.getByRole('dialog', { name: 'Cliente' });
  fireEvent.click(within(sheet).getByRole('button', { name: /Client A/ }));
  await waitFor(() => expect(screen.getByTestId('media-gallery')).toBeInTheDocument());
}

describe('ExpressPostPage no celular', () => {
  it('mostra o cabeçalho de página com o Formato segmentado, sem cabeçalho de desktop', async () => {
    const { container } = renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'Post Express' })).toBeInTheDocument();
    expect(screen.getByText('Publique rapidamente no Instagram')).toBeInTheDocument();
    expect(container.querySelector('.phone-large-title')).not.toBeNull();
    expect(container.querySelector('.header')).toBeNull();
    const format = screen.getByRole('radiogroup', { name: 'Formato' });
    expect(within(format).getByRole('radio', { name: 'Publicação' })).toBeChecked();
    expect(within(format).getByRole('radio', { name: 'Stories' })).not.toBeChecked();
    // Nada do desktop: nem select nativo nem o passo a passo.
    expect(container.querySelector('select')).toBeNull();
    expect(screen.queryByText(/Etapa 1/)).toBeNull();
    expect(screen.getByTestId('express-submit')).toBeDisabled();
    expect(screen.getByTestId('express-submit')).toHaveTextContent('Publicar agora');
  });

  it('Cliente abre o seletor; escolher cria o rascunho e mostra a galeria no formato do celular', async () => {
    renderPage();
    await pickClientA();
    expect(createAvulsoPost).toHaveBeenCalledWith({
      cliente_id: 1,
      titulo: expect.stringContaining('Post Express - Client A - '),
      tipo: 'feed',
      is_express: true,
    });
    expect(screen.getByTestId('media-gallery')).toHaveAttribute('data-variant', 'phone');
    expect(galleryProps.current).toMatchObject({ variant: 'phone', postId: 30, maxFiles: 1 });
    expect(await screen.findByText('@clienta')).toBeInTheDocument();
    expect(screen.getByTestId('express-client')).toHaveTextContent('Client A');
  });

  it('Stories esconde a legenda e libera o envio sem legenda', async () => {
    renderPage();
    await pickClientA();
    expect(screen.getByRole('textbox', { name: 'Legenda do Instagram' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: 'Stories' }));
    expect(screen.queryByRole('textbox', { name: 'Legenda do Instagram' })).toBeNull();
    expect(screen.getByText('Stories não usam legenda.')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Simulate Upload'));
    expect(screen.getByTestId('express-submit')).toBeEnabled();
    expect(screen.getByTestId('express-submit')).toHaveTextContent('Publicar Stories');
  });

  it('a legenda mostra o contador e Preview abre a prévia numa folha', async () => {
    renderPage();
    await pickClientA();
    fireEvent.change(screen.getByRole('textbox', { name: 'Legenda do Instagram' }), {
      target: { value: 'Blend de outono' },
    });
    expect(screen.getByText('15 / 2.200')).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: /Preview/ }));
    const sheet = screen.getByRole('dialog', { name: 'Preview' });
    expect(within(sheet).getAllByText('@clienta').length).toBeGreaterThan(0);
    expect(within(sheet).getByText(/Blend de outono/)).toBeInTheDocument();
  });

  it('publicar: confirma numa folha que mostra o progresso até concluir', async () => {
    let finish!: (v: { status: string }) => void;
    vi.mocked(publishInstagramPostNow).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }) as never,
    );
    renderPage();
    await pickClientA();
    fireEvent.click(screen.getByText('Simulate Upload'));
    fireEvent.change(screen.getByRole('textbox', { name: 'Legenda do Instagram' }), {
      target: { value: 'legenda' },
    });
    fireEvent.click(screen.getByTestId('express-submit'));

    const sheet = screen.getByRole('dialog', { name: 'Publicar agora?' });
    expect(within(sheet).getByText(/Esta ação não pode ser desfeita/)).toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Publicar' }));

    expect(await screen.findByRole('dialog', { name: 'Publicando…' })).toBeInTheDocument();
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow');
    // Durante a publicação não há como fechar a folha.
    expect(screen.queryByRole('button', { name: 'Fechar' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cancelar' })).toBeNull();
    await waitFor(() => expect(publishInstagramPostNow).toHaveBeenCalledWith(30));
    expect(updateWorkflowPost).toHaveBeenCalledWith(
      30,
      expect.objectContaining({ status: 'aprovado_cliente', ig_caption: 'legenda', tipo: 'feed' }),
    );

    finish({ status: 'postado' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull(), { timeout: 3000 });
    expect(toast.success).toHaveBeenCalled();
  });

  it('Cancelar fecha a confirmação sem publicar', async () => {
    renderPage();
    await pickClientA();
    fireEvent.click(screen.getByText('Simulate Upload'));
    fireEvent.change(screen.getByRole('textbox', { name: 'Legenda do Instagram' }), {
      target: { value: 'legenda' },
    });
    fireEvent.click(screen.getByTestId('express-submit'));
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(publishInstagramPostNow).not.toHaveBeenCalled();
    expect(updateWorkflowPost).not.toHaveBeenCalled();
  });

  it('aprovação do cliente: Envio segmentado, link do portal ativo e envio sem publicar', async () => {
    renderPage();
    await pickClientA();
    fireEvent.click(screen.getByText('Simulate Upload'));
    fireEvent.change(screen.getByRole('textbox', { name: 'Legenda do Instagram' }), {
      target: { value: 'legenda' },
    });
    const send = screen.getByRole('radiogroup', { name: 'Modo de envio' });
    fireEvent.click(within(send).getByRole('radio', { name: 'Aprovação do cliente' }));
    expect(await screen.findByText('Link do portal ativo para este cliente')).toBeInTheDocument();
    const submit = screen.getByTestId('express-submit');
    await waitFor(() => expect(submit).toBeEnabled());
    expect(submit).toHaveTextContent('Enviar para aprovação');

    fireEvent.click(submit);
    const sheet = screen.getByRole('dialog', { name: 'Enviar para aprovação?' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Enviar' }));
    await waitFor(() =>
      expect(updateWorkflowPost).toHaveBeenCalledWith(
        30,
        expect.objectContaining({ status: 'enviado_cliente', ig_caption: 'legenda' }),
      ),
    );
    expect(publishInstagramPostNow).not.toHaveBeenCalled();
  });

  it('sem link ativo do portal: aviso visível com Configurar portal e envio bloqueado', async () => {
    vi.mocked(getHubToken).mockResolvedValue(null);
    renderPage();
    await pickClientA();
    fireEvent.click(screen.getByText('Simulate Upload'));
    fireEvent.change(screen.getByRole('textbox', { name: 'Legenda do Instagram' }), {
      target: { value: 'legenda' },
    });
    fireEvent.click(screen.getByRole('radio', { name: 'Aprovação do cliente' }));
    expect(await screen.findByText(/não tem um link ativo do portal/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Configurar portal' })).toHaveAttribute(
      'href',
      '/clientes/1',
    );
    expect(screen.getByTestId('express-submit')).toBeDisabled();
  });

  it('sem o portal no plano, o Envio segmentado não aparece', async () => {
    vi.mocked(useWorkspaceLimits).mockReturnValue(limits(false));
    renderPage();
    await waitFor(() => expect(screen.getByTestId('express-client')).toBeEnabled());
    expect(screen.queryByRole('radiogroup', { name: 'Modo de envio' })).toBeNull();
    expect(screen.queryByRole('radio', { name: 'Aprovação do cliente' })).toBeNull();
  });

  it('token revogado: aviso visível no rodapé do Cliente com o link Reconectar', async () => {
    igAccountRef.current = { ...okAccount, authorization_status: 'revoked' };
    renderPage();
    await pickClientA();
    expect(await screen.findByText(/Token do Instagram foi revogado/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Reconectar' })).toHaveAttribute(
      'href',
      '/clientes/1/redes-sociais',
    );
    fireEvent.click(screen.getByText('Simulate Upload'));
    expect(screen.getByTestId('express-submit')).toBeDisabled();
  });

  it('sem cliente com Instagram: aviso e atalho Conectar conta', async () => {
    igClientsRef.current = [];
    renderPage();
    expect(await screen.findByText(/Nenhum cliente com Instagram conectado/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Conectar conta/ })).toHaveAttribute(
      'href',
      '/clientes',
    );
    expect(screen.getByTestId('express-client')).toBeDisabled();
  });
});
