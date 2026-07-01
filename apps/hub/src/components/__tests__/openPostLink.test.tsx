import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { HubContext } from '../../HubContext';
import { OpenPostLink } from '../OpenPostLink';

const hubValue = {
  bootstrap: { workspace: { name: 'Mesaas' } },
  token: 'token-publico',
  workspace: 'mesaas',
} as never;

describe('OpenPostLink', () => {
  it('renders a new-tab link to the focused post view', () => {
    render(
      <HubContext.Provider value={hubValue}>
        <OpenPostLink postId={42} />
      </HubContext.Provider>,
    );
    const link = screen.getByRole('link', { name: /abrir/i });
    expect(link).toHaveAttribute('href', '/mesaas/hub/token-publico/postagens/42');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noreferrer');
  });
});
