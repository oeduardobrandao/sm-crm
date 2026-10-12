import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

vi.mock('../../context/AdminAuthContext', () => ({
  useAdminAuth: () => ({ adminEmail: 'admin@mesaas.com.br', signOut: vi.fn() }),
}));
const glass = vi.hoisted(() => ({ enabled: false, toggle: vi.fn() }));
vi.mock('../../liquidglass/LiquidGlassProvider', () => ({
  useLiquidGlassContext: () => glass,
}));
vi.mock('../../liquidglass/LiquidBackdrop', () => ({ LiquidBackdrop: () => null }));

import AdminLayout from '../AdminLayout';

function tree() {
  return (
    <MemoryRouter initialEntries={['/admin']}>
      <Routes>
        <Route path="/admin" element={<AdminLayout />}>
          <Route index element={<p>conteúdo</p>} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

function renderLayout() {
  return render(tree());
}

describe('AdminLayout sidebar', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    glass.enabled = false;
    glass.toggle.mockClear();
  });

  it('renders the navigation as real links', () => {
    renderLayout();
    expect(screen.getByRole('link', { name: 'Workspaces' })).toHaveAttribute(
      'href',
      '/admin/workspaces',
    );
    expect(screen.getByRole('link', { name: 'Integrações' })).toHaveAttribute(
      'href',
      '/admin/integrations',
    );
    expect(screen.getByText('conteúdo')).toBeInTheDocument();
  });

  it('the sidebar has no theme-pinned hex classes', () => {
    renderLayout();
    const aside = screen.getByRole('complementary');
    expect(aside.className).not.toMatch(/#[0-9a-f]{6}/i);
    expect(aside.className).toContain('bg-card');
  });

  it('the theme toggle flips data-theme and persists it', () => {
    renderLayout();
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    fireEvent.click(screen.getByRole('button', { name: 'Modo claro' }));
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(localStorage.getItem('admin-theme')).toBe('light');
    expect(screen.getByRole('button', { name: 'Modo escuro' })).toBeInTheDocument();
  });

  it('groups the sidebar and marks the current page', () => {
    renderLayout();
    expect(screen.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Workspaces' })).not.toHaveAttribute('aria-current');
    expect(screen.getByText('Plataforma')).toBeInTheDocument();
    expect(screen.getByText('Comunicação')).toBeInTheDocument();
    expect(screen.getByText('Central de Ajuda')).toBeInTheDocument();
    const glassSwitch = screen.getByRole('switch', { name: 'Liquid Glass' });
    expect(glassSwitch).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(glassSwitch);
    expect(glass.toggle).toHaveBeenCalledTimes(1);
  });

  it('glass ON with light saved: forces dark without overwriting admin-theme', () => {
    localStorage.setItem('admin-theme', 'light');
    glass.enabled = true;
    const { rerender } = renderLayout();
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(localStorage.getItem('admin-theme')).toBe('light');
    // Glass ON hides the theme toggle.
    expect(screen.queryByRole('button', { name: /Modo (claro|escuro)/ })).not.toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Liquid Glass' })).toHaveAttribute(
      'aria-checked',
      'true',
    );

    // Turning glass off brings the saved light theme back.
    glass.enabled = false;
    rerender(tree());
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(localStorage.getItem('admin-theme')).toBe('light');
    expect(screen.getByRole('button', { name: 'Modo escuro' })).toBeInTheDocument();
  });
});
