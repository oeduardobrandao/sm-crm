import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useHub } from '../../HubContext';
import { hubDashboardQuery } from '../../queries';
import type { DashboardPlatform } from '../../types';
import { prefersReducedMotion } from '../../lib/prefersReducedMotion';
import { Skeleton } from '../Skeleton';
import { AccountCard } from './AccountCard';

export function ConnectedAccounts({
  onOpenPlatform,
  className = '',
}: {
  onOpenPlatform: (platform: DashboardPlatform) => void;
  className?: string;
}) {
  const { t } = useTranslation('hubHome');
  const { token } = useHub();
  const { data, isLoading, isError } = useQuery(hubDashboardQuery(token, 30));
  const [activeIndex, setActiveIndex] = useState(0);
  const trackRef = useRef<HTMLDivElement>(null);

  if (isError) return null;
  const accounts = data?.accounts ?? [];
  if (!isLoading && accounts.length === 0) return null;

  function handleScroll() {
    const el = trackRef.current;
    if (!el) return;
    const center = el.scrollLeft + el.clientWidth / 2;
    let nearest = 0;
    let best = Infinity;
    Array.from(el.children).forEach((child, i) => {
      const c = child as HTMLElement;
      const distance = Math.abs(c.offsetLeft + c.offsetWidth / 2 - center);
      if (distance < best) {
        best = distance;
        nearest = i;
      }
    });
    setActiveIndex(nearest);
  }

  function scrollToCard(index: number) {
    const card = trackRef.current?.children[index] as HTMLElement | undefined;
    card?.scrollIntoView?.({
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
      inline: 'center',
      block: 'nearest',
    });
  }

  const single = accounts.length === 1;

  return (
    <section className={className}>
      <h3 className="font-semibold text-[16px] tracking-tight hub-txt">
        {t('accounts.title', 'Contas conectadas')}
      </h3>
      <div className="text-[12.5px] hub-tx3 mt-0.5 mb-3">
        {t('accounts.subtitle', 'Seus números, atualizados automaticamente ao longo do dia')}
      </div>
      {isLoading ? (
        <Skeleton className="h-[230px] w-full" />
      ) : single ? (
        <AccountCard
          account={accounts[0]}
          layout="wide"
          onOpen={() => onOpenPlatform(accounts[0].platform)}
        />
      ) : (
        <>
          <div
            ref={trackRef}
            onScroll={handleScroll}
            className="flex items-start gap-3 overflow-x-auto snap-x snap-mandatory pb-1 -mx-1 px-1 md:grid md:grid-cols-2 md:gap-4 md:overflow-visible md:mx-0 md:px-0 md:pb-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {accounts.map((a) => (
              <AccountCard
                key={a.platform}
                account={a}
                layout="stacked"
                onOpen={() => onOpenPlatform(a.platform)}
                className="snap-start shrink-0 basis-[86%] md:shrink md:basis-auto"
              />
            ))}
          </div>
          <div className="flex md:hidden justify-center gap-1.5 mt-3">
            {accounts.map((a, i) => {
              const active = i === activeIndex;
              return (
                <button
                  key={a.platform}
                  type="button"
                  aria-label={t('accounts.goToAccount', 'Ir para conta {{index}}', {
                    index: i + 1,
                  })}
                  aria-current={active}
                  onClick={() => scrollToCard(i)}
                  className="flex items-center justify-center py-2.5 px-1.5 -my-2"
                >
                  <span
                    className={`h-1.5 rounded-full transition-all ${
                      active
                        ? 'w-4 bg-stone-800 dark:bg-stone-200'
                        : 'w-1.5 bg-stone-300 dark:bg-stone-600'
                    }`}
                  />
                </button>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}
