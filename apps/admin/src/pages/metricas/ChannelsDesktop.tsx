import { Fragment, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table';
import { Badge } from '../../components/ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '../../components/ui/tooltip';
import { channelTone, type AcquisitionChannel } from '../../lib/acquisition-channels';
import { formatCents, type DisplayRow } from './channels-view';

export const CHANNELS_FOOTNOTE =
  'Assinaram: pagou ao menos uma vez. Pagando hoje: mesma regra do MRR. Clique num canal para ver as campanhas (utm_campaign).';

/** The channel badge (or plain text for the merged and total rows), with no split detail. */
export function RowText({ row }: { row: DisplayRow }) {
  return row.channel ? (
    <Badge variant={channelTone(row.channel as AcquisitionChannel)}>{row.label}</Badge>
  ) : (
    <span className={row.isTotal ? 'font-semibold' : 'font-medium'}>{row.label}</span>
  );
}

/** "Direto: 4 · Não capturado: 2" for the merged row, null otherwise. */
export function splitDetail(row: DisplayRow): string | null {
  return row.split ? row.split.map((s) => `${s.label}: ${s.signups}`).join(' · ') : null;
}

export function RowLabel({ row }: { row: DisplayRow }) {
  const text = <RowText row={row} />;
  const detail = splitDetail(row);
  if (!detail) return text;
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="cursor-help">
            {text}
            <span className="sr-only">, {detail}</span>
          </span>
        </TooltipTrigger>
        <TooltipContent>{detail}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function ChannelsDesktop({ rows }: { rows: DisplayRow[] }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  return (
    <div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Canal</TableHead>
            <TableHead className="text-right">Cadastros</TableHead>
            <TableHead className="text-right">Assinaram</TableHead>
            <TableHead className="text-right">Pagando hoje</TableHead>
            <TableHead className="text-right">MRR (R$)</TableHead>
            <TableHead className="text-right">MRR (US$)</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => {
            const expandable = !r.isTotal && r.campaigns.length > 0;
            const isOpen = open.has(r.key);
            return (
              <Fragment key={r.key}>
                <TableRow className={r.isTotal ? 'font-semibold' : undefined}>
                  <TableCell>
                    {expandable ? (
                      <button
                        type="button"
                        aria-expanded={isOpen}
                        aria-label={`${r.label}, campanhas`}
                        onClick={() => toggle(r.key)}
                        className="mr-1.5 inline-flex align-middle text-muted-foreground"
                      >
                        {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      </button>
                    ) : (
                      <span className="mr-1.5 inline-block w-3.5" />
                    )}
                    <RowLabel row={r} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{r.signups}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.ever_paid}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.paying_now}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatCents(r.mrr_cents.brl, 'brl')}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatCents(r.mrr_cents.usd, 'usd')}
                  </TableCell>
                </TableRow>
                {isOpen
                  ? r.campaigns.map((c) => (
                      <TableRow
                        key={`${r.key}:${c.key}`}
                        className="bg-muted/30 text-muted-foreground"
                      >
                        <TableCell className="pl-10 font-mono text-xs">{c.label}</TableCell>
                        <TableCell className="text-right tabular-nums">{c.signups}</TableCell>
                        <TableCell className="text-right tabular-nums">{c.ever_paid}</TableCell>
                        <TableCell className="text-right tabular-nums">{c.paying_now}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatCents(c.mrr_cents.brl, 'brl')}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatCents(c.mrr_cents.usd, 'usd')}
                        </TableCell>
                      </TableRow>
                    ))
                  : null}
              </Fragment>
            );
          })}
        </TableBody>
      </Table>
      <p className="px-4 py-3 text-xs text-muted-foreground">{CHANNELS_FOOTNOTE}</p>
    </div>
  );
}
