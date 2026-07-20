import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { Cliente, Membro, WorkflowTemplate } from '../../../../store';

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/components/ui/button', () => ({
  // The real alert-dialog primitives style themselves with `buttonVariants`, so the mock must
  // keep that export alive — the AlertDialog itself stays real.
  buttonVariants: () => '',
  Button: ({
    children,
    type = 'button',
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type={type} {...props}>
      {children}
    </button>
  ),
}));

vi.mock('@/components/ui/input', () => ({
  Input: React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
    (props, ref) => <input ref={ref} {...props} />,
  ),
}));

vi.mock('@/components/ui/label', () => ({
  Label: ({ children, htmlFor, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) => (
    <label htmlFor={htmlFor} {...props}>
      {children}
    </label>
  ),
}));

vi.mock('@/components/ui/spinner', () => ({
  Spinner: ({ size }: { size?: string }) => <div>Spinner {size}</div>,
}));

// The wizard's Selects are label-associated (`<Label htmlFor>` + `<SelectTrigger id>`), so the
// mock renders a real `<select>` carrying the trigger's props — that keeps `getByLabelText` and
// `fireEvent.change` honest instead of testing a bespoke button list.
vi.mock('@/components/ui/select', async () => {
  const ReactModule = await vi.importActual<typeof import('react')>('react');

  function SelectTrigger({ children }: { children?: React.ReactNode; id?: string }) {
    return <>{children}</>;
  }
  function SelectValue(_props: { placeholder?: string }) {
    return null;
  }
  function SelectContent({ children }: { children?: React.ReactNode }) {
    return <>{children}</>;
  }
  function SelectItem({ children }: { value: string; children?: React.ReactNode }) {
    return <>{children}</>;
  }

  function walk(node: React.ReactNode, visit: (el: React.ReactElement) => void) {
    ReactModule.Children.forEach(node, (child) => {
      if (!ReactModule.isValidElement(child)) return;
      visit(child);
      walk((child.props as { children?: React.ReactNode }).children, visit);
    });
  }

  function Select({
    value,
    onValueChange,
    children,
  }: {
    value?: string;
    onValueChange?: (value: string) => void;
    children?: React.ReactNode;
  }) {
    const options: Array<{ value: string; label: React.ReactNode }> = [];
    let triggerProps: Record<string, unknown> = {};
    walk(children, (el) => {
      if (el.type === SelectItem) {
        const props = el.props as { value: string; children?: React.ReactNode };
        options.push({ value: props.value, label: props.children });
      }
      if (el.type === SelectTrigger) {
        const { children: _children, ...rest } = el.props as Record<string, unknown>;
        triggerProps = rest;
      }
    });
    return (
      <select
        {...triggerProps}
        value={value ?? ''}
        onChange={(event) => onValueChange?.(event.target.value)}
      >
        <option value="" />
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    );
  }

  return { Select, SelectTrigger, SelectValue, SelectContent, SelectItem };
});

// `Dialog` stays REAL so the close paths exercise the unsaved-changes guard in dialog.tsx.
import { NewWorkflowWizard } from '../NewWorkflowWizard';

const clientes = [
  { id: 1, nome: 'Aurora', status: 'ativo', dia_entrega: 25 },
  { id: 2, nome: 'Borealis', status: 'ativo' },
  { id: 3, nome: 'Encerrado', status: 'encerrado' },
] as Cliente[];

const membros = [{ id: 9, nome: 'Ana' }] as Membro[];

// Step 3 needs a couple of members so the bulk-assign control has something to pick.
const equipe = [
  { id: 7, nome: 'Maria' },
  { id: 8, nome: 'Bruno' },
] as Membro[];

const templates = [
  {
    id: 12,
    nome: 'Fluxo Padrão de Post',
    modo_prazo: 'padrao',
    etapas: [
      {
        nome: 'Briefing',
        prazo_dias: 2,
        tipo_prazo: 'corridos',
        responsavel_id: 9,
        tipo: 'padrao',
      },
      {
        nome: 'Aprovação do cliente',
        prazo_dias: 3,
        tipo_prazo: 'corridos',
        responsavel_id: 9,
        tipo: 'aprovacao_cliente',
      },
    ],
  },
] as WorkflowTemplate[];

// A template saved before the member was removed from the team: responsavel_id points nowhere.
const staleTemplates = [
  {
    id: 44,
    nome: 'Fluxo com responsável antigo',
    modo_prazo: 'padrao',
    etapas: [
      {
        nome: 'Briefing',
        prazo_dias: 2,
        tipo_prazo: 'corridos',
        responsavel_id: 999,
        tipo: 'padrao',
      },
    ],
  },
] as WorkflowTemplate[];

function renderWizard(
  overrides: Partial<React.ComponentProps<typeof NewWorkflowWizard>> = {},
): ReturnType<typeof render> {
  return render(
    <NewWorkflowWizard
      open={true}
      onClose={vi.fn()}
      clientes={clientes}
      membros={membros}
      templates={templates}
      onCreated={vi.fn()}
      {...overrides}
    />,
  );
}

describe('NewWorkflowWizard — step 1 (galeria)', () => {
  it('renders the six presets, saved templates and começar do zero', () => {
    renderWizard();
    expect(screen.getByText('Posts mensais')).toBeTruthy();
    expect(screen.getByText('Aprovação dupla (texto + arte)')).toBeTruthy();
    expect(screen.getByText('Reels / vídeo')).toBeTruthy();
    expect(screen.getByText('Campanha / lançamento')).toBeTruthy();
    expect(screen.getByText('Post avulso rápido')).toBeTruthy();
    expect(screen.getByText('Identidade / branding')).toBeTruthy();
    expect(screen.getByText('Começar do zero')).toBeTruthy();
    expect(screen.getByText('Fluxo Padrão de Post')).toBeTruthy();
  });

  it('selecting a preset advances to step 2 with prefilled name/recorrente', () => {
    renderWizard();
    fireEvent.click(screen.getByText('Posts mensais'));
    expect(screen.getByText('O básico')).toBeTruthy();
    const nome = screen.getByLabelText(/nome do fluxo/i) as HTMLInputElement;
    expect(nome.value).toMatch(/^Posts mensais — /);
    expect(screen.getByRole('switch', { name: /recorrente/i }).getAttribute('aria-checked')).toBe(
      'true',
    );
  });

  it('account-template selection does NOT set recorrente', () => {
    renderWizard();
    fireEvent.click(screen.getByText('Fluxo Padrão de Post'));
    const toggle = screen.getByRole('switch', { name: /recorrente/i });
    expect(toggle.getAttribute('aria-checked')).toBe('false');
  });

  it('switching source preserves a user-edited nome', () => {
    renderWizard();
    fireEvent.click(screen.getByText('Posts mensais'));
    fireEvent.change(screen.getByLabelText(/nome do fluxo/i), { target: { value: 'Meu nome' } });
    fireEvent.click(screen.getByText('← Voltar'));
    fireEvent.click(screen.getByText('Post avulso rápido'));
    // The source really switched...
    expect(screen.getByText('Novo Fluxo · Post avulso rápido')).toBeTruthy();
    // ...and non-nome fields ARE overwritten by the new source: Posts mensais is recorrente,
    // Post avulso rápido is not, so the switch must have flipped back to false.
    expect(screen.getByRole('switch', { name: /recorrente/i }).getAttribute('aria-checked')).toBe(
      'false',
    );
    // ...but the name the user typed survives it.
    expect((screen.getByLabelText(/nome do fluxo/i) as HTMLInputElement).value).toBe('Meu nome');
    // ...and the etapas were replaced by the new source's, not merged with the old ones.
    fireEvent.change(screen.getByLabelText(/cliente/i), { target: { value: '1' } });
    fireEvent.click(screen.getByText('Continuar →'));
    expect(screen.getByDisplayValue('Publicação')).toBeTruthy(); // Post avulso rápido
    expect(screen.queryByDisplayValue('Ajustes')).toBeNull(); // Posts mensais, gone
  });

  it('Cancelar with progress asks for confirmation; onClose fires only after confirm', () => {
    const onClose = vi.fn();
    renderWizard({ onClose });
    fireEvent.click(screen.getByText('Posts mensais')); // dirty now
    fireEvent.click(screen.getByText('Cancelar'));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText('Fechar sem salvar?')).toBeTruthy();
    fireEvent.click(screen.getByText('Fechar mesmo assim'));
    expect(onClose).toHaveBeenCalled();
  });

  it('clean wizard closes without confirmation', () => {
    const onClose = vi.fn();
    renderWizard({ onClose });
    fireEvent.click(screen.getByText('Cancelar'));
    expect(onClose).toHaveBeenCalled();
  });

  it('the dialog X on a dirty wizard routes through the unsaved-changes guard', () => {
    const onClose = vi.fn();
    renderWizard({ onClose });
    fireEvent.click(screen.getByText('Posts mensais'));
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Fechar mesmo assim'));
    expect(onClose).toHaveBeenCalled();
  });
});

