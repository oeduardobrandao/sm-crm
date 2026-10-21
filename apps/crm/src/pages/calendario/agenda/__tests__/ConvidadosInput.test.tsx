import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { AgendaConvidadoInput } from '../../../../store/agenda';
import { ConvidadosInput } from '../ConvidadosInput';

function Host({
  inicial = [],
  onChange,
  max,
}: {
  inicial?: AgendaConvidadoInput[];
  onChange?: (v: AgendaConvidadoInput[]) => void;
  max?: number;
}) {
  const [value, setValue] = useState(inicial);
  return (
    <ConvidadosInput
      value={value}
      max={max}
      onChange={(v) => {
        setValue(v);
        onChange?.(v);
      }}
    />
  );
}

const campo = () => screen.getByRole('textbox', { name: 'E-mail do convidado' });
const convidado = (email: string, nome: string | null = null) => ({ email, nome });

describe('ConvidadosInput', () => {
  it('commits a chip on Enter', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Host onChange={onChange} />);
    await user.type(campo(), 'ana@exemplo.com{Enter}');
    expect(onChange).toHaveBeenLastCalledWith([convidado('ana@exemplo.com')]);
    expect(screen.getByRole('button', { name: 'Remover ana@exemplo.com' })).toBeInTheDocument();
    expect(campo()).toHaveValue('');
  });

  it('commits on comma and on space, and lower-cases the address', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Host onChange={onChange} />);
    await user.type(campo(), 'Ana@Exemplo.com,');
    await user.type(campo(), 'bia@exemplo.com ');
    expect(onChange).toHaveBeenLastCalledWith([
      convidado('ana@exemplo.com'),
      convidado('bia@exemplo.com'),
    ]);
  });

  it('commits on blur', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Host onChange={onChange} />);
    await user.type(campo(), 'ana@exemplo.com');
    expect(onChange).not.toHaveBeenCalled();
    await user.tab();
    expect(onChange).toHaveBeenLastCalledWith([convidado('ana@exemplo.com')]);
  });

  it('commits every address of a paste', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Host onChange={onChange} />);
    await user.click(campo());
    await user.paste('ana@exemplo.com; bia@exemplo.com\ncaio@exemplo.com');
    await user.tab();
    expect(onChange).toHaveBeenLastCalledWith([
      convidado('ana@exemplo.com'),
      convidado('bia@exemplo.com'),
      convidado('caio@exemplo.com'),
    ]);
  });

  it('flags an invalid address, keeps it in the field and does not commit', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Host onChange={onChange} />);
    await user.type(campo(), 'ana@exemplo{Enter}');
    expect(screen.getByRole('alert')).toHaveTextContent('Informe um e-mail válido.');
    expect(campo()).toHaveValue('ana@exemplo');
    expect(campo()).toHaveAttribute('aria-invalid', 'true');
    expect(onChange).not.toHaveBeenCalled();
    // Typing clears the message; fixing the address commits it.
    await user.type(campo(), '.com{Enter}');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(onChange).toHaveBeenLastCalledWith([convidado('ana@exemplo.com')]);
  });

  it('flags an invalid address on blur too', async () => {
    const user = userEvent.setup();
    render(<Host />);
    await user.type(campo(), 'sem-arroba');
    await user.tab();
    expect(screen.getByRole('alert')).toHaveTextContent('Informe um e-mail válido.');
    expect(screen.queryByRole('button', { name: /Remover/ })).toBeNull();
  });

  it('ignores a duplicate (case-insensitive) without an error', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Host inicial={[convidado('ana@exemplo.com')]} onChange={onChange} />);
    await user.type(campo(), 'ANA@exemplo.com{Enter}');
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getAllByRole('button', { name: /Remover/ })).toHaveLength(1);
    expect(campo()).toHaveValue('');
  });

  it('shows the counter and drops the field at the limit', async () => {
    const user = userEvent.setup();
    render(<Host max={2} />);
    expect(screen.getByText('0 de 2')).toBeInTheDocument();
    await user.type(campo(), 'a@exemplo.com{Enter}');
    expect(screen.getByText('1 de 2')).toBeInTheDocument();
    await user.type(campo(), 'b@exemplo.com{Enter}');
    expect(screen.getByText('2 de 2')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('defaults the limit to 20', () => {
    const cheios = Array.from({ length: 20 }, (_, i) => convidado(`p${i}@exemplo.com`));
    render(<Host inicial={cheios} />);
    expect(screen.getByText('20 de 20')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('Backspace on an empty field removes the last chip, but not while typing', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Host
        inicial={[convidado('ana@exemplo.com'), convidado('bia@exemplo.com')]}
        onChange={onChange}
      />,
    );
    await user.type(campo(), 'x{Backspace}');
    expect(onChange).not.toHaveBeenCalled();
    await user.type(campo(), '{Backspace}');
    expect(onChange).toHaveBeenLastCalledWith([convidado('ana@exemplo.com')]);
    expect(screen.queryByRole('button', { name: 'Remover bia@exemplo.com' })).toBeNull();
  });

  it('removes a chip with its labelled button and shows the name when there is one', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Host inicial={[convidado('ana@exemplo.com', 'Ana Souza')]} onChange={onChange} />);
    expect(screen.getByText('Ana Souza')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Remover ana@exemplo.com' }));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it('Enter never submits the surrounding form', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <Host />
        <button type="submit">Salvar</button>
      </form>,
    );
    await user.type(campo(), '{Enter}');
    await user.type(campo(), 'ana@exemplo.com{Enter}');
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
