// apps/admin/src/hooks/__tests__/useWorkspacesParams.test.tsx
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
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
