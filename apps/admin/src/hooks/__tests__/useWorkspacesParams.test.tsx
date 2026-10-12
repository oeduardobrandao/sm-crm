// apps/admin/src/hooks/__tests__/useWorkspacesParams.test.tsx
import { act, render, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, RouterProvider, createMemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { useWorkspacesParams } from '../useWorkspacesParams';

function wrap(initial: string) {
  return ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={[initial]}>{children}</MemoryRouter>
  );
}

describe('useWorkspacesParams', () => {
  it('parses the current URL', () => {
    const { result } = renderHook(() => useWorkspacesParams(), {
      wrapper: wrap('/admin/workspaces?status=pendente&pag=3&ord=name&dir=asc'),
    });
    expect(result.current.params.status).toBe('pendente');
    expect(result.current.params.pag).toBe(3);
    expect(result.current.params.ord).toBe('name');
  });

  it('set() with a filter key resets the page to 1', () => {
    const { result } = renderHook(() => useWorkspacesParams(), {
      wrapper: wrap('/admin/workspaces?pag=3'),
    });
    act(() => result.current.set({ status: 'teste' }));
    expect(result.current.params.status).toBe('teste');
    expect(result.current.params.pag).toBe(1);
  });

  it('set() with pag / ord / dir keeps the page unless pag is given', () => {
    const { result } = renderHook(() => useWorkspacesParams(), {
      wrapper: wrap('/admin/workspaces?pag=3'),
    });
    act(() => result.current.set({ ord: 'name', dir: 'asc' }));
    expect(result.current.params.pag).toBe(3);
    act(() => result.current.set({ pag: 5 }));
    expect(result.current.params.pag).toBe(5);
  });

  it('two set() calls in one synchronous block both apply', () => {
    const { result } = renderHook(() => useWorkspacesParams(), {
      wrapper: wrap('/admin/workspaces?status=ativo&plano=pro&pag=2'),
    });
    act(() => {
      result.current.set({ status: '' });
      result.current.set({ plano: '' });
    });
    expect(result.current.params.status).toBe('');
    expect(result.current.params.plano).toBe('');
    expect(result.current.params.pag).toBe(1);
  });

  it('reset() clears filters and page but keeps sort and page size', () => {
    const { result } = renderHook(() => useWorkspacesParams(), {
      wrapper: wrap('/admin/workspaces?q=x&status=ativo&criado=7d&pag=2&ord=name&dir=asc&por=50'),
    });
    act(() => result.current.reset());
    expect(result.current.params).toEqual({
      q: '',
      plano: '',
      status: '',
      overrides: '',
      atividade: '',
      criado: '',
      ord: 'name',
      dir: 'asc',
      pag: 1,
      por: 50,
    });
  });
});

describe('useWorkspacesParams history action', () => {
  // renderHook needs the hook to render INSIDE the router, so mount it as the route element.
  function mountInRouter(initial: string) {
    const holder: { current: ReturnType<typeof useWorkspacesParams> | null } = { current: null };
    function Probe() {
      holder.current = useWorkspacesParams();
      return null;
    }
    const router = createMemoryRouter([{ path: '/admin/workspaces', element: <Probe /> }], {
      initialEntries: [initial],
    });
    render(<RouterProvider router={router} />);
    return { router, hook: holder };
  }

  it('set() pushes a history entry for a filter change', () => {
    const { router, hook } = mountInRouter('/admin/workspaces');
    act(() => hook.current!.set({ status: 'teste' }));
    expect(router.state.historyAction).toBe('PUSH');
    expect(router.state.location.search).toBe('?status=teste');
  });

  it('set(patch, { replace: true }) REPLACEs the entry instead of pushing', () => {
    const { router, hook } = mountInRouter('/admin/workspaces');
    act(() => hook.current!.set({ status: 'teste' }, { replace: true }));
    expect(router.state.historyAction).toBe('REPLACE');
    expect(router.state.location.search).toBe('?status=teste');
    act(() => hook.current!.set({ plano: 'pro' }, { replace: true }));
    expect(router.state.historyAction).toBe('REPLACE');
    expect(router.state.location.search).toBe('?plano=pro&status=teste');
  });

  it('a q-only change replaces by default, as the search box rewrites on every tick', () => {
    const { router, hook } = mountInRouter('/admin/workspaces');
    act(() => hook.current!.set({ q: 'ab' }));
    expect(router.state.historyAction).toBe('REPLACE');
  });

  it('an explicit replace: false on a q-only change pushes', () => {
    const { router, hook } = mountInRouter('/admin/workspaces');
    act(() => hook.current!.set({ q: 'ab' }, { replace: false }));
    expect(router.state.historyAction).toBe('PUSH');
  });
});
