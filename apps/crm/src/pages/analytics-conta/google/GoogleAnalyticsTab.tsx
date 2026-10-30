import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { useIsDesktop } from '@/hooks/useIsDesktop';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { PageSkeleton } from '@/components/ui/skeletons';
import {
  GbpNotConnectedError,
  type AnalyticsRange,
  type GbpLocation,
  type GbpReviewFilter,
  type GbpUnitRow,
} from '../../../services/gbpAnalytics';
import { GoogleServiceError, syncGoogleProduct } from '../../../services/google';
import { BILLING_PATH, StateCard } from '../AnalyticsStateCards';
import type { TikTokPhoneFrame } from '../tiktok/TikTokAnalyticsTabPhone';
import { dimmed } from '../tiktok/tiktokTabFormat';
import { GbpActionsChart } from './GbpActionsChart';
import { GbpCard, QueryBody, Segments, UnitControl } from './GbpCard';
import { GbpKeywordsCard } from './GbpKeywordsCard';
import { GbpKpiGrid } from './GbpKpiGrid';
import { GbpRatingCard } from './GbpRatingCard';
import { GbpReviewsList } from './GbpReviewsList';
import { GbpSurfacesCard } from './GbpSurfacesCard';
import { GbpUnitsTable } from './GbpUnitsTable';
import { GoogleAnalyticsTabPhone } from './GoogleAnalyticsTabPhone';
import {
  customRange,
  formatNoteDate,
  GBP_DEFAULT_RANGE,
  GBP_MAX_CUSTOM_DAYS,
  GBP_PERIOD_DAYS,
  rangeLength,
  windowDays,
} from './gbpTabFormat';
import { isGbpTabQuery, useGoogleTabData } from './useGoogleTabData';

/** Who the page is about, plus the shell's tab control: the same frame as the TikTok tab. */
export type GooglePhoneFrame = TikTokPhoneFrame;

/**
 * The tab's state and actions, shared by the desktop layout and its phone variant: one data
 * layer, one sync.
 */
function useGoogleTab(clientId: number) {
  const { t } = useTranslation(['analyticsGoogle', 'clients']);
  const qc = useQueryClient();
  const [range, setRange] = useState<AnalyticsRange>(GBP_DEFAULT_RANGE);
  const [location, setLocationState] = useState<GbpLocation>('all');
  const [reviewFilter, setReviewFilter] = useState<GbpReviewFilter>('all');
  const [keywordsMonth, setKeywordsMonth] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const data = useGoogleTabData(clientId, range, location, reviewFilter, keywordsMonth);
  const { overview } = data;

  // A selected unit that answers 404 was unlinked (or never was this client's): the service
  // turns a bare 404 into `Error('Error 404')` and `not_connected` into GbpNotConnectedError.
  // Either way "Todas as unidades" decides what the tab shows.
  const err = overview.error;
  const unitGone =
    location !== 'all' &&
    overview.isError &&
    (err instanceof GbpNotConnectedError || (err instanceof Error && err.message === 'Error 404'));
  useEffect(() => {
    if (!unitGone) return;
    setLocationState('all');
    setKeywordsMonth(null);
  }, [unitGone]);

  const setLocation = (next: GbpLocation) => {
    setLocationState(next);
    // Each unit has its own closed months: start from its latest one.
    setKeywordsMonth(null);
  };

  const applyCustomDays = (days: number) =>
    setRange(customRange(days, overview.data?.dataThrough ?? null));

  const handleSync = async () => {
    setSyncing(true);
    try {
      await syncGoogleProduct('gbp', clientId);
      toast.success(t('sync.success'));
      await qc.invalidateQueries({ predicate: isGbpTabQuery(clientId) });
    } catch (e) {
      const code = e instanceof GoogleServiceError ? e.code : 'unknown';
      toast.error(
        code === 'rate_limited'
          ? t('sync.rateLimited')
          : code === 'reconnect'
            ? t('clients:gmn.revokedBanner')
            : code === 'feature_disabled'
              ? t('states.locked')
              : t('sync.error'),
      );
      // A revoked connection shows up on the units: refetch them for the callout.
      if (code === 'reconnect') await qc.invalidateQueries({ predicate: isGbpTabQuery(clientId) });
    } finally {
      setSyncing(false);
    }
  };

  return {
    data,
    range,
    setRange,
    applyCustomDays,
    location,
    setLocation,
    unitGone,
    reviewFilter,
    setReviewFilter,
    setKeywordsMonth,
    syncing,
    handleSync,
  };
}

