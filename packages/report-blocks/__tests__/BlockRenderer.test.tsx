import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BlockRenderer } from '../BlockRenderer';
import { makeSnapshotFixture } from '../fixtures';
import type { ReportLayout } from '../types';

const layout: ReportLayout = {
  version: 1,
  blocks: [
    { id: 'b1', type: 'cover', size: 'full' },
    { id: 'b2', type: 'section_header', size: 'full', config: { title: 'Métricas principais' } },
    {
      id: 'b3',
      type: 'text',
      size: 'full',
      text: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Análise do gestor' }] }],
      },
    },
    { id: 'b4', type: 'divider', size: 'full' },
    // Tipo fora do catálogo (futuro): ignorado em view/print, nunca quebra.
    { id: 'b5', type: 'unknown_widget' as never, size: 'full' },
  ],
};

describe('BlockRenderer', () => {
  it('renderiza capa, cabeçalho de seção e texto a partir do snapshot', () => {
    render(<BlockRenderer layout={layout} snapshot={makeSnapshotFixture()} mode="view" />);
    expect(screen.getByText('DK Marketing')).toBeInTheDocument(); // branding.workspace_name
    expect(screen.getByText('Julho de 2026')).toBeInTheDocument(); // period.label
    expect(screen.getByText('Métricas principais')).toBeInTheDocument();
    expect(screen.getByText('Análise do gestor')).toBeInTheDocument();
  });

  it('bloco desconhecido não renderiza nada e não explode', () => {
    const { container } = render(
      <BlockRenderer layout={layout} snapshot={makeSnapshotFixture()} mode="view" />,
    );
    expect(container.querySelectorAll('[data-block-id]').length).toBe(4); // b5 fora
  });

  it('aplica o accent resolvido como CSS var no root', () => {
    const { container } = render(
      <BlockRenderer layout={layout} snapshot={makeSnapshotFixture()} mode="view" />,
    );
    const root = container.querySelector('.rb-grid') as HTMLElement;
    expect(root.style.getPropertyValue('--rb-accent')).not.toBe('');
  });
});
