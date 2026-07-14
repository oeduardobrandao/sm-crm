import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { PublicPricingPlan } from '@/services/billing';
import PlanComparison from '../PlanComparison';

const FREE: PublicPricingPlan = {
  id: 'free',
  name: 'Free',
  price_brl: 0,
  price_brl_annual: 0,
  sort_order: 0,
  max_clients: 2,
  max_team_members: 1,
  max_workflow_templates: 1,
  max_instagram_accounts: 1,
  max_hub_tokens: 0,
  storage_quota_bytes: 100 * 1024 ** 2,
  feature_analytics_reports: false,
  feature_post_scheduling: false,
  feature_leads: false,
  feature_financial: false,
  feature_contracts: false,
  feature_brand_customization: false,
  feature_mcp: false,
};

const PRO: PublicPricingPlan = {
  ...FREE,
  id: 'pro',
  name: 'Pro',
  price_brl: 13990,
  price_brl_annual: 134300,
  sort_order: 2,
  max_workflow_templates: null,
  max_instagram_accounts: 15,
  max_hub_tokens: 15,
  storage_quota_bytes: 10 * 1024 ** 3,
  feature_analytics_reports: true,
  feature_post_scheduling: true,
  feature_leads: true,
  feature_financial: true,
  feature_contracts: true,
  feature_brand_customization: true,
  feature_mcp: true,
};

const actionFor = (plan: PublicPricingPlan) => ({
  href: `/assinar/${plan.id}`,
  label: plan.id === 'free' ? 'Começar grátis' : `Assinar ${plan.name}`,
  primary: plan.id === 'pro',
});

describe('PlanComparison', () => {
  it('scopes each row group header to its own table body', () => {
    render(<PlanComparison plans={[FREE, PRO]} actionFor={actionFor} />);

    const table = screen.getByRole('table', { name: 'Comparação detalhada dos planos' });
    const rowGroups = Array.from(table.querySelectorAll(':scope > tbody'));

    expect(rowGroups).toHaveLength(2);
    expect(within(rowGroups[0]).getByRole('rowheader', { name: 'Capacidade' })).toHaveAttribute(
      'scope',
      'rowgroup',
    );
    expect(within(rowGroups[0]).getAllByRole('row')).toHaveLength(5);
    expect(within(rowGroups[0]).queryByText('Recursos')).not.toBeInTheDocument();
    expect(within(rowGroups[1]).getByRole('rowheader', { name: 'Recursos' })).toHaveAttribute(
      'scope',
      'rowgroup',
    );
    expect(within(rowGroups[1]).getAllByRole('row')).toHaveLength(8);
    expect(within(rowGroups[1]).queryByText('Capacidade')).not.toBeInTheDocument();
  });

  it('renders plans in input order and formats capacity values', () => {
    render(<PlanComparison plans={[FREE, PRO]} actionFor={actionFor} />);

    const table = screen.getByRole('table', { name: 'Comparação detalhada dos planos' });
    const columnHeaders = within(table).getAllByRole('columnheader');
    expect(columnHeaders).toHaveLength(3);
    expect(columnHeaders[0]).toHaveAccessibleName('Recurso');
    expect(columnHeaders[1]).toHaveAccessibleName('Free');
    expect(columnHeaders[2]).toHaveAccessibleName('Pro Mais popular');
    expect(screen.getByRole('row', { name: /Contas do Instagram/ })).toHaveTextContent('115');
    expect(screen.getByRole('row', { name: /Armazenamento/ })).toHaveTextContent('100 MB10 GB');
    expect(screen.getByRole('row', { name: /Templates de fluxo/ })).toHaveTextContent('1Ilimitado');
    expect(screen.getByRole('row', { name: /Portais do cliente/ })).toHaveTextContent('015');
  });

  it('exposes feature availability, actions, scroll semantics, and Pro emphasis', () => {
    render(<PlanComparison plans={[FREE, PRO]} actionFor={actionFor} />);

    const analytics = screen.getByRole('row', { name: /Relatórios e analytics/ });
    expect(within(analytics).getByText('Não incluído')).toBeInTheDocument();
    expect(within(analytics).getByText('Incluído')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Tabela comparativa de planos' })).toHaveAttribute(
      'tabindex',
      '0',
    );
    expect(screen.getByRole('link', { name: 'Começar grátis' })).toHaveAttribute(
      'href',
      '/assinar/free',
    );
    expect(screen.getByRole('link', { name: 'Assinar Pro' })).toHaveClass('lp-btn-primary');
    const proHeader = screen.getByRole('columnheader', { name: 'Pro Mais popular' });
    expect(within(proHeader).getByText('Mais popular')).toBeVisible();
    expect(proHeader).toHaveClass('plan-comparison-cell--highlight');
  });
});
