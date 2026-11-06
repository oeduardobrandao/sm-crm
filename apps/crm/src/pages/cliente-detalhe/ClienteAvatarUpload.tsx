import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Camera, X } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { holdUnsavedWork } from '@mesaas/app-lifecycle';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { supabase } from '@/lib/supabase';
import { updateCliente } from '@/store';
import { resizeClientePhoto } from './clienteFoto';

const MAX_PHOTO_BYTES = 2 * 1024 * 1024;

interface ClienteAvatarUploadProps {
  clienteId: number;
  nome: string;
  cor: string;
  initials: string;
  imageUrl: string | null;
  canEdit: boolean;
}

/**
 * Upload / remove of a client's photo, shared by the desktop header avatar and the
 * phone index ("…" > Alterar foto / Remover foto). Spread `inputProps` on a hidden file
 * input and call `pick()` from a user gesture (iOS only opens the picker inside one).
 */
export function useClienteFoto(clienteId: number) {
  const { t } = useTranslation('clients');
  const qc = useQueryClient();
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function invalidate() {
    qc.invalidateQueries({ queryKey: ['cliente', clienteId] });
    qc.invalidateQueries({ queryKey: ['clientes'] });
  }

  async function handleUpload(file: File): Promise<boolean> {
    if (file.size > MAX_PHOTO_BYTES) {
      toast.error(t('avatar.tooLarge'));
      return false;
    }
    setUploading(true);
    // The upload and the record update that follows are one unit of work: a silent
    // version swap must not land between them.
    const release = holdUnsavedWork();
    try {
      const blob = await resizeClientePhoto(file);
      const path = `clientes/${clienteId}/${crypto.randomUUID()}.png`;
      const { error: upErr } = await supabase.storage
        .from('avatars')
        .upload(path, blob, { contentType: 'image/png' });
      if (upErr) throw upErr;

      const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(path);
      await updateCliente(clienteId, { foto_url: urlData.publicUrl });
      invalidate();
      toast.success(t('avatar.updated'));
      return true;
    } catch {
      toast.error(t('avatar.uploadError'));
      return false;
    } finally {
      release();
      setUploading(false);
    }
  }

  async function remove() {
    setUploading(true);
    try {
      await updateCliente(clienteId, { foto_url: null });
      invalidate();
      toast.success(t('avatar.removed'));
    } catch {
      toast.error(t('avatar.removeError'));
    } finally {
      setUploading(false);
    }
  }

  return {
    uploading,
    pick: () => inputRef.current?.click(),
    remove,
    upload: handleUpload,
    inputProps: {
      ref: inputRef,
      type: 'file' as const,
      accept: 'image/*',
      disabled: uploading,
      onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (file) void handleUpload(file);
      },
    },
  };
}

export function ClienteAvatarUpload({
  clienteId,
  nome,
  cor,
  initials,
  imageUrl,
  canEdit,
}: ClienteAvatarUploadProps) {
  const { t } = useTranslation('clients');
  const foto = useClienteFoto(clienteId);
  const uploading = foto.uploading;
  const [removeOpen, setRemoveOpen] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);

  async function handleUpload(file: File) {
    if (await foto.upload(file)) setImageFailed(false);
  }

  async function handleRemove() {
    await foto.remove();
    setRemoveOpen(false);
  }

  const avatar =
    imageUrl && !imageFailed ? (
      <img
        className="cliente-detalhe-header__avatar"
        src={imageUrl}
        alt={nome}
        onError={() => setImageFailed(true)}
      />
    ) : (
      <div
        className="cliente-detalhe-header__avatar cliente-detalhe-header__initials"
        style={{ background: cor }}
        aria-hidden="true"
      >
        {initials}
      </div>
    );

  if (!canEdit) return avatar;

  return (
    <div className="cliente-avatar-upload">
      <button
        type="button"
        className="cliente-avatar-upload__trigger"
        aria-label={t('avatar.changeAria')}
        disabled={uploading}
        onClick={foto.pick}
      >
        {avatar}
        <span className="cliente-avatar-upload__overlay" aria-hidden="true">
          <Camera size={16} />
        </span>
      </button>
      <input
        type="file"
        accept="image/*"
        className="hidden"
        ref={foto.inputProps.ref}
        disabled={uploading}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) void handleUpload(file);
        }}
      />
      {imageUrl && (
        <>
          <button
            type="button"
            className="cliente-avatar-upload__remove"
            aria-label={t('avatar.removeAria')}
            disabled={uploading}
            onClick={() => setRemoveOpen(true)}
          >
            <X size={12} />
          </button>
          <AlertDialog open={removeOpen} onOpenChange={setRemoveOpen}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t('avatar.removeTitle')}</AlertDialogTitle>
                <AlertDialogDescription>{t('avatar.removeDescription')}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t('actions.cancel')}</AlertDialogCancel>
                <AlertDialogAction onClick={handleRemove}>{t('actions.delete')}</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      )}
    </div>
  );
}
