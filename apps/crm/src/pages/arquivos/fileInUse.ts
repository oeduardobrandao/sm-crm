function joinPt(items: string[]): string {
  return items.length <= 1
    ? (items[0] ?? '')
    : `${items.slice(0, -1).join(', ')} e ${items[items.length - 1]}`;
}

/** Mensagem do 409 file_in_use do file-manage (posts e relatórios). */
export function fileInUseMessage(body: Record<string, unknown>): string {
  const posts = Array.isArray(body.linked_posts) ? body.linked_posts.length : 0;
  const reports = Array.isArray(body.linked_reports)
    ? (body.linked_reports as Array<{ title?: unknown }>).map((r) =>
        typeof r.title === 'string' && r.title ? r.title : 'sem título',
      )
    : [];
  const parts: string[] = [];
  if (posts > 0) parts.push(`em ${posts} ${posts === 1 ? 'post' : 'posts'}`);
  if (reports.length === 1) parts.push(`no relatório ${reports[0]}`);
  if (reports.length > 1) parts.push(`nos relatórios ${joinPt(reports)}`);
  if (parts.length === 0) return 'Este arquivo está em uso e não pode ser excluído.';
  return `Este arquivo está em uso ${parts.join(' e ')}. Remova de lá primeiro.`;
}
