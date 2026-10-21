import { format } from 'date-fns';
import { trackUnsavedWork } from '@mesaas/app-lifecycle';
import { CSV_BOM, CSV_EOL, csvRow, downloadCsv } from '@/lib/csvExport';
import { slugifyTitle } from '@/lib/briefingExport';
import { fetchAllInstagramContacts, type ContactFilters, type InstagramContact } from '@/store';
import { instagramProfileUrl } from './profileUrl';

const SEP = ';';

const HEADER = [
  'usuario',
  'perfil_url',
  'cliente',
  'recebeu_dm',
  'interacoes',
  'primeira_interacao',
  'ultima_interacao',
  'automacao',
  'ultimo_comentario',
];

function when(iso: string): string {
  return format(new Date(iso), 'yyyy-MM-dd HH:mm');
}

export function buildContactsCsv(
  rows: InstagramContact[],
  clientesById: Map<number, string>,
): string {
  const sorted = [...rows].sort((a, b) =>
    b.last_interaction_at.localeCompare(a.last_interaction_at),
  );
  const lines = [csvRow(HEADER, SEP)];
  for (const r of sorted) {
    const automacao = r.automation_name
      ? r.automation_deleted
        ? `${r.automation_name} (removida)`
        : r.automation_name
      : '';
    lines.push(
      csvRow(
        [
          r.commenter_username ?? '',
          instagramProfileUrl(r.commenter_username) ?? '',
          clientesById.get(r.client_id) ?? '',
          r.reached ? 'sim' : 'não',
          r.interactions_count,
          when(r.first_interaction_at),
          when(r.last_interaction_at),
          automacao,
          r.last_comment_text ?? '',
        ],
        SEP,
      ),
    );
  }
  return CSV_BOM + lines.join(CSV_EOL);
}

export function contactsCsvFilename(clienteNome: string | null, now: Date = new Date()): string {
  const slug = clienteNome ? slugifyTitle(clienteNome) : 'todos';
  return `contatos-${slug}-${format(now, 'yyyy-MM-dd')}.csv`;
}

/** Fetches every matching contact and downloads the file. Tracked as unsaved
 * work so a silent deploy swap can't kill it mid-run. */
export async function exportContactsCsv(
  filters: ContactFilters,
  clientesById: Map<number, string>,
  clienteNome: string | null,
): Promise<number> {
  const rows = await trackUnsavedWork(fetchAllInstagramContacts(filters));
  downloadCsv(buildContactsCsv(rows, clientesById), contactsCsvFilename(clienteNome));
  return rows.length;
}
