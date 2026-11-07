import type { EmailListItem } from '../../lib/api';
import { formatSpDateTime } from './email-list-view';
import { categoryLabel, typeLabel } from './email-metrics-view';
import { EmailDetail, ResendLink, StatusBadge } from './EmailsListTable';

/** Phone variant of the list: compact rows, as EmailsPhoneList. */
export function EmailsListPhone({ items }: { items: EmailListItem[] }) {
  return (
    <ul>
      {items.map((it) => (
        <li key={it.email_id} className="border-t border-border/60 px-[18px] py-3 text-sm">
          <div className="flex items-center justify-between gap-3">
            <span className="min-w-0 truncate font-medium">
              {typeLabel(it.type)}{' '}
              <span className="font-normal text-muted-foreground">
                ({categoryLabel(it.category)})
              </span>
            </span>
            <StatusBadge event={it.last_event} />
          </div>
          <div className="mt-0.5 flex items-center justify-between gap-3 text-xs text-muted-foreground">
            <span className="tabular-nums">{formatSpDateTime(it.sent_at)}</span>
            <ResendLink id={it.email_id} />
          </div>
          <div className="mt-0.5">
            <EmailDetail item={it} />
          </div>
        </li>
      ))}
    </ul>
  );
}
