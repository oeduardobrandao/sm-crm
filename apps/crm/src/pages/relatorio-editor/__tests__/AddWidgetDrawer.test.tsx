import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AddWidgetDrawer } from '../AddWidgetDrawer';
import { WIDGET_CATALOG, WIDGET_CATEGORIES } from '@mesaas/report-blocks/catalog';

describe('AddWidgetDrawer', () => {
  it('lista todas as categorias e todos os widgets do catálogo', () => {
    render(<AddWidgetDrawer open onOpenChange={() => {}} onInsert={() => {}} />);
    for (const cat of WIDGET_CATEGORIES) {
      expect(screen.getByRole('heading', { name: cat })).toBeInTheDocument();
    }
    for (const w of WIDGET_CATALOG) {
      expect(screen.getByRole('button', { name: w.label })).toBeInTheDocument();
    }
  });

  it('clicar num widget chama onInsert com o tipo e fecha o drawer', () => {
    const onInsert = vi.fn();
    const onOpenChange = vi.fn();
    render(<AddWidgetDrawer open onOpenChange={onOpenChange} onInsert={onInsert} />);
    fireEvent.click(screen.getByRole('button', { name: 'Top publicações' }));
    expect(onInsert).toHaveBeenCalledWith('top_posts');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('fechado, nada renderizado', () => {
    render(<AddWidgetDrawer open={false} onOpenChange={() => {}} onInsert={() => {}} />);
    expect(screen.queryByText('Adicionar widget')).not.toBeInTheDocument();
  });
});
