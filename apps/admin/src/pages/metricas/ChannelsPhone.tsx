import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { formatCents, type DisplayRow } from './channels-view';
import { CHANNELS_FOOTNOTE, RowText, splitDetail } from './ChannelsDesktop';

function Stats({
  t,
}: {
  t: Pick<DisplayRow, 'signups' | 'ever_paid' | 'paying_now' | 'mrr_cents'>;
}) {
  const items: [string, string][] = [
    ['Cadastros', String(t.signups)],
    ['Assinaram', String(t.ever_paid)],
    ['Pagando hoje', String(t.paying_now)],
    ['MRR (R$)', formatCents(t.mrr_cents.brl, 'brl')],
    ['MRR (US$)', formatCents(t.mrr_cents.usd, 'usd')],
  ];
  return (
    <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
      {items.map(([k, v]) => (
        <div key={k} className="flex justify-between gap-2">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="font-medium tabular-nums">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function ChannelsPhone({ rows }: { rows: DisplayRow[] }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  return (
    <div className="phone-kit space-y-3">
      {rows.map((r) => {
        const expandable = !r.isTotal && r.campaigns.length > 0;
        const isOpen = open.has(r.key);
        // Tooltips do not open on tap, so the direct/unknown split is a visible line here.
        const split = splitDetail(r);
        return (
          <div
            key={r.key}
            data-testid={`channel-card-${r.key}`}
            className="admin-glass space-y-2 rounded-2xl border border-border bg-card p-3.5"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <RowText row={r} />
                {split ? <p className="mt-0.5 text-xs text-muted-foreground">{split}</p> : null}
              </div>
              {expandable ? (
                <button
                  type="button"
                  aria-expanded={isOpen}
                  aria-label={`${r.label}, campanhas`}
                  onClick={() => toggle(r.key)}
                  className="p-1 text-muted-foreground"
                >
                  {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                </button>
              ) : null}
            </div>
            <Stats t={r} />
            {isOpen
              ? r.campaigns.map((c) => (
                  <div key={c.key} className="space-y-1 border-t border-border pt-2">
                    <p className="font-mono text-xs text-muted-foreground">{c.label}</p>
                    <Stats t={c} />
                  </div>
                ))
              : null}
          </div>
        );
      })}
      <p className="px-1 text-xs text-muted-foreground">{CHANNELS_FOOTNOTE}</p>
    </div>
  );
}
