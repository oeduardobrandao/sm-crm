import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ColorPicker,
  normalizeHexInput,
  pushRecentColor,
  readRecentColors,
  RECENT_COLORS_KEY,
  RECENT_COLORS_MAX,
} from '../components/shared/ColorPicker';

function renderPicker(props: Partial<React.ComponentProps<typeof ColorPicker>> = {}) {
  const onChange = vi.fn();
  render(<ColorPicker value="#12151a" onChange={onChange} {...props} />);
  return { onChange };
}

function openPicker() {
  fireEvent.click(screen.getByTestId('estudio-color-trigger'));
}

function commitHex(text: string) {
  const field = screen.getByTestId('estudio-color-hex');
  fireEvent.change(field, { target: { value: text } });
  fireEvent.keyDown(field, { key: 'Enter' });
  fireEvent.blur(field);
}

beforeEach(() => {
  localStorage.clear();
});

describe('normalizeHexInput', () => {
  it('accepts #rrggbb and #rrggbbaa, lowercasing', () => {
    expect(normalizeHexInput('#EAB308')).toBe('#eab308');
    expect(normalizeHexInput('#EAB30880')).toBe('#eab30880');
  });

  it('tolerates a missing # and surrounding whitespace', () => {
    expect(normalizeHexInput('  eab308 ')).toBe('#eab308');
  });

  it('rejects everything else', () => {
    expect(normalizeHexInput('azul')).toBeNull();
    expect(normalizeHexInput('#fff')).toBeNull(); // 3-digit shorthand is not schema hex
    expect(normalizeHexInput('rgb(0,0,0)')).toBeNull();
    expect(normalizeHexInput('')).toBeNull();
  });
});

describe('recents persistence', () => {
  it('stores most-recent-first, dedupes case-insensitively, caps the list', () => {
    pushRecentColor('#111111');
    pushRecentColor('#222222');
    pushRecentColor('#111111'); // re-commit moves it to the front, no duplicate
    expect(readRecentColors()).toEqual(['#111111', '#222222']);

    for (let i = 0; i < RECENT_COLORS_MAX + 3; i++) {
      pushRecentColor(`#0000${String(i).padStart(2, '0')}`);
    }
    expect(readRecentColors()).toHaveLength(RECENT_COLORS_MAX);
  });

  it('ignores corrupted storage', () => {
    localStorage.setItem(RECENT_COLORS_KEY, '{not json');
    expect(readRecentColors()).toEqual([]);
  });
});

describe('ColorPicker', () => {
  it('commits a valid hex from the hex field (normalized)', () => {
    const { onChange } = renderPicker();
    openPicker();
    commitHex('EAB308');
    expect(onChange).toHaveBeenCalledWith('#eab308');
    expect(readRecentColors()[0]).toBe('#eab308');
  });

  it('never commits invalid text', () => {
    const { onChange } = renderPicker();
    openPicker();
    commitHex('azul');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('accepts 8-digit alpha hex by default, rejects it with allowAlpha=false', () => {
    const first = renderPicker();
    openPicker();
    commitHex('#eab30880');
    expect(first.onChange).toHaveBeenCalledWith('#eab30880');

    cleanup();
    const second = renderPicker({ allowAlpha: false });
    openPicker();
    commitHex('#eab30880');
    expect(second.onChange).not.toHaveBeenCalled();
  });

  it('brand swatches are pinned and commit on click', () => {
    const { onChange } = renderPicker({ brandColors: ['#eab308', '#12151a'] });
    openPicker();
    expect(screen.getByText('Marca')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '#eab308' }));
    expect(onChange).toHaveBeenCalledWith('#eab308');
  });

  it('tolerates a non-hex value (legacy free text) without crashing or dispatching', () => {
    const { onChange } = renderPicker({ value: 'azul royal' });
    expect(screen.getByTestId('estudio-color-trigger')).toHaveTextContent('azul royal');
    openPicker();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('native picker commits LIVE per tick, one shared coalesceKey per drag, preserving an existing alpha suffix', () => {
    // Live commits are what make the macOS OS-panel flow work at all: anything that closes the
    // popover mid-pick (interact-outside, focus loss) used to eat the buffered pick entirely.
    const { onChange } = renderPicker({ value: '#12151a80' });
    openPicker();
    const native = screen.getByTestId('estudio-color-native');
    fireEvent.change(native, { target: { value: '#ff0000' } });
    fireEvent.change(native, { target: { value: '#00ff00' } });
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange).toHaveBeenNthCalledWith(1, '#ff000080', {
      coalesceKey: expect.any(String),
    });
    expect(onChange).toHaveBeenNthCalledWith(2, '#00ff0080', {
      coalesceKey: expect.any(String),
    });
    // Same drag → same key (the whole burst is ONE undo entry for undo-aware callers).
    expect(onChange.mock.calls[0][1].coalesceKey).toBe(onChange.mock.calls[1][1].coalesceKey);
    // Closing dispatches nothing further — the picks already landed.
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' }); // Radix close
    expect(onChange).toHaveBeenCalledTimes(2);
    // The drag's END color joins recents exactly once.
    expect(readRecentColors()).toEqual(['#00ff0080']);
  });

  it('a hex-field commit carries NO coalesceKey and ends the drag session (next drag = new key)', () => {
    const { onChange } = renderPicker();
    openPicker();
    const native = screen.getByTestId('estudio-color-native');
    fireEvent.change(native, { target: { value: '#ff0000' } });
    const firstKey = onChange.mock.calls[0][1].coalesceKey as string;
    commitHex('#00ff00');
    expect(onChange).toHaveBeenCalledWith('#00ff00'); // discrete: no opts at all
    fireEvent.change(native, { target: { value: '#0000ff' } });
    const nextKey = onChange.mock.calls.at(-1)![1].coalesceKey as string;
    expect(nextKey).not.toBe(firstKey); // a fresh drag never coalesces into the pre-commit one
  });
});
