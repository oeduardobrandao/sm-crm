// RTL tests for T7.4 LayerListPanel. Same "mock DndContext to capture onDragEnd, keep
// SortableContext/useSortable real" split as SlideStrip.test.tsx — jsdom can't drive a real
// PointerSensor drag, so reorder is verified by invoking the captured callback directly.
import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { DragEndEvent } from '@dnd-kit/core';
import { makeTextLayer, makeImageLayer, makeShapeLayer } from './fixtures';
import type { NormalizedLayer } from '../types';

let capturedOnDragEnd: ((e: DragEndEvent) => void) | null = null;
vi.mock('@dnd-kit/core', async () => {
  const actual = await vi.importActual<typeof import('@dnd-kit/core')>('@dnd-kit/core');
  return {
    ...actual,
    DndContext: ({
      onDragEnd,
      children,
    }: {
      onDragEnd: (e: DragEndEvent) => void;
      children: React.ReactNode;
    }) => {
      capturedOnDragEnd = onDragEnd;
      return children;
    },
  };
});

import type React from 'react';
import { LayerListPanel } from '../components/Layers/LayerListPanel';

// Bottom → top in doc order; the panel must render them top-first (Charlie, Bravo, Alpha).
function threeLayers(): NormalizedLayer[] {
  return [
    makeTextLayer({ id: 'A', name: 'Alpha' }),
    makeImageLayer({ id: 'B', name: 'Bravo' }),
    makeShapeLayer({ id: 'C', name: 'Charlie' }),
  ];
}

function setup(overrides: Partial<React.ComponentProps<typeof LayerListPanel>> = {}) {
  const onSelect = vi.fn();
  const onReorder = vi.fn();
  const onToggleLock = vi.fn();
  render(
    <LayerListPanel
      layers={threeLayers()}
      selection={[]}
      onSelect={onSelect}
      onReorder={onReorder}
      onToggleLock={onToggleLock}
      {...overrides}
    />,
  );
  return { onSelect, onReorder, onToggleLock };
}

describe('LayerListPanel', () => {
  beforeEach(() => {
    capturedOnDragEnd = null;
  });

  it('lists layers topmost-first (reverse of doc paint order)', () => {
    setup();
    const rows = screen.getAllByTestId(/^layer-row-/);
    expect(rows.map((r) => r.getAttribute('data-testid'))).toEqual([
      'layer-row-C',
      'layer-row-B',
      'layer-row-A',
    ]);
  });

  it('renders each layer name', () => {
    setup();
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('Bravo')).toBeInTheDocument();
    expect(screen.getByText('Charlie')).toBeInTheDocument();
  });

  it('clicking a row selects that single layer', () => {
    const { onSelect } = setup();
    fireEvent.click(screen.getByText('Bravo'));
    expect(onSelect).toHaveBeenCalledWith(['B']);
  });

  it('marks the selected row via aria-pressed', () => {
    setup({ selection: ['B'] });
    const row = screen.getByTestId('layer-row-B');
    expect(within(row).getByRole('button', { pressed: true })).toBeInTheDocument();
  });

  it('the lock toggle locks an unlocked layer', () => {
    const { onToggleLock } = setup();
    const row = screen.getByTestId('layer-row-A');
    fireEvent.click(within(row).getByLabelText('Bloquear camada'));
    expect(onToggleLock).toHaveBeenCalledWith('A', true);
  });

  it('the lock toggle unlocks a locked layer', () => {
    const onToggleLock = vi.fn();
    render(
      <LayerListPanel
        layers={[makeTextLayer({ id: 'L', name: 'Locked', locked: true })]}
        selection={[]}
        onSelect={vi.fn()}
        onReorder={vi.fn()}
        onToggleLock={onToggleLock}
      />,
    );
    fireEvent.click(screen.getByLabelText('Desbloquear camada'));
    expect(onToggleLock).toHaveBeenCalledWith('L', false);
  });

  it('has NO hide/visibility control (schema has no `hidden` field, plan §15)', () => {
    setup();
    expect(screen.queryByLabelText(/ocultar|hide|esconder/i)).toBeNull();
  });

  it('dragging the top row onto the bottom row reorders to array index 0', () => {
    const { onReorder } = setup();
    // display = [C(top), B, A(bottom)]; drag C onto A → C moves to the bottom of the stack.
    capturedOnDragEnd!({ active: { id: 'C' }, over: { id: 'A' } } as DragEndEvent);
    expect(onReorder).toHaveBeenCalledWith('C', 0);
  });

  it('dragging the bottom row onto the top row reorders to the top array index', () => {
    const { onReorder } = setup();
    // drag A onto C → A moves to the top of the stack (array index n-1 = 2).
    capturedOnDragEnd!({ active: { id: 'A' }, over: { id: 'C' } } as DragEndEvent);
    expect(onReorder).toHaveBeenCalledWith('A', 2);
  });

  it('a drop onto itself does not reorder', () => {
    const { onReorder } = setup();
    capturedOnDragEnd!({ active: { id: 'B' }, over: { id: 'B' } } as DragEndEvent);
    expect(onReorder).not.toHaveBeenCalled();
  });

  it('shows an empty state when there are no layers', () => {
    render(
      <LayerListPanel
        layers={[]}
        selection={[]}
        onSelect={vi.fn()}
        onReorder={vi.fn()}
        onToggleLock={vi.fn()}
      />,
    );
    expect(screen.getByText('Nenhuma camada ainda')).toBeInTheDocument();
  });
});
