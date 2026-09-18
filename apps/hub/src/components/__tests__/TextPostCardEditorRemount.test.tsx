import { act, fireEvent, render, screen } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TextPostCard } from '../TextPostCard';
import { resetEditSuggestionFailuresForTests } from '../../hooks/useEditSuggestion';
import type { HubPost } from '../../types';

const submitEditSuggestionMock = vi.hoisted(() => vi.fn());
const mounts = vi.hoisted(() => ({ count: 0 }));

vi.mock('../../api', () => ({
  submitApproval: vi.fn(),
  submitEditSuggestion: submitEditSuggestionMock,
  fetchPostHistory: vi.fn().mockResolvedValue({ events: [], approvals: [] }),
}));

// TipTap's `useEditor` reads `content` once, at construction, so the only way a card can
// show a different document is by remounting the editor. Expose each instance's mount
// number to assert exactly when that happens.
vi.mock('../RichTextContent', () => ({
  RichTextContent: ({ editable }: { editable?: boolean }) => {
    const id = useRef<number>(0);
    if (id.current === 0) id.current = ++mounts.count;
    return <div data-testid="editor" data-mount={id.current} data-editable={String(!!editable)} />;
  },
}));

function makePost(overrides: Partial<HubPost> = {}): HubPost {
  return {
    id: 10,
    titulo: 'Roteiro',
    tipo: 'feed',
    status: 'enviado_cliente',
    ordem: 1,
    conteudo: { type: 'doc', content: [] },
    conteudo_plain: 'Roteiro original',
    ig_caption: 'Legenda original',
    scheduled_at: '2026-04-28T10:00:00.000Z',
    workflow_id: 42,
    workflow_titulo: 'Editorial',
    media: [],
    cover_media: null,
    ...overrides,
  };
}

const mountOf = () => Number(screen.getByTestId('editor').getAttribute('data-mount'));
const isEditable = () => screen.getByTestId('editor').getAttribute('data-editable') === 'true';

function renderExpanded(post: HubPost) {
  const view = render(
    <TextPostCard post={post} token="token-publico" approvals={[]} onApprovalSubmitted={vi.fn()} />,
  );
  fireEvent.click(screen.getByText(post.titulo));
  return view;
}

describe('TextPostCard editor remounting', () => {
  beforeEach(() => {
    mounts.count = 0;
    submitEditSuggestionMock.mockReset();
    resetEditSuggestionFailuresForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('recreates the editor from the draft on open and on Fechar, but not while editing', () => {
    renderExpanded(makePost());
    const readOnly = mountOf();
    expect(isEditable()).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: /Correção/ }));
    const editing = mountOf();
    expect(isEditable()).toBe(true);
    expect(editing).not.toBe(readOnly);

    // Typing elsewhere in the panel must not throw away the editor mid-edit.
    fireEvent.change(screen.getByDisplayValue('Legenda original'), {
      target: { value: 'Legenda nova' },
    });
    expect(mountOf()).toBe(editing);

    vi.spyOn(window, 'confirm').mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: /Fechar/ }));
    expect(isEditable()).toBe(false);
    // Fresh instance built from the original draft, not the one that held the typed text.
    expect(mountOf()).not.toBe(editing);
  });

  it('recreates the editor when a failed edit is discarded', async () => {
    vi.useFakeTimers();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    submitEditSuggestionMock.mockRejectedValueOnce(new Error('network'));
    renderExpanded(makePost());

    fireEvent.click(screen.getByRole('button', { name: /Correção/ }));
    const editing = mountOf();
    fireEvent.change(screen.getByDisplayValue('Legenda original'), {
      target: { value: 'Legenda nova' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Salvar edição/ }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(mountOf()).toBe(editing);

    fireEvent.click(screen.getByRole('button', { name: /Descartar edição/ }));

    expect(isEditable()).toBe(true);
    expect(mountOf()).not.toBe(editing);
  });

  it('does not carry one post’s editor into the next post shown by the same instance', () => {
    const { rerender } = renderExpanded(makePost());
    fireEvent.click(screen.getByRole('button', { name: /Correção/ }));
    const before = mountOf();

    rerender(
      <TextPostCard
        post={makePost({ id: 11, titulo: 'Outro roteiro' })}
        token="token-publico"
        approvals={[]}
        onApprovalSubmitted={vi.fn()}
      />,
    );

    expect(mountOf()).not.toBe(before);
    expect(isEditable()).toBe(false);
  });
});
