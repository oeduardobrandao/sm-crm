import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Radix AlertDialog relies on portals/focus-trap plumbing that's overkill to exercise
// here — mirrors the simplified context-driven mock already used by ClientesPage.test.tsx,
// extended with Trigger/Description since HubTab drives the dialog via an uncontrolled trigger.
vi.mock('@/components/ui/alert-dialog', async () => {
  const ReactModule = await vi.importActual<typeof import('react')>('react');

  interface AlertDialogContextValue {
    open: boolean;
    onOpenChange?: (open: boolean) => void;
  }

  const AlertDialogContext = ReactModule.createContext<AlertDialogContextValue>({ open: false });

  function AlertDialog({
    open: openProp = false,
    onOpenChange,
    children,
  }: {
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    children: React.ReactNode;
  }) {
    const [open, setOpen] = ReactModule.useState(openProp);
    ReactModule.useEffect(() => {
      setOpen(openProp);
    }, [openProp]);
    return (
      <AlertDialogContext.Provider
        value={{
          open,
          onOpenChange: (v: boolean) => {
            setOpen(v);
            onOpenChange?.(v);
          },
        }}
      >
        <div>{children}</div>
      </AlertDialogContext.Provider>
    );
  }

  function AlertDialogTrigger({ children }: { asChild?: boolean; children: React.ReactElement }) {
    const { onOpenChange } = ReactModule.useContext(AlertDialogContext);
    return ReactModule.cloneElement(children, {
      onClick: (event: unknown) => {
        (children.props as { onClick?: (e: unknown) => void }).onClick?.(event);
        onOpenChange?.(true);
      },
    });
  }

  function AlertDialogContent({ children }: { children: React.ReactNode }) {
    const { open } = ReactModule.useContext(AlertDialogContext);
    return open ? <div role="alertdialog">{children}</div> : null;
  }

  function AlertDialogHeader({ children }: { children: React.ReactNode }) {
    return <div>{children}</div>;
  }

  function AlertDialogFooter({ children }: { children: React.ReactNode }) {
    return <div>{children}</div>;
  }

  function AlertDialogTitle({ children }: { children: React.ReactNode }) {
    return <h2>{children}</h2>;
  }

  function AlertDialogDescription({ children }: { children: React.ReactNode }) {
    return <p>{children}</p>;
  }

  function AlertDialogAction({ children, onClick }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
    const { onOpenChange } = ReactModule.useContext(AlertDialogContext);
    return (
      <button
        type="button"
        onClick={(event) => {
          onClick?.(event);
          onOpenChange?.(false);
        }}
      >
        {children}
      </button>
    );
  }

  function AlertDialogCancel({ children }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
    const { onOpenChange } = ReactModule.useContext(AlertDialogContext);
    return (
      <button type="button" onClick={() => onOpenChange?.(false)}>
        {children}
      </button>
    );
  }

  return {
    AlertDialog,
    AlertDialogTrigger,
    AlertDialogContent,
    AlertDialogHeader,
    AlertDialogFooter,
    AlertDialogTitle,
    AlertDialogDescription,
    AlertDialogAction,
    AlertDialogCancel,
  };
});

import { HubTab } from '../HubTab';
import * as hubStore from '../../../store/hub';

vi.mock('../../../store/hub');

const DAY = 86_400_000;
const token = (expiresInDays: number) => ({
  id: 't1',
  token: 'tok-1',
  is_active: true,
  expires_at: new Date(Date.now() + expiresInDays * DAY).toISOString(),
});

let scrollIntoViewDescriptor: PropertyDescriptor | undefined;
let scrollToDescriptor: PropertyDescriptor | undefined;

function setGeometry(
  element: Element,
  geometry: Partial<Record<'offsetLeft' | 'offsetWidth' | 'clientWidth' | 'scrollWidth', number>>,
) {
  for (const [property, value] of Object.entries(geometry)) {
    Object.defineProperty(element, property, { configurable: true, value });
  }
}

function renderTab() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <HubTab clienteId={15} contaId="ws-1" workspaceSlug="dk-marketing-medico" />
    </QueryClientProvider>,
  );
}

