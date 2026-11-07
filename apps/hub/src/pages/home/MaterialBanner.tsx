import { Link } from 'react-router-dom';
import { ArrowRight, ImagePlus } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { hubMaterialRequestsQuery } from '../../queries';

/**
 * Home notice for the material the team is still waiting on. Renders nothing while loading,
 * on error, or when no open request has a pending item.
 */
export function MaterialBanner({ token, base }: { token: string; base: string }) {
  const { t } = useTranslation('hubHome');
  const { data } = useQuery(hubMaterialRequestsQuery(token));
  if (!data) return null;
  const items = data.reduce((n, r) => n + r.request.items.filter((i) => !i.done).length, 0);
  if (items === 0) return null;
  const posts = data.length;

  return (
    <Link
      to={`${base}/aprovacoes?aba=material`}
      className="hub-fade-up w-full flex items-center gap-3 px-5 py-3.5 rounded-2xl text-left group transition-shadow hover:shadow-sm"
      style={{
        background: 'color-mix(in srgb, var(--hub-txt) 5%, transparent)',
        border: '1px solid color-mix(in srgb, var(--hub-txt) 14%, transparent)',
      }}
    >
      <span
        className="flex items-center justify-center w-8 h-8 rounded-full flex-shrink-0"
        style={{
          background: 'color-mix(in srgb, var(--hub-txt) 10%, transparent)',
          color: 'var(--hub-txt)',
        }}
      >
        <ImagePlus size={16} strokeWidth={2} aria-hidden="true" />
      </span>
      <span className="flex-1 text-sm font-medium hub-txt">
        {t('home.materialBanner.summary', {
          items: t('home.materialBanner.items', { count: items }),
          posts: t('home.materialBanner.posts', { count: posts }),
        })}
      </span>
      <ArrowRight
        size={16}
        aria-hidden="true"
        className="hub-tx3 group-hover:translate-x-0.5 transition-transform flex-shrink-0"
      />
    </Link>
  );
}
