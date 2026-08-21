import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BlockRenderer, resolveLayoutAccent, SIZE_CLASS } from '../BlockRenderer';
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
    expect(root.style.getPropertyValue('--rb-accent-fg')).not.toBe('');
  });

  it('widget sem dados: o wrapper existe mas fica vazio (colapsa via CSS)', () => {
    const emptyLayout: ReportLayout = {
      version: 1,
      blocks: [
        // section_header sem config.title: SectionHeaderBlock rende null.
        { id: 'empty', type: 'section_header', size: 'full' },
        {
          id: 'filled',
          type: 'text',
          size: 'full',
          text: {
            type: 'doc',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'ok' }] }],
          },
        },
      ],
    };
    const { container } = render(
      <BlockRenderer layout={emptyLayout} snapshot={makeSnapshotFixture()} mode="view" />,
    );
    const wrapper = container.querySelector('[data-block-id="empty"]') as HTMLElement;
    expect(wrapper).toBeInTheDocument();
    expect(wrapper.childNodes.length).toBe(0);
  });

  it('styles.css define a regra de colapso do wrapper vazio', () => {
    const css = readFileSync(join(__dirname, '../styles.css'), 'utf-8');
    expect(css).toContain('[data-block-id]:empty');
  });

  it('resolveLayoutAccent prioriza layout.accent sobre a marca do snapshot', () => {
    const snap = makeSnapshotFixture();
    const base = resolveLayoutAccent({ version: 1, blocks: [] }, snap);
    const overridden = resolveLayoutAccent({ version: 1, accent: '#0f766e', blocks: [] }, snap);
    expect(base.acc).not.toBe(overridden.acc);
    expect(overridden.acc.toLowerCase()).toBe('#0f766e');
  });

  it('SIZE_CLASS mapeia os três tamanhos', () => {
    expect(SIZE_CLASS).toEqual({ third: 'rb-third', half: 'rb-half', full: 'rb-full' });
  });

  it('styles.css tem as regras de modo edição', () => {
    const css = readFileSync(join(__dirname, '../styles.css'), 'utf-8');
    expect(css).toContain('.rb-grid.rb-mode-edit > [data-block-id]:empty');
    expect(css).toContain('Sem dados no período');
  });
});
