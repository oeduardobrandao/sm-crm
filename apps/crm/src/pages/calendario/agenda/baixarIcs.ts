import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import type { AgendaOcorrencia } from '@/store/agenda';

const ERRO = 'Não foi possível baixar o arquivo.';

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
 *  and saves it through a temporary link. The name comes from `a.download`:
 *  Content-Disposition does not apply to a Blob download. */
export async function baixarIcsDaOcorrencia(o: AgendaOcorrencia): Promise<void> {
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) throw new Error('Not authenticated');

    const base = import.meta.env.VITE_SUPABASE_URL as string;
    const res = await fetch(`${base}/functions/v1/agenda-feed/ocorrencia/${o.ocorrencia_id}.ics`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    if (!res.ok) throw new Error(`agenda-feed ${res.status}`);

    const href = URL.createObjectURL(await res.blob());
    try {
      const a = document.createElement('a');
      a.href = href;
      a.download = `${slugDoTitulo(o.titulo)}.ics`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } finally {
      // Safari starts the download asynchronously: revoking right away cancels it.
      setTimeout(() => URL.revokeObjectURL(href), 10_000);
    }
  } catch {
    toast.error(ERRO);
  }
}
