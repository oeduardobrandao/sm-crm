import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { InstagramCollaboratorsField } from '../InstagramCollaboratorsField';

type Props = Partial<React.ComponentProps<typeof InstagramCollaboratorsField>>;

function setup(props: Props = {}) {
  const onChange = vi.fn();
  const utils = render(
    <InstagramCollaboratorsField value={[]} onChange={onChange} idPrefix="t" {...props} />,
  );
  return { onChange, user: userEvent.setup(), ...utils };
}

const input = () => screen.getByPlaceholderText('Adicionar @usuário');

describe('InstagramCollaboratorsField', () => {
  it('renders with an empty list, label, counter and help', () => {
    setup();
    expect(screen.getByText('Colaboradores')).toBeInTheDocument();
    expect(screen.getByText('0 de 3')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Cada conta recebe um convite quando o post for publicado e precisa aceitar no próprio Instagram. Só contas públicas.',
      ),
    ).toBeInTheDocument();
    expect(input()).toBeInTheDocument();
  });

  it('adds a username on Enter', async () => {
    const { onChange, user } = setup();
    await user.type(input(), 'clinicaviva{enter}');
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(['clinicaviva']);
  });

  it('normalizes @ and case, and appends to the existing list', async () => {
    const { onChange, user } = setup({ value: ['a'] });
    await user.type(input(), '@Dra.Julia{enter}');
    expect(onChange).toHaveBeenCalledWith(['a', 'dra.julia']);
  });

  it('adds on comma and on space', async () => {
    const a = setup();
    await a.user.type(input(), 'um,');
    expect(a.onChange).toHaveBeenCalledWith(['um']);
    a.unmount();
    const b = setup();
    await b.user.type(input(), 'dois ');
    expect(b.onChange).toHaveBeenCalledWith(['dois']);
  });

  it('adds the pending text on blur', async () => {
    const { onChange, user } = setup();
    await user.type(input(), 'clinicaviva');
    expect(onChange).not.toHaveBeenCalled();
    await user.tab();
    expect(onChange).toHaveBeenCalledWith(['clinicaviva']);
  });

  it('paste adds every valid piece in one onChange', async () => {
    const { onChange, user } = setup();
    await user.click(input());
    await user.paste('@Dra.Julia, @clinicaviva\nhttps://www.instagram.com/nutri.ana/?hl=pt');
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(['dra.julia', 'clinicaviva', 'nutri.ana']);
  });

  it('paste adds the valid pieces and reports the first error', async () => {
    const { onChange, user } = setup();
    await user.click(input());
    await user.paste('ok bad! also');
    expect(onChange).toHaveBeenCalledWith(['ok', 'also']);
    expect(
      screen.getByText('Use só letras, números, ponto e sublinhado, sem espaços.'),
    ).toBeInTheDocument();
  });

  it('paste past the limit keeps the first three', async () => {
    const { onChange, user } = setup();
    await user.click(input());
    await user.paste('a b c d');
    expect(onChange).toHaveBeenCalledWith(['a', 'b', 'c']);
  });

  it('shows the invalid copy and aria-invalid, and does not call onChange', async () => {
    const { onChange, user } = setup();
    await user.type(input(), 'dra*julia{enter}');
    expect(
      screen.getByText('Use só letras, números, ponto e sublinhado, sem espaços.'),
    ).toBeInTheDocument();
    expect(input()).toHaveAttribute('aria-invalid', 'true');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('clears the error when the user edits again', async () => {
    const { user } = setup();
    await user.type(input(), 'a*{enter}');
    expect(input()).toHaveAttribute('aria-invalid', 'true');
    await user.type(input(), 'x');
    expect(input()).not.toHaveAttribute('aria-invalid');
  });

  it('shows the duplicate copy', async () => {
    const { onChange, user } = setup({ value: ['clinicaviva'] });
    await user.type(input(), '@ClinicaViva{enter}');
    expect(screen.getByText('@clinicaviva já está na lista.')).toBeInTheDocument();
    expect(input()).toHaveAttribute('aria-invalid', 'true');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('at 3 the input is gone and the limit line shows', () => {
    setup({ value: ['a', 'b', 'c'] });
    expect(screen.queryByPlaceholderText('Adicionar @usuário')).not.toBeInTheDocument();
    expect(screen.getByText('3 de 3')).toBeInTheDocument();
    expect(
      screen.getByText('Limite de 3 colaboradores por post. Remova um para trocar.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remover @c' })).toBeInTheDocument();
  });

  it('backspace on an empty input removes the last chip', async () => {
    const { onChange, user } = setup({ value: ['a', 'b'] });
    await user.click(input());
    await user.keyboard('{Backspace}');
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(['a']);
  });

  it('backspace with text in the input does not remove a chip', async () => {
    const { onChange, user } = setup({ value: ['a'] });
    await user.type(input(), 'xy{Backspace}');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('the remove button removes that chip', async () => {
    const { onChange, user } = setup({ value: ['a', 'b', 'c'] });
    await user.click(screen.getByRole('button', { name: 'Remover @b' }));
    expect(onChange).toHaveBeenCalledWith(['a', 'c']);
  });

  it('works as a controlled field end to end', async () => {
    function Harness() {
      const [v, setV] = useState<string[]>([]);
      return <InstagramCollaboratorsField value={v} onChange={setV} idPrefix="h" />;
    }
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(input(), 'um,dois,tres,');
    expect(screen.getByText('3 de 3')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Adicionar @usuário')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Remover @dois' }));
    expect(screen.getByText('2 de 3')).toBeInTheDocument();
    expect(input()).toBeInTheDocument();
  });

  it('locked: no remove buttons, no input, lock line (wins over trialOn)', () => {
    setup({ value: ['a'], locked: true, trialOn: true });
    expect(screen.getByText('@a')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Remover/ })).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Adicionar @usuário')).not.toBeInTheDocument();
    expect(screen.getByText('Cancelar agendamento para editar')).toBeInTheDocument();
    expect(screen.queryByText(/Reels de teste não aceitam/)).not.toBeInTheDocument();
  });

  it('trialOn: whole field disabled with the trial line', () => {
    setup({ value: ['a'], trialOn: true });
    expect(input()).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Remover @a' })).toBeDisabled();
    expect(
      screen.getByText(
        'Reels de teste não aceitam colaboradores. Desligue o Reel de teste para convidar.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText('Cancelar agendamento para editar')).not.toBeInTheDocument();
  });

  it('refused: danger chip and singular line', () => {
    setup({ value: ['clinicaviva', 'ok'], refused: ['clinicaviva'] });
    expect(screen.getByTestId('collab-chip-clinicaviva')).toHaveAttribute('data-refused', 'true');
    expect(screen.getByTestId('collab-chip-ok')).not.toHaveAttribute('data-refused');
    expect(
      screen.getByText('O Instagram não encontrou este perfil, ou ele é privado.'),
    ).toBeInTheDocument();
  });

  it('refused: plural line for two', () => {
    setup({ value: ['a', 'b'], refused: ['a', 'b'] });
    expect(
      screen.getByText('O Instagram não encontrou estes perfis, ou eles são privados.'),
    ).toBeInTheDocument();
  });

  it('empty refused: no red chip, no line', () => {
    setup({ value: ['a'], refused: [] });
    expect(screen.getByTestId('collab-chip-a')).not.toHaveAttribute('data-refused');
    expect(screen.queryByText(/O Instagram não encontrou/)).not.toBeInTheDocument();
  });

  it('forwards inputRef', () => {
    const ref = { current: null as HTMLInputElement | null };
    setup({ inputRef: ref });
    expect(ref.current).toBe(input());
  });
});
