import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Cliente, Membro, WorkflowTemplate } from '../../../../store';

// jsdom has no scrollIntoView; adding an etapa scrolls the new row into view.
(Element.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = () => {};

// sonner 2.x really does expose `toast.warning`, so the template-failure path asserts against it
// rather than falling back to `toast.error`.
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  },
}));

vi.mock('@/lib/analytics', () => ({ captureEvent: vi.fn() }));

// Only the network-touching entry point is replaced: `resolveDeliveryDate` stays real so the date
// the review step prints is the same one the creation path would write.
const createWorkflowFromWizardMock = vi.hoisted(() => vi.fn());
vi.mock('../createWorkflow', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../createWorkflow')>()),
  createWorkflowFromWizard: createWorkflowFromWizardMock,
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
import { toast } from 'sonner';
import { captureEvent } from '@/lib/analytics';
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

  it('＋ Personalizada appends an empty row and focuses its name input', () => {
    renderWizardAtStep3();
    fireEvent.click(screen.getByText('＋ Personalizada'));
    const inputs = screen.getAllByPlaceholderText('Nome da etapa') as HTMLInputElement[];
    expect(inputs).toHaveLength(6);
    expect(inputs[5].value).toBe('');
    expect(document.activeElement).toBe(inputs[5]);
  });

  it('a second ＋ Personalizada click re-focuses the empty row instead of adding another', () => {
    renderWizardAtStep3();
    fireEvent.click(screen.getByText('＋ Personalizada'));
    fireEvent.click(screen.getByText('＋ Personalizada'));
    const inputs = screen.getAllByPlaceholderText('Nome da etapa') as HTMLInputElement[];
    expect(inputs).toHaveLength(6); // still one custom row, not two
    expect(document.activeElement).toBe(inputs[5]);
    // Naming the row disarms the guard: the next click adds a fresh empty row.
    fireEvent.change(inputs[5], { target: { value: 'Minha etapa' } });
    fireEvent.click(screen.getByText('＋ Personalizada'));
    expect(screen.getAllByPlaceholderText('Nome da etapa')).toHaveLength(7);
  });

  it('shows the etapa count in the list heading', () => {
    renderWizardAtStep3();
    expect(screen.getByText('Etapas · 5')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^Briefing$/ }));
    expect(screen.getByText('Etapas · 6')).toBeTruthy();
  });

  it('numbers the rows so the order is readable at a glance', () => {
    renderWizardAtStep3();
    expect(screen.getByText('1.')).toBeTruthy();
    expect(screen.getByText('5.')).toBeTruthy();
    expect(screen.queryByText('6.')).toBeNull();
  });

  it('bulk assign sets responsável on every etapa', () => {
    renderWizardAtStep3();
    fireEvent.change(screen.getByLabelText(/atribuir todas a/i), { target: { value: '7' } });
    // Scoped to the per-row selects on purpose: the bulk control itself also displays 'Maria', so
    // a total-count assertion would state the intent ("every row got Maria") only indirectly.
    const rowSelects = screen
      .getAllByDisplayValue('Maria')
      .filter((el) => el.id !== 'wizard-bulk-responsavel');
    expect(screen.getAllByPlaceholderText('Nome da etapa')).toHaveLength(5);
    expect(rowSelects).toHaveLength(5);
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
    // and by exact name: the approval ROW also carries an icon toggle whose accessible name is
    // 'Aprovação externa'.)
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

  it('going back clears the errors, so step 3 is clean on re-arrival', () => {
    renderWizardAtStep3();
    fireEvent.click(screen.getByText('Continuar →')); // blocked: nothing is assigned
    expect(screen.getAllByText('Selecione um responsável para esta etapa.')).toHaveLength(5);
    fireEvent.click(screen.getByText('← Voltar')); // step 2
    fireEvent.click(screen.getByText('Continuar →')); // back to step 3
    expect(screen.getByText('As etapas')).toBeTruthy();
    expect(screen.queryByText('Selecione um responsável para esta etapa.')).toBeNull();
  });

  it('does not carry errors from one source onto the next source etapas', () => {
    renderWizardAtStep3();
    fireEvent.click(screen.getByText('Continuar →')); // blocked at step 3
    expect(screen.getAllByText('Selecione um responsável para esta etapa.')).toHaveLength(5);
    fireEvent.click(screen.getByText('← Voltar')); // step 2
    fireEvent.click(screen.getByText('← Voltar')); // step 1
    fireEvent.click(screen.getByText('Post avulso rápido')); // brand-new etapas
    fireEvent.click(screen.getByText('Continuar →')); // step 3
    expect(screen.getByDisplayValue('Publicação')).toBeTruthy(); // the new source's etapas
    expect(screen.queryByText('Selecione um responsável para esta etapa.')).toBeNull();
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

  it('lights the "Aprovação do cliente" chip for an approval etapa under any name', () => {
    // The dupla preset's approvals are "Aprovação do texto" / "Aprovação da arte" — names that do
    // not match the suggestion, but they ARE client-approval etapas, so the chip must read active.
    renderWizard({ membros: equipe });
    fireEvent.click(screen.getByText('Aprovação dupla (texto + arte)'));
    fireEvent.change(screen.getByLabelText(/cliente/i), { target: { value: '1' } });
    fireEvent.click(screen.getByText('Continuar →'));
    expect(
      screen.getByRole('button', { name: /Aprovação do cliente/ }).getAttribute('aria-pressed'),
    ).toBe('true');
  });

  it('the top chip reflects a row-level "Aprovação externa" toggle', () => {
    renderWizard({ membros: equipe });
    fireEvent.click(screen.getByText('Post avulso rápido')); // preset has no approval etapa
    fireEvent.change(screen.getByLabelText(/cliente/i), { target: { value: '1' } });
    fireEvent.click(screen.getByText('Continuar →'));
    const chip = screen.getByRole('button', { name: /Aprovação do cliente/ });
    expect(chip.getAttribute('aria-pressed')).toBe('false');
    // Promote a row to client-approval via its own pill — the top chip must follow.
    fireEvent.click(screen.getAllByRole('button', { name: 'Aprovação externa' })[0]);
    expect(chip.getAttribute('aria-pressed')).toBe('true');
  });

  it('toggling the "Aprovação do cliente" chip off clears every approval etapa', () => {
    renderWizard({ membros: equipe });
    fireEvent.click(screen.getByText('Aprovação dupla (texto + arte)'));
    fireEvent.change(screen.getByLabelText(/cliente/i), { target: { value: '1' } });
    fireEvent.click(screen.getByText('Continuar →'));
    expect(screen.getByDisplayValue('Aprovação do texto')).toBeTruthy();
    expect(screen.getByDisplayValue('Aprovação da arte')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Aprovação do cliente/ }));
    expect(screen.queryByDisplayValue('Aprovação do texto')).toBeNull();
    expect(screen.queryByDisplayValue('Aprovação da arte')).toBeNull();
  });
});

