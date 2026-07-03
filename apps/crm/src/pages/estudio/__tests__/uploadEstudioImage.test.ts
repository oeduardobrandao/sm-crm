import { describe, expect, it, vi, beforeEach } from 'vitest';

const uploadFile = vi.fn();
vi.mock('@/services/fileService', () => ({
  uploadFile: (...args: unknown[]) => uploadFile(...args),
}));

import { uploadEstudioImage } from '../lib/uploadEstudioImage';

function makeFile(opts: { type?: string; size?: number; name?: string } = {}): File {
  const { type = 'image/png', size = 1024, name = 'photo.png' } = opts;
  const file = new File([new Uint8Array(Math.max(1, Math.min(size, 1024)))], name, { type });
  // jsdom computes `size` from the Blob parts, which is impractical for a 20MB+ test case —
  // override the getter directly so validation sees the intended size without allocating it.
  Object.defineProperty(file, 'size', { value: size });
  return file;
}

describe('uploadEstudioImage', () => {
  beforeEach(() => {
    uploadFile.mockReset();
  });

  it('uploads a valid image with folderId: null and no postId', async () => {
    uploadFile.mockResolvedValue({ id: 42, width: 800, height: 600 });
    const file = makeFile();

    const result = await uploadEstudioImage(file);

    expect(uploadFile).toHaveBeenCalledWith({ file, folderId: null });
    expect(uploadFile).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ file_id: 42, width: 800, height: 600 });
  });

  it("returns the resolved FileRecord's numeric .id as file_id", async () => {
    uploadFile.mockResolvedValue({ id: 12345, width: 100, height: 100 });
    const result = await uploadEstudioImage(makeFile());
    expect(result.file_id).toBe(12345);
    expect(typeof result.file_id).toBe('number');
  });

  it('falls back to 800x800 when width/height come back null', async () => {
    uploadFile.mockResolvedValue({ id: 7, width: null, height: null });
    const result = await uploadEstudioImage(makeFile());
    expect(result).toEqual({ file_id: 7, width: 800, height: 800 });
  });

  it('falls back independently per axis when only one of width/height is null', async () => {
    uploadFile.mockResolvedValue({ id: 8, width: 400, height: null });
    const result = await uploadEstudioImage(makeFile());
    expect(result).toEqual({ file_id: 8, width: 400, height: 800 });
  });

  it.each(['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'])(
    'accepts MIME type %s',
    async (type) => {
      uploadFile.mockResolvedValue({ id: 1, width: 10, height: 10 });
      await expect(uploadEstudioImage(makeFile({ type }))).resolves.toBeDefined();
    },
  );

  it('rejects an unsupported MIME type without calling uploadFile', async () => {
    await expect(uploadEstudioImage(makeFile({ type: 'application/pdf' }))).rejects.toThrow(
      'Tipo de arquivo não suportado',
    );
    expect(uploadFile).not.toHaveBeenCalled();
  });

  it('rejects a video MIME type', async () => {
    await expect(uploadEstudioImage(makeFile({ type: 'video/mp4' }))).rejects.toThrow(
      'Tipo de arquivo não suportado',
    );
    expect(uploadFile).not.toHaveBeenCalled();
  });

  it('rejects a file over the 20MB cap without calling uploadFile', async () => {
    const file = makeFile({ size: 20 * 1024 * 1024 + 1 });
    await expect(uploadEstudioImage(file)).rejects.toThrow('Imagem maior que 20 MB');
    expect(uploadFile).not.toHaveBeenCalled();
  });

  it('accepts a file exactly at the 20MB cap', async () => {
    uploadFile.mockResolvedValue({ id: 1, width: 10, height: 10 });
    const file = makeFile({ size: 20 * 1024 * 1024 });
    await expect(uploadEstudioImage(file)).resolves.toBeDefined();
  });

  it('rejects a zero-byte file without calling uploadFile', async () => {
    const file = makeFile({ size: 0 });
    await expect(uploadEstudioImage(file)).rejects.toThrow('Imagem maior que 20 MB');
    expect(uploadFile).not.toHaveBeenCalled();
  });

  it('propagates an uploadFile rejection', async () => {
    uploadFile.mockRejectedValue(new Error('network down'));
    await expect(uploadEstudioImage(makeFile())).rejects.toThrow('network down');
  });
});