describe('HubTab — Acesso', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    scrollIntoViewDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView');
    scrollToDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTo');
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      configurable: true,
      writable: true,
      value: vi.fn(),
    });
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
      configurable: true,
      writable: true,
      value: vi.fn(),
    });
    // These queries always mount (independent of the active tab) — stub them so
    // TanStack Query doesn't warn about an undefined resolution unrelated to this suite.
    vi.mocked(hubStore.getHubBrand).mockResolvedValue({ brand: null, files: [] });
    vi.mocked(hubStore.getHubPages).mockResolvedValue([]);
  });

  afterEach(() => {
    cleanup();
    if (scrollIntoViewDescriptor) {
      Object.defineProperty(Element.prototype, 'scrollIntoView', scrollIntoViewDescriptor);
    } else {
      delete (Element.prototype as Partial<Element>).scrollIntoView;
    }
    if (scrollToDescriptor) {
      Object.defineProperty(HTMLElement.prototype, 'scrollTo', scrollToDescriptor);
    } else {
      delete (HTMLElement.prototype as Partial<HTMLElement>).scrollTo;
    }
  });

  it('shows a healthy link with no Estender button', async () => {
    vi.mocked(hubStore.getHubToken).mockResolvedValue(token(360));
    renderTab();
    await waitFor(() => expect(screen.getByText(/Expira em/)).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /Estender/ })).not.toBeInTheDocument();
  });

  it('shows Estender when the link is near expiry', async () => {
    vi.mocked(hubStore.getHubToken).mockResolvedValue(token(12));
    renderTab();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Estender/ })).toBeInTheDocument(),
    );
  });

  it('shows the Expirado badge and Estender when lapsed', async () => {
    vi.mocked(hubStore.getHubToken).mockResolvedValue(token(-1));
    renderTab();
    await waitFor(() => expect(screen.getByText('Expirado')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /Estender/ })).toBeInTheDocument();
  });

  it('shows Expirado (not "Expira em 0 dias") for a token that lapsed a few hours ago today', async () => {
    // Same calendar day as "now", but the instant itself is already past — regression
    // guard for the differenceInCalendarDays(0) trap that hid a same-day expiry as healthy.
    vi.mocked(hubStore.getHubToken).mockResolvedValue({
      id: 't1',
      token: 'tok-1',
      is_active: true,
      expires_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    });
    renderTab();
    await waitFor(() => expect(screen.getByText('Expirado')).toBeInTheDocument());
    expect(screen.queryByText(/Expira em 0 dias/)).not.toBeInTheDocument();
  });

  it('does not rotate until the confirm dialog is accepted', async () => {
    vi.mocked(hubStore.getHubToken).mockResolvedValue(token(360));
    vi.mocked(hubStore.rotateHubToken).mockResolvedValue({
      token: 'tok-2',
      expires_at: new Date(Date.now() + 365 * DAY).toISOString(),
    });
    renderTab();
    await waitFor(() => screen.getByRole('button', { name: /Gerar novo link/ }));

    fireEvent.click(screen.getByRole('button', { name: /Gerar novo link/ }));
    expect(hubStore.rotateHubToken).not.toHaveBeenCalled(); // dialog open, not confirmed

    fireEvent.click(screen.getByRole('button', { name: /Confirmar/ }));
    await waitFor(() => expect(hubStore.rotateHubToken).toHaveBeenCalledWith('t1'));
  });

  it('renders all tabs inside the horizontal Hub tab list', async () => {
    vi.mocked(hubStore.getHubToken).mockResolvedValue(token(360));
    renderTab();
    await waitFor(() => screen.getByText(/Expira em/));
    expect(screen.getByRole('tablist')).toHaveClass('hub-tabs__list');
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'Acesso',
      'Briefing',
      'Marca',
      'Páginas',
      'Ideias',
    ]);
  });

  it('scrolls the selected tab into view and groups access actions', async () => {
    vi.mocked(hubStore.getHubToken).mockResolvedValue(token(360));
    renderTab();
    await waitFor(() => screen.getByText(/Expira em/));
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
    expect(HTMLElement.prototype.scrollTo).not.toHaveBeenCalled();

    const ideias = await screen.findByRole('tab', { name: 'Ideias' });
    const tabList = screen.getByRole('tablist');
    setGeometry(tabList, { clientWidth: 240, scrollWidth: 600 });
    setGeometry(ideias, { offsetLeft: 420, offsetWidth: 100 });
    fireEvent.mouseDown(ideias);
    await waitFor(() =>
      expect(tabList.scrollTo).toHaveBeenCalledWith({
        behavior: 'smooth',
        left: 350,
      }),
    );
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Acesso' }));
    expect(document.querySelector('.hub-access__url')).not.toBeNull();
    expect(document.querySelector('.hub-access__secondary-actions')).not.toBeNull();
    expect(document.querySelector('.hub-access__primary-actions')).not.toBeNull();
  });

  it('stacks the brand editor fields until the tablet breakpoint', async () => {
    vi.mocked(hubStore.getHubToken).mockResolvedValue(token(360));
    renderTab();
    fireEvent.mouseDown(await screen.findByRole('tab', { name: 'Marca' }));

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Marca' })).toBeInTheDocument());
    expect(document.querySelector('.hub-brand-editor__grid')).toHaveClass(
      'grid-cols-1',
      'md:grid-cols-2',
    );
  });

  it('stacks the page editor and preview until the tablet breakpoint', async () => {
    vi.mocked(hubStore.getHubToken).mockResolvedValue(token(360));
    renderTab();
    fireEvent.mouseDown(await screen.findByRole('tab', { name: 'Páginas' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Nova página' }));

    const dialog = await screen.findByRole('dialog', { name: 'Nova página' });
    expect(dialog.querySelector('.hub-page-editor__workspace')).toHaveClass('flex-col', 'md:flex-row');
    expect(dialog.querySelector('.hub-page-editor__input')).toHaveClass('w-full', 'md:w-1/2');
    expect(dialog.querySelector('.hub-page-editor__preview')).toHaveClass('w-full', 'md:w-1/2');
  });
});