// Steps 4–5 render react-router <Link>s (the "Configurar dia de entrega" shortcut), so these
// renders need a router — the earlier steps never reach that branch.
function renderWizardRouted(
  overrides: Partial<React.ComponentProps<typeof NewWorkflowWizard>> = {},
): void {
  render(
    <MemoryRouter>
      <NewWorkflowWizard
        open={true}
        onClose={vi.fn()}
        clientes={clientes}
        membros={equipe}
        templates={templates}
        onCreated={vi.fn()}
        {...overrides}
      />
    </MemoryRouter>,
  );
}

/**
 * Source preset → cliente → step 3 (bulk-assign so the etapas validate) → step 4.
 * Cliente 1 (Aurora) has `dia_entrega: 25`; cliente 2 (Borealis) has none.
 */
function renderWizardAtStep4(
  opts: {
    preset?: string;
    clienteId?: string;
    overrides?: Partial<React.ComponentProps<typeof NewWorkflowWizard>>;
  } = {},
): void {
  const { preset = 'Posts mensais', clienteId = '1', overrides = {} } = opts;
  renderWizardRouted(overrides);
  fireEvent.click(screen.getByText(preset));
  fireEvent.change(screen.getByLabelText(/cliente/i), { target: { value: clienteId } });
  fireEvent.click(screen.getByText('Continuar →'));
  fireEvent.change(screen.getByLabelText(/atribuir todas a/i), { target: { value: '7' } });
  fireEvent.click(screen.getByText('Continuar →'));
}

/** Same, but from the preset with TWO approval etapas. */
function renderWizardAtStep4ViaDupla(opts: { clienteId?: string } = {}): void {
  renderWizardAtStep4({ preset: 'Aprovação dupla (texto + arte)', ...opts });
}

