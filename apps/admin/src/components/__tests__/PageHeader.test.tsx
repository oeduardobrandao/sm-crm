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

  it('desktop: leading renders before the title and titleAddon sits beside the h1, not in it', () => {
    wrap(
      <PageHeader
        title="Social Bee"
        leading={<span data-testid="avatar">S</span>}
        titleAddon={<span data-testid="addon">Ativo</span>}
      />,
    );
    const h1 = screen.getByRole('heading', { level: 1, name: 'Social Bee' });
    const avatar = screen.getByTestId('avatar');
    const addon = screen.getByTestId('addon');
    expect(h1).not.toContainElement(addon);
    expect(h1.parentElement).toContainElement(addon);
    expect(avatar.compareDocumentPosition(h1) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('phone ignores leading and titleAddon, root and pushed', () => {
    restore = mockPhone();
    const { unmount } = wrap(
      <PageHeader
        title="Planos"
        leading={<span data-testid="avatar">S</span>}
        titleAddon={<span data-testid="addon">Ativo</span>}
      />,
    );
    expect(screen.queryByTestId('avatar')).toBeNull();
    expect(screen.queryByTestId('addon')).toBeNull();
    unmount();
    wrap(
      <PageHeader
        title="Social Bee"
        back={{ to: '/admin/workspaces', label: 'Workspaces' }}
        leading={<span data-testid="avatar">S</span>}
        titleAddon={<span data-testid="addon">Ativo</span>}
      />,
    );
    expect(screen.queryByTestId('avatar')).toBeNull();
    expect(screen.queryByTestId('addon')).toBeNull();
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
