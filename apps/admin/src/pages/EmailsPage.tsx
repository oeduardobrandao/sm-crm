import { useMemo, useState } from 'react';
import { Mail } from 'lucide-react';
import { SegmentedControl } from '@mesaas/ios-kit';
import { PageHeader } from '../components/PageHeader';
import { EmptyState } from '../components/EmptyState';
import { ErrorState } from '../components/ErrorState';
import { GlassPanel } from '../components/shell/GlassPanel';
import { Input } from '../components/ui/input';
import { Skeleton } from '../components/ui/skeleton';
import { useIsPhone } from '../hooks/useIsPhone';
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
import { useEmailMetrics } from './emails/useEmailMetrics';

type Preset = '7d' | '30d' | '90d' | 'custom';

const SEGMENTS: { value: Preset; label: string }[] = [
  { value: '7d', label: '7 dias' },
  { value: '30d', label: '30 dias' },
  { value: '90d', label: '90 dias' },
  { value: 'custom', label: 'Personalizado' },
];

/** 'YYYY-MM-DD...' to 'DD/MM/AAAA' (São Paulo day). */
function formatDay(iso: string): string {
  const [y, m, d] = (iso.length > 10 ? saoPauloDate(new Date(iso)) : iso).split('-');
  return `${d}/${m}/${y}`;
}

const FOOTER_TAIL =
  'E-mails de login, confirmação de cadastro e recuperação de senha, e os convites enviados pelo sistema de login, saem por outro servidor e não aparecem aqui. Os convites de equipe e de acesso demo estão incluídos.';

/** E-mails: transactional sends through Resend, from the `email_log` webhook mirror. */
export default function EmailsPage() {
  const isPhone = useIsPhone();
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

  const segments = (
    <SegmentedControl
      aria-label="Período"
      value={preset}
      onChange={setPreset}
      options={SEGMENTS.map((s) => ({ value: s.value, label: s.label }))}
    />
  );

  const backfill = (
    <EmailsBackfill
      onMessage={setMessage}
      formatSince={formatDay}
      onDone={async () => {
        const r = await q.refetch();
        return r.data?.coverage_start ? formatDay(r.data.coverage_start) : null;
      }}
    />
  );

  const empty = view !== null && view.kpis.sent === 0 && view.excluded.length === 0;

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
            {backfill}
          </>
        }
        phoneActions={backfill}
      >
        {isPhone ? segments : null}
      </PageHeader>
      {preset === 'custom' ? (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Input
            type="date"
            aria-label="Data inicial"
            className="w-auto"
            value={customStart}
            onChange={(e) => setCustomStart(e.target.value)}
          />
          <Input
            type="date"
            aria-label="Data final"
            className="w-auto"
            value={customEnd}
            onChange={(e) => setCustomEnd(e.target.value)}
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
