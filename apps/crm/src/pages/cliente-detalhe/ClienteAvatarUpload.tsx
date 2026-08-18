import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Camera, X } from 'lucide-react';
import { toast } from 'sonner';
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

export function ClienteAvatarUpload({
  clienteId,
  nome,
  cor,
  initials,
  imageUrl,
  canEdit,
}: ClienteAvatarUploadProps) {
  const qc = useQueryClient();
  const [uploading, setUploading] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function invalidate() {
    qc.invalidateQueries({ queryKey: ['cliente', clienteId] });
    qc.invalidateQueries({ queryKey: ['clientes'] });
  }

  async function handleUpload(file: File) {
    if (file.size > MAX_PHOTO_BYTES) {
      toast.error('Arquivo deve ser menor que 2MB.');
      return;
    }
    setUploading(true);
    try {
      const blob = await resizeClientePhoto(file);
      const path = `clientes/${clienteId}/${crypto.randomUUID()}.png`;
      const { error: upErr } = await supabase.storage
        .from('avatars')
        .upload(path, blob, { contentType: 'image/png' });
      if (upErr) throw upErr;

      const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(path);
      await updateCliente(clienteId, { foto_url: urlData.publicUrl });
      setImageFailed(false);
      invalidate();
      toast.success('Foto atualizada!');
    } catch {
      toast.error('Erro ao enviar foto.');
    } finally {
      setUploading(false);
    }
  }

  async function handleRemove() {
    setUploading(true);
    try {
      await updateCliente(clienteId, { foto_url: null });
      invalidate();
      toast.success('Foto removida.');
    } catch {
      toast.error('Erro ao remover foto.');
    } finally {
      setUploading(false);
      setRemoveOpen(false);
    }
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
        aria-label="Alterar foto do cliente"
        disabled={uploading}
        onClick={() => inputRef.current?.click()}
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
        ref={inputRef}
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
            aria-label="Remover foto do cliente"
            disabled={uploading}
            onClick={() => setRemoveOpen(true)}
          >
            <X size={12} />
          </button>
          <AlertDialog open={removeOpen} onOpenChange={setRemoveOpen}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Remover a foto do cliente?</AlertDialogTitle>
                <AlertDialogDescription>
                  O Hub volta a mostrar o avatar do Instagram (se houver) ou as iniciais do cliente.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction onClick={handleRemove}>Remover</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      )}
    </div>
  );
}
