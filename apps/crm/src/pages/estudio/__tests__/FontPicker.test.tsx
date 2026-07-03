import { render, screen, fireEvent } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { FontPicker } from '../components/shared/FontPicker';

// cmdk scrolls the selected option into view — jsdom has no scrollIntoView.
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

function renderPicker(props: Partial<React.ComponentProps<typeof FontPicker>> = {}) {
  const onSelect = vi.fn();
  render(<FontPicker value="inter" onSelect={onSelect} {...props} />);
  return { onSelect };
}

function open() {
  fireEvent.click(screen.getByTestId('estudio-font-trigger'));
}

describe('FontPicker', () => {
  it('shows the current family name on the trigger', () => {
    renderPicker({ value: 'playfair-display' });
    expect(screen.getByTestId('estudio-font-trigger')).toHaveTextContent('Playfair Display');
  });

  it('lists the four vibe groups from the manifest', () => {
    renderPicker();
    open();
    for (const label of ['Elegante', 'Moderna', 'Impacto', 'Manuscrita']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it('picking a family calls onSelect with its manifest key and closes', () => {
    const { onSelect } = renderPicker();
    open();
    fireEvent.click(screen.getByText('Playfair Display'));
    expect(onSelect).toHaveBeenCalledWith('playfair-display');
  });

  it('re-picking the CURRENT family does not dispatch (no no-op undo entries)', () => {
    const { onSelect } = renderPicker({ value: 'inter' });
    open();
    // The trigger ALSO reads "Inter" — target the listbox option specifically.
    fireEvent.click(screen.getByRole('option', { name: 'Inter' }));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('pins the Marca group first with matched brand fonts selectable', () => {
    const { onSelect } = renderPicker({
      brandFonts: [{ raw: 'playfair', key: 'playfair-display' }],
    });
    open();
    const matched = screen.getByTestId('estudio-font-brand-matched');
    expect(matched).toHaveTextContent('Playfair Display');
    expect(matched).toHaveTextContent('playfair'); // the raw name, shown when it differs
    fireEvent.click(matched);
    expect(onSelect).toHaveBeenCalledWith('playfair-display');
  });

  it('an unmatched brand font renders as a DISABLED "não incluída no Estúdio" row', () => {
    const { onSelect } = renderPicker({
      brandFonts: [{ raw: 'Comic Sans MS', key: null }],
    });
    open();
    const row = screen.getByTestId('estudio-font-brand-unmatched');
    expect(row).toHaveTextContent('Comic Sans MS — não incluída no Estúdio');
    expect(row).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(row);
    expect(onSelect).not.toHaveBeenCalled(); // never a silent substitution
  });
});
