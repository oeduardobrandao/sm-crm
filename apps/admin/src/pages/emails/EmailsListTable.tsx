import { ExternalLink } from 'lucide-react';
import { Badge } from '../../components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table';
import type { EmailListItem } from '../../lib/api';
import {
  NOT_SENT_DETAIL,
  STATUS_GROUPS,
  formatSpDateTime,
  resendEmailUrl,
  statusGroupOf,
} from './email-list-view';
import { categoryLabel, typeLabel } from './email-metrics-view';

export function StatusBadge({ event }: { event: string }) {
  const group = STATUS_GROUPS.find((g) => g.key === statusGroupOf(event));
  return <Badge variant={group?.badge}>{group?.label}</Badge>;
}

/** Reason, masked recipient and subject; each only when it exists. */
export function EmailDetail({ item }: { item: EmailListItem }) {
  const reason = [NOT_SENT_DETAIL[item.last_event], item.bounce_type, item.bounce_message]
    .filter(Boolean)
    .join(' · ');
  return (
    <div className="min-w-0 text-[13px] text-muted-foreground">
      {reason || item.recipient_masked ? (
        <div>{[reason, item.recipient_masked].filter(Boolean).join(' · ')}</div>
      ) : null}
      {item.subject ? <div className="max-w-[320px] truncate">{item.subject}</div> : null}
    </div>
  );
}

export function ResendLink({ id }: { id: string }) {
  return (
    <a
      href={resendEmailUrl(id)}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 whitespace-nowrap text-primary hover:underline"
    >
      Ver no Resend
      <ExternalLink size={12} aria-hidden="true" />
    </a>
  );
}

export function EmailsListTable({ items }: { items: EmailListItem[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Data e hora</TableHead>
          <TableHead>Categoria</TableHead>
          <TableHead>Tipo</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Detalhe</TableHead>
          <TableHead>
            <span className="sr-only">Resend</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((it) => (
          <TableRow key={it.email_id}>
            <TableCell className="whitespace-nowrap tabular-nums">
              {formatSpDateTime(it.sent_at)}
            </TableCell>
            <TableCell>{categoryLabel(it.category)}</TableCell>
            <TableCell>{typeLabel(it.type)}</TableCell>
            <TableCell>
              <StatusBadge event={it.last_event} />
            </TableCell>
            <TableCell>
              <EmailDetail item={it} />
            </TableCell>
            <TableCell>
              <ResendLink id={it.email_id} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
