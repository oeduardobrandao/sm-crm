import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
// Este repo não tem @testing-library/user-event instalado (ver outros testes
// de Dialog, ex. RelatorioEditorPage.test.tsx) — cliques via fireEvent.
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { GuideContext, type GuideApi } from '../GuideContext';
import { GUIDE_TRAILS } from '../guideContent';
import GuideDialog from '../GuideDialog';

vi.mock('../../../lib/analytics', () => ({ captureEvent: vi.fn() }));

function makeApi(overrides: Partial<GuideApi> = {}): GuideApi {
  return {
    trails: GUIDE_TRAILS,
    doneIds: new Set<string>(),
    totals: { done: 0, total: 15 },
    isConcluded: false,
    signalsSatisfied: false,
    progress: { pagesSeen: [], pagesDone: [], trailsCompleted: [] },
    markSeen: vi.fn(),
    setLastPage: vi.fn(),
    dismiss: vi.fn(),
    conclude: vi.fn(),
    recordAutoOpen: vi.fn(),
    recordTrailCompleted: vi.fn(),
    isOpen: true,
    autoOpen: 'no',
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
  };
}

function LocationProbe() {
  const loc = useLocation();
  return <span data-testid="loc">{loc.pathname + loc.search}</span>;
}

function renderDialog(api: GuideApi) {
  return render(
    <MemoryRouter initialEntries={['/dashboard']}>
      <GuideContext.Provider value={api}>
        <GuideDialog />
        <Routes>
          <Route path="*" element={<LocationProbe />} />
        </Routes>
      </GuideContext.Provider>
    </MemoryRouter>,
  );
}

describe('GuideDialog', () => {
  it('home mostra as três trilhas e o contador geral', () => {
    renderDialog(makeApi());
    expect(screen.getByText('Bem-vindo ao Mesaas')).toBeInTheDocument();
    expect(screen.getByText('Adicionar seu primeiro cliente')).toBeInTheDocument();
    expect(screen.getByText('Montar sua equipe')).toBeInTheDocument();
    expect(screen.getByText('Criar suas entregas')).toBeInTheDocument();
    expect(screen.getByText('0 de 15 páginas')).toBeInTheDocument();
  });

  it('começar uma trilha navega para a primeira página dela', () => {
    const api = makeApi();
    renderDialog(api);
    fireEvent.click(screen.getAllByRole('button', { name: 'Começar' })[0]);
    expect(api.goTo).toHaveBeenCalledWith('t1p1');
  });

  it('página renderiza título, posição e markSeen dispara', () => {
    const api = makeApi({ currentPageId: 't1p1' });
    renderDialog(api);
    expect(screen.getByText('Tudo começa com um cliente')).toBeInTheDocument();
    expect(screen.getByText('Página 1 de 5')).toBeInTheDocument();
    expect(api.markSeen).toHaveBeenCalledWith('t1p1');
  });

  it('Fazer agora fecha sem dismissal, grava lastPage e navega', () => {
    const api = makeApi({ currentPageId: 't1p2' });
    renderDialog(api);
    fireEvent.click(screen.getByRole('button', { name: 'Fazer agora' }));
    expect(api.setLastPage).toHaveBeenCalledWith('t1p2');
    expect(api.closeForAction).toHaveBeenCalled();
    expect(api.dismiss).not.toHaveBeenCalled();
    expect(screen.getByTestId('loc').textContent).toBe('/clientes?novo=1');
  });

  it('a última página da trilha 1 tem a ponte para a trilha 2', () => {
    const api = makeApi({ currentPageId: 't1p5' });
    renderDialog(api);
    fireEvent.click(screen.getByRole('button', { name: /Montar sua equipe/ }));
    expect(api.goTo).toHaveBeenCalledWith('t2p1');
  });

  it('a conclusão chama concludeGuide', () => {
    const api = makeApi({ currentPageId: 't3p6' });
    renderDialog(api);
    fireEvent.click(screen.getByRole('button', { name: 'Concluir guia' }));
    expect(api.concludeGuide).toHaveBeenCalled();
  });
});
