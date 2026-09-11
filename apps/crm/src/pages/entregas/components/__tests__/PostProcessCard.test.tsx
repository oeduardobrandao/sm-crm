import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render as rtlRender, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@/store', () => ({
  getPostStatusDefinitions: vi.fn(async () => []),
}));

import { PostProcessCard } from '../PostProcessCard';
import type { PostEntity } from '../../boardEntity';

function render(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return rtlRender(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

const steps = [
  { ordem: 0, nome: 'Copy', tipo: 'padrao' as const },
  { ordem: 1, nome: 'Design', tipo: 'padrao' as const },
];

/** A step whose prazo_dias (<= 3) would read as "caution" through
 *  deadlineFromPrazoEfetivo's fallback -- exactly the config that exposed the
 *  bug: an etapa not yet started (no prazo_efetivo) still has a low
 *  prazo_dias, and the fallback fills diasRestantes with it. */
function makeEntity(overrides: Partial<PostEntity> = {}): PostEntity {
  return {
    kind: 'post',
    id: 'post:9',
    process: {
      id: 9,
      post_id: 109,
      post: {
        id: 109,
        tipo: 'feed',
        cliente_nome: 'Aurora',
        status: 'rascunho',
      },
    } as never,
    step: { ordem: 0 } as never,
    templateId: 7,
    steps,
    etapaOrdem: 0,
    etapaNome: 'Copy',
    responsavel: undefined,
    prazoEfetivo: null,
    posicao: 0,
    deadline: { diasRestantes: 2, horasRestantes: 0, estourado: false, urgente: false },
    cliente: undefined,
    titulo: 'Post X',
    ...overrides,
  } as PostEntity;
}

describe('PostProcessCard', () => {
  it('sem prazo efetivo: barra de progresso usa o verde de "sem prazo", não o âmbar de caution', () => {
    // dl.diasRestantes (2) <= 3 would compute 'deadline-caution' unconditionally
    // if the accent ignored hasDeadline, even though prazoEfetivo is null and
    // the pill/border correctly show "Sem prazo" / deadline-ok.
    const entity = makeEntity({ prazoEfetivo: null });
    render(<PostProcessCard entity={entity} />);

    expect(screen.getByText('Sem prazo')).toBeInTheDocument();
    const card = screen.getByTestId('post-process-card');
    expect(card.className).toContain('deadline-ok');
    expect(card.className).not.toContain('deadline-caution');

    const bar = card.querySelector('div[style*="width: 0%"]') as HTMLElement | null;
    expect(bar).toBeTruthy();
    expect(bar!.style.background).toBe('rgb(62, 207, 142)'); // #3ecf8e, same fallback as deadline-ok elsewhere
  });

  it('com prazo efetivo vencendo em breve: barra de progresso usa o âmbar de caution', () => {
    const entity = makeEntity({ prazoEfetivo: new Date('2026-01-01T00:00:00.000Z') });
    render(<PostProcessCard entity={entity} />);

    const card = screen.getByTestId('post-process-card');
    expect(card.className).toContain('deadline-caution');
    const bar = card.querySelector('div[style*="width: 0%"]') as HTMLElement | null;
    expect(bar).toBeTruthy();
    expect(bar!.style.background).toBe('rgb(234, 179, 8)'); // #eab308, deadline-caution accent
  });
});
