import { Component, type ReactNode } from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render } from '@testing-library/react';
import { installTranslateGuard } from '../src/translate-guard';

let uninstall: (() => void) | undefined;

afterEach(() => {
  uninstall?.();
  uninstall = undefined;
});

/** What Google Translate does to every text node it translates. */
function translateTextNodes(root: Node) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  for (const text of nodes) {
    const outer = document.createElement('font');
    const inner = document.createElement('font');
    inner.textContent = text.nodeValue;
    outer.appendChild(inner);
    text.parentNode!.replaceChild(outer, text);
  }
}

// The shape of the DateTimePicker trigger: an icon, then a bare text node that swaps with an
// element. (A lone string child would be set through textContent, never as a text node.)
function Trigger({ value }: { value?: string }) {
  return (
    <button>
      <svg />
      {value ? value : <span>Selecionar data e hora</span>}
    </button>
  );
}

// Stands in for the apps' Sentry.ErrorBoundary ("Algo deu errado").
class Boundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    return this.state.error ? <p>crashed: {this.state.error.message}</p> : this.props.children;
  }
}

describe('installTranslateGuard', () => {
  it('without the guard, a translated text node crashes the next React update', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { container, rerender } = render(
      <Boundary>
        <Trigger value="05 nov 2026 · 10:00" />
      </Boundary>,
    );
    translateTextNodes(container);
    rerender(
      <Boundary>
        <Trigger />
      </Boundary>,
    );
    expect(container.textContent).toMatch(/crashed: .*not a child of this node/);
    vi.restoreAllMocks();
  });

  it('with the guard, the same update renders', () => {
    uninstall = installTranslateGuard();
    const { container, rerender } = render(<Trigger value="05 nov 2026 · 10:00" />);
    translateTextNodes(container);
    rerender(<Trigger />);
    expect(container.querySelector('span')?.textContent).toBe('Selecionar data e hora');
    rerender(<Trigger value="18 nov 2026 · 10:00" />);
    expect(container.textContent).toContain('18 nov 2026 · 10:00');
  });

  it('inserting before a node that moved appends instead of throwing', () => {
    uninstall = installTranslateGuard();
    const parent = document.createElement('div');
    const orphan = document.createTextNode('gone');
    const added = document.createElement('b');
    expect(parent.insertBefore(added, orphan)).toBe(added);
    expect(parent.lastChild).toBe(added);
  });

  it('leaves normal DOM operations alone and is idempotent', () => {
    uninstall = installTranslateGuard();
    const again = installTranslateGuard();
    const parent = document.createElement('div');
    const a = parent.appendChild(document.createElement('i'));
    const b = parent.insertBefore(document.createElement('b'), a);
    expect(parent.firstChild).toBe(b);
    parent.removeChild(a);
    expect(parent.childNodes.length).toBe(1);
    again();
  });
});
