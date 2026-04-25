import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Breadcrumbs } from '../components/Breadcrumbs';

describe('Breadcrumbs', () => {
  it('renders "Todos os Arquivos" when breadcrumbs are empty', () => {
    const onNavigate = vi.fn();
    render(<Breadcrumbs breadcrumbs={[]} onNavigate={onNavigate} />);

    expect(screen.getByText('Todos os Arquivos')).toBeInTheDocument();
  });

  it('navigates to root when clicking "Todos os Arquivos"', () => {
    const onNavigate = vi.fn();
    render(<Breadcrumbs breadcrumbs={[]} onNavigate={onNavigate} />);

    fireEvent.click(screen.getByText('Todos os Arquivos'));
    expect(onNavigate).toHaveBeenCalledWith(null);
  });

  it('renders breadcrumb chain with separators', () => {
    const onNavigate = vi.fn();
    const breadcrumbs = [
      { id: 1, name: 'Clientes' },
      { id: 2, name: 'Aurora' },
      { id: 3, name: 'Fotos' },
    ];
    render(<Breadcrumbs breadcrumbs={breadcrumbs} onNavigate={onNavigate} />);

    expect(screen.getByText('Todos os Arquivos')).toBeInTheDocument();
    expect(screen.getByText('Clientes')).toBeInTheDocument();
    expect(screen.getByText('Aurora')).toBeInTheDocument();
    expect(screen.getByText('Fotos')).toBeInTheDocument();
  });

  it('calls onNavigate with correct id when clicking a non-last breadcrumb', () => {
    const onNavigate = vi.fn();
    const breadcrumbs = [
      { id: 1, name: 'Clientes' },
      { id: 2, name: 'Aurora' },
      { id: 3, name: 'Fotos' },
    ];
    render(<Breadcrumbs breadcrumbs={breadcrumbs} onNavigate={onNavigate} />);

    fireEvent.click(screen.getByText('Clientes'));
    expect(onNavigate).toHaveBeenCalledWith(1);

    fireEvent.click(screen.getByText('Aurora'));
    expect(onNavigate).toHaveBeenCalledWith(2);
  });

  it('last breadcrumb is not a button (not clickable)', () => {
    const onNavigate = vi.fn();
    const breadcrumbs = [
      { id: 1, name: 'Clientes' },
      { id: 2, name: 'Fotos' },
    ];
    render(<Breadcrumbs breadcrumbs={breadcrumbs} onNavigate={onNavigate} />);

    // Last breadcrumb is rendered as a span, not a button
    const lastCrumb = screen.getByText('Fotos');
    expect(lastCrumb.tagName).toBe('SPAN');

    // Non-last crumb is a button
    const firstCrumb = screen.getByText('Clientes');
    expect(firstCrumb.tagName).toBe('BUTTON');
  });

  it('renders a single breadcrumb as non-clickable last item', () => {
    const onNavigate = vi.fn();
    const breadcrumbs = [{ id: 5, name: 'Documentos' }];
    render(<Breadcrumbs breadcrumbs={breadcrumbs} onNavigate={onNavigate} />);

    const item = screen.getByText('Documentos');
    expect(item.tagName).toBe('SPAN');
  });
});
