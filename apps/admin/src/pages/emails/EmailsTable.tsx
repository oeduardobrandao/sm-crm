import { Fragment, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table';
import { cn } from '../../lib/utils';
import {
  BOUNCE_ALERT,
  COMPLAINT_ALERT,
  formatRate,
  type CategoryRow,
  type Counts,
  type Rates,
} from './email-metrics-view';

function Cells({ counts, rates, muted }: { counts: Counts; rates: Rates; muted?: boolean }) {
  const bounceAlert = !muted && rates.bounce !== null && rates.bounce > BOUNCE_ALERT;
  const complaintAlert = !muted && rates.complaint !== null && rates.complaint > COMPLAINT_ALERT;
  const num = 'text-right tabular-nums';
  return (
    <>
      <TableCell className={num}>{counts.sent.toLocaleString('pt-BR')}</TableCell>
      <TableCell className={num}>{counts.delivered.toLocaleString('pt-BR')}</TableCell>
      <TableCell className={num}>{formatRate(rates.delivery)}</TableCell>
      <TableCell className={num}>{counts.bounced.toLocaleString('pt-BR')}</TableCell>
      <TableCell
        data-alert={bounceAlert ? 'true' : undefined}
        className={cn(num, bounceAlert && 'font-semibold text-destructive')}
      >
        {formatRate(rates.bounce)}
      </TableCell>
      <TableCell
        data-alert={complaintAlert ? 'true' : undefined}
        className={cn(num, complaintAlert && 'font-semibold text-destructive')}
      >
        {counts.complained.toLocaleString('pt-BR')}
      </TableCell>
      <TableCell className={num}>{counts.not_sent.toLocaleString('pt-BR')}</TableCell>
    </>
  );
}

export function EmailsTable({
  categories,
  excluded,
}: {
  categories: CategoryRow[];
  excluded: CategoryRow[];
}) {
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const toggle = (c: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Tipo</TableHead>
          <TableHead className="text-right">Enviados</TableHead>
          <TableHead className="text-right">Entregues</TableHead>
          <TableHead className="text-right">Taxa de entrega</TableHead>
          <TableHead className="text-right">Bounces</TableHead>
          <TableHead className="text-right">Taxa de bounce</TableHead>
          <TableHead className="text-right">Reclamações</TableHead>
          <TableHead className="text-right">Não enviados</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {categories.map((cat) => {
          const isOpen = open.has(cat.category);
          return (
            <Fragment key={cat.category}>
              <TableRow>
                <TableCell>
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    onClick={() => toggle(cat.category)}
                    className="flex items-center gap-1.5 font-medium"
                  >
                    <ChevronRight
                      size={14}
                      aria-hidden="true"
                      className={cn('transition-transform', isOpen && 'rotate-90')}
                    />
                    {cat.label}
                  </button>
                </TableCell>
                <Cells counts={cat.counts} rates={cat.rates} />
              </TableRow>
              {isOpen
                ? cat.types.map((t) => (
                    <TableRow key={`${cat.category}:${t.type}`} className="bg-muted/30">
                      <TableCell className="pl-9 text-muted-foreground">{t.label}</TableCell>
                      <Cells counts={t.counts} rates={t.rates} />
                    </TableRow>
                  ))
                : null}
            </Fragment>
          );
        })}
        {excluded.map((cat) => (
          <TableRow key={cat.category} className="text-muted-foreground">
            <TableCell>{cat.label} (fora do total)</TableCell>
            <Cells counts={cat.counts} rates={cat.rates} muted />
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
