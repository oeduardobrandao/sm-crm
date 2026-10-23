/** Admin route builders. Every row link and every navigate() to these pages goes through here. */
export const workspaceDetailPath = (id: string) => `/admin/workspaces/${id}`;
export const kbArticleEditPath = (id: string) => `/admin/kb-articles/${id}/edit`;
export const kbArticleNewPath = () => '/admin/kb-articles/new';
export const metricasPath = () => '/admin/metricas';
export const kbVideosPath = () => '/admin/kb-videos';
export const kbVideoNewPath = () => '/admin/kb-videos/new';
export const kbVideoEditPath = (id: number) => `/admin/kb-videos/${id}/edit`;
export const affiliatesPath = () => '/admin/afiliados';
export const affiliateDetailPath = (id: string) => `/admin/afiliados/${id}`;
/** Blog queue. The tab rides in the query string so a detail link keeps the list beside it. */
export const blogPath = (tab?: string) =>
  tab && tab !== 'aguardando' ? `/admin/blog?tab=${tab}` : '/admin/blog';
export const blogPostPath = (id: string, tab?: string) =>
  tab && tab !== 'aguardando' ? `/admin/blog/${id}?tab=${tab}` : `/admin/blog/${id}`;
