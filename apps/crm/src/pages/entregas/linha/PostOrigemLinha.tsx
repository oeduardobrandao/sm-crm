import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import { useTranslation } from 'react-i18next';
import { useDateFnsLocale } from '@mesaas/i18n';
import { ListChecks } from 'lucide-react';
import { useWorkspaceLimits } from '@/hooks/useWorkspaceLimits';
import { getOrigemDoPost, listRespostas } from '@/store/linhaEditorial';
import { mesLabel } from './linhaLogic';

/**
 * Where a post came from: the chip back to its linha editorial plus the client's comments on
 * that row (read live, never copied). Renders nothing without the flag or without an origin.
 */
export function PostOrigemLinha({ postId }: { postId: number | undefined }) {
  const { t } = useTranslation('linha');
  const dateLocale = useDateFnsLocale();
  const { features } = useWorkspaceLimits();
  const enabled = features?.feature_linha_editorial === true;

  const { data: origem } = useQuery({
    queryKey: ['linha-origem', postId],
    queryFn: () => getOrigemDoPost(postId as number),
    enabled: enabled && postId != null,
    staleTime: 60_000,
  });
  const linhaId = origem?.linha.id;
  const itemId = origem?.item.id;
  const { data: respostas } = useQuery({
    queryKey: ['linha-origem-respostas', linhaId],
    queryFn: () => listRespostas(linhaId as string),
    enabled: enabled && !!linhaId,
    staleTime: 60_000,
  });

  if (!enabled || postId == null || !origem) return null;

  const { linha } = origem;
  const comentarios = (respostas ?? []).filter(
    (r) => !r.is_workspace_user && r.item_id === itemId && !!r.comentario?.trim(),
  );

  return (
    <div className="mb-3 flex flex-col gap-2" data-testid="post-origem-linha">
      <Link
        to={`/entregas?view=linha&clientes=${linha.cliente_id}&mes=${linha.periodo.slice(0, 7)}`}
        className="inline-flex w-fit items-center gap-1.5 rounded-full border border-[var(--border-color)] bg-[var(--surface-hover)] px-2.5 py-1 text-xs font-medium text-[var(--text-main)] no-underline hover:bg-[var(--surface-1)]"
      >
        <ListChecks size={13} aria-hidden="true" />
        {linha.titulo?.trim()
          ? t('postOrigem.chipTitulo', { titulo: linha.titulo.trim() })
          : t('postOrigem.chip', { mes: mesLabel(linha.periodo) })}
      </Link>
      {comentarios.length > 0 && (
        <section aria-label={t('postOrigem.comentarios')} className="flex flex-col gap-1.5">
          <h3 className="m-0 text-xs font-semibold text-[var(--text-muted)]">
            {t('postOrigem.comentarios')}
          </h3>
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
            {comentarios.map((r) => (
              <li
                key={r.id}
                className="rounded-lg border border-[var(--border-color)] bg-[var(--surface-main)] px-3 py-2 text-sm text-[var(--text-main)]"
              >
                <p className="m-0 whitespace-pre-wrap">{r.comentario}</p>
                <time dateTime={r.created_at} className="text-[11px] text-[var(--text-light)]">
                  {format(new Date(r.created_at), t('shared.dayMonthFormat'), {
                    locale: dateLocale,
                  })}
                </time>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