export type GoogleTabState = ReturnType<typeof useGoogleTab>;

/**
 * `/analytics/:id/google`: the client's Google Meu Negócio numbers (board 4), one unit and
 * period control for the whole tab. Below 768px it renders `GoogleAnalyticsTabPhone`, which
 * owns the phone frame and shares this tab's state, queries and sync.
 */
export function GoogleAnalyticsTab({
  clientId,
  phoneFrame,
}: {
  clientId: number;
  /** Phone only: who the page is about and the shell's tab control. */
  phoneFrame?: GooglePhoneFrame;
}) {
  const { t, i18n } = useTranslation(['analyticsGoogle', 'clients']);
  const isPhone = !useIsDesktop(768);
  const tab = useGoogleTab(clientId);
  const { data, range, setRange, applyCustomDays, location, setLocation, syncing, handleSync } =
    tab;
  const { overview, daily, surfaces, keywords, reviews, ratingDistribution } = data;
  const redesSociais = `/clientes/${clientId}/redes-sociais`;

  // The shell always passes the frame on phones; without one there is no identity to head the page.
  if (isPhone && phoneFrame) {
    return <GoogleAnalyticsTabPhone clientId={clientId} frame={phoneFrame} tab={tab} />;
  }

  if (overview.isPending || tab.unitGone) return <PageSkeleton body="report" header={false} />;

  if (overview.isError && !overview.data) {
    const err = overview.error;
    if (err instanceof GbpNotConnectedError) {
      return (
        <StateCard
          title={t('states.notConnectedTitle')}
          body={t('states.notConnectedBody')}
          action={
            <Button asChild>
              <Link to={redesSociais}>{t('states.connectAction')}</Link>
            </Button>
          }
        />
      );
    }
    if (data.locked) {
      return (
        <StateCard
          title={t('states.lockedTitle')}
          body={t('states.locked')}
          action={
            <Button asChild variant="outline">
              <Link to={BILLING_PATH}>{t('states.lockedAction')}</Link>
            </Button>
          }
        />
      );
    }
    // The period may be what failed (a long custom window), so it stays changeable.
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
        <GbpPeriodBar range={range} onChange={setRange} onCustomDays={applyCustomDays} />
        <StateCard
          title={t('states.error')}
          action={
            <Button variant="outline" onClick={() => overview.refetch()}>
              {t('states.retry')}
            </Button>
          }
        />
      </div>
    );
  }

  const ov = overview.data!;
  // The server lists only the client's `active` and `revoked` units.
  const units = data.units.data ?? [];
  const selectedUnit = location === 'all' ? null : units.find((u) => u.id === location);
  const days = windowDays(ov.window);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div className="flex flex-wrap items-center justify-between gap-3 animate-up">
        <UnitControl units={units} value={location} onChange={setLocation} />
        <div className="flex flex-wrap items-center gap-3" style={{ marginLeft: 'auto' }}>
          <GbpPeriodBar range={range} onChange={setRange} onCustomDays={applyCustomDays} />
          <Button variant="outline" size="sm" disabled={syncing} onClick={handleSync}>
            {syncing ? <Spinner size="sm" /> : <RefreshCw className="h-4 w-4" />}
            {t('sync.action')}
          </Button>
        </div>
      </div>

      <RevokedCallouts units={units} to={redesSociais} />

      {ov.dataThrough === null ? (
        <StateCard
          title={t('states.firstSyncTitle')}
          body={t('states.firstSyncBody')}
          action={null}
        />
      ) : (
        <>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', margin: '-0.75rem 0 0' }}>
            {t('note', { date: formatNoteDate(ov.dataThrough, i18n.language) })}
          </p>

          <div style={dimmed(overview.isPlaceholderData)} aria-busy={overview.isPlaceholderData}>
            <GbpKpiGrid
              kpis={ov.kpis}
              windowDays={days}
              totalReviews={ratingDistribution.data?.total ?? null}
            />
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <GbpCard title={t('actions.title')} sub={t('actions.sub')}>
              <QueryBody query={daily}>{(rows) => <GbpActionsChart daily={rows} />}</QueryBody>
            </GbpCard>
            <GbpSurfacesCard query={surfaces} />
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <GbpKeywordsCard query={keywords} onMonth={tab.setKeywordsMonth} />
            <GbpRatingCard
              query={ratingDistribution}
              avgRating={ov.kpis.avg_rating?.value ?? null}
              newReviews={ov.kpis.new_reviews?.value ?? null}
              scope={
                selectedUnit ? selectedUnit.title || t('filters.untitledUnit') : t('rating.subAll')
              }
            />
          </div>

          <GbpReviewsList
            query={reviews}
            filter={tab.reviewFilter}
            onFilter={tab.setReviewFilter}
          />

          {units.length > 1 && <GbpUnitsTable units={units} windowDays={days} />}
        </>
      )}
    </div>
  );
}

