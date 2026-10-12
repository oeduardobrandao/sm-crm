import { act, render, screen } from '@testing-library/react';
import { useEffect, useState, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PageToolbarProvider,
  createPageToolbarStore,
  usePageToolbar,
  useVidroShell,
} from '../PageToolbarContext';
import PageToolbar from '../PageToolbar';
import { VidroToolbarHarness } from '@/test/vidroToolbar';

function Page({ title, extra }: { title: string; extra?: ReactNode }) {
  const inToolbar = usePageToolbar({
    title,
    primary: <button type="button">Novo</button>,
    subtitle: extra,
  });
  return inToolbar ? <p>conteúdo</p> : <h1>{title}</h1>;
}

afterEach(() => vi.restoreAllMocks());

describe('page toolbar store', () => {
  it('shows the last inserted registration and keeps order on set', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const store = createPageToolbarStore();
    store.register('a');
    store.set('a', { title: 'A' });
    store.register('b');
    store.set('b', { title: 'B' });
    store.set('a', { title: 'A2' });
    expect(store.getSnapshot().spec?.title).toBe('B');
    store.unregister('b');
    expect(store.getSnapshot().spec?.title).toBe('A2');
    store.unregister('a');
    expect(store.getSnapshot()).toEqual({ spec: null, registered: false });
  });

  it('ignores set for an unregistered id and returns a stable snapshot', () => {
    const store = createPageToolbarStore();
    store.set('x', { title: 'X' });
    const first = store.getSnapshot();
    expect(first.registered).toBe(false);
    expect(store.getSnapshot()).toBe(first);
  });

  it('warns in development when two registrations are live', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const store = createPageToolbarStore();
    store.register('a');
    store.register('b');
    expect(warn).toHaveBeenCalled();
  });
});

describe('usePageToolbar', () => {
  it('renders the title once, in the toolbar h1, when vidroShell', () => {
    render(
      <VidroToolbarHarness>
        <Page title="Clientes" />
      </VidroToolbarHarness>,
    );
    const h1s = screen.getAllByRole('heading', { level: 1 });
    expect(h1s).toHaveLength(1);
    expect(h1s[0].closest('.vidro-toolbar')).not.toBeNull();
    expect(screen.getAllByRole('button', { name: 'Novo' })).toHaveLength(1);
  });

  it('is inert without vidroShell: the page keeps its own header', () => {
    render(
      <VidroToolbarHarness vidroShell={false}>
        <Page title="Clientes" />
      </VidroToolbarHarness>,
    );
    expect(
      screen.getByRole('heading', { level: 1, name: 'Clientes' }).closest('.vidro-toolbar'),
    ).toBeNull();
    expect(screen.queryByRole('button', { name: 'Novo' })).toBeNull();
  });

  it('updates the toolbar on page re-render without changing the context value', () => {
    const shellRenders = { count: 0 };
    // Reads the context: it re-renders only if the Provider value changes.
    function ShellSibling() {
      useVidroShell();
      useEffect(() => {
        shellRenders.count += 1;
      });
      return null;
    }
    function LivePage() {
      const [n, setN] = useState(0);
      usePageToolbar({ title: 'Entregas', subtitle: `${n} atrasados` });
      return (
        <button type="button" onClick={() => setN((v) => v + 1)}>
          bump
        </button>
      );
    }
    render(
      <PageToolbarProvider vidroShell>
        <ShellSibling />
        <PageToolbar capsule={null} />
        <LivePage />
      </PageToolbarProvider>,
    );
    const before = shellRenders.count;
    act(() => screen.getByRole('button', { name: 'bump' }).click());
    act(() => screen.getByRole('button', { name: 'bump' }).click());
    expect(screen.getByText('2 atrasados')).toBeInTheDocument();
    expect(shellRenders.count).toBe(before);
  });

  it('clears the toolbar when the page unmounts', () => {
    function Host() {
      const [show, setShow] = useState(true);
      return (
        <>
          <button type="button" onClick={() => setShow(false)}>
            sair
          </button>
          {show && <Page title="Leads" />}
        </>
      );
    }
    render(
      <VidroToolbarHarness>
        <Host />
      </VidroToolbarHarness>,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Leads' })).toBeInTheDocument();
    act(() => screen.getByRole('button', { name: 'sair' }).click());
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
  });
});
