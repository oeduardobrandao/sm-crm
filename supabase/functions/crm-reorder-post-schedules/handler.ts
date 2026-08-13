import { createJsonResponder } from "../_shared/http.ts";

// Agency-facing allowlist: the CRM may reschedule any planned post that is not
// already published or failed. Broader than the Hub's client-facing set, but the
// ownership locking, agendado future-slot guard and container clearing are shared
// with the Hub via the same reorder_post_schedules RPC.
const CRM_ALLOWED_STATUSES = [
  "rascunho",
  "revisao_interna",
  "aprovado_interno",
  "enviado_cliente",
  "aprovado_cliente",
  "correcao_cliente",
  "agendado",
];

type DbClient = {
  auth: { getUser: (token: string) => Promise<{ data: { user: { id: string } | null }; error: unknown }> };
  from: (table: string) => any;
  rpc: (fn: string, params: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
};

interface CrmReorderHandlerDeps {
  buildCorsHeaders: (req: Request) => Record<string, string>;
  createDb: () => DbClient;
}

export function createCrmReorderHandler(deps: CrmReorderHandlerDeps) {
  return async (req: Request): Promise<Response> => {
    const cors = deps.buildCorsHeaders(req);
    const json = createJsonResponder(cors);

    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token || token === "undefined" || token === "null") {
      return json({ error: "Unauthorized" }, 401);
    }

    const db = deps.createDb();

    const { data: { user }, error: authErr } = await db.auth.getUser(token);
    if (authErr || !user) return json({ error: "Unauthorized" }, 401);

    const { data: profile } = await db.from("profiles").select("conta_id").eq("id", user.id).single();
    const contaId = profile?.conta_id;
    if (!contaId) return json({ error: "Profile not found" }, 403);

    const body = await req.json().catch(() => ({}));
    const clienteId = body.cliente_id;
    const updates = body.updates;
    if (typeof clienteId !== "number" || !Number.isFinite(clienteId)) {
      return json({ error: "cliente_id required" }, 400);
    }
    if (!Array.isArray(updates) || updates.length === 0) {
      return json({ error: "updates array required" }, 400);
    }
    for (const u of updates) {
      if (!u || typeof u.post_id !== "number" || !("scheduled_at" in u)) {
        return json({ error: "malformed update" }, 400);
      }
    }

    // Ownership: the client must belong to the caller's account before we touch
    // any of its posts. The RPC re-checks per row, but fail fast here too.
    const { data: cliente } = await db
      .from("clientes")
      .select("conta_id")
      .eq("id", clienteId)
      .single();
    if (!cliente || cliente.conta_id !== contaId) {
      return json({ error: "Cliente não autorizado." }, 403);
    }

    const { data, error } = await db.rpc("reorder_post_schedules", {
      p_cliente_id: clienteId,
      p_conta_id: contaId,
      p_updates: updates,
      p_allowed_statuses: CRM_ALLOWED_STATUSES,
    });

    if (error) {
      const msg = String((error as { message?: string }).message ?? "");
      if (msg.includes("FORBIDDEN")) return json({ error: "Post não autorizado." }, 403);
      if (msg.includes("LOCKED")) {
        const lockedIds = (msg.match(/\{([\d,\s]+)\}/)?.[1] ?? "")
          .split(",")
          .map((s) => parseInt(s.trim(), 10))
          .filter((n) => Number.isFinite(n));
        return json(
          {
            error:
              "Não é possível reagendar posts em publicação ou já publicados. Atualize a página e tente novamente.",
            locked_post_ids: lockedIds,
          },
          409,
        );
      }
      if (msg.includes("BAD_REQUEST")) {
        return json({ error: "Datas inválidas para reagendamento." }, 400);
      }
      // Never leak raw internals to the client.
      return json({ error: "Falha ao reagendar." }, 500);
    }

    return json(data ?? { ok: true }, 200);
  };
}
