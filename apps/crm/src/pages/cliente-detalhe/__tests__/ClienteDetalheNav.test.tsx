import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup, fireEvent } from '@testing-library/react';
import { ClienteDetalheNav } from '../ClienteDetalheNav';
import type { NavSectionItem, NavActionItem } from '../clienteDetalheNav.model';

class MockIntersectionObserver {
  static instances: MockIntersectionObserver[] = [];
  readonly observe = vi.fn();
  readonly unobserve = vi.fn();
  readonly disconnect = vi.fn();
  readonly takeRecords = vi.fn(() => []);
  constructor(
    readonly callback: IntersectionObserverCallback,
    readonly options: IntersectionObserverInit = {},
  ) {
    MockIntersectionObserver.instances.push(this);
  }
}

const sections: NavSectionItem[] = [
  { key: 'info', id: 'sec-info' },
  { key: 'datas', id: 'sec-datas' },
];

beforeEach(() => {
  MockIntersectionObserver.instances = [];
  vi.stubGlobal(
    'IntersectionObserver',
    MockIntersectionObserver as unknown as typeof IntersectionObserver,
  );
  // jsdom does not implement scrollIntoView.
  Element.prototype.scrollIntoView = vi.fn();
  document.body.innerHTML = '<div id="sec-info"></div><div id="sec-datas"></div>';
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('ClienteDetalheNav', () => {
  it('renders a button per section and per action (PT labels)', () => {
    const actions: NavActionItem[] = [{ key: 'editar', onClick: vi.fn() }];
    render(<ClienteDetalheNav sections={sections} actions={actions} />);
    expect(screen.getByRole('button', { name: 'Informação' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Datas' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Editar cliente' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Navegação da página' })).toBeInTheDocument();
  });

  it('clicking a section scrolls its target into view', () => {
    render(<ClienteDetalheNav sections={sections} actions={[]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Datas' }));
    expect(document.getElementById('sec-datas')!.scrollIntoView).toHaveBeenCalled();
  });

  it('clicking an action fires its onClick', () => {
    const onClick = vi.fn();
    render(<ClienteDetalheNav sections={sections} actions={[{ key: 'editar', onClick }]} />);
    screen.getByRole('button', { name: 'Editar cliente' }).click();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('marks the intersecting section active via aria-current', () => {
    render(<ClienteDetalheNav sections={sections} actions={[]} />);
    const observer = MockIntersectionObserver.instances[0];
    act(() => {
      observer.callback(
        [
          {
            isIntersecting: true,
            target: document.getElementById('sec-datas')!,
          } as IntersectionObserverEntry,
        ],
        observer as unknown as IntersectionObserver,
      );
    });
    expect(screen.getByRole('button', { name: 'Datas' })).toHaveAttribute('aria-current', 'true');
    expect(screen.getByRole('button', { name: 'Informação' })).not.toHaveAttribute('aria-current');
  });

  it('keeps an observer-selected phone chip visible', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockImplementation((query: string) => ({
        matches: query === '(max-width: 767px)',
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
    render(<ClienteDetalheNav sections={sections} actions={[]} />);
    const dates = screen.getByRole('button', { name: 'Datas' });

    act(() => {
      MockIntersectionObserver.instances[0].callback(
        [
          {
            isIntersecting: true,
            target: document.getElementById('sec-datas')!,
          } as IntersectionObserverEntry,
        ],
        MockIntersectionObserver.instances[0] as unknown as IntersectionObserver,
      );
    });

    expect(dates.scrollIntoView).toHaveBeenCalledWith({
      behavior: 'smooth',
      block: 'nearest',
      inline: 'center',
    });
  });

  it('uses an instant section jump when reduced motion is preferred', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockImplementation((query: string) => ({
        matches: query === '(prefers-reduced-motion: reduce)',
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
    render(<ClienteDetalheNav sections={sections} actions={[]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Datas' }));
    expect(document.getElementById('sec-datas')!.scrollIntoView).toHaveBeenCalledWith({
      behavior: 'auto',
      block: 'start',
    });
  });
});