describe('NewWorkflowWizard — step 2 (o básico)', () => {
  it('blocks Continuar until cliente and nome are set', () => {
    renderWizard();
    fireEvent.click(screen.getByText('Começar do zero'));
    expect((screen.getByText('Continuar →') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/cliente/i), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText(/nome do fluxo/i), { target: { value: 'Meu fluxo' } });
    expect((screen.getByText('Continuar →') as HTMLButtonElement).disabled).toBe(false);
  });

  it('lists only active clients, sorted pt-BR', () => {
    renderWizard();
    fireEvent.click(screen.getByText('Começar do zero'));
    const options = Array.from(
      (screen.getByLabelText(/cliente/i) as HTMLSelectElement).options,
    ).map((o) => o.textContent);
    expect(options).toEqual(['', 'Aurora', 'Borealis']);
  });

  it('toggling recorrente flips aria-checked', () => {
    renderWizard();
    fireEvent.click(screen.getByText('Começar do zero'));
    const toggle = screen.getByRole('switch', { name: /recorrente/i });
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(toggle);
    expect(screen.getByRole('switch', { name: /recorrente/i }).getAttribute('aria-checked')).toBe(
      'true',
    );
  });
});

/** Preset "Posts mensais" → step 2 → fill cliente (nome is prefilled) → step 3. */
function renderWizardAtStep3(): void {
  renderWizard({ membros: equipe });
  fireEvent.click(screen.getByText('Posts mensais'));
  fireEvent.change(screen.getByLabelText(/cliente/i), { target: { value: '1' } });
  fireEvent.click(screen.getByText('Continuar →'));
}

