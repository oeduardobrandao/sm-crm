import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  upload: vi.fn(async (..._args: unknown[]) => ({ error: null as unknown })),
  from: vi.fn(),
  setMemberPhoto: vi.fn(
    async (..._args: unknown[]) => 'https://x/avatars/foto.jpg' as string | null,
  ),
  crop: vi.fn(async (..._args: unknown[]) => new Blob(['x'], { type: 'image/jpeg' })),
  refetchProfile: vi.fn(async () => {}),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    storage: {
      from: (bucket: string) => {
        h.from(bucket);
        return { upload: h.upload };
      },
    },
  },
}));
vi.mock('@/store', () => ({ setMemberPhoto: h.setMemberPhoto }));
vi.mock('@/lib/pessoaFoto', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/pessoaFoto')>()),
  cropPessoaPhoto: h.crop,
}));
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ refetchProfile: h.refetchProfile }),
}));
vi.mock('sonner', () => ({ toast: { success: h.toastSuccess, error: h.toastError } }));

import { hasUnsavedWork } from '@mesaas/app-lifecycle';
import { useFotoPessoa } from '../useFotoPessoa';
import type { FotoAlvo } from '@/store/team';

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

function setup(alvo: FotoAlvo) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(() => useFotoPessoa(alvo), { wrapper });
  return { result, invalidate };
}

function fileOfSize(bytes: number) {
  const f = new File(['x'], 'foto.jpg', { type: 'image/jpeg' });
  Object.defineProperty(f, 'size', { value: bytes });
  return f;
}

const SELF: FotoAlvo = { kind: 'self', userId: 'user-1' };
const MEMBRO: FotoAlvo = { kind: 'membro', membroId: 42 };

beforeEach(() => {
  vi.clearAllMocks();
  h.upload.mockImplementation(async () => ({ error: null }));
  h.setMemberPhoto.mockImplementation(async () => 'https://x/avatars/foto.jpg');
});

describe('useFotoPessoa', () => {
  it('rejects over 10MB', async () => {
    const { result } = setup(SELF);
    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.upload(fileOfSize(10 * 1024 * 1024 + 1));
    });
    expect(ok).toBe(false);
    expect(h.toastError).toHaveBeenCalledWith('A foto deve ter até 10 MB.');
    expect(h.crop).not.toHaveBeenCalled();
    expect(h.upload).not.toHaveBeenCalled();
    expect(h.setMemberPhoto).not.toHaveBeenCalled();
  });

  it('accepts 9MB', async () => {
    const { result } = setup(SELF);
    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.upload(fileOfSize(9 * 1024 * 1024));
    });
    expect(ok).toBe(true);
    expect(h.upload).toHaveBeenCalledTimes(1);
    expect(h.toastSuccess).toHaveBeenCalledWith('Foto atualizada.');
  });

  it('uploads self to profiles/<uid>/<uuid>.jpg', async () => {
    const { result } = setup(SELF);
    const file = fileOfSize(1000);
    await act(async () => {
      await result.current.upload(file);
    });
    expect(h.crop).toHaveBeenCalledWith(file);
    expect(h.from).toHaveBeenCalledWith('avatars');
    const [path, blob, opts] = h.upload.mock.calls[0];
    expect(path).toMatch(new RegExp(`^profiles/user-1/${UUID}\\.jpg$`, 'i'));
    expect(blob).toBeInstanceOf(Blob);
    expect(opts).toEqual({ contentType: 'image/jpeg' });
    expect(h.setMemberPhoto).toHaveBeenCalledWith({ kind: 'self', userId: 'user-1' }, path);
  });

  it('uploads membro to membros/<id>/', async () => {
    const { result } = setup(MEMBRO);
    await act(async () => {
      await result.current.upload(fileOfSize(1000));
    });
    const [path] = h.upload.mock.calls[0];
    expect(path).toMatch(new RegExp(`^membros/42/${UUID}\\.jpg$`, 'i'));
    expect(h.setMemberPhoto).toHaveBeenCalledWith({ kind: 'membro', membroId: 42 }, path);
  });

  it('invalidates', async () => {
    const { result, invalidate } = setup(MEMBRO);
    await act(async () => {
      await result.current.upload(fileOfSize(1000));
    });
    for (const key of [
      'membros',
      'workspace-users',
      'equipe-conversas',
      'equipe-mensagens',
      'equipe-chat-members',
    ]) {
      expect(invalidate).toHaveBeenCalledWith({ queryKey: [key] });
    }
    expect(h.refetchProfile).toHaveBeenCalled();
  });

  it('holds unsaved work during upload', async () => {
    const seen: boolean[] = [];
    h.upload.mockImplementationOnce(async () => {
      seen.push(hasUnsavedWork());
      return { error: null };
    });
    h.setMemberPhoto.mockImplementationOnce(async () => {
      seen.push(hasUnsavedWork());
      return 'https://x/avatars/foto.jpg';
    });
    const { result } = setup(SELF);
    await act(async () => {
      await result.current.upload(fileOfSize(1000));
    });
    expect(seen).toEqual([true, true]);
    await waitFor(() => expect(hasUnsavedWork()).toBe(false));
  });

  it('remove calls setMemberPhoto(alvo, null)', async () => {
    h.setMemberPhoto.mockImplementationOnce(async () => null);
    const { result, invalidate } = setup(MEMBRO);
    await act(async () => {
      await result.current.remove();
    });
    expect(h.setMemberPhoto).toHaveBeenCalledWith({ kind: 'membro', membroId: 42 }, null);
    expect(h.upload).not.toHaveBeenCalled();
    expect(h.toastSuccess).toHaveBeenCalledWith('Foto removida.');
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['membros'] });
    expect(h.refetchProfile).toHaveBeenCalled();
  });

  it('shows an error toast when the upload fails', async () => {
    h.upload.mockImplementationOnce(async () => ({ error: new Error('boom') }));
    const { result } = setup(SELF);
    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.upload(fileOfSize(1000));
    });
    expect(ok).toBe(false);
    expect(h.toastError).toHaveBeenCalledWith('Erro ao enviar a foto.');
    expect(h.setMemberPhoto).not.toHaveBeenCalled();
    expect(result.current.uploading).toBe(false);
  });

  it('shows an error toast when the RPC fails', async () => {
    h.setMemberPhoto.mockImplementationOnce(async () => {
      throw new Error('denied');
    });
    const { result } = setup(MEMBRO);
    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.upload(fileOfSize(1000));
    });
    expect(ok).toBe(false);
    expect(h.toastError).toHaveBeenCalledWith('Erro ao enviar a foto.');
    expect(hasUnsavedWork()).toBe(false);
  });

  it('exposes a gallery input and a front-camera input', () => {
    const { result } = setup(SELF);
    expect(result.current.inputProps).toMatchObject({ type: 'file', accept: 'image/*' });
    expect(result.current.inputProps).not.toHaveProperty('capture');
    expect(result.current.cameraInputProps).toMatchObject({
      type: 'file',
      accept: 'image/*',
      capture: 'user',
    });
  });

  it('uploads the file picked in the input and clears it', async () => {
    const { result } = setup(SELF);
    const file = fileOfSize(1000);
    const target = { files: [file], value: 'C:\\fakepath\\foto.jpg' };
    await act(async () => {
      result.current.inputProps.onChange({
        target,
      } as unknown as React.ChangeEvent<HTMLInputElement>);
    });
    await waitFor(() => expect(h.setMemberPhoto).toHaveBeenCalled());
    expect(target.value).toBe('');
  });
});
