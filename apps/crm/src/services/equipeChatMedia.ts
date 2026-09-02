// apps/crm/src/services/equipeChatMedia.ts
// Upload de anexos do chat de equipe: presign -> PUT -> finalize.
// Contrato do handler (supabase/functions/equipe-chat-media): presign devolve
// a upload_url + key; finalize recebe essa mesma key e devolve o anexo já
// persistido (equipe_mensagem_anexos).
import { supabase } from '@/lib/supabase';
import { probeImage, putWithProgress, type UploadProgress } from './postMedia';
import type { EquipeMensagemAnexo } from '@/store';

export const EQUIPE_CHAT_ANEXO_MIME = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/pdf',
  'application/zip',
];
export const MAX_EQUIPE_CHAT_ANEXO_BYTES = 25 * 1024 * 1024;

export function validateEquipeChatFile(file: File): string | null {
  if (!EQUIPE_CHAT_ANEXO_MIME.includes(file.type)) {
    return 'Tipo de arquivo não suportado. Use imagem, PDF ou ZIP.';
  }
  if (file.size <= 0 || file.size > MAX_EQUIPE_CHAT_ANEXO_BYTES) {
    return 'O arquivo precisa ter no máximo 25MB.';
  }
  return null;
}

async function callFn<T>(route: string, body: unknown): Promise<T> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error('Sessão expirada');
  const res = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/equipe-chat-media/${route}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    },
  );
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(json.error ?? `equipe-chat-media/${route} falhou`);
  return json;
}

export async function uploadEquipeChatAnexo(
  conversaId: number,
  file: File,
  onProgress?: (p: UploadProgress) => void,
): Promise<EquipeMensagemAnexo> {
  // probeImage so para imagens; anexos de documento pulam o probe.
  if (file.type.startsWith('image/')) await probeImage(file).catch(() => null);
  const signed = await callFn<{ upload_url: string; key: string }>('presign', {
    conversa_id: conversaId,
    mime_type: file.type,
    size_bytes: file.size,
  });
  await putWithProgress(signed.upload_url, file, onProgress);
  const { anexo } = await callFn<{ anexo: EquipeMensagemAnexo }>('finalize', {
    conversa_id: conversaId,
    key: signed.key,
    file_name: file.name,
    mime_type: file.type,
    size_bytes: file.size,
  });
  return anexo;
}

export async function signEquipeChatAnexoView(anexoId: number): Promise<string> {
  const { url } = await callFn<{ url: string }>('anexo-url', { anexo_id: anexoId });
  return url;
}
