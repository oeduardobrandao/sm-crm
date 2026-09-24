// "Em produção" (Hub presentational state, never stored): a post the client
// has already seen (some enviado_cliente event) that is back in an internal
// status. The reason is the latest transition OUT of a client-visible status.
// Spec: docs/superpowers/specs/2026-09-24-hub-em-producao-design.md

export type EmProducaoReason = "proxima_aprovacao" | "correcao" | "ajuste";

export const INTERNAL_STATUSES: ReadonlySet<string> = new Set([
  "rascunho",
  "revisao_interna",
  "aprovado_interno",
]);

// Mirrors apps/hub/src/lib/postView.ts VISIBLE_STATUSES.
const CLIENT_VISIBLE_STATUSES: ReadonlySet<string> = new Set([
  "enviado_cliente",
  "aprovado_cliente",
  "correcao_cliente",
  "agendado",
  "postado",
  "falha_publicacao",
]);

export interface StatusEventRow {
  id: number;
  post_id: number;
  from_status: string | null;
  to_status: string;
  created_at: string;
}

function reasonOf(exit: StatusEventRow | null): EmProducaoReason {
  if (!exit) return "ajuste";
  if (exit.from_status === "aprovado_cliente" && exit.to_status === "rascunho") {
    return "proxima_aprovacao";
  }
  if (exit.from_status === "correcao_cliente") return "correcao";
  return "ajuste";
}

export function computeEmProducaoByPost(rows: StatusEventRow[]): Map<number, EmProducaoReason> {
  const byPost = new Map<number, StatusEventRow[]>();
  for (const row of rows) {
    const list = byPost.get(row.post_id);
    if (list) list.push(row);
    else byPost.set(row.post_id, [row]);
  }

  const out = new Map<number, EmProducaoReason>();
  for (const [postId, list] of byPost) {
    if (!list.some((r) => r.to_status === "enviado_cliente")) continue;
    const ordered = [...list].sort(
      (a, b) => a.created_at.localeCompare(b.created_at) || a.id - b.id,
    );
    let exit: StatusEventRow | null = null;
    for (const r of ordered) {
      if (
        r.from_status !== null &&
        CLIENT_VISIBLE_STATUSES.has(r.from_status) &&
        INTERNAL_STATUSES.has(r.to_status)
      ) {
        exit = r;
      }
    }
    out.set(postId, reasonOf(exit));
  }
  return out;
}
