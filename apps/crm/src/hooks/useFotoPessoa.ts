import { useRef, useState, type ChangeEvent, type RefObject } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { holdUnsavedWork } from '@mesaas/app-lifecycle';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { cropPessoaPhoto, MAX_PESSOA_FOTO_BYTES } from '@/lib/pessoaFoto';
import { setMemberPhoto, type FotoAlvo } from '@/store';

export interface InputProps {
  ref: RefObject<HTMLInputElement | null>;
  type: 'file';
  accept: string;
  disabled: boolean;
  capture?: 'user';
  onChange: (e: ChangeEvent<HTMLInputElement>) => void;
}

/** Every query that carries a team photo, so a change shows up everywhere at once. */
const PHOTO_QUERY_KEYS = [
  'membros',
  'workspace-users',
  'equipe-conversas',
  'equipe-mensagens',
  'equipe-chat-members',
] as const;

function storagePath(alvo: FotoAlvo): string {
  const file = `${crypto.randomUUID()}.jpg`;
  return alvo.kind === 'self'
    ? `profiles/${alvo.userId}/${file}`
    : `membros/${alvo.membroId}/${file}`;
}

/**
 * Upload / remove of a team member's photo, shared by Perfil (self) and Equipe (a
 * membro). Spread `inputProps` (gallery) and `cameraInputProps` (front camera) on hidden
 * file inputs and call `pick()` / `pickCamera()` from a user gesture: iOS only opens
 * the picker inside one.
 */
export function useFotoPessoa(alvo: FotoAlvo): {
  uploading: boolean;
  pick: () => void;
  pickCamera: () => void;
  upload: (file: File) => Promise<boolean>;
  remove: () => Promise<void>;
  inputProps: InputProps;
  cameraInputProps: InputProps;
} {
  const qc = useQueryClient();
  const { refetchProfile } = useAuth();
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  function invalidate() {
    for (const key of PHOTO_QUERY_KEYS) qc.invalidateQueries({ queryKey: [key] });
    // A membro linked to the caller's own login changes the caller's profile too.
    void refetchProfile();
  }

  async function upload(file: File): Promise<boolean> {
    if (file.size > MAX_PESSOA_FOTO_BYTES) {
      toast.error('A foto deve ter até 10 MB.');
      return false;
    }
    setUploading(true);
    // Upload and RPC are one unit of work: a silent version swap must not land between.
    const release = holdUnsavedWork();
    try {
      const blob = await cropPessoaPhoto(file);
      const path = storagePath(alvo);
      const { error } = await supabase.storage
        .from('avatars')
        .upload(path, blob, { contentType: 'image/jpeg' });
      if (error) throw error;
      await setMemberPhoto(alvo, path);
      invalidate();
      toast.success('Foto atualizada.');
      return true;
    } catch {
      toast.error('Erro ao enviar a foto.');
      return false;
    } finally {
      release();
      setUploading(false);
    }
  }

  async function remove(): Promise<void> {
    setUploading(true);
    const release = holdUnsavedWork();
    try {
      await setMemberPhoto(alvo, null);
      invalidate();
      toast.success('Foto removida.');
    } catch {
      toast.error('Erro ao remover a foto.');
    } finally {
      release();
      setUploading(false);
    }
  }

  function onChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) void upload(file);
  }

  return {
    uploading,
    pick: () => inputRef.current?.click(),
    pickCamera: () => cameraRef.current?.click(),
    upload,
    remove,
    inputProps: { ref: inputRef, type: 'file', accept: 'image/*', disabled: uploading, onChange },
    cameraInputProps: {
      ref: cameraRef,
      type: 'file',
      accept: 'image/*',
      capture: 'user',
      disabled: uploading,
      onChange,
    },
  };
}