/** Same, but sourced from a template whose responsável no longer exists. */
function renderWizardAtStep3ViaTemplate(): void {
  renderWizard({ membros: equipe, templates: staleTemplates });
  fireEvent.click(screen.getByText('Fluxo com responsável antigo'));
  fireEvent.change(screen.getByLabelText(/cliente/i), { target: { value: '1' } });
  fireEvent.click(screen.getByText('Continuar →'));
}

describe('NewWorkflowWizard — step 3 (etapas)', () => {
  it('starts with the source etapas and the matching chips pressed', () => {
    renderWizardAtStep3();
    expect(screen.getAllByPlaceholderText('Nome da etapa')).toHaveLength(5);
    expect(screen.getByRole('button', { name: /^✓ Criação$/ }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    // A suggestion the preset does not use stays unpressed.
    expect(screen.getByRole('button', { name: /^Briefing$/ }).getAttribute('aria-pressed')).toBe(
      'false',
    );
  });

  it('an unpressed chip adds its etapa', () => {
    renderWizardAtStep3();
    fireEvent.click(screen.getByRole('button', { name: /^Briefing$/ }));
    expect(screen.getByDisplayValue('Briefing')).toBeTruthy();
    expect(screen.getAllByPlaceholderText('Nome da etapa')).toHaveLength(6);
  });

  it('chips add and remove etapas by suggestionId even after rename', () => {
    renderWizardAtStep3();
    // 'Criação' came from the preset bound to suggestionId 'criacao' → chip pressed.
    const chip = screen.getByRole('button', { name: /^✓ Criação$/ });
    // Rename the row FIRST: if removal matched on nome instead of suggestionId, the renamed
    // row would survive the toggle.
    const nameInputs = screen.getAllByPlaceholderText('Nome da etapa');
    fireEvent.change(nameInputs[0], { target: { value: 'Criação renomeada' } });
    expect(screen.getByDisplayValue('Criação renomeada')).toBeTruthy();
    fireEvent.click(chip);
    expect(screen.queryByDisplayValue('Criação renomeada')).toBeNull();
    expect(screen.getAllByPlaceholderText('Nome da etapa')).toHaveLength(4);
    expect(screen.getByRole('button', { name: /^Criação$/ }).getAttribute('aria-pressed')).toBe(
      'false',
    );
  });

  it('＋ Personalizada appends an empty row', () => {
    renderWizardAtStep3();
    fireEvent.click(screen.getByText('＋ Personalizada'));
    const inputs = screen.getAllByPlaceholderText('Nome da etapa') as HTMLInputElement[];
    expect(inputs).toHaveLength(6);
    expect(inputs[5].value).toBe('');
  });

  it('bulk assign sets responsável on every etapa', () => {
    renderWizardAtStep3();
    fireEvent.change(screen.getByLabelText(/atribuir todas a/i), { target: { value: '7' } });
    const rowSelects = screen.getAllByDisplayValue('Maria');
    expect(rowSelects.length).toBeGreaterThanOrEqual(5);
  });

  it('advances once every etapa has an existing responsável', () => {
    renderWizardAtStep3();
    fireEvent.change(screen.getByLabelText(/atribuir todas a/i), { target: { value: '7' } });
    fireEvent.click(screen.getByText('Continuar →'));
    expect(screen.queryByText('As etapas')).toBeNull(); // left step 3
  });

  it('a missing responsável blocks with an inline row error', () => {
    renderWizardAtStep3();
    fireEvent.click(screen.getByText('Continuar →'));
    expect(screen.getAllByText('Selecione um responsável para esta etapa.')).toHaveLength(5);
    expect(screen.getByText('As etapas')).toBeTruthy(); // did not advance
  });

  it('clears a row error as soon as the row is fixed', () => {
    renderWizardAtStep3();
    fireEvent.click(screen.getByText('Continuar →'));
    expect(screen.getAllByText('Selecione um responsável para esta etapa.')).toHaveLength(5);
    fireEvent.change(screen.getByLabelText(/atribuir todas a/i), { target: { value: '7' } });
    expect(screen.queryByText('Selecione um responsável para esta etapa.')).toBeNull();
  });

  it('an empty etapa list blocks with a global error', () => {
    renderWizardAtStep3();
    // Toggle every chip the preset pressed back off, emptying the list. (Queried one at a time
    // and by exact name: the approval ROW also carries a '✓ Aprovação externa' pill.)
    for (const nome of [
      'Criação',
      'Revisão interna',
      'Aprovação do cliente',
      'Ajustes',
      'Agendamento',
    ]) {
      fireEvent.click(screen.getByRole('button', { name: `✓ ${nome}` }));
    }
    expect(screen.queryAllByPlaceholderText('Nome da etapa')).toHaveLength(0);
    fireEvent.click(screen.getByText('Continuar →'));
    expect(screen.getByText('Adicione pelo menos uma etapa.')).toBeTruthy();
    expect(screen.getByText('As etapas')).toBeTruthy(); // did not advance
  });

  it('with no membros, swaps the bulk control for the prerequisite alert', () => {
    // PrerequisiteAlert (and the row-level EmptyStateGuide) render react-router <Link>s, so this
    // one render needs a router — the other step-3 tests have membros and never hit that branch.
    render(
      <MemoryRouter>
        <NewWorkflowWizard
          open={true}
          onClose={vi.fn()}
          clientes={clientes}
          membros={[]}
          templates={templates}
          onCreated={vi.fn()}
        />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByText('Posts mensais'));
    fireEvent.change(screen.getByLabelText(/cliente/i), { target: { value: '1' } });
    fireEvent.click(screen.getByText('Continuar →'));
    expect(screen.getByText('As etapas')).toBeTruthy();
    expect(screen.queryByLabelText(/atribuir todas a/i)).toBeNull();
    expect(screen.getAllByText('Nenhum membro cadastrado').length).toBeGreaterThan(0);
  });

  it('stale template responsável blocks with inline row error', () => {
    renderWizardAtStep3ViaTemplate();
    fireEvent.click(screen.getByText('Continuar →'));
    expect(screen.getByText(/não existe mais/i)).toBeTruthy();
    expect(screen.getByText('As etapas')).toBeTruthy(); // did not advance
  });
});
