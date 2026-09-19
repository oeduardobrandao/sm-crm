import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TESTIMONIALS, Testimonials } from '../Testimonials';

const AUTOPLAY_MS = 7000;

function mockReducedMotion(matches: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

function activeName() {
  const slide = document.querySelector('.quote-slide[aria-hidden="false"]');
  return slide?.querySelector('.n')?.textContent;
}

describe('Testimonials', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockReducedMotion(false);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('renders every testimonial but exposes only the first one', () => {
    render(<Testimonials />);
    expect(document.querySelectorAll('.quote-slide')).toHaveLength(TESTIMONIALS.length);
    expect(document.querySelectorAll('.quote-slide[aria-hidden="false"]')).toHaveLength(1);
    expect(activeName()).toBe(TESTIMONIALS[0].name);
  });

  it('steps with the arrows and wraps around at both ends', () => {
    render(<Testimonials />);
    fireEvent.click(screen.getByRole('button', { name: 'Depoimento anterior' }));
    expect(activeName()).toBe(TESTIMONIALS[TESTIMONIALS.length - 1].name);
    fireEvent.click(screen.getByRole('button', { name: 'Próximo depoimento' }));
    expect(activeName()).toBe(TESTIMONIALS[0].name);
  });

  it('jumps straight to a testimonial from its dot', () => {
    render(<Testimonials />);
    fireEvent.click(
      screen.getByRole('button', { name: `Ver depoimento de ${TESTIMONIALS[2].name}` }),
    );
    expect(activeName()).toBe(TESTIMONIALS[2].name);
    expect(
      screen.getByRole('button', { name: `Ver depoimento de ${TESTIMONIALS[2].name}` }),
    ).toHaveAttribute('aria-current', 'true');
  });

  it('advances on its own and holds while the pointer is over the card', () => {
    render(<Testimonials />);
    act(() => {
      vi.advanceTimersByTime(AUTOPLAY_MS);
    });
    expect(activeName()).toBe(TESTIMONIALS[1].name);

    const card = document.querySelector('.quote-card') as HTMLElement;
    fireEvent.mouseEnter(card);
    act(() => {
      vi.advanceTimersByTime(AUTOPLAY_MS * 3);
    });
    expect(activeName()).toBe(TESTIMONIALS[1].name);

    fireEvent.mouseLeave(card);
    act(() => {
      vi.advanceTimersByTime(AUTOPLAY_MS);
    });
    expect(activeName()).toBe(TESTIMONIALS[2].name);
  });

  it('restarts the countdown after a manual click', () => {
    render(<Testimonials />);
    act(() => {
      vi.advanceTimersByTime(AUTOPLAY_MS - 1000);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Próximo depoimento' }));
    act(() => {
      vi.advanceTimersByTime(AUTOPLAY_MS - 1000);
    });
    expect(activeName()).toBe(TESTIMONIALS[1].name);
  });

  it('does not autoplay when the user prefers reduced motion', () => {
    mockReducedMotion(true);
    render(<Testimonials />);
    act(() => {
      vi.advanceTimersByTime(AUTOPLAY_MS * 3);
    });
    expect(activeName()).toBe(TESTIMONIALS[0].name);
  });

  it('keeps em-dashes out of the shipped copy', () => {
    for (const t of TESTIMONIALS) {
      expect(`${t.quote} ${t.name} ${t.role}`).not.toContain('—');
    }
  });
});
