import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

vi.mock('../../context/AdminAuthContext', () => ({
  useAdminAuth: () => ({ adminEmail: 'admin@mesaas.com.br', signOut: vi.fn() }),
}));
vi.mock('../../liquidglass/LiquidGlassProvider', () => ({
  useLiquidGlassContext: () => ({ enabled: false, toggle: vi.fn() }),
}));
vi.mock('../../liquidglass/LiquidBackdrop', () => ({ LiquidBackdrop: () => null }));

import AdminLayout from '../AdminLayout';

function renderLayout() {
  return render(
    <MemoryRouter initialEntries={['/admin']}>
      <Routes>
        <Route path="/admin" element={<AdminLayout />}>
          <Route index element={<p>conteúdo</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('AdminLayout sidebar', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
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
});
