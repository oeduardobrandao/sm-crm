import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { PageHeader } from '../PageHeader';
import { mockPhone } from '../../__tests__/phone';

const wrap = (ui: React.ReactNode) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe('PageHeader', () => {
  let restore: (() => void) | null = null;
  afterEach(() => restore?.());

  it('desktop: h1, description and actions', () => {
    wrap(
      <PageHeader title="Planos" description="5 planos" actions={<button>Novo plano</button>} />,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Planos' })).toBeInTheDocument();
    expect(screen.getByText('5 planos')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Novo plano' })).toBeInTheDocument();
  });

  it('desktop with back: a link to the parent above the title', () => {
    wrap(<PageHeader title="Social Bee" back={{ to: '/admin/workspaces', label: 'Workspaces' }} />);
    expect(screen.getByRole('link', { name: /Workspaces/ })).toHaveAttribute(
      'href',
      '/admin/workspaces',
    );
  });

  it('phone root: large title with the Mesaas mark and phone actions, not desktop actions', () => {
    restore = mockPhone();
    wrap(
      <PageHeader
        title="Planos"
        description="5 planos"
        actions={<button>Novo plano</button>}
        phoneActions={<button aria-label="Novo">+</button>}
      />,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Planos' })).toBeInTheDocument();
    expect(screen.getByAltText('Mesaas')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Novo' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Novo plano' })).not.toBeInTheDocument();
  });

  it('phone with back: a back button named after the parent', () => {
    restore = mockPhone();
    wrap(<PageHeader title="Workspace" back={{ to: '/admin/workspaces', label: 'Workspaces' }} />);
    expect(screen.getByRole('button', { name: 'Voltar para Workspaces' })).toBeInTheDocument();
  });
});
