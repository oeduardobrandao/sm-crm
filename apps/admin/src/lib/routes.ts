/** Admin route builders. Every row link and every navigate() to these pages goes through here. */
export const workspaceDetailPath = (id: string) => `/admin/workspaces/${id}`;
export const kbArticleEditPath = (id: string) => `/admin/kb-articles/${id}/edit`;
export const kbArticleNewPath = () => '/admin/kb-articles/new';
