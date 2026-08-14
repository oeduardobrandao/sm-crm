import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, waitFor } from '@testing-library/react';
import Hls from 'hls.js';
import { VideoPlayer } from '../index';

// hls.js is heavy and needs a MediaSource-capable environment it doesn't get
// in jsdom, so the real module is swapped for a minimal stand-in that mirrors
// the bits VideoPlayer touches: isSupported(), Events.ERROR, and an instance
// with on/loadSource/attachMedia/destroy. Tests reach back into the mocked
// instances to drive the ERROR callback and assert on loadSource/attachMedia.
vi.mock('hls.js', () => {
  class MockHls {
    static instances: MockHls[] = [];
    static isSupported = vi.fn(() => true);
    static Events = { ERROR: 'hlsError' } as const;

    loadSource = vi.fn();
    attachMedia = vi.fn();
    destroy = vi.fn();
    errorHandler: ((event: string, data: { fatal: boolean }) => void) | null = null;

    on(event: string, handler: (event: string, data: { fatal: boolean }) => void) {
      if (event === MockHls.Events.ERROR) this.errorHandler = handler;
    }

    constructor() {
      MockHls.instances.push(this);
    }
  }

  return { default: MockHls };
});

type MockHlsCtor = {
  instances: {
    loadSource: ReturnType<typeof vi.fn>;
    attachMedia: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
    errorHandler: ((event: string, data: { fatal: boolean }) => void) | null;
  }[];
  isSupported: ReturnType<typeof vi.fn>;
};

const MockedHls = Hls as unknown as MockHlsCtor;

const SRC = 'https://media-proxy.example.com/videos/clip.mp4';
const HLS_SRC = 'https://media-proxy.example.com/videos/clip/manifest.m3u8';

function stubCanPlayType(returnValue: string) {
  HTMLMediaElement.prototype.canPlayType = vi.fn(() => returnValue) as unknown as (
    type: string,
  ) => CanPlayTypeResult;
}

describe('VideoPlayer', () => {
  beforeEach(() => {
    MockedHls.instances.length = 0;
    MockedHls.isSupported.mockReturnValue(true);
  });

  afterEach(() => {
    delete (HTMLMediaElement.prototype as { canPlayType?: unknown }).canPlayType;
  });

  it('renders the progressive src when no hlsSrc is given', () => {
    const { container } = render(<VideoPlayer src={SRC} />);
    const video = container.querySelector('video');
    expect(video).not.toBeNull();
    expect(video?.getAttribute('src')).toBe(SRC);
  });

  it('renders the hlsSrc directly when the browser supports native HLS', () => {
    stubCanPlayType('probably');
    const { container } = render(<VideoPlayer hlsSrc={HLS_SRC} src={SRC} />);
    const video = container.querySelector('video');
    expect(video?.getAttribute('src')).toBe(HLS_SRC);
  });

  it('loads hls.js and calls loadSource/attachMedia when native HLS is unsupported', async () => {
    stubCanPlayType('');
    const { container } = render(<VideoPlayer hlsSrc={HLS_SRC} src={SRC} />);
    const video = container.querySelector('video');
    expect(video?.hasAttribute('src')).toBe(false);

    await waitFor(() => expect(MockedHls.instances.length).toBe(1));
    const instance = MockedHls.instances[0];
    expect(instance.loadSource).toHaveBeenCalledWith(HLS_SRC);
    expect(instance.attachMedia).toHaveBeenCalledWith(video);
  });

  it('falls back to the progressive src when hls.js reports a fatal error', async () => {
    stubCanPlayType('');
    const { container } = render(<VideoPlayer hlsSrc={HLS_SRC} src={SRC} />);

    await waitFor(() => expect(MockedHls.instances.length).toBe(1));
    const instance = MockedHls.instances[0];
    expect(instance.errorHandler).not.toBeNull();

    act(() => {
      instance.errorHandler?.('hlsError', { fatal: true });
    });

    await waitFor(() => {
      const video = container.querySelector('video');
      expect(video?.getAttribute('src')).toBe(SRC);
    });
    expect(instance.destroy).toHaveBeenCalled();
  });

  it('calls onFatalError when the fallback video itself errors', () => {
    const onFatalError = vi.fn();
    const { container } = render(<VideoPlayer src={SRC} onFatalError={onFatalError} />);
    const video = container.querySelector('video');
    expect(video).not.toBeNull();

    fireEvent.error(video as HTMLVideoElement);

    expect(onFatalError).toHaveBeenCalledTimes(1);
  });

  it('switches native HLS to fallback on error without calling onFatalError', async () => {
    stubCanPlayType('probably');
    const onFatalError = vi.fn();
    const { container } = render(
      <VideoPlayer hlsSrc={HLS_SRC} src={SRC} onFatalError={onFatalError} />,
    );
    const video = container.querySelector('video');
    expect(video?.getAttribute('src')).toBe(HLS_SRC);

    fireEvent.error(video as HTMLVideoElement);

    await waitFor(() => {
      const current = container.querySelector('video');
      expect(current?.getAttribute('src')).toBe(SRC);
    });
    expect(onFatalError).not.toHaveBeenCalled();
  });
});
