import { toast } from 'sonner';
import { i18n } from '@mesaas/i18n';
import { supabase } from '@/lib/supabase';
import type { AgendaOcorrencia } from '@/store/agenda';
import { saveFile } from '@/utils/downloadMedia';

/** File name stem: lowercase, no accents, non-alphanumerics -> '-', max 60. */
export function slugDoTitulo(titulo: string): string {
  const slug = titulo
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '');
  return slug || 'evento';
}

/** "Baixar .ics": fetches the single-occurrence calendar with the session JWT
 *  and saves it as `<slug>.ics` (Content-Disposition does not apply to a Blob):
 *  a download in the browser, the share sheet in the iOS app. */
export async function baixarIcsDaOcorrencia(o: AgendaOcorrencia): Promise<void> {
  const base = import.meta.env.VITE_SUPABASE_URL as string;
  const url = `${base}/functions/v1/agenda-feed/ocorrencia/${o.ocorrencia_id}.ics`;
  try {
    await saveFile(
      `${slugDoTitulo(o.titulo)}.ics`,
      async () => {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session) throw new Error('Not authenticated');

        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (!res.ok) throw new Error(`agenda-feed ${res.status}`);
        return res.blob();
      },
      url,
    );
  } catch {
    toast.error(i18n.t('agenda:ics.erro'));
  }
}