/** 7 / 30 / 90 dias plus Personalizado (a day count, sent as a range ending on data-through). */
function GbpPeriodBar({
  range,
  onChange,
  onCustomDays,
}: {
  range: AnalyticsRange;
  onChange: (range: AnalyticsRange) => void;
  onCustomDays: (days: number) => void;
}) {
  const { t } = useTranslation('analyticsGoogle');
  const isCustom = !('days' in range);
  const [customOpen, setCustomOpen] = useState(isCustom);
  const value = isCustom || customOpen ? 'custom' : String(range.days);
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Segments
        ariaLabel={t('filters.periodAria')}
        value={value}
        onChange={(v) => {
          if (v === 'custom') {
            setCustomOpen(true);
            return;
          }
          setCustomOpen(false);
          onChange({ days: parseInt(v, 10) });
        }}
        options={[
          ...GBP_PERIOD_DAYS.map((d) => ({
            value: String(d),
            label: t('filters.periodDays', { count: d }),
          })),
          { value: 'custom', label: t('filters.custom') },
        ]}
      />
      {(customOpen || isCustom) && (
        <Input
          type="number"
          min={1}
          max={GBP_MAX_CUSTOM_DAYS}
          placeholder={t('filters.customDaysPlaceholder')}
          aria-label={t('filters.customDaysAria')}
          defaultValue={isCustom ? rangeLength(range) : undefined}
          className="!rounded-full !text-xs h-9 w-[110px] mb-0"
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return;
            const val = parseInt((e.target as HTMLInputElement).value, 10);
            if (isNaN(val) || val < 1 || val > GBP_MAX_CUSTOM_DAYS) {
              toast.error(t('filters.customDaysInvalid'));
              return;
            }
            onCustomDays(val);
          }}
        />
      )}
    </div>
  );
}

/** Revoked units keep their history on screen; this says why they stopped updating. */
function RevokedCallouts({ units, to }: { units: GbpUnitRow[]; to: string }) {
  const { t } = useTranslation(['analyticsGoogle', 'clients']);
  const revoked = units.filter((u) => u.status === 'revoked');
  if (revoked.length === 0) return null;
  const names = revoked.map((u) => u.title || t('filters.untitledUnit')).join(', ');
  return (
    <Callout
      title={t('revoked.title', { count: revoked.length, units: names })}
      text={t('clients:gmn.revokedBanner')}
      action={
        <Button asChild size="sm" variant="outline" style={{ alignSelf: 'flex-start' }}>
          <Link to={to}>{t('clients:gmn.reconnect')}</Link>
        </Button>
      }
    />
  );
}

function Callout({ title, text, action }: { title: string; text: string; action: ReactNode }) {
  return (
    <div
      className="analytics-callout analytics-callout--with-icon animate-up"
      role="status"
      style={{ borderColor: 'var(--warning)' }}
    >
      <AlertTriangle
        className="h-5 w-5 analytics-callout__icon"
        style={{ color: 'var(--warning)' }}
        aria-hidden
      />
      <div className="analytics-callout__body">
        <span className="analytics-callout__title">{title}</span>
        <p className="analytics-callout__text">{text}</p>
        {action}
      </div>
    </div>
  );
}
