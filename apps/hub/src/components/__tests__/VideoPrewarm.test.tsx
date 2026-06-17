import { render, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { VideoPrewarm } from '../VideoPrewarm';

// Controllable IntersectionObserver mock so tests can decide when the sentinel
// "enters" the viewport.
class MockIntersectionObserver {
  static instances: MockIntersectionObserver[] = [];
  cb: IntersectionObserverCallback;
  elements: Element[] = [];
  constructor(cb: IntersectionObserverCallback) {
    this.cb = cb;
    MockIntersectionObserver.instances.push(this);
  }
  observe(el: Element) {
    this.elements.push(el);
  }
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
  trigger(isIntersecting: boolean) {
    this.cb(
      this.elements.map((el) => ({ isIntersecting, target: el })) as IntersectionObserverEntry[],
      this as unknown as IntersectionObserver,
    );
  }
}

const VIDEO_URL = 'https://cdn.example.com/contas/1/files/abc.mov';
const original = globalThis.IntersectionObserver;

beforeEach(() => {
  MockIntersectionObserver.instances = [];
  globalThis.IntersectionObserver =
    MockIntersectionObserver as unknown as typeof IntersectionObserver;
});

afterEach(() => {
  globalThis.IntersectionObserver = original;
});

describe('VideoPrewarm', () => {
  it('does not fetch the video until its sentinel nears the viewport', () => {
    const { container } = render(<VideoPrewarm src={VIDEO_URL} />);
    const video = container.querySelector('video');

    expect(video).not.toBeNull();
    // Idle: no src set and preload disabled, so the browser makes no request.
    expect(video).toHaveAttribute('preload', 'none');
    expect(video).not.toHaveAttribute('src');
  });

  it('warms with metadata preload once the sentinel intersects', () => {
    const { container } = render(<VideoPrewarm src={VIDEO_URL} />);

    act(() => {
      MockIntersectionObserver.instances[0].trigger(true);
    });

    const video = container.querySelector('video');
    expect(video).toHaveAttribute('src', VIDEO_URL);
    // metadata is enough to do the (potentially end-of-file) moov round-trip
    // ahead of the click, without downloading the whole file.
    expect(video).toHaveAttribute('preload', 'metadata');
  });

  it('warms immediately when IntersectionObserver is unavailable', () => {
    globalThis.IntersectionObserver = undefined as unknown as typeof IntersectionObserver;

    const { container } = render(<VideoPrewarm src={VIDEO_URL} />);

    const video = container.querySelector('video');
    expect(video).toHaveAttribute('src', VIDEO_URL);
    expect(video).toHaveAttribute('preload', 'metadata');
  });

  it('renders nothing when there is no video to warm', () => {
    const { container } = render(<VideoPrewarm src={null} />);
    expect(container.querySelector('video')).toBeNull();
  });
});
