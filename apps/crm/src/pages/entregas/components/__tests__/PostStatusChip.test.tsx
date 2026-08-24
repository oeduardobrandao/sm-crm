import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { PostStatusDefinition } from '../../../../store';
import { buildStatusRegistry } from '../../statusRegistry';
import { PostStatusChip } from '../PostStatusChip';

const CANONICAL = buildStatusRegistry([]);

function customRegistry(behavesAs: PostStatusDefinition['behaves_as']) {
  return buildStatusRegistry([
    {
      id: '11111111-2222-3333-4444-555555555555',
      conta_id: 'conta-1',
      nome: 'Publicado manualmente',
      cor: '#3ecf8e',
      behaves_as: behavesAs,
      ordem: 0,
      arquivado: false,
    } as PostStatusDefinition,
  ]);
}

describe('PostStatusChip automation tooltip', () => {
  it('explains that a scheduled post publishes on its own', () => {
    const future = new Date(Date.now() + 86_400_000).toISOString();
    render(
      <PostStatusChip post={{ status: 'agendado', scheduled_at: future }} registry={CANONICAL} />,
    );

    expect(screen.getByTitle(/Publica sozinho em/)).toHaveTextContent('Agendado');
  });

  it('explains who moves a post out of enviado_cliente', () => {
    render(<PostStatusChip post={{ status: 'enviado_cliente' }} registry={CANONICAL} />);

    expect(screen.getByTitle(/muda sozinho quando ele aprovar/)).toBeInTheDocument();
  });

  it('leaves the tooltip off statuses where nothing happens automatically', () => {
    const { container } = render(
      <PostStatusChip post={{ status: 'rascunho' }} registry={CANONICAL} />,
    );

    expect(container.querySelector('.post-status-chip')).not.toHaveAttribute('title');
  });

  it('gives a custom status the automation of the canonical it behaves as', () => {
    const registry = customRegistry('postado');
    const { container } = render(
      <PostStatusChip
        post={{ status: 'postado', custom_status_id: '11111111-2222-3333-4444-555555555555' }}
        registry={registry}
      />,
    );

    // postado has no pending automation, so the custom chip carries none either.
    expect(container.querySelector('.post-status-chip')).toHaveTextContent('Publicado manualmente');
    expect(container.querySelector('.post-status-chip')).not.toHaveAttribute('title');
  });

  it('carries the anchor automation when a custom status behaves as enviado_cliente', () => {
    const registry = customRegistry('enviado_cliente');
    render(
      <PostStatusChip
        post={{
          status: 'enviado_cliente',
          custom_status_id: '11111111-2222-3333-4444-555555555555',
        }}
        registry={registry}
      />,
    );

    expect(screen.getByTitle(/muda sozinho quando ele aprovar/)).toHaveTextContent(
      'Publicado manualmente',
    );
  });
});
