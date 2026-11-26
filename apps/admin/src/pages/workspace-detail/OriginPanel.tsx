// "Origem" of the workspace detail: acquisition channel, campaign and the two stored touches.
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import type { WorkspaceDetail } from '../../lib/api';
import { GlassPanel } from '../../components/shell/GlassPanel';
import { OriginBadge } from '../workspaces/WorkspacesTable';
import { cn } from '../../lib/utils';

type Acquisition = NonNullable<WorkspaceDetail['acquisition']>;
type Touch = Record<string, unknown> | null;

const EMPTY = '-';

function text(touch: Touch, key: string): string | null {
  const v = touch?.[key];
  return typeof v === 'string' && v.trim() !== '' ? v : null;
}

function touchDate(touch: Touch): string | null {
  const at = text(touch, 'at');
  if (!at) return null;
  const d = new Date(at);
  return Number.isNaN(d.getTime()) ? null : format(d, 'dd/MM/yyyy', { locale: ptBR });
}

function touchSource(touch: Touch): string | null {
  const source = text(touch, 'utm_source');
  const medium = text(touch, 'utm_medium');
  if (source && medium) return `${source} / ${medium}`;
  return source ?? medium;
}

/** Which ad click parameter came (never its value) and whether it was an affiliate link. */
function touchClick(touch: Touch): string | null {
  const parts = [text(touch, 'click'), touch?.ref === true ? 'Link de afiliado' : null].filter(
    (v): v is string => v !== null,
  );
  return parts.length ? parts.join(' · ') : null;
}

function TouchBox({
  title,
  touch,
  highlight,
}: {
  title: string;
  touch: Touch;
  highlight?: boolean;
}) {
  const rows: { label: string; value: string | null; mono?: boolean }[] = [
    { label: 'Data', value: touchDate(touch) },
    { label: 'Fonte', value: touchSource(touch) },
    { label: 'Campanha', value: text(touch, 'utm_campaign') },
    { label: 'Clique', value: touchClick(touch), mono: true },
    { label: 'Veio de', value: text(touch, 'referrer_host') },
    { label: 'Página', value: text(touch, 'landing_path'), mono: true },
  ];
  return (
    <div
      role="group"
      aria-label={title}
      className={cn(
        'min-w-0 rounded-xl border p-3.5',
        highlight ? 'border-primary/50 bg-primary/5' : 'border-border bg-secondary/40',
      )}
    >
      <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </p>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-sm">
        {rows.map((r) => (
          <div key={r.label} className="contents">
            <dt className="text-muted-foreground">{r.label}</dt>
            <dd className={cn('min-w-0 break-words text-right', r.mono && 'font-mono text-xs')}>
              {r.value ?? EMPTY}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** Content of the panel, shared by the desktop panel and the phone section. */
export function OriginBody({ acquisition }: { acquisition: WorkspaceDetail['acquisition'] }) {
  const a: Acquisition | null = acquisition ?? null;
  const showTouches = !!a && a.captured && (a.first_touch !== null || a.last_touch !== null);
  return (
    <div className="flex min-w-0 flex-col gap-3 text-sm">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <OriginBadge channel={a?.channel ?? 'no_data'} />
        {a?.campaign && (
          <span className="min-w-0 break-words text-muted-foreground">{a.campaign}</span>
        )}
      </div>
      {showTouches && (
        <div className="grid min-w-0 gap-3 sm:grid-cols-2">
          <TouchBox title="Primeira visita" touch={a.first_touch} />
          <TouchBox title="Último clique (conta para o canal)" touch={a.last_touch} highlight />
        </div>
      )}
      {!a && (
        <p className="text-xs text-muted-foreground">
          <strong className="font-semibold">Sem dados:</strong> workspace criado antes do rastreio.
        </p>
      )}
      {a && !a.captured && a.channel !== 'demo' && (
        <p className="text-xs text-muted-foreground">
          <strong className="font-semibold">Não capturado:</strong> o navegador não guardou a visita
          (modo privado, outro aparelho).
        </p>
      )}
    </div>
  );
}

export function OriginPanel({
  acquisition,
  titleId = 'wd-origin',
}: {
  acquisition: WorkspaceDetail['acquisition'];
  titleId?: string;
}) {
  return (
    <GlassPanel title="Origem" titleId={titleId}>
      <OriginBody acquisition={acquisition} />
    </GlassPanel>
  );
}
