import { afterEach, describe, expect, it, vi } from 'vitest';
const fake = vi.hoisted(() => ({
  load: vi.fn(),
  writeFile: vi.fn(),
  exec: vi.fn(),
  readFile: vi.fn(),
  terminate: vi.fn(),
  on: vi.fn(),
}));
vi.mock('@ffmpeg/ffmpeg', () => ({
  FFmpeg: class {
    load = fake.load;
    writeFile = fake.writeFile;
    exec = fake.exec;
    readFile = fake.readFile;
    terminate = fake.terminate;
    on = fake.on;
  },
}));
import { exportVideo } from '../media-editor/exportVideo';
const a = {
  width: 1080,
  height: 1920,
  mode: 'crop' as const,
  zoom: 1,
  x: 0.5,
  y: 0.5,
  background: 'solid' as const,
  color: '#12151a',
};
const file = { name: 'sample.mp4', arrayBuffer: async () => new ArrayBuffer(8) } as File;
afterEach(() => {
  vi.resetAllMocks();
});
describe('video worker lifecycle', () => {
  it('stops on nonzero encoder exit and releases the worker', async () => {
    fake.exec.mockResolvedValue(1);
    await expect(
      exportVideo(file, a, 1920, 1080, 3, 300000000, new AbortController().signal, vi.fn()),
    ).rejects.toThrow('Falha ao processar');
    expect(fake.readFile).not.toHaveBeenCalled();
    expect(fake.terminate).toHaveBeenCalled();
  });
  it('rejects an output above the target size', async () => {
    fake.exec.mockResolvedValue(0);
    fake.readFile.mockResolvedValue(new Uint8Array(100001));
    await expect(
      exportVideo(file, a, 1920, 1080, 3, 100000, new AbortController().signal, vi.fn()),
    ).rejects.toThrow('excede');
    expect(fake.terminate).toHaveBeenCalled();
  });
  it('terminates processing when cancellation occurs', async () => {
    const c = new AbortController();
    fake.load.mockImplementation(async () => c.abort());
    await expect(
      exportVideo(file, a, 1920, 1080, 3, 300000000, c.signal, vi.fn()),
    ).rejects.toThrow();
    expect(fake.exec).not.toHaveBeenCalled();
    expect(fake.terminate).toHaveBeenCalled();
  });
});

it('reports a readable timeout and releases a stalled processor', async () => {
  vi.useFakeTimers();
  let rejectLoad: (error: Error) => void = () => {};
  fake.load.mockImplementation(
    () =>
      new Promise((_resolve, reject) => {
        rejectLoad = reject;
      }),
  );
  fake.terminate.mockImplementation(() => rejectLoad(new Error('called FFmpeg.terminate()')));
  try {
    const failure = expect(
      exportVideo(file, a, 1920, 1080, 3, 300000000, new AbortController().signal, vi.fn()),
    ).rejects.toThrow('demorou');
    await vi.advanceTimersByTimeAsync(30 * 60 * 1000);
    await failure;
  } finally {
    vi.useRealTimers();
  }
});
