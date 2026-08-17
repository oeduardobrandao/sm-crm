import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { WorkflowPost } from '../../../../store';

vi.mock('../../../../services/instagram', () => ({
  retryInstagramPublish: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import { PublishErrorBlock } from '../PublishErrorBlock';

// Copied from ScheduleButton.test.tsx:44-58.
function makePost(overrides?: Partial<WorkflowPost>): WorkflowPost {
  return {
    id: 1,
    workflow_id: 10,
    titulo: 'Test Post',
    conteudo: null,
    conteudo_plain: '',
    tipo: 'feed',
    ordem: 0,
    status: 'aprovado_cliente',
    scheduled_at: '2026-12-01T10:00:00Z',
    ig_caption: 'Test caption #hashtag',
    ...overrides,
  };
}

describe('PublishErrorBlock', () => {
  it('TOKEN_EXPIRED: mostra copy e link de reconexão para /clientes/:id/redes-sociais', () => {
    render(
      <MemoryRouter>
        <PublishErrorBlock
          post={makePost({
            status: 'falha_publicacao',
            publish_error_code: 'TOKEN_EXPIRED',
            publish_error: 'raw',
          })}
          clienteId={42}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText('Conexão com o Instagram expirou')).toBeTruthy();
    const link = screen.getByRole('link', { name: /reconectar instagram/i });
    expect(link.getAttribute('href')).toBe('/clientes/42/redes-sociais');
    expect(screen.queryByText('raw')).toBeNull(); // mostrarDetalhes: false
  });

  it('IG_TRANSIENT: mostra botão tentar novamente e detalhes técnicos', () => {
    render(
      <MemoryRouter>
        <PublishErrorBlock
          post={makePost({
            status: 'falha_publicacao',
            publish_error_code: 'IG_TRANSIENT',
            publish_error: 'An unexpected error has occurred',
          })}
          clienteId={42}
        />
      </MemoryRouter>,
    );
    expect(screen.getByRole('button', { name: /tentar novamente/i })).toBeTruthy();
    fireEvent.click(screen.getByText(/detalhes técnicos/i));
    expect(screen.getByText('An unexpected error has occurred')).toBeTruthy();
  });

  it('INTERNAL: sem botão e sem detalhes técnicos', () => {
    render(
      <MemoryRouter>
        <PublishErrorBlock
          post={makePost({
            status: 'falha_publicacao',
            publish_error_code: 'INTERNAL',
            publish_error: 'Tag length overflows ciphertext',
          })}
          clienteId={42}
        />
      </MemoryRouter>,
    );
    expect(screen.queryByRole('button', { name: /tentar novamente/i })).toBeNull();
    expect(screen.queryByText(/detalhes técnicos/i)).toBeNull();
    expect(screen.queryByText('Tag length overflows ciphertext')).toBeNull();
  });
});
