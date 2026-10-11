import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Chip, ChipRow } from '../ChipRow';
import { BottomActionBar } from '../BottomActionBar';

describe('ChipRow', () => {
  it('renders toggle chips with aria-pressed and removable filter chips', () => {
    const onRemove = vi.fn();
    render(
      <ChipRow aria-label="Filtros ativos">
        <Chip label="Atrasados" selected onClick={() => {}} />
        <Chip
          label="Café Aurora"
          onRemove={onRemove}
          removeLabel="Remover filtro Cliente: Café Aurora"
        />
      </ChipRow>,
    );
    expect(screen.getByRole('group', { name: 'Filtros ativos' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Atrasados' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Remover filtro Cliente: Café Aurora' }));
    expect(onRemove).toHaveBeenCalled();
  });

  it('works as a tablist with arrow keys', () => {
    function Tabs() {
      const [value, setValue] = useState('producao');
      return (
        <ChipRow aria-label="Etapas" semantics="tablist">
          {['briefing', 'producao', 'aprovacao'].map((id) => (
            <Chip
              key={id}
              label={id}
              count={2}
              selected={value === id}
              onClick={() => setValue(id)}
            />
          ))}
        </ChipRow>
      );
    }
    render(<Tabs />);
    const producao = screen.getByRole('tab', { name: /producao/ });
    expect(producao).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /briefing/ })).toHaveAttribute('tabindex', '-1');
    producao.focus();
    fireEvent.keyDown(producao, { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: /aprovacao/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /aprovacao/ })).toHaveFocus();
  });
});

describe('BottomActionBar', () => {
  it('renders its actions plus an in-flow spacer, and is not a dialog', () => {
    const { container } = render(
      <BottomActionBar aria-label="Ações do post">
        <button type="button">Enviar para aprovação</button>
      </BottomActionBar>,
    );
    expect(screen.getByRole('button', { name: 'Enviar para aprovação' })).toBeInTheDocument();
    expect(container.querySelector('.phone-bottom-bar__spacer')).toHaveAttribute(
      'aria-hidden',
      'true',
    );
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it('can sit above the tab bar', () => {
    const { container } = render(
      <BottomActionBar aboveTabBar>
        <button type="button">Ver 6</button>
      </BottomActionBar>,
    );
    expect(container.querySelector('.phone-bottom-bar')).toHaveClass(
      'phone-bottom-bar--above-tab-bar',
    );
  });
});
