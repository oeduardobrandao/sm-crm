import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { Cell, GroupedList } from '../GroupedList';

function Path() {
  return <div data-testid="path">{useLocation().pathname}</div>;
}

function renderInRouter(ui: React.ReactNode) {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route
          path="*"
          element={
            <>
              {ui}
              <Path />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe('GroupedList', () => {
  it('names the list by its header', () => {
    renderInRouter(
      <GroupedList header="Situação" footer="Escolha uma">
        <Cell label="Atrasados" />
      </GroupedList>,
    );
    expect(screen.getByRole('list', { name: 'Situação' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Situação' })).toBeInTheDocument();
    expect(screen.getByText('Escolha uma')).toBeInTheDocument();
  });

  it('takes an aria-label when there is no visible header', () => {
    renderInRouter(
      <GroupedList aria-label="Conta">
        <Cell label="Sair" destructive onClick={() => {}} />
      </GroupedList>,
    );
    expect(screen.getByRole('list', { name: 'Conta' })).toBeInTheDocument();
  });
});

describe('Cell', () => {
  it('renders a link row with a chevron by default and navigates', () => {
    const { container } = renderInRouter(
      <GroupedList aria-label="g">
        <Cell label="Clientes" to="/clientes" value="12" />
      </GroupedList>,
    );
    const link = screen.getByRole('link', { name: /Clientes/ });
    expect(link).toHaveTextContent('12');
    expect(container.querySelector('.phone-cell__chevron')).not.toBeNull();
    fireEvent.click(link);
    expect(screen.getByTestId('path')).toHaveTextContent('/clientes');
  });

  it('renders a button row that forwards id/data-testid and marks current', () => {
    const onClick = vi.fn();
    renderInRouter(
      <GroupedList aria-label="g">
        <Cell label="Buscar" id="buscar" data-testid="buscar" current onClick={onClick} />
      </GroupedList>,
    );
    const button = screen.getByRole('button', { name: 'Buscar' });
    expect(button).toHaveAttribute('id', 'buscar');
    expect(button).toHaveAttribute('aria-current', 'page');
    expect(document.querySelector('.phone-cell__chevron')).toBeNull();
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('styles destructive rows and disables disabled ones', () => {
    const onClick = vi.fn();
    renderInRouter(
      <GroupedList aria-label="g">
        <Cell label="Excluir" destructive onClick={onClick} />
        <Cell label="Arquivar" disabled onClick={onClick} />
      </GroupedList>,
    );
    expect(screen.getByRole('button', { name: 'Excluir' })).toHaveClass(
      'phone-cell__main--destructive',
    );
    const disabled = screen.getByRole('button', { name: 'Arquivar' });
    expect(disabled).toBeDisabled();
    fireEvent.click(disabled);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('renders a switch named by the label; the switch and the whole row toggle it once', () => {
    const onCheckedChange = vi.fn();
    renderInRouter(
      <GroupedList aria-label="g">
        <Cell id="row" label="Face ID" switch={{ checked: false, onCheckedChange }} />
      </GroupedList>,
    );
    const toggle = screen.getByRole('switch', { name: 'Face ID' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(toggle);
    expect(onCheckedChange).toHaveBeenCalledTimes(1);
    expect(onCheckedChange).toHaveBeenLastCalledWith(true);
    fireEvent.click(document.getElementById('row')!);
    expect(onCheckedChange).toHaveBeenCalledTimes(2);
  });

  it('renders a plain text row when it has no action', () => {
    renderInRouter(
      <GroupedList aria-label="g">
        <Cell label="Plano" value="Pro" />
      </GroupedList>,
    );
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('Pro')).toBeInTheDocument();
  });
});
