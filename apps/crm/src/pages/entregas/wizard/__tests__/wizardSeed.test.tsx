import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Cliente, Membro, Workflow, WorkflowTemplate } from '../../../../store';
import type { LinhaItem } from '@/store/linhaEditorial';

// The "Criar fluxo" path of the linha editorial (spec §7.1): the wizard opened with a `seed`.
// Same mock set as NewWorkflowWizard.test.tsx, so the steps behave the same way here.

(Element.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = () => {};

vi.mock('@/hooks/useWorkspaceLimits', () => ({
  useWorkspaceLimits: () => ({ features: {}, isLoading: false }),
}));
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));
vi.mock('@/lib/analytics', () => ({ captureEvent: vi.fn() }));

const createWorkflowFromWizardMock = vi.hoisted(() => vi.fn());
vi.mock('../createWorkflow', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../createWorkflow')>()),
  createWorkflowFromWizard: createWorkflowFromWizardMock,
}));

const removeWorkflowMock = vi.hoisted(() => vi.fn());
vi.mock('../../../../store', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../store')>()),
  removeWorkflow: removeWorkflowMock,
}));

vi.mock('@/components/ui/button', () => ({
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

import { toast } from 'sonner';
import { captureEvent } from '@/lib/analytics';
import { NewWorkflowWizard, type WizardSeed } from '../NewWorkflowWizard';

const clientes = [
  { id: 1, nome: 'Aurora', status: 'ativo', dia_entrega: 25 },
  { id: 2, nome: 'Borealis', status: 'ativo' },
] as Cliente[];

const membros = [{ id: 9, nome: 'Ana' }] as Membro[];

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

const item = (n: number, over: Partial<LinhaItem> = {}): LinhaItem => ({
  id: `i${n}`,
  linha_id: 'l-1',
  data: null,
  tipo: 'reels',
  titulo: `Post ${n}`,
  direcao: '',
  valores: {},
  ordem: n,
  post_id: null,
  ...over,
});

const ITENS: LinhaItem[] = [
  item(1, {
    data: '2026-11-06',
    titulo: 'Bastidores do consultório',
    direcao: 'Mostrar a recepção pela manhã\nSegunda linha que não aparece',
  }),
  item(2, { data: '2026-11-03', tipo: 'carrossel', titulo: 'Mitos do clareamento' }),
  item(3, { titulo: 'Sem data ainda' }),
];

const WORKFLOW = { id: 77, titulo: 'Linha de novembro', template_id: 12 } as Workflow;

function seedWith(over: Partial<WizardSeed> = {}): WizardSeed {
  return {
    clienteId: 2,
    nome: 'Linha de novembro',
    origemLabel: 'linha editorial de novembro',
    itens: ITENS,
    afterCreate: vi.fn().mockResolvedValue(undefined),
    ...over,
  };
}

function renderSeeded(
  seed: WizardSeed,
  overrides: Partial<React.ComponentProps<typeof NewWorkflowWizard>> = {},
) {
  return render(
    <MemoryRouter>
      <NewWorkflowWizard
        open={true}
        onClose={vi.fn()}
        clientes={clientes}
        membros={membros}
        templates={templates}
        onCreated={vi.fn()}
        seed={seed}
        {...overrides}
      />
    </MemoryRouter>,
  );
}

/** Template → O básico → Etapas → Prazos → Revisar, with the template's own responsáveis. */
function goToReview() {
  fireEvent.click(screen.getByText('Fluxo Padrão de Post'));
  fireEvent.click(screen.getByText('Continuar →'));
  fireEvent.click(screen.getByText('Continuar →'));
  fireEvent.click(screen.getByText('Continuar →'));
  expect(screen.getByText('Revisar e criar')).toBeTruthy();
}

beforeEach(() => {
  vi.clearAllMocks();
  createWorkflowFromWizardMock.mockResolvedValue({ workflow: WORKFLOW });
  removeWorkflowMock.mockResolvedValue(undefined);
});

describe('NewWorkflowWizard with a linha editorial seed', () => {
  it('seed locks client and presets name', () => {
    renderSeeded(seedWith());
    // The Template step pre-selects nothing; the banner explains where the posts come from.
    expect(screen.getByText('3 posts vêm da linha editorial de novembro.')).toBeTruthy();
    fireEvent.click(screen.getByText('Fluxo Padrão de Post'));
    expect(screen.getByText('O básico')).toBeTruthy();
    const cliente = screen.getByLabelText(/cliente/i) as HTMLSelectElement;
    expect(cliente.value).toBe('2');
    expect(cliente.disabled).toBe(true);
    // Picking a template does not overwrite the seeded name with the template's.
    expect((screen.getByLabelText(/nome do fluxo/i) as HTMLInputElement).value).toBe(
      'Linha de novembro',
    );
    expect(screen.getByText('3 posts vêm da linha editorial de novembro.')).toBeTruthy();
  });

  it('an untouched seeded wizard closes without the discard confirmation', () => {
    const onClose = vi.fn();
    renderSeeded(seedWith(), { onClose });
    fireEvent.click(screen.getByText('Cancelar'));
    expect(onClose).toHaveBeenCalled();
  });

  it('review lists seeded posts without deadlines', () => {
    renderSeeded(seedWith());
    goToReview();
    expect(
      screen.getByText('3 posts vindos da linha editorial de novembro, já preenchidos'),
    ).toBeTruthy();
    const lista = screen.getByRole('list', { name: /posts da linha editorial/i });
    const rows = within(lista).getAllByRole('listitem');
    // Date order, undated last.
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining('Mitos do clareamento'),
      expect.stringContaining('Bastidores do consultório'),
      expect.stringContaining('Sem data ainda'),
    ]);
    expect(rows[0].textContent).toMatch(/03\/11/);
    expect(rows[0].textContent).toMatch(/ter/);
    expect(rows[0].textContent).toContain('Carrossel');
    expect(rows[1].textContent).toContain('Mostrar a recepção pela manhã');
    expect(rows[1].textContent).not.toContain('Segunda linha');
    expect(rows[2].textContent).toContain('Sem data');
    // No per-post deadline: nothing in the list reads as a prazo.
    expect(lista.textContent).not.toMatch(/prazo/i);
    expect(screen.getByText('Criar fluxo com 3 posts')).toBeTruthy();
    expect(screen.queryByText('✓ Criar Fluxo')).toBeNull();
  });

  it('afterCreate called with created workflow before onCreated', async () => {
    const order: string[] = [];
    const afterCreate = vi.fn(async () => {
      order.push('afterCreate');
    });
    const onCreated = vi.fn(() => order.push('onCreated'));
    const onClose = vi.fn();
    renderSeeded(seedWith({ afterCreate }), { onCreated, onClose });
    goToReview();
    fireEvent.click(screen.getByText('Criar fluxo com 3 posts'));
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(createWorkflowFromWizardMock).toHaveBeenCalledWith(
      expect.objectContaining({ clienteId: 2, titulo: 'Linha de novembro' }),
    );
    expect(afterCreate).toHaveBeenCalledWith(WORKFLOW);
    expect(order).toEqual(['afterCreate', 'onCreated']);
    expect(onClose).toHaveBeenCalled();
    expect(removeWorkflowMock).not.toHaveBeenCalled();
  });

  it('converter failure removes workflow and keeps wizard open', async () => {
    const afterCreate = vi
      .fn()
      .mockRejectedValue(new Error('Seu plano atingiu o limite de fluxos.'));
    const onCreated = vi.fn();
    const onClose = vi.fn();
    renderSeeded(seedWith({ afterCreate }), { onCreated, onClose });
    goToReview();
    fireEvent.click(screen.getByText('Criar fluxo com 3 posts'));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Seu plano atingiu o limite de fluxos.'),
    );
    expect(removeWorkflowMock).toHaveBeenCalledWith(77);
    expect(onCreated).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
    expect(captureEvent).not.toHaveBeenCalledWith('workflow_wizard_source', expect.anything());
    expect((screen.getByText('Criar fluxo com 3 posts') as HTMLButtonElement).disabled).toBe(false);
  });

  it('a failing cleanup still surfaces the conversion error', async () => {
    removeWorkflowMock.mockRejectedValue(new Error('rede'));
    const afterCreate = vi.fn().mockRejectedValue(new Error('Não foi possível criar os posts.'));
    renderSeeded(seedWith({ afterCreate }));
    goToReview();
    fireEvent.click(screen.getByText('Criar fluxo com 3 posts'));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Não foi possível criar os posts.'),
    );
  });

  it('success toast fires after afterCreate', async () => {
    let successBeforeAfterCreate: boolean | null = null;
    const afterCreate = vi.fn(async () => {
      successBeforeAfterCreate = vi.mocked(toast.success).mock.calls.length > 0;
    });
    renderSeeded(seedWith({ afterCreate }));
    goToReview();
    fireEvent.click(screen.getByText('Criar fluxo com 3 posts'));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Fluxo criado com 3 posts'));
    expect(successBeforeAfterCreate).toBe(false);
    expect(toast.success).not.toHaveBeenCalledWith('Fluxo criado com sucesso!');
  });

  it('one seeded item reads in the singular', () => {
    renderSeeded(seedWith({ itens: [ITENS[0]] }));
    expect(screen.getByText('1 post vem da linha editorial de novembro.')).toBeTruthy();
    goToReview();
    expect(
      screen.getByText('1 post vindo da linha editorial de novembro, já preenchido'),
    ).toBeTruthy();
    expect(screen.getByText('Criar fluxo com 1 post')).toBeTruthy();
  });
});
