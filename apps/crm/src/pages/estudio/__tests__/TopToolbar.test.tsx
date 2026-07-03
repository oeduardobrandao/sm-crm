// TopToolbar (design §6.1): save pill states, undo/redo wiring, zoom control.
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TopToolbar } from '../components/Toolbar/TopToolbar';
import type { AutosaveStatus } from '../hooks/useAutosave';

function renderBar(overrides: Partial<Parameters<typeof TopToolbar>[0]> = {}) {
  const onUndo = vi.fn();
  const onRedo = vi.fn();
  const onZoomReset = vi.fn();
  render(
    <TopToolbar
      title="Estúdio"
      summary="1 página · 3 camadas"
      saveStatus="saved"
      canUndo
      canRedo={false}
      onUndo={onUndo}
      onRedo={onRedo}
      {...overrides}
    />,
  );
  return { onUndo, onRedo, onZoomReset };
}

describe('TopToolbar', () => {
  it.each<AutosaveStatus>(['saved', 'saving', 'dirty', 'conflict'])(
    'renders the %s save-pill state',
    (status) => {
      renderBar({ saveStatus: status });
      expect(screen.getByTestId('estudio-save-pill').dataset.status).toBe(status);
    },
  );

  it('wires undo/redo buttons and disables them per canUndo/canRedo', () => {
    const { onUndo, onRedo } = renderBar();
    const undo = screen.getByRole('button', { name: 'Desfazer' });
    const redo = screen.getByRole('button', { name: 'Refazer' });
    expect(undo).toBeEnabled();
    expect(redo).toBeDisabled();
    fireEvent.click(undo);
    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(onRedo).not.toHaveBeenCalled();
  });

  it('shows the zoom percentage and resets on click; hidden while the view is not mounted', () => {
    const onZoomReset = vi.fn();
    renderBar({ zoom: 0.4167, onZoomReset });
    const zoomButton = screen.getByRole('button', { name: 'Ajustar à tela' });
    expect(zoomButton).toHaveTextContent('42%');
    fireEvent.click(zoomButton);
    expect(onZoomReset).toHaveBeenCalledTimes(1);
  });

  it('renders no zoom control when zoom is undefined', () => {
    renderBar({ zoom: undefined });
    expect(screen.queryByRole('button', { name: 'Ajustar à tela' })).not.toBeInTheDocument();
  });
});
