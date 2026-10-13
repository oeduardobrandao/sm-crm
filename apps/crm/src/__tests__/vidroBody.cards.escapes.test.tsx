import { render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { VidroToolbarHarness } from '@/test/vidroToolbar';
import { EmptyStateGuide } from '@/components/help/EmptyStateGuide';
import { ModeToggle } from '@/pages/entregas/components/ModeToggle';
import { EntidadeToggle } from '@/pages/entregas/components/EntidadeToggle';
import { PropertyPanel } from '@/pages/entregas/components/PropertyPanel';
import { getPropertyDefinitions } from '../store';

vi.mock('../store', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../store')>()),
  getPropertyDefinitions: vi.fn(),
}));
vi.mock('../pages/entregas/components/PropertyValue', () => ({
  PropertyValue: () => <div>valor</div>,
}));

// Inline-style escapes (spec "Inline-style escapes"): under the Vidro shell the look-defining inline
// style is dropped so cards.css paints the surface; with the shell off the markup is byte-identical.

function wrap(ui: ReactNode, vidroShell: boolean | null) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const body =
    vidroShell === null ? (
      ui
    ) : (
      <VidroToolbarHarness vidroShell={vidroShell}>{ui}</VidroToolbarHarness>
    );
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{body}</MemoryRouter>
    </QueryClientProvider>,
  );
}

const guide = (
  <EmptyStateGuide
    icon="📭"
    title="Nenhum cliente"
    description="Cadastre o primeiro cliente."
    actionLabel="Novo cliente"
    actionHref="/clientes"
    hint="Leva um minuto."
  />
);

describe('EmptyStateGuide under Vidro', () => {
  it('renders the vidro-empty class and drops the border, background and three text colours', () => {
    const { container } = wrap(guide, true);
    const root = container.querySelector('.rounded-xl') as HTMLElement;
    expect(root.className).toBe('rounded-xl px-4 py-5 flex flex-col gap-2 vidro-empty');
    expect(root.getAttribute('style')).toBeNull();
    expect(screen.getByText('Nenhum cliente').getAttribute('style')).toBeNull();
    expect(screen.getByText('Leva um minuto.').getAttribute('style')).toBeNull();
    const body = screen.getByText(/Cadastre o primeiro cliente/);
    expect(body.getAttribute('style')).toBeNull();
    // The action link keeps its ink colour: it would otherwise inherit the body's grey.
    expect(screen.getByRole('link', { name: 'Novo cliente' }).getAttribute('style')).toBe(
      'color: var(--text-main);',
    );
  });

  it.each([
    ['shell off', false],
    ['no provider', null],
  ] as const)('keeps the classic markup (%s)', (_, shell) => {
    const { container } = wrap(guide, shell);
    const root = container.querySelector('.rounded-xl') as HTMLElement;
    expect(root.className).toBe('rounded-xl px-4 py-5 flex flex-col gap-2');
    expect(root.getAttribute('style')).toBe(
      'border: 1px solid var(--border-color); background: var(--surface-hover);',
    );
    expect(screen.getByText('Nenhum cliente').getAttribute('style')).toBe(
      'color: var(--text-main);',
    );
    expect(screen.getByText(/Cadastre o primeiro cliente/).getAttribute('style')).toBe(
      'color: var(--text-muted);',
    );
    expect(screen.getByText('Leva um minuto.').getAttribute('style')).toBe(
      'color: var(--text-light);',
    );
  });
});

const TOGGLE_CLASSIC =
  'display: flex; gap: 0.25rem; background: var(--card-bg); border: 1px solid var(--border-color); padding: 0.25rem; border-radius: 8px; width: fit-content;';

describe('Entregas ModeToggle / EntidadeToggle under Vidro', () => {
  const mode = (shell: boolean) => {
    wrap(<ModeToggle mode="entregas" onModeChange={() => {}} />, shell);
    return screen.getByRole('button', { name: 'Etapas' }).parentElement as HTMLElement;
  };
  const entidade = (shell: boolean) => {
    wrap(<EntidadeToggle value="todos" onChange={() => {}} />, shell);
    return screen.getByRole('radiogroup', { name: 'Entidades do quadro' });
  };

  // Under the shell both toggles join the skin's segmented capsule via the toggle-group data-slot
  // hooks and carry no inline style at all (inline styles would beat the skin).
  const expectCapsule = (group: HTMLElement, selected: string) => {
    expect(group.getAttribute('data-slot')).toBe('toggle-group');
    expect(group.hasAttribute('style')).toBe(false);
    const items = within(group).getAllByRole(
      group.getAttribute('role') === 'radiogroup' ? 'radio' : 'button',
    );
    for (const item of items) {
      expect(item.getAttribute('data-slot')).toBe('toggle-group-item');
      expect(item.hasAttribute('style')).toBe(false);
      expect(item.getAttribute('data-state')).toBe(item.textContent === selected ? 'on' : 'off');
    }
  };

  it('ModeToggle renders as the Vidro segmented capsule under the shell', () => {
    const group = mode(true);
    expectCapsule(group, 'Etapas');
    expect(screen.getByRole('button', { name: 'Etapas' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
  });

  it('ModeToggle keeps its inline style byte-identical with the shell off', () => {
    expect(mode(false).getAttribute('style')).toBe(TOGGLE_CLASSIC);
  });

  it('EntidadeToggle renders as the Vidro segmented capsule under the shell', () => {
    expectCapsule(entidade(true), 'Todos');
    expect(screen.getByRole('radio', { name: 'Todos' }).getAttribute('aria-checked')).toBe('true');
  });

  it('EntidadeToggle keeps its inline style byte-identical with the shell off', () => {
    expect(entidade(false).getAttribute('style')).toBe(TOGGLE_CLASSIC);
  });
});

describe('Entregas PropertyPanel under Vidro', () => {
  beforeEach(() => {
    vi.mocked(getPropertyDefinitions).mockResolvedValue([
      { id: 1, name: 'Canal', type: 'text' },
    ] as Awaited<ReturnType<typeof getPropertyDefinitions>>);
  });

  const panel = async (shell: boolean) => {
    wrap(
      <PropertyPanel templateId={7} postId={1} workflowId={2} propertyValues={[]} membros={[]} />,
      shell,
    );
    return (await screen.findByText('Propriedades')).parentElement as HTMLElement;
  };

  it('drops only the inline background under the shell', async () => {
    expect((await panel(true)).getAttribute('style')).toBe(
      'border: 1px solid var(--border-color); border-radius: 8px; padding: 10px 12px; margin-bottom: 4px;',
    );
  });

  it('keeps its inline style byte-identical with the shell off', async () => {
    expect((await panel(false)).getAttribute('style')).toBe(
      'background: var(--card-bg); border: 1px solid var(--border-color); border-radius: 8px; padding: 10px 12px; margin-bottom: 4px;',
    );
  });
});
