import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render as rtlRender, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@/store', () => ({
  getPostStatusDefinitions: vi.fn(async () => []),
}));

// Radix's real DropdownMenu only mounts its content once open, which needs
// pointer-event choreography jsdom doesn't reproduce well. Same convention as
// WorkflowCard's tests: render the content unconditionally, but (unlike those)
// keep onClick wired through so the kebab's menu items are actually clickable.
vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({
    children,
    onClick,
    className,
  }: {
    children: React.ReactNode;
    onClick?: (e: React.MouseEvent) => void;
    className?: string;
  }) => (
    <button type="button" role="menuitem" className={className} onClick={onClick}>
      {children}
    </button>
  ),
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

  it('renderiza Voltar/Avançar com aria-label e não propaga o clique ao card', () => {
    const onClick = vi.fn();
    const onForwardClick = vi.fn();
    const onRevertClick = vi.fn();
    render(
      <PostProcessCard
        entity={makeEntity()}
        onClick={onClick}
        onForwardClick={onForwardClick}
        onRevertClick={onRevertClick}
        canRevert
        forwardLabel="Avançar etapa"
        dragHandle={<span data-testid="handle" />}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Avançar etapa' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Voltar etapa' }));
    expect(onForwardClick).toHaveBeenCalledTimes(1);
    expect(onRevertClick).toHaveBeenCalledTimes(1);
    expect(onClick).not.toHaveBeenCalled();
    expect(screen.getByTestId('handle')).toBeInTheDocument();
  });
  it('sem canRevert não mostra Voltar; rótulo "Concluir processo" na última etapa', () => {
    render(
      <PostProcessCard
        entity={makeEntity()}
        onForwardClick={vi.fn()}
        forwardLabel="Concluir processo"
      />,
    );
    expect(screen.queryByRole('button', { name: 'Voltar etapa' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Concluir processo' })).toBeInTheDocument();
  });
  it('sem handlers (leitura) não renderiza botão nenhum: DOM da fase 3', () => {
    render(<PostProcessCard entity={makeEntity()} />);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('card compacto (spec §4): badge "Individual" fica só ícone, e a barra de progresso não mostra "N/total" visível', () => {
    render(<PostProcessCard entity={makeEntity()} />);
    // O texto "Individual" não deve mais existir como nó de texto solto --
    // só o ícone, com o rótulo completo em aria-label/title.
    expect(screen.queryByText('Individual')).toBeNull();
    expect(screen.getByLabelText('Processo individual')).toBeInTheDocument();

    // "N/total" não aparece mais como texto visível; vira tooltip na barra.
    expect(screen.queryByText('1/2')).toBeNull();
    const bar = screen.getByTestId('post-progress-bar');
    expect(bar).toHaveAttribute('title', 'Copy 1/2');
    // ...e o mesmo texto chega ao leitor de tela pelo progressbar, não só pelo
    // title (que AT nenhuma anuncia de forma confiável num <div> genérico).
    expect(bar).toHaveAttribute('role', 'progressbar');
    expect(bar).toHaveAttribute('aria-valuetext', 'Copy 1/2');
  });

  it('kebab: encerrar/excluir só aparecem quando o caller passa o handler', () => {
    const onClick = vi.fn();
    const onRemoveProcessClick = vi.fn();
    const onDeleteClick = vi.fn();
    render(
      <PostProcessCard
        entity={makeEntity()}
        onClick={onClick}
        onRemoveProcessClick={onRemoveProcessClick}
        onDeleteClick={onDeleteClick}
      />,
    );
    fireEvent.click(screen.getByRole('menuitem', { name: 'Encerrar processo' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Excluir post' }));
    expect(onRemoveProcessClick).toHaveBeenCalledTimes(1);
    expect(onDeleteClick).toHaveBeenCalledTimes(1);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('kebab: sem os handlers opcionais, encerrar/excluir não aparecem', () => {
    render(<PostProcessCard entity={makeEntity()} onClick={vi.fn()} />);
    expect(screen.queryByRole('menuitem', { name: 'Encerrar processo' })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: 'Excluir post' })).toBeNull();
  });

  it('kebab: nunca oferece "editar processo" -- essa capacidade não existe (spec §4)', () => {
    render(
      <PostProcessCard
        entity={makeEntity()}
        onClick={vi.fn()}
        onRemoveProcessClick={vi.fn()}
        onDeleteClick={vi.fn()}
      />,
    );
    expect(screen.queryByText(/editar processo/i)).toBeNull();
    // E "Encerrar", nunca "Remover": remove_post_process encerra o processo e
    // preserva o post.
    expect(screen.queryByText(/remover processo/i)).toBeNull();
  });
});
