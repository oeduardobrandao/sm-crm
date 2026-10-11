import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SegmentedControl } from '../SegmentedControl';

function Harness({
  semantics,
  onChange = () => {},
}: {
  semantics?: 'radiogroup' | 'tablist';
  onChange?: (v: string) => void;
}) {
  const [value, setValue] = useState('etapas');
  return (
    <SegmentedControl
      aria-label="Modo"
      semantics={semantics}
      value={value}
      onChange={(v) => {
        setValue(v);
        onChange(v);
      }}
      options={[
        { value: 'etapas', label: 'Etapas', controls: 'p1', id: 't1' },
        { value: 'status', label: 'Status', controls: 'p2', id: 't2' },
        { value: 'off', label: 'Desligado', disabled: true },
      ]}
    />
  );
}

describe('SegmentedControl', () => {
  it('is a radiogroup by default, with one tab stop on the checked segment', () => {
    render(<Harness />);
    expect(screen.getByRole('radiogroup', { name: 'Modo' })).toBeInTheDocument();
    const etapas = screen.getByRole('radio', { name: 'Etapas' });
    const status = screen.getByRole('radio', { name: 'Status' });
    expect(etapas).toHaveAttribute('aria-checked', 'true');
    expect(etapas).toHaveAttribute('tabindex', '0');
    expect(status).toHaveAttribute('tabindex', '-1');
  });

  it('selects on click and moves selection with the arrow keys, skipping disabled segments', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Status' }));
    expect(onChange).toHaveBeenLastCalledWith('status');
    expect(screen.getByRole('radio', { name: 'Status' })).toHaveAttribute('aria-checked', 'true');

    // Right from the last enabled one wraps to the first (Desligado is disabled).
    fireEvent.keyDown(screen.getByRole('radio', { name: 'Status' }), { key: 'ArrowRight' });
    expect(onChange).toHaveBeenLastCalledWith('etapas');
    expect(screen.getByRole('radio', { name: 'Etapas' })).toHaveFocus();

    fireEvent.keyDown(screen.getByRole('radio', { name: 'Etapas' }), { key: 'End' });
    expect(onChange).toHaveBeenLastCalledWith('status');
  });

  it('uses tab semantics with aria-controls when asked', () => {
    render(<Harness semantics="tablist" />);
    expect(screen.getByRole('tablist', { name: 'Modo' })).toBeInTheDocument();
    const tab = screen.getByRole('tab', { name: 'Etapas' });
    expect(tab).toHaveAttribute('aria-selected', 'true');
    expect(tab).toHaveAttribute('aria-controls', 'p1');
    expect(tab).toHaveAttribute('id', 't1');
  });
});
