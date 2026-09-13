import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioPlayer, formatClock } from '../index';

const play = vi.fn(async () => {});
const pause = vi.fn();

beforeEach(() => {
  Object.defineProperty(HTMLMediaElement.prototype, 'play', { configurable: true, value: play });
  Object.defineProperty(HTMLMediaElement.prototype, 'pause', { configurable: true, value: pause });
});
afterEach(() => {
  vi.restoreAllMocks();
  delete (HTMLMediaElement.prototype as { play?: unknown }).play;
  delete (HTMLMediaElement.prototype as { pause?: unknown }).pause;
});

describe('AudioPlayer', () => {
  it('formats clocks as m:ss', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(65.4)).toBe('1:05');
    expect(formatClock(Number.POSITIVE_INFINITY)).toBe('0:00');
  });

  it('shows the given duration when the media reports none and toggles play/pause', () => {
    render(<AudioPlayer src="blob:x" durationSeconds={58} />);
    expect(screen.getByText('0:00 / 0:58')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /reproduzir/i }));
    expect(play).toHaveBeenCalledTimes(1);
    const audio = document.querySelector('audio') as HTMLAudioElement;
    fireEvent(audio, new Event('play'));
    expect(screen.getByRole('button', { name: /pausar/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /pausar/i }));
    expect(pause).toHaveBeenCalledTimes(1);
  });

  it('updates the clock on timeupdate and seeks on track click and keyboard', () => {
    render(<AudioPlayer src="blob:x" durationSeconds={100} />);
    const audio = document.querySelector('audio') as HTMLAudioElement;
    Object.defineProperty(audio, 'currentTime', { configurable: true, writable: true, value: 25 });
    fireEvent(audio, new Event('timeupdate'));
    expect(screen.getByText('0:25 / 1:40')).toBeInTheDocument();

    const slider = screen.getByRole('slider');
    slider.getBoundingClientRect = () =>
      ({
        left: 0,
        width: 200,
        top: 0,
        height: 4,
        right: 200,
        bottom: 4,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;
    fireEvent.click(slider, { clientX: 100 });
    expect(audio.currentTime).toBe(50);
    expect(slider).toHaveAttribute('aria-valuenow', '50');

    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    expect(audio.currentTime).toBe(55);
  });

  it('seeks Home to 0 and End to the total', () => {
    render(<AudioPlayer src="blob:x" durationSeconds={100} />);
    const audio = document.querySelector('audio') as HTMLAudioElement;
    Object.defineProperty(audio, 'currentTime', { configurable: true, writable: true, value: 40 });
    const slider = screen.getByRole('slider');

    fireEvent.keyDown(slider, { key: 'End' });
    expect(audio.currentTime).toBe(100);
    expect(slider).toHaveAttribute('aria-valuenow', '100');

    fireEvent.keyDown(slider, { key: 'Home' });
    expect(audio.currentTime).toBe(0);
    expect(slider).toHaveAttribute('aria-valuenow', '0');
  });

  it('ignores track clicks when there is no known total duration', () => {
    render(<AudioPlayer src="blob:x" />);
    const audio = document.querySelector('audio') as HTMLAudioElement;
    Object.defineProperty(audio, 'currentTime', { configurable: true, writable: true, value: 0 });
    const slider = screen.getByRole('slider');
    slider.getBoundingClientRect = () =>
      ({
        left: 0,
        width: 200,
        top: 0,
        height: 4,
        right: 200,
        bottom: 4,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;

    fireEvent.click(slider, { clientX: 100 });
    expect(audio.currentTime).toBe(0);

    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    expect(audio.currentTime).toBe(0);
  });

  it('resets to paused at the end and rewinds playback position to 0', () => {
    render(<AudioPlayer src="blob:x" durationSeconds={10} />);
    const audio = document.querySelector('audio') as HTMLAudioElement;
    Object.defineProperty(audio, 'currentTime', { configurable: true, writable: true, value: 10 });
    fireEvent(audio, new Event('play'));
    expect(screen.getByRole('button', { name: /pausar/i })).toBeInTheDocument();
    fireEvent(audio, new Event('ended'));
    expect(screen.getByRole('button', { name: /reproduzir/i })).toBeInTheDocument();
    expect(audio.currentTime).toBe(0);
  });

  it('resets the clock and button when the src changes', () => {
    const { rerender } = render(<AudioPlayer src="blob:a" durationSeconds={30} />);
    const audio = document.querySelector('audio') as HTMLAudioElement;
    Object.defineProperty(audio, 'currentTime', { configurable: true, writable: true, value: 12 });
    fireEvent(audio, new Event('timeupdate'));
    fireEvent(audio, new Event('play'));
    expect(screen.getByText('0:12 / 0:30')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /pausar/i })).toBeInTheDocument();

    rerender(<AudioPlayer src="blob:b" durationSeconds={45} />);
    expect(screen.getByText('0:00 / 0:45')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reproduzir/i })).toBeInTheDocument();
  });

  it('draws the play button visible with no CSS variables set', () => {
    render(<AudioPlayer src="blob:x" durationSeconds={10} />);
    const button = screen.getByRole('button', { name: /reproduzir/i });
    expect(button.style.color).toBe('');
    expect(button.style.background).toBe('var(--audio-btn-bg, currentColor)');

    const svg = button.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute('fill')).toBe('var(--audio-btn-fg, #fff)');
  });
});
