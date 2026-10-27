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

import { runFfmpegScale } from '../exportVideo';

const file = { name: 'clip.mov', arrayBuffer: async () => new ArrayBuffer(8) } as File;

afterEach(() => {
  vi.resetAllMocks();
});

describe('runFfmpegScale', () => {
  it('runs the given arguments and names the output', async () => {
    fake.exec.mockResolvedValue(0);
    fake.readFile.mockResolvedValue(new Uint8Array(10));
    const args = ['-i', 'input', 'output.mp4'];
    const onProgress = vi.fn();
    const out = await runFfmpegScale(
      file,
      args,
      1000,
      new AbortController().signal,
      onProgress,
      'clip (1080p).mp4',
    );
    expect(fake.exec).toHaveBeenCalledWith(args);
    expect(fake.readFile).toHaveBeenCalledWith('output.mp4');
    expect(out.name).toBe('clip (1080p).mp4');
    expect(out.type).toBe('video/mp4');
    expect(out.size).toBe(10);
    expect(onProgress).toHaveBeenLastCalledWith(100);
    expect(fake.terminate).toHaveBeenCalled();
  });

  it('rejects an output above the size limit', async () => {
    fake.exec.mockResolvedValue(0);
    fake.readFile.mockResolvedValue(new Uint8Array(11));
    await expect(
      runFfmpegScale(file, [], 10, new AbortController().signal, vi.fn(), 'x.mp4'),
    ).rejects.toThrow('excede');
  });
});
