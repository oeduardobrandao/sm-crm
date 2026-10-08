import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DestinationChips, DestinationStatusPill } from '../DestinationStatusPill';

const post = {
  status: 'aprovado_cliente' as const,
  scheduled_at: null,
  instagram_media_id: 'm1',
  publish_error: null,
  tiktok_publish_status: null,
};

describe('DestinationStatusPill', () => {
  it('names platform and state for assistive tech', () => {
    render(<DestinationStatusPill platform="instagram" state="publicado" />);
    expect(screen.getByLabelText('Instagram: Publicado')).toHaveTextContent('Publicado');
  });

  it('can hide the label of a pending destination (icon only)', () => {
    render(<DestinationStatusPill platform="geral" state="pendente" hideLabelWhenPending />);
    expect(screen.getByLabelText('Geral: Pendente')).not.toHaveTextContent('Pendente');
  });
});

describe('DestinationChips', () => {
  it('one chip per destination, in registry order', () => {
    render(
      <DestinationChips
        post={{
          ...post,
          targets: [
            { platform: 'geral', status: 'pendente' },
            { platform: 'instagram', status: 'pendente' },
          ],
        }}
      />,
    );
    const chips = screen.getAllByLabelText(/: /);
    expect(chips.map((c) => c.getAttribute('aria-label'))).toEqual([
      'Instagram: Publicado',
      'Geral: Disponível',
    ]);
  });

  it('renders nothing without targets', () => {
    const { container } = render(<DestinationChips post={post} />);
    expect(container).toBeEmptyDOMElement();
  });
});
