import { createRef } from 'react';
import { act, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MentionList } from '../MentionList';
import type { MentionListHandle } from '../MentionList';
import type { MentionSection, MentionSuggestionItem } from '../useMentionSearch';

const RECT = { top: 100, bottom: 120, left: 40, right: 200 };

const ANA: MentionSuggestionItem = { entityType: 'membro', id: 1, label: 'Ana' };
const BRUNO: MentionSuggestionItem = { entityType: 'membro', id: 2, label: 'Bruno' };
const CLIENTE_X: MentionSuggestionItem = { entityType: 'cliente', id: 5, label: 'Clínica X' };

function sections(overrides?: Partial<Record<'membro' | 'cliente', MentionSuggestionItem[]>>) {
  const result: MentionSection[] = [
    { key: 'membro', title: 'Pessoas', items: overrides?.membro ?? [ANA, BRUNO] },
    { key: 'post', title: 'Posts', items: [] },
    { key: 'cliente', title: 'Clientes', items: overrides?.cliente ?? [CLIENTE_X] },
    { key: 'tarefa', title: 'Tarefas', items: [] },
  ];
  return result;
}

describe('MentionList', () => {
  it('renders nothing when referenceRect is null', () => {
    const { container } = render(
      <MentionList sections={sections()} onSelect={() => {}} referenceRect={null} />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('shows only non-empty section headers', () => {
    render(<MentionList sections={sections()} onSelect={() => {}} referenceRect={RECT} />);
    expect(screen.getByText('Pessoas')).toBeInTheDocument();
    expect(screen.getByText('Clientes')).toBeInTheDocument();
    expect(screen.queryByText('Posts')).not.toBeInTheDocument();
    expect(screen.queryByText('Tarefas')).not.toBeInTheDocument();
  });

  it('shows the "Nenhum resultado" empty state when every section is empty', () => {
    render(
      <MentionList
        sections={sections({ membro: [], cliente: [] })}
        onSelect={() => {}}
        referenceRect={RECT}
      />,
    );
    expect(screen.getByText('Nenhum resultado')).toBeInTheDocument();
  });

  it('clicking a row selects it', () => {
    const onSelect = vi.fn();
    render(<MentionList sections={sections()} onSelect={onSelect} referenceRect={RECT} />);
    screen.getByText('Bruno').click();
    expect(onSelect).toHaveBeenCalledWith(BRUNO);
  });

  it('ArrowDown/ArrowUp move the keyboard cursor across section boundaries, Enter selects it', () => {
    const onSelect = vi.fn();
    const ref = createRef<MentionListHandle>();
    render(
      <MentionList ref={ref} sections={sections()} onSelect={onSelect} referenceRect={RECT} />,
    );

    const preventDefault = vi.fn();
    // Starts at index 0 (Ana). Three ArrowDowns: Bruno -> Clínica X (crosses into the
    // Clientes section) -> wraps back to Ana. Each call is wrapped in its own act() to
    // mirror production: every keydown is a separate browser event, so React always
    // commits (and mentionSuggestion.ts's `component.ref` always reflects the latest
    // handle) before the next one arrives.
    act(() => ref.current!.onKeyDown({ key: 'ArrowDown', preventDefault }));
    act(() => ref.current!.onKeyDown({ key: 'ArrowDown', preventDefault }));
    act(() => ref.current!.onKeyDown({ key: 'ArrowDown', preventDefault }));
    act(() => ref.current!.onKeyDown({ key: 'Enter', preventDefault }));

    expect(onSelect).toHaveBeenCalledWith(ANA);
    expect(preventDefault).toHaveBeenCalled();
  });

  it('ArrowUp from the first item wraps to the last item', () => {
    const onSelect = vi.fn();
    const ref = createRef<MentionListHandle>();
    render(
      <MentionList ref={ref} sections={sections()} onSelect={onSelect} referenceRect={RECT} />,
    );

    act(() => ref.current!.onKeyDown({ key: 'ArrowUp', preventDefault: vi.fn() }));
    act(() => ref.current!.onKeyDown({ key: 'Enter', preventDefault: vi.fn() }));

    expect(onSelect).toHaveBeenCalledWith(CLIENTE_X);
  });

  it('returns false (unhandled) for keys it does not manage', () => {
    const ref = createRef<MentionListHandle>();
    render(
      <MentionList ref={ref} sections={sections()} onSelect={() => {}} referenceRect={RECT} />,
    );
    expect(ref.current!.onKeyDown({ key: 'a', preventDefault: vi.fn() })).toBe(false);
  });

  it('onKeyDown is a no-op (returns false) when there are no results', () => {
    const ref = createRef<MentionListHandle>();
    render(
      <MentionList
        ref={ref}
        sections={sections({ membro: [], cliente: [] })}
        onSelect={() => {}}
        referenceRect={RECT}
      />,
    );
    expect(ref.current!.onKeyDown({ key: 'ArrowDown', preventDefault: vi.fn() })).toBe(false);
  });
});
