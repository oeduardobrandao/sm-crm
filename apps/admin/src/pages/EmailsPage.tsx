import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Mail } from 'lucide-react';
import { SegmentedControl } from '@mesaas/ios-kit';
import { PageHeader } from '../components/PageHeader';
import { EmptyState } from '../components/EmptyState';
import { ErrorState } from '../components/ErrorState';
import { GlassPanel } from '../components/shell/GlassPanel';
import { buttonVariants } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Skeleton } from '../components/ui/skeleton';
import { useIsPhone } from '../hooks/useIsPhone';
import { cn } from '../lib/utils';
import { EmailsBackfill } from './emails/EmailsBackfill';
import { EmailsDailyChart } from './emails/EmailsDailyChart';
import { EmailsKpis } from './emails/EmailsKpis';
import { EmailsRecentBounces } from './emails/EmailsRecentBounces';
import { EmailsPhoneList } from './emails/EmailsPhoneList';
import { EmailsTable } from './emails/EmailsTable';
import {
  buildEmailView,
  presetRange,
  saoPauloDate,
  validateCustomRange,
} from './emails/email-metrics-view';
import { EMAIL_METRICS_KEY, useEmailMetrics } from './emails/useEmailMetrics';

type Preset = '7d' | '30d' | '90d' | 'custom';

const SEGMENTS: { value: Preset; label: string }[] = [
  { value: '7d', label: '7 dias' },
  { value: '30d', label: '30 dias' },
  { value: '90d', label: '90 dias' },
  { value: 'custom', label: 'Personalizado' },
];

/** ISO or Postgres timestamp to 'DD/MM/AAAA' (São Paulo day). Never throws: unparseable input
 * falls back to its leading date part, or an empty string. */
function formatDay(iso: string): string {
  let ymd = '';
  if (iso.length <= 10) ymd = iso;
  else {
    const t = new Date(iso.replace(' ', 'T'));
    ymd = Number.isNaN(t.getTime()) ? iso.slice(0, 10) : saoPauloDate(t);
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

const FOOTER_TAIL =
  'E-mails de login, confirmação de cadastro e recuperação de senha, e os convites enviados pelo sistema de login, saem por outro servidor e não aparecem aqui. Os convites de equipe e de acesso demo estão incluídos.';

/** E-mails: transactional sends through Resend, from the `email_sends` webhook mirror. */
export default function EmailsPage() {
  const isPhone = useIsPhone();
  const queryClient = useQueryClient();
  const [preset, setPreset] = useState<Preset>('7d');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  const customError = preset === 'custom' ? validateCustomRange(customStart, customEnd) : null;
  const range = useMemo(
    () =>
      preset === 'custom'
        ? { start: customStart, end: customEnd }
        : presetRange(preset, new Date()),
    [preset, customStart, customEnd],
  );
  const q = useEmailMetrics(range, customError === null);
  const view = useMemo(() => (q.data ? buildEmailView(q.data) : null), [q.data]);

  const listSearch = new URLSearchParams({ preset });
  if (preset === 'custom') {
    listSearch.set('start', customStart);
    listSearch.set('end', customEnd);
  }
  const listLink = (
    <Link
      to={`/admin/emails/lista?${listSearch.toString()}`}
      aria-disabled={customError ? 'true' : undefined}
      tabIndex={customError ? -1 : undefined}
      onClick={customError ? (e) => e.preventDefault() : undefined}
      className={cn(
        buttonVariants({ variant: 'secondary', size: 'sm' }),
        customError && 'pointer-events-none opacity-50',
      )}
    >
      Ver lista completa
    </Link>
  );

  const segments = (
    <SegmentedControl
      aria-label="Período"
      value={preset}
      onChange={(p) => {
        setMessage(null);
        setPreset(p);
      }}
      options={SEGMENTS.map((s) => ({
        value: s.value,
        label: isPhone && s.value === 'custom' ? 'Outro' : s.label,
      }))}
    />
  );

  const backfill = (
    <EmailsBackfill
      onMessage={setMessage}
      formatSince={formatDay}
      onDone={async (_inserted, ok) => {
        if (!ok) {
          await q.refetch();
          return null;
        }
        await queryClient.invalidateQueries({ queryKey: EMAIL_METRICS_KEY });
        const cs = queryClient.getQueryData<{ coverage_start: string | null }>([
          ...EMAIL_METRICS_KEY,
          range.start,
          range.end,
        ])?.coverage_start;
        return cs ? formatDay(cs) || null : null;
      }}
    />
  );

  const empty = view !== null && view.categories.length === 0 && view.excluded.length === 0;

  let body;
  if (customError) {
    body = null;
  } else if (q.isPending) {
    body = <Skeleton className="h-80 w-full rounded-2xl" />;
  } else if (q.isError) {
    body = (
      <GlassPanel flush>
        <ErrorState message="Não foi possível carregar as métricas." onRetry={() => q.refetch()} />
      </GlassPanel>
    );
  } else if (!view || empty) {
    body = (
      <GlassPanel flush>
        <EmptyState icon={Mail} title="Nenhum e-mail no período" />
      </GlassPanel>
    );
  } else {
    body = (
      <>
        <EmailsKpis kpis={view.kpis} />
        <div className="space-y-5">
          <GlassPanel title="Envios por dia">
            <EmailsDailyChart daily={view.daily} compact={isPhone} />
          </GlassPanel>
          <GlassPanel title="Por tipo" flush>
            {isPhone ? (
              <EmailsPhoneList categories={view.categories} excluded={view.excluded} />
            ) : (
              <EmailsTable categories={view.categories} excluded={view.excluded} />
            )}
          </GlassPanel>
          <EmailsRecentBounces recent={view.recent} />
        </div>
      </>
    );
  }

  return (
    <div>
      <PageHeader
        title="E-mails"
        description="Envios transacionais pelo Resend"
        actions={
          <>
            {segments}
            {listLink}
            {backfill}
          </>
        }
        phoneActions={backfill}
      >
        {isPhone ? (
          <>
            {segments}
            <div className="mt-3">{listLink}</div>
          </>
        ) : null}
      </PageHeader>
      {preset === 'custom' ? (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Input
            type="date"
            aria-label="Data inicial"
            className="w-auto"
            value={customStart}
            onChange={(e) => {
              setMessage(null);
              setCustomStart(e.target.value);
            }}
          />
          <Input
            type="date"
            aria-label="Data final"
            className="w-auto"
            value={customEnd}
            onChange={(e) => {
              setMessage(null);
              setCustomEnd(e.target.value);
            }}
          />
          {customError ? (
            <p role="alert" className="text-sm text-destructive">
              {customError}
            </p>
          ) : null}
        </div>
      ) : null}
      {message ? (
        <p role="status" className="mb-3 text-sm text-muted-foreground">
          {message}
        </p>
      ) : null}
      {body}
      {view ? (
        <p className="mt-5 text-xs text-muted-foreground">
          {view.coverageStart ? `Dados desde ${formatDay(view.coverageStart)}. ` : ''}
          {FOOTER_TAIL}
        </p>
      ) : null}
    </div>
  );
}
