import { describe, it, expect } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import {
  contactsHref,
  parseContactsParams,
  useContactsFilters,
  writeContactsParams,
  useAutomacoesTab,
} from '../useContactsFilters';

describe('contacts URL state', () => {
  it('parses defaults and guards bad numbers', () => {
    const s = parseContactsParams(new URLSearchParams('aba=contatos&cliente=abc&pagina=-3'));
    expect(s).toEqual({
      clientId: null,
      automationId: null,
      from: null,
      to: null,
      reachedOnly: true,
      search: '',
      page: 1,
    });
  });

  it('round-trips every field', () => {
    const sp = writeContactsParams(new URLSearchParams('aba=contatos'), {
      clientId: 14,
      automationId: 'a1',
      from: '2026-10-01',
      to: '2026-10-07',
      reachedOnly: false,
      search: 'ana',
      page: 3,
    });
    expect(parseContactsParams(sp)).toEqual({
      clientId: 14,
      automationId: 'a1',
      from: '2026-10-01',
      to: '2026-10-07',
      reachedOnly: false,
      search: 'ana',
      page: 3,
    });
    expect(sp.get('aba')).toBe('contatos');
  });

  it('resets the page when a filter changes', () => {
    const sp = writeContactsParams(new URLSearchParams('aba=contatos&pagina=4'), { search: 'x' });
    expect(sp.get('pagina')).toBeNull();
  });

  it('clearing the client also clears the automation', () => {
    const sp = writeContactsParams(new URLSearchParams('cliente=14&automacao=a1'), {
      clientId: null,
    });
    expect(sp.get('cliente')).toBeNull();
    expect(sp.get('automacao')).toBeNull();
  });

  it('builds deep links', () => {
    expect(contactsHref()).toBe('/automacoes?aba=contatos');
    expect(contactsHref({ clientId: 14, automationId: 'a1' })).toBe(
      '/automacoes?aba=contatos&cliente=14&automacao=a1',
    );
  });

  it('hook reads and writes the router search params', () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <MemoryRouter initialEntries={['/automacoes?aba=contatos&cliente=14']}>
        {children}
      </MemoryRouter>
    );
    const { result } = renderHook(() => useContactsFilters(), { wrapper });
    expect(result.current.state.clientId).toBe(14);
    act(() => result.current.setFilters({ reachedOnly: false }));
    expect(result.current.state.reachedOnly).toBe(false);
    act(() => result.current.setPage(2));
    expect(result.current.state.page).toBe(2);
  });

  it('useAutomacoesTab tracks explicit tab setting', () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <MemoryRouter initialEntries={['/automacoes']}>{children}</MemoryRouter>
    );
    const { result } = renderHook(() => useAutomacoesTab(), { wrapper });
    expect(result.current[0]).toBe('automacoes');
    expect(result.current[2]).toBe(false);
    act(() => result.current[1]('automacoes'));
    expect(result.current[0]).toBe('automacoes');
    expect(result.current[2]).toBe(true);
    act(() => result.current[1]('contatos'));
    expect(result.current[0]).toBe('contatos');
    expect(result.current[2]).toBe(true);
  });
});
