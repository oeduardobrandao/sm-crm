// Reordenação dos artigos da Central de Ajuda pelo Admin. Handler exportado para teste direto, no
// padrão de kb-videos.ts. A autorização (platform_admins) já aconteceu em index.ts.
//
// Não reaproveita update-kb-article: aquele handler relê e revalida a linha inteira mesclada, então
// um artigo legado com slug ou categoria fora da regra faria uma simples troca de ordem falhar.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

type Headers = Record<string, string>;
type Row = Record<string, unknown>;

const MAX_REORDER_ITEMS = 200;
const MAX_DISPLAY_ORDER = 10_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(body: unknown, status: number, headers: Headers): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

export async function handleReorderKbArticles(svc: SupabaseClient, body: Row, headers: Headers) {
  const items = Array.isArray(body.items) ? body.items : null;
  if (!items || items.length === 0 || items.length > MAX_REORDER_ITEMS) {
    return json({ error: `items must have 1 to ${MAX_REORDER_ITEMS} entries` }, 400, headers);
  }
  const parsed: Array<{ id: string; display_order: number }> = [];
  for (const item of items as Row[]) {
    const id = item?.id;
    const order = item?.display_order;
    if (
      typeof id !== "string" || !UUID_RE.test(id) ||
      !Number.isInteger(order) || (order as number) < 0 || (order as number) > MAX_DISPLAY_ORDER
    ) {
      return json({ error: "invalid reorder item" }, 400, headers);
    }
    parsed.push({ id, display_order: order as number });
  }
  for (const item of parsed) {
    const { error } = await svc.from("kb_articles").update({ display_order: item.display_order }).eq("id", item.id);
    if (error) throw error;
  }
  return json({ message: "Reordered" }, 200, headers);
}
