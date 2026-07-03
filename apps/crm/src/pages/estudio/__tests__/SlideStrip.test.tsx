// RTL tests for T2.10 SlideStrip (docs/estudio-design.md §6.1/§6.4). Mocks `usePageThumbnails`
// so this file stays focused on selection/format-gating/add-remove-duplicate/reorder-wiring
// logic rather than the real satori pipeline (that's usePageThumbnails.test.ts's concern) —
// same "mock the render hook, test the shell" split as InteractionOverlay.test.tsx mocking
// useSatoriRenderer.
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { DragEndEvent } from '@dnd-kit/core';
import { makeDoc, makePage } from './fixtures';

const thumbnailsState: { thumbnails: Map<string, string> } = { thumbnails: new Map() };
vi.mock('../hooks/usePageThumbnails', () => ({
  usePageThumbnails: () => ({
    thumbnails: thumbnailsState.thumbnails,
    isLoading: false,
    error: null,
  }),
}));

// jsdom can't drive a real PointerSensor drag (no precedent for `DragEndEvent` elsewhere in this
// repo's tests — grepped, none found), so we capture the `onDragEnd` callback DndContext was
// given and invoke it directly with a synthetic `{ active: { id }, over: { id } }` object, same
// shape SlideStrip's own `handleDragEnd` reads off a real DragEndEvent. `DndContext` itself is
// mocked to just render its children plus stash the callback; `SortableContext`/`useSortable`
// are left real since they don't require an actual pointer gesture to render.
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
import { SlideStrip } from '../components/SlideStrip/SlideStrip';

