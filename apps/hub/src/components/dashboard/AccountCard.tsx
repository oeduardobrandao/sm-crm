import { ArrowRight, Clock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { PlatformIcon } from '@mesaas/report-blocks/PlatformIcon';
import type { HubAccountSummary } from '../../types';
import { formatCompact, formatCount, formatDayMonth, syncAge } from '../../lib/dashboardFormat';
import { AccountStatusPill } from './AccountStatusPill';

interface Stat {
  key: string;
  label: string;
  value: number | null | undefined;
}

export function AccountCard({
  account,
  layout,
  onOpen,
  className = '',
}: {
  account: HubAccountSummary;
  /** 'wide' is the single-account horizontal layout, from xl up; below it the card stacks like the others. */
  layout: 'stacked' | 'wide';
  onOpen: () => void;
  className?: string;
}) {
  const { t, i18n } = useTranslation('hubHome');
  const locale = i18n.language === 'en' ? 'en-US' : 'pt-BR';
  const reconnect = account.state === 'needs_reconnect';
  const wide = layout === 'wide';
  const isInstagram = account.platform === 'instagram';
  const day = (iso: string) => formatDayMonth(iso, locale);

  const stats: Stat[] = isInstagram
    ? [
        {
          key: 'reach',
          label: t('accounts.stats.reach28d', 'Alcance, 28 dias'),
          value: account.instagram?.reach28d,
        },
        {
          key: 'views',
          label: t('accounts.stats.views28d', 'Visualizações, 28 dias'),
          value: account.instagram?.impressions28d,
        },
        {
          key: 'posts',
          label: t('accounts.stats.posts', 'Publicações'),
          value: account.instagram?.mediaCount,
        },
      ]
    : [
        {
          key: 'views',
          label: t('accounts.stats.views30d', 'Visualizações, 30 dias'),
          value: account.tiktok?.views30d,
        },
        {
          key: 'likes',
          label: t('accounts.stats.likesTotal', 'Curtidas no total'),
          value: account.tiktok?.likesTotal,
        },
        {
          key: 'videos',
          label: t('accounts.stats.videos', 'Vídeos'),
          value: account.tiktok?.videoCount,
        },
      ];

  const age = syncAge(account.lastSyncedAt, new Date());
  let syncText: string | null;
  if (reconnect) {
    syncText =
      age.kind === 'never'
        ? null
        : t('accounts.sync.last', 'Última atualização em {{date}}', {
            date: day(account.lastSyncedAt as string),
          });
  } else if (age.kind === 'minutes') {
    syncText = t('accounts.sync.minutes', 'Atualizado há {{n}} min', { n: age.n });
  } else if (age.kind === 'hours') {
    syncText = t('accounts.sync.hours', 'Atualizado há {{n}} h', { n: age.n });
  } else if (age.kind === 'date') {
    syncText = t('accounts.sync.date', 'Atualizado em {{date}}', { date: day(age.iso) });
  } else {
    syncText = t('accounts.sync.never', 'Aguardando a primeira atualização');
  }

  const delta = account.followersDelta;
  let deltaText: string | null = null;
  let deltaPositive = false;
  if (!reconnect && delta) {
    const date = day(delta.since);
    if (delta.value === 0) {
      deltaText = delta.fullWindow
        ? t('accounts.delta.noneWindow', 'Sem variação em 30 dias')
        : t('accounts.delta.noneSince', 'Sem variação desde {{date}}', { date });
    } else {
      deltaPositive = delta.value > 0;
      const value = `${deltaPositive ? '+' : '-'}${formatCount(Math.abs(delta.value), locale)}`;
      deltaText = delta.fullWindow
        ? t('accounts.delta.window', '{{value}} em 30 dias', { value })
        : t('accounts.delta.since', '{{value}} desde {{date}}', { value, date });
    }
  }

  const followersLabel =
    reconnect && account.lastSyncedAt
      ? t('accounts.followersOn', 'seguidores em {{date}}', { date: day(account.lastSyncedAt) })
      : t('accounts.followers', 'seguidores');

  const platformName = t(
    `accounts.platform.${account.platform}`,
    isInstagram ? 'Instagram' : 'TikTok',
  );

  const head = (
    <div className={`flex items-center gap-3 ${wide ? 'xl:shrink-0' : ''}`}>
      <span className="w-9 h-9 rounded-[10px] hub-bg-soft hub-txt flex items-center justify-center shrink-0">
        <PlatformIcon platform={account.platform} size={18} />
      </span>
      <div className="min-w-0 flex-1">
        <h4 className="text-[15px] font-semibold tracking-tight hub-txt">{platformName}</h4>
        {account.username && (
          <div className="truncate text-[12.5px] hub-tx3">@{account.username}</div>
        )}
      </div>
      <AccountStatusPill state={account.state} />
    </div>
  );

  const number = (
    <div
      className={`flex flex-wrap items-baseline gap-x-2.5 gap-y-1 ${wide ? 'xl:flex-col xl:items-start xl:shrink-0' : ''}`}
    >
      <span
        className={`font-display text-[2.1rem] font-medium tracking-tight leading-none ${reconnect ? 'hub-tx2' : 'hub-txt'}`}
      >
        {formatCount(account.followerCount, locale)}
      </span>
      <span className="text-[13px] hub-tx3">{followersLabel}</span>
      {deltaText && (
        <span
          className={`ml-auto ${wide ? 'xl:ml-0' : ''} text-[12.5px] font-semibold ${deltaPositive ? 'text-emerald-600 dark:text-emerald-400' : 'hub-tx2'}`}
        >
          {deltaText}
        </span>
      )}
    </div>
  );

  const statsBlock = (
    <div
      className={`grid grid-cols-3 border-y border-[var(--hub-bd)] ${wide ? 'xl:flex-1 xl:min-w-0 xl:border-0' : ''}`}
    >
      {stats.map((s, i) => (
        <div
          key={s.key}
          className={`min-w-0 py-3 pr-2 ${i === 0 ? '' : 'pl-3.5 border-l border-[var(--hub-bd)]'}`}
        >
          <div className="text-[17px] font-semibold tracking-tight hub-txt">
            {formatCompact(s.value, locale)}
          </div>
          <div className="text-[12px] hub-tx3 mt-0.5">{s.label}</div>
        </div>
      ))}
    </div>
  );

  const reconnectBlock = (
    <p
      className={`m-0 px-3.5 py-3 rounded-[10px] hub-bg-soft hub-tx2 text-[13px] leading-[1.45] ${wide ? 'xl:flex-1' : ''}`}
    >
      {account.lastSyncedAt
        ? t(
            'accounts.reconnect.stopped',
            'Os números pararam de atualizar em {{date}}. Fale com a sua agência para reconectar a conta.',
            { date: day(account.lastSyncedAt) },
          )
        : t(
            'accounts.reconnect.never',
            'Os números não estão sendo atualizados. Fale com a sua agência para reconectar a conta.',
          )}
    </p>
  );

  const link = (
    <button
      type="button"
      onClick={onOpen}
      className="inline-flex items-center gap-1 whitespace-nowrap font-semibold hub-txt min-h-[44px] md:min-h-0 text-[12.5px]"
    >
      {reconnect
        ? t('accounts.seeHistory', 'Ver histórico')
        : t('accounts.seePerformance', 'Ver desempenho')}
      <ArrowRight size={14} aria-hidden="true" />
    </button>
  );

  const sync = syncText && (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[12.5px] hub-tx3">
      <Clock size={13} aria-hidden="true" />
      {syncText}
    </span>
  );

  return (
    <article
      className={`hub-card p-5 flex flex-col gap-4 ${wide ? 'xl:flex-row xl:items-center xl:gap-6' : ''} ${className}`}
    >
      {head}
      {number}
      {reconnect ? reconnectBlock : statsBlock}
      {wide ? (
        <div className="flex items-center justify-between gap-3 xl:shrink-0 xl:flex-col xl:items-end xl:gap-1.5">
          {link}
          {sync}
        </div>
      ) : (
        <div className="flex items-center justify-between gap-3">
          {sync ?? <span />}
          {link}
        </div>
      )}
    </article>
  );
}
