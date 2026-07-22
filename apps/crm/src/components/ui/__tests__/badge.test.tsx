import { readFileSync } from 'node:fs';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Badge } from '../badge';

const css = readFileSync('apps/crm/style.css', 'utf8');

const VARIANTS = ['neutral', 'success', 'warning', 'danger', 'info', 'primary', 'outline'] as const;

describe('Badge', () => {
  it('renders the shared .badge pill with the neutral variant by default', () => {
    render(<Badge>Ativo</Badge>);
    const el = screen.getByText('Ativo');
    expect(el.tagName).toBe('SPAN');
    expect(el).toHaveClass('badge', 'badge-neutral');
  });

  it.each(VARIANTS)('emits a badge-%s class that style.css actually defines', (variant) => {
    render(<Badge variant={variant}>{variant}</Badge>);
    expect(screen.getByText(variant)).toHaveClass(`badge-${variant}`);
    expect(css).toContain(`.badge-${variant} {`);
  });

  it('applies the solid tone and size modifiers', () => {
    render(
      <Badge variant="danger" tone="solid" size="sm">
        Vencido
      </Badge>,
    );
    const el = screen.getByText('Vencido');
    expect(el).toHaveClass('badge', 'badge-danger', 'badge--solid', 'badge--sm');
    expect(css).toContain('.badge--solid {');
    expect(css).toContain('.badge--sm {');
  });

  it('adds no modifier class for the default soft tone and md size', () => {
    render(
      <Badge tone="soft" size="md">
        Rascunho
      </Badge>,
    );
    expect(screen.getByText('Rascunho').className).toBe('badge badge-neutral');
  });

  it('keeps the legacy shadcn variant names mapped onto the new palette', () => {
    render(
      <>
        <Badge variant="default">a</Badge>
        <Badge variant="secondary">b</Badge>
        <Badge variant="destructive">c</Badge>
      </>,
    );
    expect(screen.getByText('a')).toHaveClass('badge-primary');
    expect(screen.getByText('b')).toHaveClass('badge-neutral');
    expect(screen.getByText('c')).toHaveClass('badge-danger');
  });

  it('merges a caller-supplied className', () => {
    render(<Badge className="shrink-0">Pronto</Badge>);
    expect(screen.getByText('Pronto')).toHaveClass('badge', 'badge-neutral', 'shrink-0');
  });

  it('shares its shape rule with the post status chips', () => {
    expect(css).toMatch(/\.badge,\s*\.post-tipo-badge,\s*\.post-status-chip\s*\{/);
  });
});
