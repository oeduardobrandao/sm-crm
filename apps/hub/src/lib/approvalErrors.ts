/** What hub-approve answers (409, or the older 400) once a post has left enviado_cliente. */
const NO_LONGER_PENDING_MESSAGES: ReadonlySet<string> = new Set([
  'Post não está mais aguardando aprovação.',
  'Post não está aguardando revisão do cliente.',
]);

/** api.ts `request()` exposes only the server's message, so the case is matched on it. */
export function isNoLongerPendingError(err: unknown): err is Error {
  return err instanceof Error && NO_LONGER_PENDING_MESSAGES.has(err.message);
}
