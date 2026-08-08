import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { MeterBar, UsageMeter } from '../UsageMeter';

function renderMeter(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe('UsageMeter', () => {
  it('renders value text and no CTA when ok below 75%', () => {
    renderMeter(<UsageMeter label="clientes" used={3} limit={15} showUpgradeCta />);
    expect(screen.getByText('3 de 15')).toBeInTheDocument();
    expect(screen.queryByText('Fazer upgrade')).not.toBeInTheDocument();
  });

  it('shows the CTA above 75% for owners', () => {
    renderMeter(<UsageMeter label="clientes" used={12} limit={15} showUpgradeCta />);
    expect(screen.getByRole('link', { name: 'Fazer upgrade' })).toHaveAttribute(
      'href',
      '/configuracao/cobranca',
    );
  });

  it('never shows the CTA for non-owners', () => {
    renderMeter(<UsageMeter label="clientes" used={15} limit={15} showUpgradeCta={false} />);
    expect(screen.queryByText('Fazer upgrade')).not.toBeInTheDocument();
  });

  it('renders the blocked state for limit 0', () => {
    renderMeter(<UsageMeter label="portais do Hub" used={0} limit={0} showUpgradeCta />);
    expect(screen.getByText('Não incluído no plano')).toBeInTheDocument();
    expect(screen.getByText('Fazer upgrade')).toBeInTheDocument();
  });

  it('blocked state wins over a caller valueText override', () => {
    renderMeter(
      <UsageMeter
        label="Vagas de equipe"
        used={0}
        limit={0}
        valueText="0 de 0 vagas do plano usadas"
        showUpgradeCta
      />,
    );
    expect(screen.getByText('Não incluído no plano')).toBeInTheDocument();
    expect(screen.queryByText('0 de 0 vagas do plano usadas')).not.toBeInTheDocument();
  });

  it('blocked state wins over a caller subText override', () => {
    renderMeter(
      <UsageMeter
        label="Vagas de equipe"
        used={0}
        limit={0}
        subText="0 restantes"
        showUpgradeCta
      />,
    );
    expect(screen.getByText('Não incluído no plano')).toBeInTheDocument();
    expect(screen.queryByText('0 restantes')).not.toBeInTheDocument();
  });

  it('renders count + Ilimitado badge for null limit in full size', () => {
    renderMeter(<UsageMeter label="Chaves MCP" used={2} limit={null} />);
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('Ilimitado')).toBeInTheDocument();
  });

  it('hides the Ilimitado badge when unlimitedBadge is false', () => {
    renderMeter(<UsageMeter label="Armazenamento" used={5} limit={null} unlimitedBadge={false} />);
    expect(screen.queryByText('Ilimitado')).not.toBeInTheDocument();
  });

  it('renders nothing in compact size when unlimited', () => {
    const { container } = renderMeter(
      <UsageMeter size="compact" label="clientes" used={3} limit={null} />,
    );
    expect(container.textContent).toBe('');
  });

  it('compact size renders "X de Y label" as one line', () => {
    renderMeter(<UsageMeter size="compact" label="clientes" used={13} limit={15} />);
    expect(screen.getByText('13 de 15 clientes')).toBeInTheDocument();
  });

  it('honors valueText and subText overrides', () => {
    renderMeter(
      <UsageMeter
        label=""
        used={3}
        limit={5}
        valueText="3 de 5 vagas do plano usadas"
        subText="2 restantes"
      />,
    );
    expect(screen.getByText('3 de 5 vagas do plano usadas')).toBeInTheDocument();
    expect(screen.getByText('2 restantes')).toBeInTheDocument();
  });

  it('renders the subText sub row for an unlimited meter without a CTA', () => {
    renderMeter(
      <UsageMeter
        label="Vagas de equipe"
        used={4}
        limit={null}
        subText="4 membros e 1 convite pendente"
        showUpgradeCta
      />,
    );
    expect(screen.getByText('4 membros e 1 convite pendente')).toBeInTheDocument();
    expect(screen.queryByText('Fazer upgrade')).not.toBeInTheDocument();
  });

  it('renders no sub row for an unlimited meter without subText', () => {
    const { container } = renderMeter(<UsageMeter label="Chaves MCP" used={2} limit={null} />);
    // Root wrapper + the label/value header row -- no trailing sub row, no bar.
    expect(container.querySelectorAll('div')).toHaveLength(2);
  });

  describe('MeterBar accessibility', () => {
    it('exposes progressbar semantics with min/max/current values', () => {
      render(<MeterBar used={13} limit={15} />);
      const bar = screen.getByRole('progressbar');
      expect(bar).toHaveAttribute('aria-valuemin', '0');
      expect(bar).toHaveAttribute('aria-valuemax', '15');
      expect(bar).toHaveAttribute('aria-valuenow', '13');
    });

    it('clamps aria-valuenow to the limit when used exceeds it', () => {
      render(<MeterBar used={20} limit={15} />);
      expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '15');
    });
  });
});
