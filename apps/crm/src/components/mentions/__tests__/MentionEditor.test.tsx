import { createElement, useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MentionEditor } from '../MentionEditor';
import { editorOf, setEditorText } from '@/test/mentionEditor';
import { getClientes, getMembros, getTarefas } from '@/store';

vi.mock('@/store', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getMembros: vi.fn().mockResolvedValue([]),
  getClientes: vi.fn().mockResolvedValue([]),
  getTarefas: vi.fn().mockResolvedValue([]),
}));
vi.mock('@/store/posts', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  searchPostsForMention: vi.fn().mockResolvedValue([]),
}));

function Harness({
  initial = '',
  onChange,
  onKeyDown,
}: {
  initial?: string;
  onChange?: (v: string) => void;
  onKeyDown?: (e: KeyboardEvent) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <MentionEditor
        placeholder="Escreva..."
        value={value}
        onValueChange={(v) => {
          setValue(v);
          onChange?.(v);
        }}
        onKeyDown={onKeyDown}
      />
      <button type="button" onClick={() => setValue('')}>
        limpar
      </button>
    </>
  );
}

function renderHarness(props: Parameters<typeof Harness>[0] = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: qc }, children);
  return render(<Harness {...props} />, { wrapper });
}

const box = () => screen.getByRole('textbox', { name: 'Escreva...' });

describe('MentionEditor', () => {
  // The global test setup resets mock implementations between tests.
  beforeEach(() => {
    vi.mocked(getMembros).mockResolvedValue([]);
    vi.mocked(getClientes).mockResolvedValue([]);
    vi.mocked(getTarefas).mockResolvedValue([]);
  });

  it('shows a stored token as a chip, not as raw token text', () => {
    renderHarness({ initial: 'oi @[Eduardo Souza](membro:12)' });
    const chip = box().querySelector('[data-mention]');
    expect(chip).toHaveTextContent('@Eduardo Souza');
    expect(chip).toHaveClass('mention-chip', 'mention-chip--membro');
    expect(box()).not.toHaveTextContent('(membro:12)');
  });

  it('emits the token string when the content changes', () => {
    const onChange = vi.fn();
    renderHarness({ onChange });
    setEditorText(box(), 'olá @[Ana](membro:1)');
    expect(onChange).toHaveBeenLastCalledWith('olá @[Ana](membro:1)');
  });

  it('follows an external value reset without emitting', () => {
    const onChange = vi.fn();
    renderHarness({ initial: 'rascunho', onChange });
    fireEvent.click(screen.getByText('limpar'));
    expect(editorOf(box()).getText()).toBe('');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('hands keys to onKeyDown and treats preventDefault as handled', () => {
    const onKeyDown = vi.fn((e: KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) e.preventDefault();
    });
    renderHarness({ onKeyDown });
    fireEvent.keyDown(box(), { key: 'Enter' });
    expect(onKeyDown).toHaveBeenCalledTimes(1);
    expect(onKeyDown.mock.calls[0][0].defaultPrevented).toBe(true);
  });
});
