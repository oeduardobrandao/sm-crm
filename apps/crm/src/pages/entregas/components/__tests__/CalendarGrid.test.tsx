import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi, beforeAll } from 'vitest';
import { CalendarGrid } from '../CalendarGrid';
import type { ClientePost } from '@/store/posts';

vi.mock('@dnd-kit/core', () => ({
  useDraggable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: () => {},
    setActivatorNodeRef: () => {},
    isDragging: false,
  }),
  useDroppable: () => ({ setNodeRef: () => {}, isOver: false }),
}));

beforeAll(() => {
  (Element.prototype as unknown as { hasPointerCapture: () => boolean }).hasPointerCapture = () =>
    false;
  (Element.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = () => {};
});

const month = new Date(2026, 5, 1); // June 2026

function mkPost(over: Partial<ClientePost> & Pick<ClientePost, 'id' | 'titulo'>): ClientePost {
  return {
    workflow_id: 10,
    tipo: 'reels',
    status: 'rascunho',
    scheduled_at: '2026-06-15T13:00:00.000Z',
    ordem: 0,
    workflow_titulo: 'WF',
    ...over,
  };
}

describe('CalendarGrid pills', () => {
  it('renders pills as buttons and selects on click', () => {
    const onSelect = vi.fn();
    render(
      <CalendarGrid
        currentMonth={month}
        scheduledPosts={[mkPost({ id: 1, titulo: 'Post B' })]}
        currentWorkflowId={10}
        selectedPostId={null}
        onSelectPost={onSelect}
        onMonthChange={() => {}}
      />,
    );
    const pill = screen.getByRole('button', { name: /Post B/ });
    fireEvent.click(pill);
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }));
  });

  it('selects on Enter keydown', () => {
    const onSelect = vi.fn();
    render(
      <CalendarGrid
        currentMonth={month}
        scheduledPosts={[mkPost({ id: 1, titulo: 'Post B' })]}
        currentWorkflowId={10}
        selectedPostId={null}
        onSelectPost={onSelect}
        onMonthChange={() => {}}
      />,
    );
    fireEvent.keyDown(screen.getByRole('button', { name: /Post B/ }), { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }));
  });

  it('exposes overflow posts via a selectable +N mais popover', async () => {
    const onSelect = vi.fn();
    render(
      <CalendarGrid
        currentMonth={month}
        scheduledPosts={[
          mkPost({ id: 1, titulo: 'Visible 1' }),
          mkPost({ id: 2, titulo: 'Visible 2' }),
          mkPost({ id: 3, titulo: 'Hidden Three' }),
        ]}
        currentWorkflowId={10}
        selectedPostId={null}
        onSelectPost={onSelect}
        onMonthChange={() => {}}
      />,
    );
    const moreBtn = screen.getByRole('button', { name: /\+1 mais/ });
    fireEvent.click(moreBtn);
    const row = await screen.findByRole('button', { name: /Hidden Three/ });
    fireEvent.click(row);
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 3 }));
  });
});

describe('cross-workflow drag gate', () => {
  it('exposes the drag handle on an unlocked post from another workflow', () => {
    render(
      <CalendarGrid
        currentMonth={month}
        scheduledPosts={[mkPost({ id: 5, titulo: 'Foreign', workflow_id: 99 })]}
        currentWorkflowId={10}
        selectedPostId={null}
        onSelectPost={() => {}}
        onMonthChange={() => {}}
      />,
    );
    expect(screen.getByLabelText(/Mover post/)).toBeInTheDocument();
  });

  it('still hides the drag handle on a locked post from another workflow', () => {
    render(
      <CalendarGrid
        currentMonth={month}
        scheduledPosts={[mkPost({ id: 6, titulo: 'Locked', workflow_id: 99, status: 'agendado' })]}
        currentWorkflowId={10}
        selectedPostId={null}
        onSelectPost={() => {}}
        onMonthChange={() => {}}
      />,
    );
    expect(screen.queryByLabelText(/Mover post/)).not.toBeInTheDocument();
  });

  it('still hides the drag handle on a locked post from this workflow', () => {
    render(
      <CalendarGrid
        currentMonth={month}
        scheduledPosts={[mkPost({ id: 7, titulo: 'Own locked', status: 'postado' })]}
        currentWorkflowId={10}
        selectedPostId={null}
        onSelectPost={() => {}}
        onMonthChange={() => {}}
      />,
    );
    expect(screen.queryByLabelText(/Mover post/)).not.toBeInTheDocument();
  });
});

describe('whole-pill drag', () => {
  it('selects when the grip itself is clicked', () => {
    const onSelect = vi.fn();
    render(
      <CalendarGrid
        currentMonth={month}
        scheduledPosts={[mkPost({ id: 8, titulo: 'Grip click' })]}
        currentWorkflowId={10}
        selectedPostId={null}
        onSelectPost={onSelect}
        onMonthChange={() => {}}
      />,
    );
    fireEvent.click(screen.getByLabelText(/Mover post/));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('selects on Enter rather than starting a keyboard drag', () => {
    const onSelect = vi.fn();
    render(
      <CalendarGrid
        currentMonth={month}
        scheduledPosts={[mkPost({ id: 9, titulo: 'Enter select' })]}
        currentWorkflowId={10}
        selectedPostId={null}
        onSelectPost={onSelect}
        onMonthChange={() => {}}
      />,
    );
    fireEvent.keyDown(screen.getByRole('button', { name: /Enter select/ }), { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledTimes(1);
  });
});
