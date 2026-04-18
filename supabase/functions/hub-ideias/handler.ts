import { createJsonResponder } from "../_shared/http.ts";

type DbClient = {
  from: (table: string) => any;
};

interface HubIdeiasHandlerDeps {
  buildCorsHeaders: (req: Request) => Record<string, string>;
  createDb: () => DbClient;
  now: () => string;
}

async function resolveToken(db: DbClient, token: string, now: string) {
  const { data } = await db
    .from("client_hub_tokens")
    .select("cliente_id, is_active, clientes(conta_id)")
    .eq("token", token)
    .gt("expires_at", now)
    .maybeSingle();
  return data as { cliente_id: number; is_active: boolean; clientes: { conta_id: string } } | null;
}

async function checkLock(db: DbClient, ideiaId: string, clienteId: number): Promise<null | boolean> {
  const { data: ideia } = await db
    .from("ideias")
    .select("status, comentario_agencia")
    .eq("id", ideiaId)
    .eq("cliente_id", clienteId)
    .maybeSingle();

  if (!ideia) return null;
  if (ideia.status !== "nova") return true;
  if (ideia.comentario_agencia !== null) return true;

  const { count } = await db
    .from("ideia_reactions")
    .select("id", { count: "exact", head: true })
    .eq("ideia_id", ideiaId);

  return (count ?? 0) > 0;
}

export function createHubIdeiasHandler(deps: HubIdeiasHandlerDeps) {
  return async (req: Request): Promise<Response> => {
    const cors = deps.buildCorsHeaders(req);
    const json = createJsonResponder(cors);

    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

    const url = new URL(req.url);
    const pathParts = url.pathname.split("/").filter(Boolean);
    const ideiaId = pathParts[pathParts.length - 1];
    const hasId = ideiaId && ideiaId !== "hub-ideias" && ideiaId.length === 36;

    const db = deps.createDb();

    const token = url.searchParams.get("token") ?? (await req.clone().json().catch(() => ({}))).token;
    if (!token) return json({ error: "token required" }, 400);

    const hubToken = await resolveToken(db, token, deps.now());
    if (!hubToken || !hubToken.is_active) return json({ error: "Link inválido." }, 404);

    const clienteId = hubToken.cliente_id;
    const workspaceId = hubToken.clientes.conta_id;

    if (req.method === "GET") {
      const { data: ideias } = await db
        .from("ideias")
        .select(`
        id, titulo, descricao, links, status,
        comentario_agencia, comentario_autor_id, comentario_at, created_at, updated_at,
        comentario_autor:membros!comentario_autor_id(nome),
        ideia_reactions(id, membro_id, emoji, membros(nome))
      `)
        .eq("cliente_id", clienteId)
        .order("created_at", { ascending: false });

      return json({ ideias: ideias ?? [] });
    }

    if (req.method === "POST" && !hasId) {
      const body = await req.json().catch(() => ({}));
      const titulo = (body.titulo ?? "").trim();
      const descricao = (body.descricao ?? "").trim();
      const links: string[] = Array.isArray(body.links) ? body.links.filter((link: string) => typeof link === "string" && link.trim()) : [];

      if (!titulo) return json({ error: "titulo obrigatório" }, 400);
      if (!descricao) return json({ error: "descricao obrigatória" }, 400);

      const { data, error } = await db
        .from("ideias")
        .insert({ workspace_id: workspaceId, cliente_id: clienteId, titulo, descricao, links, status: "nova" })
        .select()
        .single();

      if (error) return json({ error: error.message }, 500);
      return json({ ideia: data }, 201);
    }

    if (req.method === "PATCH" && hasId) {
      const lockResult = await checkLock(db, ideiaId, clienteId);
      if (lockResult === null) return json({ error: "Ideia não encontrada." }, 404);
      if (lockResult === true) return json({ error: "Esta ideia não pode mais ser editada" }, 409);

      const body = await req.json().catch(() => ({}));
      const patch: Record<string, unknown> = {};
      if (body.titulo !== undefined) patch.titulo = (body.titulo ?? "").trim();
      if (body.descricao !== undefined) patch.descricao = (body.descricao ?? "").trim();
      if (body.links !== undefined) patch.links = Array.isArray(body.links) ? body.links.filter((link: string) => typeof link === "string" && link.trim()) : [];

      if (patch.titulo === "") return json({ error: "titulo obrigatório" }, 400);
      if (patch.descricao === "") return json({ error: "descricao obrigatória" }, 400);

      const { data, error } = await db
        .from("ideias")
        .update(patch)
        .eq("id", ideiaId)
        .eq("cliente_id", clienteId)
        .select()
        .single();

      if (error) return json({ error: error.message }, 500);
      return json({ ideia: data });
    }

    if (req.method === "DELETE" && hasId) {
      const lockResult = await checkLock(db, ideiaId, clienteId);
      if (lockResult === null) return json({ error: "Ideia não encontrada." }, 404);
      if (lockResult === true) return json({ error: "Esta ideia não pode mais ser editada" }, 409);

      const { error } = await db
        .from("ideias")
        .delete()
        .eq("id", ideiaId)
        .eq("cliente_id", clienteId);

      if (error) return json({ error: error.message }, 500);
      return json({ ok: true });
    }

    return json({ error: "Not found" }, 404);
  };
}
