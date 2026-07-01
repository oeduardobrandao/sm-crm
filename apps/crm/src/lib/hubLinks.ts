/** Append the focused-post path to a hub base URL (relative or absolute). */
export function buildHubPostLink(base: string, postId: number): string {
  return `${base.replace(/\/$/, '')}/postagens/${postId}`;
}
