import { useTranslation } from 'react-i18next';
import { format } from 'date-fns';
import { enUS, ptBR } from 'date-fns/locale';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { InstagramContact } from '@/store';
import { instagramProfileUrl } from './profileUrl';

function fmt(iso: string, lang: string) {
  return format(new Date(iso), "dd MMM yyyy '·' HH:mm", {
    locale: lang.startsWith('en') ? enUS : ptBR,
  });
}

function truncate(text: string, max: number) {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function UserCell({ username }: { username: string | null }) {
  const { t } = useTranslation('automations');
  const url = instagramProfileUrl(username);
  if (!username)
    return <span style={{ color: 'var(--text-muted)' }}>{t('contacts.unknownUser')}</span>;
  if (!url) return <span style={{ fontWeight: 600 }}>@{username}</span>;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      style={{ fontWeight: 600 }}
      className="hover:underline"
    >
      @{username}
    </a>
  );
}

export function ContactsList({
  rows,
  clientesById,
  showClient,
  isDesktop,
}: {
  rows: InstagramContact[];
  clientesById: Map<number, string>;
  showClient: boolean;
  isDesktop: boolean;
}) {
  const { t, i18n } = useTranslation('automations');
  const automation = (r: InstagramContact) =>
    !r.automation_name
      ? ''
      : r.automation_deleted
        ? t('contacts.removed', { name: r.automation_name })
        : r.automation_name;
  const reached = (r: InstagramContact) => (
    <Badge variant={r.reached ? 'success' : 'neutral'} size="sm">
      {r.reached ? t('contacts.yes') : t('contacts.no')}
    </Badge>
  );

  if (!isDesktop) {
    return (
      <div style={{ display: 'grid', gap: '0.75rem' }}>
        {rows.map((r) => (
          <div
            key={r.id}
            className="card"
            style={{ padding: '0.875rem 1rem', fontSize: '0.85rem' }}
          >
            <div className="flex items-center justify-between gap-2">
              <UserCell username={r.commenter_username} />
              {reached(r)}
            </div>
            <div style={{ color: 'var(--text-muted)', marginTop: 6, display: 'grid', gap: 2 }}>
              {showClient && <span>{clientesById.get(r.client_id) ?? ''}</span>}
              <span>
                {automation(r)} · {t('contacts.col.interactions')}: {r.interactions_count}
              </span>
              <span>
                {t('contacts.col.last')}: {fmt(r.last_interaction_at, i18n.language)}
              </span>
              {r.last_comment_text && <span>"{truncate(r.last_comment_text, 80)}"</span>}
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="card animate-up" style={{ padding: '0.25rem 0', overflowX: 'auto' }}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('contacts.col.user')}</TableHead>
            {showClient && <TableHead>{t('contacts.col.client')}</TableHead>}
            <TableHead>{t('contacts.col.reached')}</TableHead>
            <TableHead>{t('contacts.col.interactions')}</TableHead>
            <TableHead>{t('contacts.col.first')}</TableHead>
            <TableHead>{t('contacts.col.last')}</TableHead>
            <TableHead>{t('contacts.col.automation')}</TableHead>
            <TableHead>{t('contacts.col.comment')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id}>
              <TableCell>
                <UserCell username={r.commenter_username} />
              </TableCell>
              {showClient && <TableCell>{clientesById.get(r.client_id) ?? ''}</TableCell>}
              <TableCell>{reached(r)}</TableCell>
              <TableCell>{r.interactions_count}</TableCell>
              <TableCell style={{ whiteSpace: 'nowrap' }}>
                {fmt(r.first_interaction_at, i18n.language)}
              </TableCell>
              <TableCell style={{ whiteSpace: 'nowrap' }}>
                {fmt(r.last_interaction_at, i18n.language)}
              </TableCell>
              <TableCell>{automation(r)}</TableCell>
              <TableCell style={{ color: 'var(--text-muted)', maxWidth: 280 }}>
                {r.last_comment_text ? `"${truncate(r.last_comment_text, 80)}"` : ''}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
