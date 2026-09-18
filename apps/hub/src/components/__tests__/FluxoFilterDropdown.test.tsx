import { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { FluxoFilterDropdown, type FluxoFilterOption, type FluxoKey } from '../FluxoFilterDropdown';

const OPTIONS: FluxoFilterOption[] = [
  { key: 'wf-1', label: 'Posts Roberta - Maio', count: 12 },
  { key: 'wf-2', label: 'Campanha', count: 3 },
  { key: 'avulso', label: 'Avulsas', count: 2 },
];

/** Keeps the selection in state so multi-pick flows behave like the page. */
function Harness({
  initial = [],
  onChange,
}: {
  initial?: FluxoKey[];
  onChange?: (next: FluxoKey[]) => void;
}) {
  const [value, setValue] = useState<FluxoKey[]>(initial);
  return (
    <FluxoFilterDropdown
      value={value}
      options={OPTIONS}
      onChange={(next) => {
        onChange?.(next);
        setValue(next);
      }}
    />
  );
}

describe('FluxoFilterDropdown', () => {
  it('renders nothing with one option or fewer', () => {
    const { container, rerender } = render(
      <FluxoFilterDropdown value={[]} options={[OPTIONS[0]]} onChange={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
    rerender(<FluxoFilterDropdown value={[]} options={[]} onChange={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('labels the trigger by selection: none, one, several', () => {
    const { rerender } = render(
      <FluxoFilterDropdown value={[]} options={OPTIONS} onChange={vi.fn()} />,
    );
    const trigger = screen.getByRole('button', { name: 'Fluxos' });
    expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    rerender(<FluxoFilterDropdown value={['wf-2']} options={OPTIONS} onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Campanha' })).toBeInTheDocument();

    rerender(
      <FluxoFilterDropdown value={['wf-2', 'avulso']} options={OPTIONS} onChange={vi.fn()} />,
    );
    expect(screen.getByRole('button', { name: '2 fluxos' })).toBeInTheDocument();
  });

  it('opens on click and lists every option as a checkbox with its count', async () => {
    render(<Harness initial={['wf-2']} />);
    fireEvent.click(screen.getByRole('button', { name: 'Campanha' }));
    const group = await screen.findByRole('group', { name: 'Filtrar por fluxo' });
    expect(screen.getByRole('button', { name: 'Campanha' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    const boxes = screen.getAllByRole('checkbox');
    expect(boxes).toHaveLength(3);
    for (const box of boxes) expect(group).toContainElement(box);
    expect(screen.getByRole('checkbox', { name: 'Posts Roberta - Maio (12)' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Campanha (3)' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Avulsas (2)' })).not.toBeChecked();
  });

  it('toggles a fluxo and keeps the menu open for further picks', async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Fluxos' }));
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Campanha (3)' }));
    expect(onChange).toHaveBeenLastCalledWith(['wf-2']);
    // Still open: pick a second one.
    fireEvent.click(screen.getByRole('checkbox', { name: 'Posts Roberta - Maio (12)' }));
    // Emitted in option order, not click order.
    expect(onChange).toHaveBeenLastCalledWith(['wf-1', 'wf-2']);
    expect(screen.getByRole('group', { name: 'Filtrar por fluxo' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '2 fluxos' })).toBeInTheDocument();
    // Untoggle.
    fireEvent.click(screen.getByRole('checkbox', { name: 'Campanha (3)' }));
    expect(onChange).toHaveBeenLastCalledWith(['wf-1']);
  });

  it('Limpar resets to none selected and is disabled when nothing is selected', async () => {
    const onChange = vi.fn();
    render(<Harness initial={['wf-1', 'avulso']} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: '2 fluxos' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Limpar' }));
    expect(onChange).toHaveBeenLastCalledWith([]);
    expect(screen.getByRole('button', { name: 'Limpar' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Fluxos' })).toBeInTheDocument();
  });

  it('Escape closes the menu and returns focus to the trigger', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'Fluxos' });
    await user.click(trigger);
    await screen.findByRole('group', { name: 'Filtrar por fluxo' });
    await user.keyboard('{Escape}');
    await waitFor(() =>
      expect(screen.queryByRole('group', { name: 'Filtrar por fluxo' })).not.toBeInTheDocument(),
    );
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('closes on an outside click', async () => {
    const user = userEvent.setup();
    render(
      <div>
        <button type="button">Fora</button>
        <Harness />
      </div>,
    );
    await user.click(screen.getByRole('button', { name: 'Fluxos' }));
    await screen.findByRole('group', { name: 'Filtrar por fluxo' });
    await user.click(screen.getByRole('button', { name: 'Fora' }));
    await waitFor(() =>
      expect(screen.queryByRole('group', { name: 'Filtrar por fluxo' })).not.toBeInTheDocument(),
    );
  });

  it('the trigger opens with Enter and Space from the keyboard', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.tab();
    expect(screen.getByRole('button', { name: 'Fluxos' })).toHaveFocus();
    await user.keyboard('{Enter}');
    await screen.findByRole('group', { name: 'Filtrar por fluxo' });
    await user.keyboard('{Escape}');
    await waitFor(() =>
      expect(screen.queryByRole('group', { name: 'Filtrar por fluxo' })).not.toBeInTheDocument(),
    );
    await user.keyboard(' ');
    await screen.findByRole('group', { name: 'Filtrar por fluxo' });
  });
});
