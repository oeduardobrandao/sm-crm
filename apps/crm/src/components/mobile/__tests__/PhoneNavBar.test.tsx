import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PhoneLayoutContext,
  usePhoneChromeController,
} from '@/components/layout/PhoneLayoutContext';
import { PhoneNavBar, type PhoneNavBarProps } from '../PhoneNavBar';

function PathProbe() {
  return <div data-testid="path">{useLocation().pathname}</div>;
}

function Shell({ children }: { children: React.ReactNode }) {
  const { contextValue, attributes } = usePhoneChromeController(true);
  return (
    <PhoneLayoutContext.Provider value={contextValue}>
      <div data-testid="container" {...attributes}>
        {children}
      </div>
    </PhoneLayoutContext.Provider>
  );
}

function renderBar(props: PhoneNavBarProps = {}, entries = ['/equipe', '/equipe/5']) {
  return render(
    <MemoryRouter initialEntries={entries} initialIndex={entries.length - 1}>
      <Shell>
        <Routes>
          <Route path="/equipe/:id" element={<PhoneNavBar {...props} />} />
          <Route path="*" element={null} />
        </Routes>
        <PathProbe />
      </Shell>
    </MemoryRouter>,
  );
}

/** The data router keeps its slot index in history.state; MemoryRouter does not. */
function setHistoryIdx(idx: number | undefined) {
  window.history.replaceState(idx === undefined ? null : { idx }, '');
}

afterEach(() => setHistoryIdx(undefined));

describe('PhoneNavBar', () => {
  it('goes back in history when there is an in-app entry', () => {
    setHistoryIdx(1);
    renderBar({ backLabel: 'Voltar para Equipe' });
    fireEvent.click(screen.getByRole('button', { name: 'Voltar para Equipe' }));
    expect(screen.getByTestId('path')).toHaveTextContent(/^\/equipe$/);
  });

  it('replaces with the fallback route when opened directly', () => {
    setHistoryIdx(0);
    renderBar({ fallbackTo: '/equipe' }, ['/equipe/5']);
    fireEvent.click(screen.getByRole('button', { name: 'Voltar' }));
    expect(screen.getByTestId('path')).toHaveTextContent(/^\/equipe$/);
  });

  it('defaults the fallback to the dashboard', () => {
    setHistoryIdx(undefined);
    renderBar({}, ['/equipe/5']);
    fireEvent.click(screen.getByRole('button', { name: 'Voltar' }));
    expect(screen.getByTestId('path')).toHaveTextContent('/dashboard');
  });

  it('uses onBack instead of navigating when given', () => {
    setHistoryIdx(1);
    const onBack = vi.fn();
    renderBar({ onBack });
    fireEvent.click(screen.getByRole('button', { name: 'Voltar' }));
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('path')).toHaveTextContent('/equipe/5');
  });

  it('renders a centered title by default, a leading one on request, and trailing actions', () => {
    const { unmount } = renderBar({
      title: 'Bruno',
      trailing: <button type="button">Editar</button>,
    });
    const bar = document.querySelector('.phone-nav-bar')!;
    expect(bar).toHaveClass('phone-nav-bar--title-center');
    expect(screen.getByRole('heading', { level: 1, name: 'Bruno' })).toHaveClass(
      'phone-nav-bar__title',
    );
    expect(
      screen.getByRole('button', { name: 'Editar' }).closest('.phone-nav-bar__trailing'),
    ).not.toBeNull();
    unmount();

    renderBar({ title: 'Perfil', titleAlign: 'leading', titleAs: 'h2' });
    expect(document.querySelector('.phone-nav-bar')).toHaveClass('phone-nav-bar--title-leading');
    expect(screen.getByRole('heading', { level: 2, name: 'Perfil' })).toBeInTheDocument();
  });

  it('has no title element when the screen renders its own large title', () => {
    renderBar();
    expect(screen.queryByRole('heading')).toBeNull();
    expect(document.querySelector('.phone-nav-bar')).not.toHaveClass('phone-nav-bar--title-center');
  });

  it('is a plain header, never a dialog, and hides the shell bar while mounted', () => {
    renderBar({ title: 'Bruno' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.querySelector('header.phone-nav-bar')).not.toBeNull();
    expect(screen.getByTestId('container')).toHaveAttribute('data-phone-page-header');
  });
});
