import { createRef } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@mesaas/app-lifecycle', () => ({ useUnsavedWork: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { toast } from 'sonner';
import { useUnsavedWork } from '@mesaas/app-lifecycle';
import {
  DestinationCaptionField,
  type DestinationCaptionFieldHandle,
} from '../DestinationCaptionField';

const base = {
  id: 'cap-1',
  label: 'Legenda do TikTok',
  value: 'oi',
  max: 2200 as number | null,
  placeholder: 'Texto',
};

describe('DestinationCaptionField', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('shows the per-platform counter, or a plain count without a limit', () => {
    const { rerender } = render(<DestinationCaptionField {...base} onSave={vi.fn()} />);
    expect(screen.getByText('2 / 2200')).toBeInTheDocument();
    rerender(<DestinationCaptionField {...base} max={null} onSave={vi.fn()} />);
    expect(screen.getByText('2 caracteres')).toBeInTheDocument();
  });

  it('autosaves after the debounce and registers unsaved work while dirty', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<DestinationCaptionField {...base} onSave={onSave} />);
    fireEvent.change(screen.getByLabelText('Legenda do TikTok'), { target: { value: 'oi!' } });
    expect(vi.mocked(useUnsavedWork)).toHaveBeenLastCalledWith(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(onSave).toHaveBeenCalledWith('oi!');
  });

  it('is read-only when disabled', () => {
    render(<DestinationCaptionField {...base} disabled onSave={vi.fn()} />);
    expect(screen.getByLabelText('Legenda do TikTok')).toHaveAttribute('readonly');
  });

  it('exposes getText() with the unsaved draft', () => {
    const ref = createRef<DestinationCaptionFieldHandle>();
    render(<DestinationCaptionField ref={ref} {...base} onSave={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Legenda do TikTok'), { target: { value: 'novo' } });
    expect(ref.current!.getText()).toBe('novo');
  });

  it('copies the caption', async () => {
    vi.useRealTimers();
    const writeText = vi.fn().mockResolvedValue(undefined);
    // jsdom expõe navigator.clipboard só com getter: Object.assign quebraria.
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<DestinationCaptionField {...base} showCopy onSave={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Copiar legenda/ }));
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith('oi'));
    await vi.waitFor(() => expect(toast.success).toHaveBeenCalledWith('Legenda copiada.'));
  });
});
