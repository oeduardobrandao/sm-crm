// Normaliza uma entrega da Meta em 1 evento POR COMENTÁRIO. `entry` é array;
// cada entry pode trazer vários changes; as fixtures oficiais mostram DUAS
// formas (entry[].changes[] e entry[].field/value) e o parser aceita ambas.
// from/parent_id/text NÃO são garantidos: o processador tem fallback via GET.
// NUNCA lança: payload que não parseia devolve [] (nada durável a persistir).

export interface NormalizedCommentEvent {
  igUserId: string;
  commentId: string;
  mediaId?: string;
  parentId?: string;
  commenterId?: string;
  commenterUsername?: string;
  text?: string;
  timestamp?: string;
  raw: unknown;
}

// deno-lint-ignore no-explicit-any
function toEvent(igUserId: string, change: any): NormalizedCommentEvent | null {
  const value = change?.value;
  const commentId = value?.id;
  if (typeof commentId !== "string" || !commentId) return null;
  const epoch = typeof value.created_time === "number" ? value.created_time
    : typeof value.timestamp === "number" ? value.timestamp : null;
  return {
    igUserId,
    commentId,
    mediaId: typeof value.media?.id === "string" ? value.media.id : undefined,
    parentId: typeof value.parent_id === "string" ? value.parent_id : undefined,
    commenterId: typeof value.from?.id === "string" ? value.from.id : undefined,
    commenterUsername: typeof value.from?.username === "string" ? value.from.username : undefined,
    text: typeof value.text === "string" ? value.text : undefined,
    timestamp: epoch !== null ? new Date(epoch * 1000).toISOString()
      : typeof value.timestamp === "string" ? value.timestamp : undefined,
    raw: change,
  };
}

// deno-lint-ignore no-explicit-any
export function parseWebhookDelivery(body: any): NormalizedCommentEvent[] {
  const out: NormalizedCommentEvent[] = [];
  const entries = Array.isArray(body?.entry) ? body.entry : [];
  for (const entry of entries) {
    const igUserId = typeof entry?.id === "string" ? entry.id : String(entry?.id ?? "");
    if (!igUserId) continue;
    const changes = Array.isArray(entry.changes)
      ? entry.changes
      : entry.field !== undefined ? [{ field: entry.field, value: entry.value }] : [];
    for (const change of changes) {
      if (change?.field !== "comments") continue;
      const ev = toEvent(igUserId, change);
      if (ev) out.push(ev);
    }
  }
  return out;
}