/** Step 4 → step 5, with the save-as-template checkbox already ticked. */
function renderWizardThroughReview(
  overrides: Partial<React.ComponentProps<typeof NewWorkflowWizard>> = {},
): void {
  renderWizardAtStep4({ overrides });
  fireEvent.click(screen.getByText('Continuar →'));
  fireEvent.click(screen.getByRole('checkbox'));
}

describe('NewWorkflowWizard — steps 4 & 5', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createWorkflowFromWizardMock.mockResolvedValue({ workflow: { id: 1 }, template: { id: 5 } });
  });

  it('disables data_entrega and auto-falls back when client lacks dia_entrega', () => {
    // "Posts mensais" prefers data_entrega; Borealis has no dia_entrega.
    renderWizardAtStep4({ clienteId: '2' });
    expect(screen.getByText(/modo ajustado para duração por etapa/i)).toBeTruthy();
    const radio = screen.getByRole('radio', { name: /data de entrega do cliente/i });
    expect((radio as HTMLInputElement).disabled).toBe(true);
    expect((radio as HTMLInputElement).checked).toBe(false);
    expect(
      (screen.getByRole('radio', { name: /duração por etapa/i }) as HTMLInputElement).checked,
    ).toBe(true);
    // The fallback offers the way out of the dead end.
    expect(screen.getByText('Configurar dia de entrega')).toBeTruthy();
  });

  it('warns about the first-approval anchor with 2+ approvals', () => {
    renderWizardAtStep4ViaDupla();
    fireEvent.click(screen.getByRole('radio', { name: /data de entrega do cliente/i }));
    expect(screen.getByText(/a primeira .* âncora/i)).toBeTruthy();
  });

  it('does not count an unnamed approval row toward the anchor warning', () => {
    // `countApprovals` counts unnamed rows too (task 7), so an empty row flipped to "Aprovação
    // externa" before it is named must not make a single-approval fluxo look ambiguous.
    renderWizardRouted();
    fireEvent.click(screen.getByText('Posts mensais'));
    fireEvent.change(screen.getByLabelText(/cliente/i), { target: { value: '1' } });
    fireEvent.click(screen.getByText('Continuar →'));
    fireEvent.change(screen.getByLabelText(/atribuir todas a/i), { target: { value: '7' } });
    fireEvent.click(screen.getByText('＋ Personalizada'));
    const pills = screen.getAllByRole('button', { name: 'Aprovação externa' });
    fireEvent.click(pills[pills.length - 1]); // the blank row's pill
    fireEvent.click(screen.getByText('Continuar →'));
    expect(screen.queryByText(/a primeira .* âncora/i)).toBeNull();
  });

  it('data_fixa without all datas limite blocks Continuar with the inline error', () => {
    renderWizardAtStep4();
    fireEvent.click(screen.getByRole('radio', { name: /datas fixas/i }));
    fireEvent.click(screen.getByText('Continuar →'));
    expect(screen.getByText(/data limite para todas as etapas/i)).toBeTruthy();
    expect(screen.queryByText(/revisar/i)).toBeNull(); // did not advance
  });

  it('month select offers próximo disponível + current month + 5 more', () => {
    renderWizardAtStep4();
    const select = screen.getByLabelText(/mês de entrega/i) as HTMLSelectElement;
    // The Select mock always prepends a valueless placeholder <option>; the component's own
    // options are the ones with a value.
    const options = Array.from(select.options).filter((o) => o.value !== '');
    expect(options).toHaveLength(7); // '__auto__' sentinel + 6 months
    expect(options[0].textContent).toMatch(/próximo mês disponível/i);
    const now = new Date();
    const currentLabel = now.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
    expect(options[1].textContent!.toLowerCase()).toBe(currentLabel.toLowerCase());
  });

  it('blocks Continuar when the data_fixa list on step 4 is blanked out', () => {
    // Step 4's data_fixa mode re-exposes the etapa list, so step 3's "at least one etapa" gate
    // has to hold here too — otherwise the wizard creates a fluxo with no etapas at all.
    renderWizardAtStep4();
    fireEvent.click(screen.getByRole('radio', { name: /datas fixas/i }));
    for (const input of screen.getAllByPlaceholderText('Nome da etapa')) {
      fireEvent.change(input, { target: { value: '' } });
    }
    fireEvent.click(screen.getByText('Continuar →'));
    expect(screen.getByText('Adicione pelo menos uma etapa.')).toBeTruthy();
    expect(screen.queryByText(/revisar/i)).toBeNull(); // did not advance
  });

  it('never leaves Continuar dead when a row error survives leaving data_fixa', () => {
    // The row-error gate applies in EVERY mode, but the etapa list that shows those errors used
    // to render only for data_fixa — so this exact sequence produced a Continuar button that did
    // nothing, forever, with no message.
    renderWizardAtStep4();
    fireEvent.click(screen.getByRole('radio', { name: /datas fixas/i }));
    const responsavelSelects = screen
      .getAllByDisplayValue('Maria')
      .filter((el) => el.id !== 'wizard-bulk-responsavel');
    fireEvent.change(responsavelSelects[0], { target: { value: '__none__' } });
    fireEvent.click(screen.getByRole('radio', { name: /duração por etapa/i }));
    expect(screen.queryAllByPlaceholderText('Nome da etapa')).toHaveLength(0); // list is gone
    fireEvent.click(screen.getByText('Continuar →'));
    expect(screen.getByText(/revise os responsáveis das etapas/i)).toBeTruthy();
    // ...and the broken row is pulled back into view so it can be fixed in place.
    expect(screen.getByText('Selecione um responsável para esta etapa.')).toBeTruthy();
    expect(screen.queryByText(/revisar/i)).toBeNull(); // did not advance
  });

  it('names the real blocker when the fluxo has neither an approval etapa nor a dia de entrega', () => {
    renderWizardRouted();
    fireEvent.click(screen.getByText('Posts mensais'));
    fireEvent.change(screen.getByLabelText(/cliente/i), { target: { value: '2' } }); // no dia_entrega
    fireEvent.click(screen.getByText('Continuar →'));
    fireEvent.change(screen.getByLabelText(/atribuir todas a/i), { target: { value: '7' } });
    fireEvent.click(screen.getByRole('button', { name: '✓ Aprovação do cliente' })); // drop the anchor
    fireEvent.click(screen.getByText('Continuar →'));
    // The anchor is checked first, so the dia de entrega is not yet the operative blocker.
    expect(screen.getByText(/modo ajustado .* aprovação do cliente/i)).toBeTruthy();
    expect(screen.queryByText('Configurar dia de entrega')).toBeNull();
  });

  it('warns instead of silently skipping the template when the name is cleared', () => {
    renderWizardThroughReview();
    fireEvent.change(screen.getByLabelText(/nome do modelo/i), { target: { value: '  ' } });
    expect(screen.getByText(/dê um nome ao modelo/i)).toBeTruthy();
  });

  it('never stores the __auto__ sentinel in wizard state', () => {
    renderWizardAtStep4();
    const select = screen.getByLabelText(/mês de entrega/i) as HTMLSelectElement;
    const proximo = Array.from(select.options).find((o) =>
      /próximo mês disponível/i.test(o.textContent ?? ''),
    )!;
    fireEvent.change(select, { target: { value: proximo.value } });
    fireEvent.click(screen.getByText('Continuar →'));
    fireEvent.click(screen.getByText('✓ Criar Fluxo'));
    expect(createWorkflowFromWizardMock).toHaveBeenCalledWith(
      expect.objectContaining({ mesEntrega: '' }),
    );
  });

  it('client switch re-applies the source mode preference when not manually overridden', () => {
    renderWizardAtStep4({ clienteId: '2' }); // no dia_entrega → auto-fallback padrao
    expect(screen.getByText(/modo ajustado para duração por etapa/i)).toBeTruthy();
    fireEvent.click(screen.getByText('← Voltar')); // step 3
    fireEvent.click(screen.getByText('← Voltar')); // step 2
    fireEvent.change(screen.getByLabelText(/cliente/i), { target: { value: '1' } }); // dia_entrega 25
    fireEvent.click(screen.getByText('Continuar →'));
    fireEvent.click(screen.getByText('Continuar →')); // back to step 4
    const radio = screen.getByRole('radio', { name: /data de entrega do cliente/i });
    expect((radio as HTMLInputElement).checked).toBe(true);
    expect((radio as HTMLInputElement).disabled).toBe(false);
    expect(screen.queryByText(/modo ajustado para duração por etapa/i)).toBeNull();
  });

  it('keeps a manual data_entrega selected-but-blocked after switching to a client without dia_entrega', () => {
    renderWizardAtStep4(); // cliente 1, data_entrega available
    // Two clicks so the *manual* choice is registered: re-clicking an already-checked radio
    // fires no change event.
    fireEvent.click(screen.getByRole('radio', { name: /datas fixas/i }));
    fireEvent.click(screen.getByRole('radio', { name: /data de entrega do cliente/i }));
    fireEvent.click(screen.getByText('← Voltar')); // step 3
    fireEvent.click(screen.getByText('← Voltar')); // step 2
    fireEvent.change(screen.getByLabelText(/cliente/i), { target: { value: '2' } }); // no dia_entrega
    fireEvent.click(screen.getByText('Continuar →'));
    fireEvent.click(screen.getByText('Continuar →')); // step 4
    const radio = screen.getByRole('radio', { name: /data de entrega do cliente/i });
    expect((radio as HTMLInputElement).checked).toBe(true); // manual choice preserved
    expect((radio as HTMLInputElement).disabled).toBe(true);
    expect(screen.queryByText(/modo ajustado para duração por etapa/i)).toBeNull();
    fireEvent.click(screen.getByText('Continuar →'));
    expect(screen.getByRole('alert').textContent).toMatch(/dia de entrega/i);
    expect(screen.queryByText(/revisar/i)).toBeNull(); // did not advance
  });

  it('review summary + create calls sequencing and analytics, then closes', async () => {
    const onCreated = vi.fn();
    const onClose = vi.fn();
    renderWizardThroughReview({ onCreated, onClose });
    expect(screen.getByText('Aurora')).toBeTruthy();
    expect(screen.getByText('5 (1 aprovação do cliente)')).toBeTruthy();
    fireEvent.click(screen.getByText('✓ Criar Fluxo'));
    await waitFor(() => expect(createWorkflowFromWizardMock).toHaveBeenCalled());
    expect(createWorkflowFromWizardMock).toHaveBeenCalledWith(
      expect.objectContaining({
        clienteId: 1,
        modoPrazo: 'data_entrega',
        saveAsTemplate: true,
        source: { kind: 'preset', presetId: 'posts-mensais', presetNome: 'Posts mensais' },
      }),
    );
    expect(captureEvent).toHaveBeenCalledWith('workflow_wizard_source', {
      source: 'posts-mensais',
    });
    expect(captureEvent).toHaveBeenCalledWith('workflow_saved_as_template');
    expect(toast.success).toHaveBeenCalledWith('Fluxo criado com sucesso!');
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(onClose).toHaveBeenCalled();
  });

  it('does not fire workflow_wizard_source until creation succeeds', () => {
    renderWizardAtStep4();
    expect(captureEvent).not.toHaveBeenCalledWith('workflow_wizard_source', expect.anything());
  });

  it('prefills the template name from the source preset and the client', () => {
    renderWizardThroughReview();
    expect((screen.getByLabelText(/nome do modelo/i) as HTMLInputElement).value).toBe(
      'Posts mensais — Aurora',
    );
  });

  it('surfaces the template warning as a separate toast', async () => {
    createWorkflowFromWizardMock.mockResolvedValue({
      workflow: { id: 1 },
      warning: 'O fluxo será criado, mas não foi possível salvar o modelo.',
    });
    renderWizardThroughReview();
    fireEvent.click(screen.getByText('✓ Criar Fluxo'));
    await waitFor(() =>
      expect(toast.warning).toHaveBeenCalledWith(
        expect.stringMatching(/não foi possível salvar o modelo/i),
      ),
    );
    expect(toast.success).toHaveBeenCalledWith('Fluxo criado com sucesso!');
    // No template came back, so the template event must not fire.
    expect(captureEvent).not.toHaveBeenCalledWith('workflow_saved_as_template');
  });

  it('keeps the wizard open and toasts the error when creation fails', async () => {
    const onCreated = vi.fn();
    const onClose = vi.fn();
    createWorkflowFromWizardMock.mockRejectedValue(new Error('Falha no servidor'));
    renderWizardThroughReview({ onCreated, onClose });
    fireEvent.click(screen.getByText('✓ Criar Fluxo'));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Falha no servidor'));
    expect(onCreated).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect((screen.getByText('✓ Criar Fluxo') as HTMLButtonElement).disabled).toBe(false);
  });
});
