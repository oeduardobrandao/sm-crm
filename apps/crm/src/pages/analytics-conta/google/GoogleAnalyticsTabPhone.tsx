import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { PhoneNavBar } from '@/components/mobile/PhoneNavBar';
import { PhoneIconButton } from '@/components/mobile/LargeTitleHeader';
import { PageSkeleton } from '@/components/ui/skeletons';
import { GbpNotConnectedError } from '../../../services/gbpAnalytics';
import { Avatar } from '../../analytics/phone/shared';
import { PeriodSegmented } from '../../analytics/phone/PeriodControl';
import { BILLING_PATH } from '../AnalyticsStateCards';
import { dimmed } from '../tiktok/tiktokTabFormat';
import { GbpActionsChart } from './GbpActionsChart';
import { GbpCard, QueryBody, UnitControl } from './GbpCard';
import { GbpKeywordsCard } from './GbpKeywordsCard';
import { GbpKpiGrid } from './GbpKpiGrid';
import { GbpRatingCard } from './GbpRatingCard';
import { GbpReviewsList } from './GbpReviewsList';
import { GbpSurfacesCard } from './GbpSurfacesCard';
import { GbpUnitsTable } from './GbpUnitsTable';
import type { GooglePhoneFrame, GoogleTabState } from './GoogleAnalyticsTab';
import {
  formatNoteDate,
  GBP_MAX_CUSTOM_DAYS,
  GBP_PERIOD_DAYS,
  rangeLength,
  windowDays,
} from './gbpTabFormat';

/** `/analytics/:id/google` below 768px: the TikTok tab's phone pattern with board 4's cards. */
export function GoogleAnalyticsTabPhone({
  clientId,
  frame,
  tab,
}: {
  clientId: number;
  frame: GooglePhoneFrame;
  /** The desktop tab's state, queries and sync: one data layer for both variants. */
  tab: GoogleTabState;
}) {
  const { t, i18n } = useTranslation(['analyticsGoogle', 'clients']);
  const { data, location, setLocation, syncing, handleSync } = tab;
  const { overview, daily, surfaces, keywords, reviews, ratingDistribution } = data;
  const redesSociais = `/clientes/${clientId}/redes-sociais`;

  if (overview.isPending || tab.unitGone) {
    return (
      <Frame frame={frame}>
        <PageSkeleton body="report" header={false} />
      </Frame>
    );
  }

  if (overview.isError && !overview.data) {
    if (overview.error instanceof GbpNotConnectedError) {
      return (
        <Frame frame={frame}>
          <StateBlock
            title={t('states.notConnectedTitle')}
            body={t('states.notConnectedBody')}
            action={
              <Link to={redesSociais} className="phone-an-link-button">
                {t('states.connectAction')}
              </Link>
            }
          />
        </Frame>
      );
    }
    if (data.locked) {
      return (
        <Frame frame={frame}>
          <StateBlock
            title={t('states.lockedTitle')}
            body={t('states.locked')}
            action={
              <Link to={BILLING_PATH} className="phone-an-link-button">
                {t('states.lockedAction')}
              </Link>
            }
          />
        </Frame>
      );
    }
    // The period may be what failed (a long custom window), so it stays changeable.
    return (
      <Frame frame={frame}>
        <PhonePeriod tab={tab} />
        <StateBlock
          title={t('states.error')}
          action={
            <button
              type="button"
              className="phone-an-link-button"
              onClick={() => overview.refetch()}
            >
              {t('states.retry')}
            </button>
          }
        />
      </Frame>
    );
  }

  const ov = overview.data!;
  // The server lists only the client's `active` and `revoked` units.
  const units = data.units.data ?? [];
  const revoked = units.filter((u) => u.status === 'revoked');
  const selectedUnit = location === 'all' ? null : units.find((u) => u.id === location);
  const days = windowDays(ov.window);

  return (
    <Frame frame={frame} syncing={syncing} onSync={handleSync}>
      {units.length > 1 && (
        <div style={{ margin: '0 0 12px' }}>
          <UnitControl units={units} value={location} onChange={setLocation} forceSelect />
        </div>
      )}
      <PhonePeriod tab={tab} />

      {revoked.length > 0 && (
        <section className="phone-an-callout" role="status">
          <div className="phone-an-callout__head">
            <AlertTriangle aria-hidden="true" />
            <h2 className="phone-an-callout__title">
              {t('revoked.title', {
                count: revoked.length,
                units: revoked.map((u) => u.title || t('filters.untitledUnit')).join(', '),
              })}
            </h2>
          </div>
          <p className="phone-an-callout__text">{t('clients:gmn.revokedBanner')}</p>
          <Link to={redesSociais} className="phone-an-link-button">
            {t('clients:gmn.reconnect')}
          </Link>
        </section>
      )}

      {ov.dataThrough === null ? (
        <StateBlock title={t('states.firstSyncTitle')} body={t('states.firstSyncBody')} />
      ) : (
        <>
          <p className="phone-an-footnote" style={{ margin: '0 4px 12px' }}>
            {t('note', { date: formatNoteDate(ov.dataThrough, i18n.language) })}
          </p>

          <div style={dimmed(overview.isPlaceholderData)} aria-busy={overview.isPlaceholderData}>
            <GbpKpiGrid
              kpis={ov.kpis}
              windowDays={days}
              totalReviews={ratingDistribution.data?.total ?? null}
            />
          </div>

          <GbpCard phone title={t('actions.title')} sub={t('actions.sub')}>
            <QueryBody query={daily}>{(rows) => <GbpActionsChart daily={rows} phone />}</QueryBody>
          </GbpCard>
          <GbpSurfacesCard phone query={surfaces} />
          <GbpKeywordsCard phone query={keywords} onMonth={tab.setKeywordsMonth} />
          <GbpRatingCard
            phone
            query={ratingDistribution}
            avgRating={ov.kpis.avg_rating?.value ?? null}
            newReviews={ov.kpis.new_reviews?.value ?? null}
            scope={
              selectedUnit ? selectedUnit.title || t('filters.untitledUnit') : t('rating.subAll')
            }
          />
          <GbpReviewsList
            phone
            query={reviews}
            filter={tab.reviewFilter}
            onFilter={tab.setReviewFilter}
          />
          {units.length > 1 && <GbpUnitsTable phone units={units} windowDays={days} />}
        </>
      )}
    </Frame>
  );
}

