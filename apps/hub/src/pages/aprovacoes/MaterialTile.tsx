import { ArrowRight, Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { StatusPill } from '../../components/StatusPill';
import { getTipoLabel } from '../../lib/postView';
import type { HubMaterialRequest } from '../../services/materialRequests';

/** "14 nov" in the client's language; null when the post has no date yet. */
function shortDate(iso: string | null, lang: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(lang === 'en' ? 'en-US' : 'pt-BR', {
    day: 'numeric',
    month: 'short',
  });
}

export function MaterialTile({
  request,
  onOpen,
}: {
  request: HubMaterialRequest;
  onOpen: (postId: number) => void;
}) {
  const { t, i18n } = useTranslation('hubMaterial');
  const tCommon = useTranslation().t;
  const items = request.request.items;
  const total = items.length;
  const done = items.filter((i) => i.done).length;
  const date = shortDate(request.scheduled_at, i18n.language) ?? t('semData');

  return (
    <button
      type="button"
      onClick={() => onOpen(request.post_id)}
      aria-label={t('abrir', { titulo: request.titulo })}
      className="hub-card relative flex aspect-[4/5] w-full flex-col gap-1.5 p-3 text-left hub-focus-accent focus:outline-none"
    >
      <span className="self-start">
        <StatusPill tone="accent" semantic="wait">
          {t('pill')}
        </StatusPill>
      </span>
      <span className="font-display mt-1 text-[15px] leading-[1.2] hub-txt">{request.titulo}</span>
      <span className="text-[12px] font-semibold hub-txt">{t('progresso', { done, total })}</span>
      <span
        role="progressbar"
        aria-label={t('progressoRotulo', { done, total })}
        aria-valuenow={done}
        aria-valuemin={0}
        aria-valuemax={total}
        className="block h-1 overflow-hidden rounded-full"
        style={{ background: 'var(--hub-soft)' }}
      >
        <span
          className="block h-full"
          style={{
            width: total > 0 ? `${Math.round((done / total) * 100)}%` : '0%',
            background: 'var(--hub-txt)',
          }}
        />
      </span>
      <span className="mt-1 flex min-h-0 flex-col gap-1.5 overflow-hidden">
        {items.map((item) => (
          <span
            key={item.id}
            className={`flex items-start gap-[7px] text-[12px] leading-[1.35] ${
              item.done ? 'hub-tx3 line-through' : 'hub-tx2'
            }`}
          >
            {item.done ? (
              <span
                aria-hidden="true"
                className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full"
                style={{ background: 'var(--hub-txt)', color: 'var(--hub-card)' }}
              >
                <Check size={12} strokeWidth={2.5} />
              </span>
            ) : (
              <span
                aria-hidden="true"
                className="box-border h-4 w-4 shrink-0 rounded-full border-[1.5px]"
                style={{ borderColor: 'var(--hub-bd2)' }}
              />
            )}
            <span>{item.label}</span>
          </span>
        ))}
      </span>
      <span className="mt-auto flex items-center justify-between gap-2 text-[12px] hub-tx3">
        <span>
          {getTipoLabel(tCommon, request.tipo)} · {date}
        </span>
        <span className="flex items-center gap-1 font-semibold hub-txt">
          {t('enviar')}
          <ArrowRight aria-hidden="true" size={13} />
        </span>
      </span>
    </button>
  );
}
