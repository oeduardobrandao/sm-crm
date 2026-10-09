import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ChevronRight } from 'lucide-react';
import type { HubPost } from '../../types';
import { getClientStatusLabel, getPostCover, getTipoLabel } from '../../lib/postView';
import { formatDate, getPlatformLabel } from '../../components/PostCard';
import { StatusPill } from '../../components/StatusPill';
import { SectionHeader } from '../../components/SectionHeader';

export function WaitingSection({
  number,
  posts,
  base,
}: {
  number: number;
  posts: HubPost[];
  base: string;
}) {
  const { t } = useTranslation('hubHome');
  const { t: tp, i18n } = useTranslation('hubPosts');
  const dateLang = i18n.language.startsWith('en') ? 'en-US' : 'pt-BR';
  return (
    <section className="hub-card p-5">
      <SectionHeader
        number={number}
        label={t('home.pauta.section.approvals', 'Aprovações')}
        title={t('home.pauta.waiting.title', 'Esperando você')}
        action={
          <Link
            to={`${base}/aprovacoes`}
            className="flex items-center gap-1 text-[13px] font-semibold hub-txt shrink-0 group"
          >
            {t('home.pauta.waiting.seeAll', 'Ver todas')}
            <ChevronRight
              size={14}
              className="hub-tx3 group-hover:translate-x-0.5 transition-transform"
            />
          </Link>
        }
      />
      <ul className="hub-divide">
        {posts.map((p) => {
          const cover = getPostCover(p);
          const src = cover ? (cover.kind === 'image' ? cover.url : cover.thumbnail_url) : null;
          return (
            <li key={p.id} className="flex items-center gap-3 py-3">
              <span className="w-12 h-[60px] shrink-0 overflow-hidden rounded-[var(--hub-r-tile)] hub-bg-soft">
                {src && !cover?.media_lost_at && (
                  <img
                    src={src}
                    alt=""
                    className="w-full h-full object-cover"
                    loading="lazy"
                    decoding="async"
                  />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[14px] font-medium hub-txt truncate">{p.titulo}</div>
                <div className="text-[12.5px] hub-tx3 mt-0.5 truncate">
                  {getTipoLabel(tp, p.tipo)} · {getPlatformLabel(tp, p.platform ?? 'instagram')}
                  {p.scheduled_at ? ` · ${formatDate(p.scheduled_at, dateLang)}` : ''}
                </div>
              </div>
              <span className="hidden sm:inline-flex">
                <StatusPill tone="accent" semantic="wait">
                  {getClientStatusLabel(tp, 'enviado_cliente')}
                </StatusPill>
              </span>
              <Link
                to={`${base}/aprovacoes/${p.id}`}
                className="hub-btn-secondary h-9 px-3 inline-flex items-center text-[13px] font-semibold shrink-0"
              >
                {t('home.pauta.waiting.review', 'Revisar')}
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