/** Nav bar (back, sync), the identity heading, the shell's tabs, then the tab's content. */
function Frame({
  frame,
  syncing,
  onSync,
  children,
}: {
  frame: GooglePhoneFrame;
  syncing?: boolean;
  onSync?: () => void;
  children: ReactNode;
}) {
  const { t } = useTranslation('analyticsGoogle');
  const name = frame.nome;
  return (
    <div className="phone-kit phone-an">
      <PhoneNavBar
        fallbackTo="/analytics"
        backLabel={t('states.back')}
        trailing={
          onSync ? (
            <PhoneIconButton
              label={t('sync.action')}
              onClick={onSync}
              disabled={syncing}
              aria-busy={syncing || undefined}
            >
              <RefreshCw aria-hidden="true" className={syncing ? 'phone-an-spin' : undefined} />
            </PhoneIconButton>
          ) : undefined
        }
      />
      <div className="phone-an-identity">
        <Avatar
          src={frame.photo}
          initials={name.slice(0, 2).toUpperCase()}
          color={frame.cor}
          large
        />
        <div className="phone-an-identity__text">
          <h1 className="phone-an-identity__name">{name}</h1>
        </div>
      </div>
      {frame.tabs}
      {children}
    </div>
  );
}

function StateBlock({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <section className="phone-an-empty">
      <h2>{title}</h2>
      {body && <p>{body}</p>}
      {action}
    </section>
  );
}

/** 7d / 30d / 90d plus Personalizado (a day count, sent as a range ending on data-through). */
function PhonePeriod({ tab }: { tab: GoogleTabState }) {
  const { t } = useTranslation('analyticsGoogle');
  const { range, setRange, applyCustomDays } = tab;
  const days = 'days' in range ? range.days : null;
  return (
    <PeriodSegmented
      aria-label={t('filters.periodAria')}
      presets={GBP_PERIOD_DAYS.map((d) => ({
        value: String(d),
        label: t('filters.periodShort', { count: d }),
      }))}
      value={days !== null ? String(days) : null}
      onChange={(v) => setRange({ days: parseInt(v, 10) })}
      custom={{
        days: days === null ? rangeLength(range) : null,
        min: 1,
        max: GBP_MAX_CUSTOM_DAYS,
        onApply: applyCustomDays,
      }}
    />
  );
}
