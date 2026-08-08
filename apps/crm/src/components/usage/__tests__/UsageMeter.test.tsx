import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { UsageMeter } from '../UsageMeter';

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
});
