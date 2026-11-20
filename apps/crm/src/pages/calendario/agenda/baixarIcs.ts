import { toast } from 'sonner';
import { i18n } from '@mesaas/i18n';
import { supabase } from '@/lib/supabase';
import type { AgendaOcorrencia } from '@/store/agenda';
import { saveFile } from '@/utils/downloadMedia';
import { getMesaasNative, hasMesaasNativeMethod } from '@/native/mesaasNative';

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

/** The iOS app binary can add an event to the device's calendar natively. */
export function podeAdicionarAoCalendario(): boolean {
  return hasMesaasNativeMethod('addCalendarEvent');
}

/** Same as the .ics the agenda-feed serves (_shared/ics.ts): description, then the
 *  meeting link, which also goes in the event's URL field. */
function notasDoEvento(o: AgendaOcorrencia): string {
  return [o.descricao?.trim() || null, o.link_reuniao ? `Link da reunião: ${o.link_reuniao}` : null]
    .filter(Boolean)
    .join('\n\n');
}

/** In the iOS app: the system "New Event" screen, filled with the occurrence, where the
 *  user picks a calendar and taps Adicionar. A shared .ics only offered "Save to Files".
 *  Returns false when this binary can't, so the caller falls back to the .ics. */
async function adicionarNoApp(o: AgendaOcorrencia): Promise<boolean> {
  const plugin = getMesaasNative();
  if (!plugin || !podeAdicionarAoCalendario()) return false;
  // A masked occurrence (someone else's private event) has no details to add; the
  // feed answers 404 for it too.
  if (o.mascarado) throw new Error('masked occurrence');
  await plugin.addCalendarEvent({
    title: o.titulo,
    notes: notasDoEvento(o) || undefined,
    location: o.local?.trim() || undefined,
    url: o.link_reuniao ?? undefined,
    allDay: o.dia_inteiro,
    ...(o.dia_inteiro
      ? { startDay: o.data_inicio_local, endDay: o.data_fim_local }
      : { start: o.inicio, end: o.fim }),
  });
  return true;
}

/** "Baixar .ics": fetches the single-occurrence calendar with the session JWT
 *  and saves it as `<slug>.ics` (Content-Disposition does not apply to a Blob):
 *  a download in the browser, the share sheet in the iOS app. */
export async function baixarIcsDaOcorrencia(o: AgendaOcorrencia): Promise<void> {
  const base = import.meta.env.VITE_SUPABASE_URL as string;
  const url = `${base}/functions/v1/agenda-feed/ocorrencia/${o.ocorrencia_id}.ics`;
  try {
    if (await adicionarNoApp(o)) return;
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
