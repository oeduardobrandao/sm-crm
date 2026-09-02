import { act, renderHook } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { useFluxosFilters } from '../useFluxosFilters';

/** Renders the hook under a router seeded with `search`, and exposes the
 *  location so assertions can read what the setters wrote back. */
function renderFilters(search = '') {
  function wrapper({ children }: { children: ReactNode }) {
    return createElement(
      MemoryRouter,
      { initialEntries: [`/analytics-fluxos${search}`] },
      children,
    );
  }
  return renderHook(() => ({ filters: useFluxosFilters(), location: useLocation() }), { wrapper });
}

describe('useFluxosFilters', () => {
  it('defaults to 30d with no client or template filter', () => {
    const { result } = renderFilters();

    expect(result.current.filters.periodo).toBe('30d');
    expect(result.current.filters.clienteId).toBeNull();
    expect(result.current.filters.templateId).toBeNull();
    expect(result.current.filters.hasFilters).toBe(false);
  });

  it('reads periodo, cliente and template from the URL', () => {
    const { result } = renderFilters('?periodo=90d&cliente=3&template=7');

    expect(result.current.filters.periodo).toBe('90d');
    expect(result.current.filters.clienteId).toBe(3);
    expect(result.current.filters.templateId).toBe(7);
    expect(result.current.filters.hasFilters).toBe(true);
  });

  it('falls back to defaults on unknown or malformed params', () => {
    const { result } = renderFilters('?periodo=ontem&cliente=abc&template=');

    expect(result.current.filters.periodo).toBe('30d');
    expect(result.current.filters.clienteId).toBeNull();
    expect(result.current.filters.templateId).toBeNull();
  });

  it('writes non-default values to the URL and round-trips them', () => {
    const { result } = renderFilters();

    act(() => result.current.filters.setPeriodo('7d'));
    expect(result.current.location.search).toBe('?periodo=7d');
    expect(result.current.filters.periodo).toBe('7d');

    act(() => result.current.filters.setClienteId(12));
    expect(new URLSearchParams(result.current.location.search).get('cliente')).toBe('12');
    expect(result.current.filters.clienteId).toBe(12);

    act(() => result.current.filters.setTemplateId(4));
    expect(new URLSearchParams(result.current.location.search).get('template')).toBe('4');
    expect(result.current.filters.templateId).toBe(4);
  });

  it('omits defaults from the URL instead of spelling them out', () => {
    const { result } = renderFilters('?periodo=7d&cliente=12&template=4');

    act(() => result.current.filters.setPeriodo('30d'));
    expect(new URLSearchParams(result.current.location.search).has('periodo')).toBe(false);

    act(() => result.current.filters.setClienteId(null));
    expect(new URLSearchParams(result.current.location.search).has('cliente')).toBe(false);

    act(() => result.current.filters.setTemplateId(null));
    expect(result.current.location.search).toBe('');
  });

  it('derives from/to from the periodo and keeps them stable across renders', () => {
    const { result, rerender } = renderFilters('?periodo=7d');

    const { from, to } = result.current.filters;
    const spanDays = (to.getTime() - from.getTime()) / 86400000;
    expect(Math.round(spanDays)).toBe(7);

    rerender();
    // Same object identity, or the query key/fn would churn on every render.
    expect(result.current.filters.from).toBe(from);
    expect(result.current.filters.to).toBe(to);
  });

  it('reaches back to 2020 for the "tudo" periodo', () => {
    const { result } = renderFilters('?periodo=tudo');

    expect(result.current.filters.from.getFullYear()).toBe(2020);
    expect(result.current.filters.from.getMonth()).toBe(0);
    expect(result.current.filters.from.getDate()).toBe(1);
  });
});
