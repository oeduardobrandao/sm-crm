import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { UnscheduledPostsSidebar } from '../UnscheduledPostsSidebar';
import type { ClientePost } from '@/store/posts';

// The component reads `isOver` from useDroppable and `active` from useDndContext to decide
// whether to show the drop highlight. Both are mocked directly so each test can drive them
// independently, without going through a real DndContext/drag gesture.
const dndState = vi.hoisted(() => ({
  isOver: false,
  active: null as { data: { current: { post: ClientePost } } } | null,
}));

vi.mock('@dnd-kit/core', () => ({
  useDroppable: () => ({ setNodeRef: () => {}, isOver: dndState.isOver }),
  useDraggable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: () => {},
    isDragging: false,
  }),
  useDndContext: () => ({ active: dndState.active }),
}));

function makePost(overrides: Partial<ClientePost> = {}): ClientePost {
  return {
    id: 1,
    workflow_id: 99,
    titulo: 'Post de outro workflow',
    tipo: 'feed',
    status: 'rascunho',
    scheduled_at: '2026-07-20T13:00:00.000Z',
    ordem: 0,
    workflow_titulo: 'Outro Workflow',
    ...overrides,
  };
}

function renderSidebar() {
  return render(<UnscheduledPostsSidebar posts={[]} currentWorkflowId={10} />);
}

describe('UnscheduledPostsSidebar drop affordance', () => {
  it('suppresses the highlight while hovering with a foreign post being dragged', () => {
    dndState.isOver = true;
    dndState.active = { data: { current: { post: makePost({ workflow_id: 99 }) } } };

    const { container } = renderSidebar();
    const sidebar = container.querySelector('.calendar-sidebar') as HTMLElement;

    expect(sidebar.style.borderColor).toBe('');
    expect(sidebar.style.boxShadow).toBe('');
  });

  it('shows the highlight while hovering with an own-workflow post being dragged', () => {
    dndState.isOver = true;
    dndState.active = { data: { current: { post: makePost({ workflow_id: 10 }) } } };

    const { container } = renderSidebar();
    const sidebar = container.querySelector('.calendar-sidebar') as HTMLElement;

    expect(sidebar.style.borderColor).toBe('var(--primary-color)');
    expect(sidebar.style.boxShadow).not.toBe('');
  });
});
