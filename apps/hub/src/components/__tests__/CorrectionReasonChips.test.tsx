import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CorrectionReasonChips } from '../CorrectionReasonChips';

describe('CorrectionReasonChips', () => {
  it('renders the four reasons inside a labelled group and reports the pressed one', () => {
    const onChange = vi.fn();
    render(<CorrectionReasonChips value="texto" onChange={onChange} />);

    const group = screen.getByRole('group', { name: 'Motivo da correção' });
    expect(group).toBeInTheDocument();
    for (const label of ['Mídia', 'Texto', 'Legenda', 'Outro']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
    expect(screen.getByRole('button', { name: 'Texto' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Legenda' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Legenda' }));
    expect(onChange).toHaveBeenCalledWith('legenda');
  });

  it('deselects the currently selected chip when clicked again', () => {
    const onChange = vi.fn();
    render(<CorrectionReasonChips value="texto" onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Texto' }));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('disables every chip when disabled', () => {
    render(<CorrectionReasonChips value={null} onChange={vi.fn()} disabled />);
    expect(screen.getByRole('button', { name: 'Outro' })).toBeDisabled();
  });
});
