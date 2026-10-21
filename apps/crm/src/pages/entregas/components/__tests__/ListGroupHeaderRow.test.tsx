import type { ComponentProps } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ListGroupHeaderRow } from '../ListGroupHeaderRow';

function renderRow(props: Partial<ComponentProps<typeof ListGroupHeaderRow>> = {}) {
  const onToggle = vi.fn();
  const { container } = render(
    <table>
      <tbody>
        <ListGroupHeaderRow
          label="Sexta-feira"
          sub="2 out"
          count={3}
          colSpan={6}
          collapsed={false}
          onToggle={onToggle}
          {...props}
        />
      </tbody>
    </table>,
  );
  return { onToggle, container };
}

describe('ListGroupHeaderRow', () => {
  it('names the group with its date and count, spans every column and toggles', () => {
    const { onToggle, container } = renderRow();
    const button = screen.getByRole('button', { name: 'Sexta-feira 2 out (3)' });
    expect(button).toHaveAttribute('aria-expanded', 'true');
    const th = container.querySelector('th')!;
    expect(th).toHaveAttribute('colspan', '6');
    expect(th).toHaveAttribute('scope', 'rowgroup');
    fireEvent.click(button);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('reflects the collapsed state and marks Atrasado as danger', () => {
    renderRow({ label: 'Atrasado', sub: undefined, count: 2, collapsed: true, danger: true });
    const button = screen.getByRole('button', { name: 'Atrasado (2)' });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(button).toHaveClass('is-danger');
  });
});
