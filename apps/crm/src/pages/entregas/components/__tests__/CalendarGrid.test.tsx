import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi, beforeAll, beforeEach } from 'vitest';
import { CalendarGrid } from '../CalendarGrid';
import type { ClientePost } from '@/store/posts';

const dndKeyDownSpy = vi.fn();

vi.mock('@dnd-kit/core', () => ({
  useDraggable: () => ({
    attributes: {},
    listeners: { onKeyDown: dndKeyDownSpy },
    setNodeRef: () => {},
    setActivatorNodeRef: () => {},
    isDragging: false,
  }),
  useDroppable: () => ({ setNodeRef: () => {}, isOver: false }),
}));

beforeEach(() => {
  dndKeyDownSpy.mockReset();
});

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
    // Guards prop ordering: onKeyDown={handleKeyDown} must come AFTER {...listeners} in the
    // JSX so it wins (last-prop-wins) and dnd-kit's keyboard-drag handler never fires here.
    expect(dndKeyDownSpy).not.toHaveBeenCalled();
  });
});

describe('card design', () => {
  it('encodes tipo in the dash, not workflow ownership', () => {
    const { container } = render(
      <CalendarGrid
        currentMonth={month}
        scheduledPosts={[
          mkPost({ id: 20, titulo: 'Own reels', tipo: 'reels' }),
          mkPost({ id: 21, titulo: 'Foreign reels', tipo: 'reels', workflow_id: 99 }),
        ]}
        currentWorkflowId={10}
        selectedPostId={null}
        onSelectPost={() => {}}
        onMonthChange={() => {}}
      />,
    );
    // Same tipo => same dash colour, regardless of which workflow owns the post.
    const dashes = [...container.querySelectorAll('.post-card-dash')] as HTMLElement[];
    expect(dashes).toHaveLength(2);
    expect(dashes[0].style.background).toBe(dashes[1].style.background);
    expect(dashes[0].style.background).toBe('rgb(225, 48, 108)'); // reels #E1306C
  });

  it('shows the post title on the card so it is readable without opening it', () => {
    render(
      <CalendarGrid
        currentMonth={month}
        scheduledPosts={[mkPost({ id: 22, titulo: 'Como dar acesso ao cliente' })]}
        currentWorkflowId={10}
        selectedPostId={null}
        onSelectPost={() => {}}
        onMonthChange={() => {}}
      />,
    );
    expect(screen.getByText('Como dar acesso ao cliente')).toBeInTheDocument();
  });

  it('marks a foreign post with the recessed surface and names its workflow', () => {
    const { container } = render(
      <CalendarGrid
        currentMonth={month}
        scheduledPosts={[
          mkPost({
            id: 23,
            titulo: 'Outro fluxo',
            workflow_id: 99,
            workflow_titulo: 'POSTS YASMIN',
          }),
        ]}
        currentWorkflowId={10}
        selectedPostId={null}
        onSelectPost={() => {}}
        onMonthChange={() => {}}
      />,
    );
    expect(container.querySelector('.calendar-post-card.foreign')).toBeInTheDocument();
    expect(screen.getByText('POSTS YASMIN')).toBeInTheDocument();
  });

  it('leaves an own post unmarked and does not name its workflow', () => {
    const { container } = render(
      <CalendarGrid
        currentMonth={month}
        scheduledPosts={[mkPost({ id: 24, titulo: 'Meu post', workflow_titulo: 'Meu fluxo' })]}
        currentWorkflowId={10}
        selectedPostId={null}
        onSelectPost={() => {}}
        onMonthChange={() => {}}
      />,
    );
    expect(container.querySelector('.calendar-post-card.foreign')).not.toBeInTheDocument();
    expect(screen.queryByText('Meu fluxo')).not.toBeInTheDocument();
  });

  it('names a post avulso "Avulso" (not blank) and suffixes its tooltip "(avulso)", not "(outro workflow)"', () => {
    const { container } = render(
      <CalendarGrid
        currentMonth={month}
        scheduledPosts={[
          mkPost({
            id: 25,
            titulo: 'Post sem fluxo',
            workflow_id: null,
            workflow_titulo: null,
          }),
        ]}
        currentWorkflowId={10}
        selectedPostId={null}
        onSelectPost={() => {}}
        onMonthChange={() => {}}
      />,
    );
    // Still gets the recessed "foreign" treatment (it isn't this workflow's own post
    // either), but names itself "Avulso" instead of rendering blank next to the icon.
    expect(container.querySelector('.calendar-post-card.foreign')).toBeInTheDocument();
    expect(screen.getByText('Avulso')).toBeInTheDocument();
    const pill = screen.getByRole('button', { name: /Post sem fluxo/ });
    expect(pill.title).toContain('Avulso');
    expect(pill.title).toContain('(avulso)');
    expect(pill.title).not.toContain('(outro workflow)');
  });
});
