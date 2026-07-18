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

let scrollIntoViewDescriptor: PropertyDescriptor | undefined;
let scrollToDescriptor: PropertyDescriptor | undefined;

function setGeometry(
  element: Element,
  geometry: Partial<Record<'offsetLeft' | 'offsetWidth' | 'clientWidth' | 'scrollWidth', number>>,
) {
  for (const [property, value] of Object.entries(geometry)) {
    Object.defineProperty(element, property, { configurable: true, value });
  }
}

beforeEach(() => {
  MockIntersectionObserver.instances = [];
  vi.stubGlobal(
    'IntersectionObserver',
    MockIntersectionObserver as unknown as typeof IntersectionObserver,
  );
  // jsdom does not implement these scrolling methods. Preserve their descriptors so
  // this suite cannot leak mocks into other test files.
  scrollIntoViewDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView');
  scrollToDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTo');
  Object.defineProperty(Element.prototype, 'scrollIntoView', {
    configurable: true,
    writable: true,
    value: vi.fn(),
  });
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
    configurable: true,
    writable: true,
    value: vi.fn(),
  });
  document.body.innerHTML = '<div id="sec-info"></div><div id="sec-datas"></div>';
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  if (scrollIntoViewDescriptor) {
    Object.defineProperty(Element.prototype, 'scrollIntoView', scrollIntoViewDescriptor);
  } else {
    delete (Element.prototype as Partial<Element>).scrollIntoView;
  }
  if (scrollToDescriptor) {
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', scrollToDescriptor);
  } else {
    delete (HTMLElement.prototype as Partial<HTMLElement>).scrollTo;
  }
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

  it('clicking a phone section scrolls its target without scrolling the sticky chip vertically', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockImplementation((query: string) => ({
        matches: query === '(max-width: 767px)',
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
    render(<ClienteDetalheNav sections={sections} actions={[]} />);
    const target = document.getElementById('sec-datas')!;
    const targetScroll = vi.fn();
    const chip = screen.getByRole('button', { name: 'Datas' });
    const chipScroll = vi.fn();
    target.scrollIntoView = targetScroll;
    chip.scrollIntoView = chipScroll;

    fireEvent.click(chip);

    expect(targetScroll).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
    expect(chipScroll).not.toHaveBeenCalled();
    expect(
      screen.getByRole('navigation', { name: 'Navegação da página' }).scrollTo,
    ).toHaveBeenCalled();
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

  it('keeps an observer-selected phone chip visible with horizontal-only nav scrolling', () => {
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
    const nav = screen.getByRole('navigation', { name: 'Navegação da página' });
    setGeometry(nav, { clientWidth: 200, scrollWidth: 500 });
    setGeometry(dates, { offsetLeft: 320, offsetWidth: 80 });

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

    expect(nav.scrollTo).toHaveBeenCalledWith({
      left: 260,
      behavior: 'smooth',
    });
    expect(dates.scrollIntoView).not.toHaveBeenCalled();
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
