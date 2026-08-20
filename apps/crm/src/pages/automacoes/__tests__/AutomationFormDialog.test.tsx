import type { ReactNode } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const {
  mockCreate,
  mockUpdate,
  mockGetClientes,
  mockGetStatuses,
  mockGetInstagramPosts,
  mockUseAuth,
} = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockUpdate: vi.fn(),
  mockGetClientes: vi.fn(),
  mockGetStatuses: vi.fn(),
  mockGetInstagramPosts: vi.fn(),
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

import AutomationFormDialog from '../AutomationFormDialog';

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

function renderDialog(onSaved = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <AutomationFormDialog open onOpenChange={vi.fn()} editing={null} onSaved={onSaved} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('AutomationFormDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetClientes.mockResolvedValue(CLIENTES);
    mockGetStatuses.mockResolvedValue(
      new Map([[7, { revoked: false, expired: false, canPublish: true, canAutomate: true }]]),
    );
    mockGetInstagramPosts.mockResolvedValue({ posts: [POST], total: 1 });
    mockCreate.mockResolvedValue({ id: 'auto-new' });
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

    // The post-grid button carries no accessible text (thumbnail alt=""); it's
    // the only element with aria-pressed at this point in the tree.
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
      expect.objectContaining({ ig_media_id: '17900000000000001' }),
    );
    expect(mockCreate).not.toHaveBeenCalledWith(expect.objectContaining({ ig_media_id: POST.id }));
  });
});
