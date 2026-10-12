import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MaisSheet, type MaisSheetProps } from '../MaisSheet';
import { mockPhone } from '../../../__tests__/phone';

function renderMais(overrides: Partial<MaisSheetProps> = {}) {
  const props: MaisSheetProps = {
    open: true,
    onOpenChange: vi.fn(),
    email: 'eduardo@mesaas.com.br',
    theme: 'dark',
    onSetTheme: vi.fn(),
    glassEnabled: false,
    onToggleGlass: vi.fn(),
    onSignOut: vi.fn(),
    ...overrides,
  };
  render(
    <MemoryRouter>
      <MaisSheet {...props} />
    </MemoryRouter>,
  );
  return screen.getByRole('dialog');
}

describe('MaisSheet (board Mais)', () => {
  let restore: () => void;
  beforeEach(() => {
    restore = mockPhone();
  });
  afterEach(() => restore());

  it('shows a visible "Mais" title', () => {
    const sheet = renderMais();
    const title = within(sheet).getByText('Mais');
    expect(title).not.toHaveClass('sr-only');
    expect(sheet).toHaveClass('admin-mais-sheet');
  });

  it('puts the account first, with the e-mail initial as avatar', () => {
    const sheet = renderMais();
    const groups = sheet.querySelectorAll('section.phone-group');
    const account = groups[0] as HTMLElement;
    expect(account).toHaveTextContent('eduardo@mesaas.com.br');
    expect(account).toHaveTextContent('Admin da plataforma');
    expect(account.querySelector('.admin-avatar')).toHaveTextContent('e');
    // The account sits above the page groups.
    expect(groups[1]).toHaveTextContent('Planos');
  });

  it('groups Liquid Glass and Tema escuro under Aparência, before Sair', () => {
    const sheet = renderMais();
    const aparencia = within(sheet).getByRole('list', { name: 'Aparência' });
    expect(within(aparencia).getByRole('switch', { name: 'Liquid Glass' })).toBeInTheDocument();
    expect(within(aparencia).getByRole('switch', { name: 'Tema escuro' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    const groups = Array.from(sheet.querySelectorAll('section.phone-group'));
    const aparenciaIdx = groups.findIndex((g) => g.contains(aparencia));
    const sairIdx = groups.findIndex((g) => g.textContent?.includes('Sair'));
    expect(aparenciaIdx).toBeLessThan(sairIdx);
    expect(within(sheet).queryByText('Conta')).not.toBeInTheDocument();
  });

  it('hides Tema escuro while glass is on and explains why', () => {
    const sheet = renderMais({ glassEnabled: true });
    expect(within(sheet).getByRole('switch', { name: 'Liquid Glass' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(within(sheet).queryByRole('switch', { name: 'Tema escuro' })).not.toBeInTheDocument();
    expect(
      within(sheet).getByText('Com o Liquid Glass ligado o tema fica escuro.'),
    ).toBeInTheDocument();
  });

  it('no e-mail: no account group', () => {
    const sheet = renderMais({ email: null });
    expect(sheet.querySelector('.admin-avatar')).toBeNull();
    expect(within(sheet).queryByText('Admin da plataforma')).not.toBeInTheDocument();
  });
});