describe('SlideStrip', () => {
  beforeEach(() => {
    thumbnailsState.thumbnails = new Map();
    capturedOnDragEnd = null;
  });

  it('renders one tile per doc.pages entry', () => {
    const doc = makeDoc({
      format: 'carrossel',
      pages: [makePage({ id: 'p1' }), makePage({ id: 'p2' }), makePage({ id: 'p3' })],
    });
    render(
      <SlideStrip
        doc={doc}
        activePageId="p1"
        setActivePage={vi.fn()}
        onAddPage={vi.fn()}
        onDuplicatePage={vi.fn()}
        onRemovePage={vi.fn()}
        onReorderPages={vi.fn()}
      />,
    );
    expect(screen.getByLabelText('Página 1')).toBeInTheDocument();
    expect(screen.getByLabelText('Página 2')).toBeInTheDocument();
    expect(screen.getByLabelText('Página 3')).toBeInTheDocument();
  });

  it('shows a neutral placeholder for a page whose thumbnail has not resolved yet', () => {
    const doc = makeDoc({ format: 'carrossel', pages: [makePage({ id: 'p1' })] });
    render(
      <SlideStrip
        doc={doc}
        activePageId="p1"
        setActivePage={vi.fn()}
        onAddPage={vi.fn()}
        onDuplicatePage={vi.fn()}
        onRemovePage={vi.fn()}
        onReorderPages={vi.fn()}
      />,
    );
    expect(screen.getByTestId('slide-tile-placeholder')).toBeInTheDocument();
    expect(screen.queryByTestId('slide-tile-thumbnail')).not.toBeInTheDocument();
  });

  it('renders the resolved thumbnail once available', () => {
    thumbnailsState.thumbnails = new Map([['p1', '<svg width="10" height="10"></svg>']]);
    const doc = makeDoc({ format: 'carrossel', pages: [makePage({ id: 'p1' })] });
    render(
      <SlideStrip
        doc={doc}
        activePageId="p1"
        setActivePage={vi.fn()}
        onAddPage={vi.fn()}
        onDuplicatePage={vi.fn()}
        onRemovePage={vi.fn()}
        onReorderPages={vi.fn()}
      />,
    );
    expect(screen.getByTestId('slide-tile-thumbnail')).toBeInTheDocument();
    expect(screen.queryByTestId('slide-tile-placeholder')).not.toBeInTheDocument();
  });

  it('clicking a tile calls setActivePage with that page id', () => {
    const doc = makeDoc({
      format: 'carrossel',
      pages: [makePage({ id: 'p1' }), makePage({ id: 'p2' })],
    });
    const setActivePage = vi.fn();
    render(
      <SlideStrip
        doc={doc}
        activePageId="p1"
        setActivePage={setActivePage}
        onAddPage={vi.fn()}
        onDuplicatePage={vi.fn()}
        onRemovePage={vi.fn()}
        onReorderPages={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByLabelText('Página 2'));
    expect(setActivePage).toHaveBeenCalledWith('p2');
  });

  it('marks the active page tile with aria-pressed=true and others false', () => {
    const doc = makeDoc({
      format: 'carrossel',
      pages: [makePage({ id: 'p1' }), makePage({ id: 'p2' })],
    });
    render(
      <SlideStrip
        doc={doc}
        activePageId="p2"
        setActivePage={vi.fn()}
        onAddPage={vi.fn()}
        onDuplicatePage={vi.fn()}
        onRemovePage={vi.fn()}
        onReorderPages={vi.fn()}
      />,
    );
    expect(screen.getByLabelText('Página 1')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByLabelText('Página 2')).toHaveAttribute('aria-pressed', 'true');
  });

  describe('format gating', () => {
    it('shows add/duplicate/remove controls for a carrossel doc', () => {
      const doc = makeDoc({
        format: 'carrossel',
        pages: [makePage({ id: 'p1' }), makePage({ id: 'p2' })],
      });
      render(
        <SlideStrip
          doc={doc}
          activePageId="p1"
          setActivePage={vi.fn()}
          onAddPage={vi.fn()}
          onDuplicatePage={vi.fn()}
          onRemovePage={vi.fn()}
          onReorderPages={vi.fn()}
        />,
      );
      expect(screen.getByLabelText('Adicionar página')).toBeInTheDocument();
      expect(screen.getAllByLabelText('Duplicar página').length).toBe(2);
      expect(screen.getAllByLabelText('Remover página').length).toBe(2);
    });

    it('hides add/duplicate/remove controls for a feed (single-page, non-carrossel) doc', () => {
      const doc = makeDoc({ format: 'feed', pages: [makePage({ id: 'p1' })] });
      render(
        <SlideStrip
          doc={doc}
          activePageId="p1"
          setActivePage={vi.fn()}
          onAddPage={vi.fn()}
          onDuplicatePage={vi.fn()}
          onRemovePage={vi.fn()}
          onReorderPages={vi.fn()}
        />,
      );
      expect(screen.queryByLabelText('Adicionar página')).not.toBeInTheDocument();
      expect(screen.queryByLabelText('Duplicar página')).not.toBeInTheDocument();
      expect(screen.queryByLabelText('Remover página')).not.toBeInTheDocument();
    });

    it('hides add/duplicate/remove controls for a reel_cover (single-page, non-carrossel) doc', () => {
      const doc = makeDoc({ format: 'reel_cover', pages: [makePage({ id: 'p1' })] });
      render(
        <SlideStrip
          doc={doc}
          activePageId="p1"
          setActivePage={vi.fn()}
          onAddPage={vi.fn()}
          onDuplicatePage={vi.fn()}
          onRemovePage={vi.fn()}
          onReorderPages={vi.fn()}
        />,
      );
      expect(screen.queryByLabelText('Adicionar página')).not.toBeInTheDocument();
    });

    it('renders the single tile of a non-carrossel doc as genuinely non-interactive — no role="button", not tab-focusable, click is a no-op (regression: previously stayed clickable/tabIndex=0/role=button regardless of format, misleadingly presenting a dead-end affordance)', () => {
      const doc = makeDoc({ format: 'feed', pages: [makePage({ id: 'p1' })] });
      const setActivePage = vi.fn();
      render(
        <SlideStrip
          doc={doc}
          activePageId="p1"
          setActivePage={setActivePage}
          onAddPage={vi.fn()}
          onDuplicatePage={vi.fn()}
          onRemovePage={vi.fn()}
          onReorderPages={vi.fn()}
        />,
      );
      const tile = screen.getByLabelText('Página 1');
      expect(tile).not.toHaveAttribute('role', 'button');
      expect(tile).not.toHaveAttribute('tabIndex');
      fireEvent.click(tile);
      expect(setActivePage).not.toHaveBeenCalled();
    });
  });

  describe('add-page cap', () => {
    it('disables "add page" once doc.pages.length reaches 10', () => {
      const doc = makeDoc({
        format: 'carrossel',
        pages: Array.from({ length: 10 }, (_, i) => makePage({ id: `p${i + 1}` })),
      });
      render(
        <SlideStrip
          doc={doc}
          activePageId="p1"
          setActivePage={vi.fn()}
          onAddPage={vi.fn()}
          onDuplicatePage={vi.fn()}
          onRemovePage={vi.fn()}
          onReorderPages={vi.fn()}
        />,
      );
      expect(screen.getByLabelText('Adicionar página')).toBeDisabled();
    });

    it('leaves "add page" enabled below the 10-page cap', () => {
      const doc = makeDoc({
        format: 'carrossel',
        pages: Array.from({ length: 9 }, (_, i) => makePage({ id: `p${i + 1}` })),
      });
      render(
        <SlideStrip
          doc={doc}
          activePageId="p1"
          setActivePage={vi.fn()}
          onAddPage={vi.fn()}
          onDuplicatePage={vi.fn()}
          onRemovePage={vi.fn()}
          onReorderPages={vi.fn()}
        />,
      );
      expect(screen.getByLabelText('Adicionar página')).not.toBeDisabled();
    });

    it('calls onAddPage when clicked', () => {
      const doc = makeDoc({
        format: 'carrossel',
        pages: [makePage({ id: 'p1' }), makePage({ id: 'p2' })],
      });
      const onAddPage = vi.fn();
      render(
        <SlideStrip
          doc={doc}
          activePageId="p1"
          setActivePage={vi.fn()}
          onAddPage={onAddPage}
          onDuplicatePage={vi.fn()}
          onRemovePage={vi.fn()}
          onReorderPages={vi.fn()}
        />,
      );
      fireEvent.click(screen.getByLabelText('Adicionar página'));
      expect(onAddPage).toHaveBeenCalledTimes(1);
    });
  });

  describe('delete-disabled at 1 page', () => {
    it('disables the remove button when doc.pages.length === 1', () => {
      // Force carrossel with a single page to check UI gating independent of removePage's own
      // reducer-level no-op defense.
      const doc = makeDoc({ format: 'carrossel', pages: [makePage({ id: 'p1' })] });
      render(
        <SlideStrip
          doc={doc}
          activePageId="p1"
          setActivePage={vi.fn()}
          onAddPage={vi.fn()}
          onDuplicatePage={vi.fn()}
          onRemovePage={vi.fn()}
          onReorderPages={vi.fn()}
        />,
      );
      expect(screen.getByLabelText('Remover página')).toBeDisabled();
    });

    it('enables remove and calls onRemovePage with the page id when pages.length > 1', () => {
      const doc = makeDoc({
        format: 'carrossel',
        pages: [makePage({ id: 'p1' }), makePage({ id: 'p2' })],
      });
      const onRemovePage = vi.fn();
      render(
        <SlideStrip
          doc={doc}
          activePageId="p1"
          setActivePage={vi.fn()}
          onAddPage={vi.fn()}
          onDuplicatePage={vi.fn()}
          onRemovePage={onRemovePage}
          onReorderPages={vi.fn()}
        />,
      );
      const removeButtons = screen.getAllByLabelText('Remover página');
      expect(removeButtons[0]).not.toBeDisabled();
      fireEvent.click(removeButtons[0]);
      expect(onRemovePage).toHaveBeenCalledWith('p1');
    });
  });

  describe('duplicate', () => {
    it('calls onDuplicatePage with the correct page id', () => {
      const doc = makeDoc({
        format: 'carrossel',
        pages: [makePage({ id: 'p1' }), makePage({ id: 'p2' })],
      });
      const onDuplicatePage = vi.fn();
      render(
        <SlideStrip
          doc={doc}
          activePageId="p1"
          setActivePage={vi.fn()}
          onAddPage={vi.fn()}
          onDuplicatePage={onDuplicatePage}
          onRemovePage={vi.fn()}
          onReorderPages={vi.fn()}
        />,
      );
      const dupButtons = screen.getAllByLabelText('Duplicar página');
      fireEvent.click(dupButtons[1]);
      expect(onDuplicatePage).toHaveBeenCalledWith('p2');
    });
  });

  describe('reordering', () => {
    function fireDragEnd(activeId: string, overId: string) {
      capturedOnDragEnd?.({
        active: { id: activeId },
        over: { id: overId },
      } as unknown as DragEndEvent);
    }

    it('calls onReorderPages with correct from/to indices on drag end', () => {
      const doc = makeDoc({
        format: 'carrossel',
        pages: [makePage({ id: 'p1' }), makePage({ id: 'p2' }), makePage({ id: 'p3' })],
      });
      const onReorderPages = vi.fn();
      render(
        <SlideStrip
          doc={doc}
          activePageId="p1"
          setActivePage={vi.fn()}
          onAddPage={vi.fn()}
          onDuplicatePage={vi.fn()}
          onRemovePage={vi.fn()}
          onReorderPages={onReorderPages}
        />,
      );

      expect(capturedOnDragEnd).not.toBeNull();
      fireDragEnd('p1', 'p3'); // drag first tile onto the third tile's slot
      expect(onReorderPages).toHaveBeenCalledWith(0, 2);
    });

    it('does nothing when there is no drop target (over is null)', () => {
      const doc = makeDoc({
        format: 'carrossel',
        pages: [makePage({ id: 'p1' }), makePage({ id: 'p2' })],
      });
      const onReorderPages = vi.fn();
      render(
        <SlideStrip
          doc={doc}
          activePageId="p1"
          setActivePage={vi.fn()}
          onAddPage={vi.fn()}
          onDuplicatePage={vi.fn()}
          onRemovePage={vi.fn()}
          onReorderPages={onReorderPages}
        />,
      );
      capturedOnDragEnd?.({ active: { id: 'p1' }, over: null } as unknown as DragEndEvent);
      expect(onReorderPages).not.toHaveBeenCalled();
    });

    it('does nothing when dropped on itself', () => {
      const doc = makeDoc({
        format: 'carrossel',
        pages: [makePage({ id: 'p1' }), makePage({ id: 'p2' })],
      });
      const onReorderPages = vi.fn();
      render(
        <SlideStrip
          doc={doc}
          activePageId="p1"
          setActivePage={vi.fn()}
          onAddPage={vi.fn()}
          onDuplicatePage={vi.fn()}
          onRemovePage={vi.fn()}
          onReorderPages={onReorderPages}
        />,
      );
      fireDragEnd('p1', 'p1');
      expect(onReorderPages).not.toHaveBeenCalled();
    });

    it('does not reorder a non-carrossel (single, non-interactive) doc even if invoked', () => {
      const doc = makeDoc({ format: 'feed', pages: [makePage({ id: 'p1' })] });
      const onReorderPages = vi.fn();
      render(
        <SlideStrip
          doc={doc}
          activePageId="p1"
          setActivePage={vi.fn()}
          onAddPage={vi.fn()}
          onDuplicatePage={vi.fn()}
          onRemovePage={vi.fn()}
          onReorderPages={onReorderPages}
        />,
      );
      fireDragEnd('p1', 'p1');
      expect(onReorderPages).not.toHaveBeenCalled();
    });
  });
});
