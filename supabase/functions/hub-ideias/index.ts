import { createClient } from "npm:@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

async function resolveToken(db: ReturnType<typeof createClient>, token: string) {
  const { data } = await db
    .from("client_hub_tokens")
    .select("cliente_id, is_active, clientes(conta_id)")
    .eq("token", token)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  return data as { cliente_id: number; is_active: boolean; clientes: { conta_id: string } } | null;
}

// Returns null if not found, false if mutable, true if locked
async function checkLock(db: ReturnType<typeof createClient>, ideiaId: string, clienteId: number): Promise<null | boolean> {
  const { data: ideia } = await db
    .from("ideias")
    .select("status, comentario_agencia")
    .eq("id", ideiaId)
    .eq("cliente_id", clienteId)
    .maybeSingle();

  if (!ideia) return null; // not found
  if (ideia.status !== "nova") return true;
  if (ideia.comentario_agencia !== null) return true;

  const { count } = await db
    .from("ideia_reactions")
    .select("id", { count: "exact", head: true })
    .eq("ideia_id", ideiaId);

  return (count ?? 0) > 0;
}

Deno.serve(async (req) => {
  const cors = buildCorsHeaders(req);
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const url = new URL(req.url);
  // Extract optional ideia id from path: /hub-ideias/<uuid>
  const pathParts = url.pathname.split("/").filter(Boolean);
  const ideiaId = pathParts[pathParts.length - 1];
  const hasId = ideiaId && ideiaId !== "hub-ideias" && ideiaId.length === 36;

  const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // All methods except OPTIONS need a token
  const token = url.searchParams.get("token") ?? (await req.clone().json().catch(() => ({}))).token;
  if (!token) return json({ error: "token required" }, 400);

  const hubToken = await resolveToken(db, token);
  if (!hubToken || !hubToken.is_active) return json({ error: "Link inválido." }, 404);

  const clienteId = hubToken.cliente_id;
  const workspaceId = hubToken.clientes.conta_id;

  // GET /hub-ideias?token=...
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

  // POST /hub-ideias
  if (req.method === "POST" && !hasId) {
    const body = await req.json().catch(() => ({}));
    const titulo = (body.titulo ?? "").trim();
    const descricao = (body.descricao ?? "").trim();
    const links: string[] = Array.isArray(body.links) ? body.links.filter((l: string) => typeof l === "string" && l.trim()) : [];

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

  // PATCH /hub-ideias/<uuid>?token=...
  if (req.method === "PATCH" && hasId) {
    const lockResult = await checkLock(db, ideiaId, clienteId);
    if (lockResult === null) return json({ error: "Ideia não encontrada." }, 404);
    if (lockResult === true) return json({ error: "Esta ideia não pode mais ser editada" }, 409);

    const body = await req.json().catch(() => ({}));
    const patch: Record<string, unknown> = {};
    if (body.titulo !== undefined) patch.titulo = (body.titulo ?? "").trim();
    if (body.descricao !== undefined) patch.descricao = (body.descricao ?? "").trim();
    if (body.links !== undefined) patch.links = Array.isArray(body.links) ? body.links.filter((l: string) => typeof l === "string" && l.trim()) : [];

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

  // DELETE /hub-ideias/<uuid>?token=...
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
});
