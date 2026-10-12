import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FormRow } from '../src/FormRow';
import { GroupedList } from '../src/GroupedList';

function inList(ui: React.ReactNode) {
  return render(<GroupedList aria-label="Formulário">{ui}</GroupedList>);
}

describe('FormRow', () => {
  it('labels a text input and passes its props through', () => {
    const onChange = vi.fn();
    inList(
      <FormRow
        label="Descrição"
        input={{ value: 'Mensalidade', onChange, placeholder: 'Ex.: Mensalidade' }}
      />,
    );
    const input = screen.getByLabelText('Descrição');
    expect(input.tagName).toBe('INPUT');
    expect(input).toHaveAttribute('type', 'text');
    expect(input).toHaveValue('Mensalidade');
    fireEvent.change(input, { target: { value: 'Produção' } });
    expect(onChange).toHaveBeenCalled();
    // Inline by default: label and control on one line.
    expect(input.closest('li')).toHaveClass('phone-form-row--inline');
  });

  it('keeps a caller-provided id for the input', () => {
    inList(<FormRow label="Valor" input={{ id: 'valor', type: 'number', defaultValue: 10 }} />);
    expect(screen.getByLabelText('Valor')).toHaveAttribute('id', 'valor');
    expect(screen.getByLabelText('Valor')).toHaveAttribute('type', 'number');
  });

  it('stacks a textarea under its label by default', () => {
    inList(<FormRow label="Observações" textarea={{ defaultValue: 'Oi' }} />);
    const area = screen.getByLabelText('Observações');
    expect(area.tagName).toBe('TEXTAREA');
    expect(area.closest('li')).toHaveClass('phone-form-row--stacked');
  });

  it('links the helper text through aria-describedby', () => {
    inList(<FormRow label="Dia de pagamento" helper="De 1 a 31." input={{}} />);
    const input = screen.getByLabelText('Dia de pagamento');
    expect(input).toHaveAccessibleDescription('De 1 a 31.');
    expect(input).not.toHaveAttribute('aria-invalid');
  });

  it('shows an error instead of the helper and marks the control invalid', () => {
    inList(
      <FormRow
        label="Nome"
        helper="Como aparece para o cliente."
        error="Informe o nome."
        input={{ 'aria-describedby': 'extra' }}
      />,
    );
    const input = screen.getByLabelText('Nome');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input.getAttribute('aria-describedby')).toMatch(/^extra /);
    expect(screen.getByText('Informe o nome.')).toBeInTheDocument();
    expect(screen.queryByText('Como aparece para o cliente.')).toBeNull();
    expect(input.closest('li')).toHaveClass('phone-form-row--error');
  });

  it('renders a tappable read-only value with a chevron', () => {
    const onClick = vi.fn();
    inList(<FormRow label="Data" value="10 de out. de 2026" onClick={onClick} />);
    const button = screen.getByRole('button', { name: /Data/ });
    expect(button).toHaveTextContent('10 de out. de 2026');
    expect(button.querySelector('.phone-form-row__chevron')).not.toBeNull();
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('shows the placeholder for an empty read-only value, without a button', () => {
    inList(<FormRow label="Plano" value="" placeholder="Nenhum" />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('Nenhum')).toHaveClass('phone-form-row__value--placeholder');
  });

  it('wires a custom control to the label and the footnote', () => {
    function Harness() {
      const [v, setV] = useState('a');
      return (
        <FormRow label="Tipo" helper="Escolha um tipo." accessory={<span>un.</span>}>
          {(field) => (
            <select {...field} value={v} onChange={(e) => setV(e.target.value)}>
              <option value="a">A</option>
              <option value="b">B</option>
            </select>
          )}
        </FormRow>
      );
    }
    inList(<Harness />);
    const select = screen.getByLabelText('Tipo');
    expect(select.tagName).toBe('SELECT');
    expect(select).toHaveAccessibleDescription('Escolha um tipo.');
    expect(screen.getByText('un.')).toBeInTheDocument();
  });

  it('disables the control', () => {
    inList(<FormRow label="E-mail" disabled input={{ type: 'email' }} />);
    expect(screen.getByLabelText('E-mail')).toBeDisabled();
  });
});
