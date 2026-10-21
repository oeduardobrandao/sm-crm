import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CAMADAS_PADRAO } from '../camadasStorage';
import { CamadasGrupo, type CamadasGrupoProps } from '../CamadasGrupo';

// Radix Select needs pointer-capture/scrollIntoView APIs jsdom lacks: same stand-in
// as CalendarioPage.test.tsx, so onValueChange is still exercised.
vi.mock('@/components/ui/select', async () => {
  const ReactModule = await vi.importActual<typeof import('react')>('react');
  const Ctx = ReactModule.createContext<{
    value?: string;
    onValueChange?: (value: string) => void;
  }>({});
  function Select({
    value,
    onValueChange,
    children,
  }: {
    value?: string;
    onValueChange?: (value: string) => void;
    children: React.ReactNode;
  }) {
    return <Ctx.Provider value={{ value, onValueChange }}>{children}</Ctx.Provider>;
  }
  function SelectTrigger({ children, ...p }: { children: React.ReactNode; id?: string }) {
    return (
      <button type="button" id={p.id} aria-label="Nicho">
        {children}
      </button>
    );
  }
  function SelectValue() {
    const { value } = ReactModule.useContext(Ctx);
    return <span>{value}</span>;
  }
  function SelectContent({ children }: { children: React.ReactNode }) {
    return <div>{children}</div>;
  }
  function SelectItem({ value, children }: { value: string; children: React.ReactNode }) {
    const { onValueChange } = ReactModule.useContext(Ctx);
    return (
      <button type="button" onClick={() => onValueChange?.(value)}>
        {children}
      </button>
    );
  }
  return { Select, SelectTrigger, SelectValue, SelectContent, SelectItem };
});

function renderGrupo(over: Partial<CamadasGrupoProps> = {}) {
  const props: CamadasGrupoProps = {
    ativas: { ...CAMADAS_PADRAO },
    onChange: vi.fn(),
    canSeeFinancials: true,
    nichoKey: 'medico',
    onNichoChange: vi.fn(),
    ...over,
  };
  render(<CamadasGrupo {...props} />);
  return props;
}

const nomes = () => screen.getAllByRole('checkbox').map((c) => c.getAttribute('aria-label'));

describe('CamadasGrupo', () => {
  it('lists the six layers in order for someone who sees financials', () => {
    renderGrupo();
    expect(screen.getByText('Camadas')).toBeInTheDocument();
    expect(nomes()).toEqual([
      'Posts agendados',
      'Prazos de entrega',
      'Recebimentos',
      'Pagamentos da equipe',
      'Datas dos clientes',
      'Datas comemorativas',
    ]);
  });

  it.each([false, 'unknown', undefined] as const)(
    'hides receivables and team payments when canSeeFinancials is %s',
    (fin) => {
      renderGrupo({ canSeeFinancials: fin });
      expect(nomes()).toEqual([
        'Posts agendados',
        'Prazos de entrega',
        'Datas dos clientes',
        'Datas comemorativas',
      ]);
    },
  );

  it('reflects the state and toggles one layer at a time', () => {
    const props = renderGrupo();
    expect(screen.getByRole('checkbox', { name: 'Posts agendados' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Datas comemorativas' })).not.toBeChecked();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Posts agendados' }));
    expect(props.onChange).toHaveBeenCalledWith({ ...CAMADAS_PADRAO, posts: false });
  });

  it('shows the niche picker only while commemorative dates are on', () => {
    renderGrupo();
    expect(screen.queryByText('Nicho')).toBeNull();
  });

  it('picks a niche', () => {
    const props = renderGrupo({ ativas: { ...CAMADAS_PADRAO, comemorativas: true } });
    expect(screen.getByText('Nicho')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Jurídico' }));
    expect(props.onNichoChange).toHaveBeenCalledWith('juridico');
  });
});
