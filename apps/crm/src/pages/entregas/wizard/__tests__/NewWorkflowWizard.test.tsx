import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
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
    // The source really switched (etapas swap with it — asserted once step 3 renders them)...
    expect(screen.getByText('Novo Fluxo · Post avulso rápido')).toBeTruthy();
    // ...and non-nome fields ARE overwritten by the new source: Posts mensais is recorrente,
    // Post avulso rápido is not, so the switch must have flipped back to false.
    expect(screen.getByRole('switch', { name: /recorrente/i }).getAttribute('aria-checked')).toBe(
      'false',
    );
    // ...but the name the user typed survives it.
    expect((screen.getByLabelText(/nome do fluxo/i) as HTMLInputElement).value).toBe('Meu nome');
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
