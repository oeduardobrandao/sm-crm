import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { GuideContext, type GuideApi } from '../GuideContext';
import { GuidePill, GuideNavItem } from '../GuidePill';

function api(overrides: Partial<GuideApi>): GuideApi {
  return {
    trails: [],
    doneIds: new Set(),
    totals: { done: 7, total: 15 },
    isConcluded: false,
    signalsSatisfied: false,
    progress: { pagesSeen: [], pagesDone: [], trailsCompleted: [] },
    markSeen: vi.fn(),
    setLastPage: vi.fn(),
    dismiss: vi.fn(),
    conclude: vi.fn(),
    recordAutoOpen: vi.fn(),
    recordTrailCompleted: vi.fn(),
    isOpen: false,
    currentPageId: null,
    latestClienteId: null,
    signalValues: {},
    showEntryPoint: true,
    open: vi.fn(),
    close: vi.fn(),
    closeForAction: vi.fn(),
    goTo: vi.fn(),
    concludeGuide: vi.fn(),
    ...overrides,
  } as GuideApi;
}

describe('GuidePill / GuideNavItem', () => {
  it('pill mostra o contador e abre com source pill', () => {
    const a = api({});
    render(
      <GuideContext.Provider value={a}>
        <GuidePill />
      </GuideContext.Provider>,
    );
    expect(screen.getByText('7 de 15')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Guia/ }));
    expect(a.open).toHaveBeenCalledWith('pill');
  });

  it('some quando showEntryPoint é false', () => {
    render(
      <GuideContext.Provider value={api({ showEntryPoint: false })}>
        <GuidePill />
        <GuideNavItem source="mobile_nav" />
      </GuideContext.Provider>,
    );
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('nav item abre com o source recebido', () => {
    const a = api({});
    render(
      <GuideContext.Provider value={a}>
        <GuideNavItem source="mobile_nav" />
      </GuideContext.Provider>,
    );
    fireEvent.click(screen.getByRole('button'));
    expect(a.open).toHaveBeenCalledWith('mobile_nav');
  });
});
