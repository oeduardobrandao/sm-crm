// Lista das notas do admin (todas, de todos os autores), compartilhada por desktop e iPhone.
// O compositor fica em cada vista, porque o estilo do campo muda entre as duas.
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Trash2 } from 'lucide-react';
import type { NotesModel } from './types';

export const NOTE_PLACEHOLDER = 'Escreva uma nota para os outros admins…';
export const LEGACY_AUTHOR_LABEL = 'Nota anterior (autor desconhecido)';

export function formatNoteDate(iso: string): string {
  return format(new Date(iso), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR });
}

export function NotesList({ notes }: { notes: NotesModel }) {
  const { items, loadError, onDelete, deletingId } = notes;
  if (loadError) {
    return <p className="m-0 text-sm text-destructive">Não foi possível carregar as notas.</p>;
  }
  if (!items) {
    return <p className="m-0 text-sm text-muted-foreground">Carregando notas…</p>;
  }
  if (items.length === 0) {
    return <p className="m-0 text-sm text-muted-foreground">Nenhuma nota ainda.</p>;
  }
  return (
    <ul className="m-0 flex list-none flex-col gap-2 p-0" aria-label="Notas dos admins">
      {items.map((n) => {
        const author = n.author_email ?? LEGACY_AUTHOR_LABEL;
        return (
          <li key={n.id} className="rounded-[12px] border border-border bg-card/60 px-3 py-2.5">
            <div className="flex items-start justify-between gap-2">
              <p className="m-0 min-w-0 text-xs text-muted-foreground">
                <span className="font-semibold text-foreground">{author}</span>
                {n.is_mine ? ' (você)' : ''} ·{' '}
                <time dateTime={n.created_at}>{formatNoteDate(n.created_at)}</time>
              </p>
              {n.is_mine && (
                <button
                  type="button"
                  onClick={() => onDelete(n.id)}
                  disabled={deletingId === n.id}
                  aria-label={`Excluir nota de ${formatNoteDate(n.created_at)}`}
                  className="-m-1 shrink-0 rounded-md border-0 bg-transparent p-1 text-muted-foreground hover:text-destructive disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              )}
            </div>
            <p className="m-0 mt-1 whitespace-pre-wrap break-words text-sm text-foreground">
              {n.body}
            </p>
          </li>
        );
      })}
    </ul>
  );
}
