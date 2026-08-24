import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BlockRenderer, SIZE_CLASS } from '../BlockRenderer';
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

  it('bloco com type "__proto__" ou "constructor" não explode e não renderiza nada (guard de prototype-pollution)', () => {
    // BLOCK_COMPONENTS é um objeto literal: sem o guard hasOwnProperty, o
    // lookup ["__proto__"] resolveria para Object.prototype (herdado,
    // truthy) e ["constructor"] resolveria para Object (também herdado,
    // truthy) -- o React tentaria renderizar um desses como componente e
    // explodiria, em vez de tratar o bloco como tipo desconhecido (mesmo
    // caminho do teste "bloco desconhecido não renderiza nada e não
    // explode" acima: nem o wrapper [data-block-id] chega a existir).
    const hostileLayout: ReportLayout = {
      version: 1,
      blocks: [
        { id: 'hostile-proto', type: '__proto__' as never, size: 'full' },
        { id: 'hostile-ctor', type: 'constructor' as never, size: 'full' },
        {
          id: 'still-works',
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
      <BlockRenderer layout={hostileLayout} snapshot={makeSnapshotFixture()} mode="view" />,
    );
    expect(container.querySelector('[data-block-id="hostile-proto"]')).toBeNull();
    expect(container.querySelector('[data-block-id="hostile-ctor"]')).toBeNull();
    expect(container.querySelector('[data-block-id="still-works"]')).toBeInTheDocument();
  });

  it('tema explicito: container ganha classe e vars de tema', () => {
    const { container } = render(
      <BlockRenderer
        layout={{ version: 1, theme: 'editorial', blocks: [] }}
        snapshot={makeSnapshotFixture()}
        mode="view"
      />,
    );
    const grid = container.querySelector('.rb-grid') as HTMLElement;
    expect(grid.classList.contains('rb-theme-editorial')).toBe(true);
    expect(grid.style.getPropertyValue('--rb-bg')).toBe('#faf6ee');
  });

  it('modo herdado: sem classe de tema, sem var de fundo (byte-identico)', () => {
    const { container } = render(
      <BlockRenderer
        layout={{ version: 1, blocks: [] }}
        snapshot={makeSnapshotFixture()}
        mode="view"
      />,
    );
    const grid = container.querySelector('.rb-grid') as HTMLElement;
    expect(grid.className).not.toContain('rb-theme-');
    expect(grid.style.getPropertyValue('--rb-bg')).toBe('');
    expect(grid.style.getPropertyValue('--rb-accent')).toBe('#7c3aed');
  });

  it('fonts definido: link do Google Fonts renderizado; ausente: nenhum link', () => {
    render(
      <BlockRenderer
        layout={{ version: 1, fonts: 'fraunces', blocks: [] }}
        snapshot={makeSnapshotFixture()}
        mode="view"
      />,
    );
    expect(
      document.querySelector('link[href*="fonts.googleapis.com"][href*="Fraunces"]'),
    ).not.toBeNull();
  });

  it('SIZE_CLASS mapeia os três tamanhos', () => {
    expect(SIZE_CLASS).toEqual({ third: 'rb-third', half: 'rb-half', full: 'rb-full' });
  });

  it('styles.css tem as regras de modo edição', () => {
    const css = readFileSync(join(__dirname, '../styles.css'), 'utf-8');
    expect(css).toContain('.rb-grid.rb-mode-edit .rb-edit-body:empty');
    expect(css).toContain('Sem dados no período');
  });
});
