import { beforeEach, describe, expect, it, vi } from 'vitest';

const { upload, createSignedUrl, from, getContaId } = vi.hoisted(() => {
  const upload = vi.fn();
  const createSignedUrl = vi.fn();
  return {
    upload,
    createSignedUrl,
    from: vi.fn(() => ({ upload, createSignedUrl })),
    getContaId: vi.fn(),
  };
});

vi.mock('../core', () => ({
  supabase: { storage: { from }, rpc: vi.fn() },
  getContaId,
}));

import {
  CONTRATO_ERRO,
  uploadContratoAcordo,
  urlContratoAcordo,
  validarContratoAcordo,
} from '../financeiroV2';

const arquivo = (tipo: string, bytes = 1024) =>
  new File([new Uint8Array(bytes)], 'Contrato final (assinado).bin', { type: tipo });

beforeEach(() => {
  vi.clearAllMocks();
  getContaId.mockResolvedValue('conta-1');
  upload.mockResolvedValue({ data: { path: 'x' }, error: null });
});

describe('validarContratoAcordo', () => {
  it('accepts a pdf and images up to 10 MB', () => {
    expect(validarContratoAcordo(arquivo('application/pdf', 10 * 1024 * 1024))).toBeNull();
    expect(validarContratoAcordo(arquivo('image/png'))).toBeNull();
    expect(validarContratoAcordo(arquivo('image/jpeg'))).toBeNull();
  });

  it('rejects a file over 10 MB or of another type', () => {
    expect(validarContratoAcordo(arquivo('application/pdf', 10 * 1024 * 1024 + 1))).toBe(
      'Envie um PDF ou imagem de até 10 MB.',
    );
    expect(validarContratoAcordo(arquivo('image/gif'))).toBe(CONTRATO_ERRO);
    expect(validarContratoAcordo(arquivo(''))).toBe(CONTRATO_ERRO);
  });
});

describe('uploadContratoAcordo', () => {
  it('uploads to <conta>/<membro>/<uuid>.<ext> in the private bucket, without upsert', async () => {
    const path = await uploadContratoAcordo(7, arquivo('application/pdf'));

    expect(path).toMatch(/^conta-1\/7\/[0-9a-f]{8}-[0-9a-f-]{27}\.pdf$/);
    expect(from).toHaveBeenCalledWith('financeiro-acordos');
    expect(upload).toHaveBeenCalledTimes(1);
    const [enviado, , opcoes] = upload.mock.calls[0];
    expect(enviado).toBe(path);
    expect(opcoes).toEqual({ contentType: 'application/pdf', upsert: false });
  });

  it('derives the extension from the mime type, not the file name', async () => {
    expect(await uploadContratoAcordo(7, arquivo('image/jpeg'))).toMatch(/\.jpg$/);
    expect(await uploadContratoAcordo(7, arquivo('image/png'))).toMatch(/\.png$/);
  });

  it('rejects an invalid file before touching storage', async () => {
    await expect(
      uploadContratoAcordo(7, arquivo('application/pdf', 11 * 1024 * 1024)),
    ).rejects.toThrow(CONTRATO_ERRO);
    await expect(uploadContratoAcordo(7, arquivo('text/plain'))).rejects.toThrow(CONTRATO_ERRO);
    expect(upload).not.toHaveBeenCalled();
  });

  it('propagates a storage error', async () => {
    upload.mockResolvedValue({ data: null, error: new Error('new row violates RLS') });
    await expect(uploadContratoAcordo(7, arquivo('application/pdf'))).rejects.toThrow(/RLS/);
  });
});

describe('urlContratoAcordo', () => {
  it('signs the path for 300 seconds', async () => {
    createSignedUrl.mockResolvedValue({ data: { signedUrl: 'https://s/x?t=1' }, error: null });
    await expect(urlContratoAcordo('conta-1/7/a.pdf')).resolves.toBe('https://s/x?t=1');
    expect(from).toHaveBeenCalledWith('financeiro-acordos');
    expect(createSignedUrl).toHaveBeenCalledWith('conta-1/7/a.pdf', 300);
  });

  it('throws when the signing fails', async () => {
    createSignedUrl.mockResolvedValue({ data: null, error: new Error('Object not found') });
    await expect(urlContratoAcordo('conta-1/7/a.pdf')).rejects.toThrow('Object not found');
  });
});
