import { i18n } from '@mesaas/i18n';

function joinList(items: string[]): string {
  return items.length <= 1
    ? (items[0] ?? '')
    : i18n.t('files:fileInUse.join', {
        head: items.slice(0, -1).join(', '),
        last: items[items.length - 1],
      });
}

/** Mensagem do 409 file_in_use do file-manage (posts e relatórios). */
export function fileInUseMessage(body: Record<string, unknown>): string {
  const posts = Array.isArray(body.linked_posts) ? body.linked_posts.length : 0;
  const reports = Array.isArray(body.linked_reports)
    ? (body.linked_reports as Array<{ title?: unknown }>).map((r) =>
        typeof r.title === 'string' && r.title ? r.title : i18n.t('files:fileInUse.untitled'),
      )
    : [];
  const parts: string[] = [];
  if (posts > 0) parts.push(i18n.t('files:fileInUse.inPosts', { count: posts }));
  if (reports.length === 1) parts.push(i18n.t('files:fileInUse.inReport', { title: reports[0] }));
  if (reports.length > 1)
    parts.push(i18n.t('files:fileInUse.inReports', { titles: joinList(reports) }));
  if (parts.length === 0) return i18n.t('files:fileInUse.generic');
  return i18n.t('files:fileInUse.withPlaces', {
    places: parts.join(i18n.t('files:fileInUse.partsSeparator')),
  });
}
