// Tenant resolution for google-integration. The tenant is the caller's
// `profiles.active_workspace_id` plus a matching `workspace_members` row (the
// report-docs/index.ts pattern, same semantics as get_my_conta_id()/RLS). The legacy
// `profiles.conta_id` is never a fallback: it would act under the wrong workspace.

// deno-lint-ignore no-explicit-any
export type DbClient = any;

function unauthorized(cors: Record<string, string>): Response {
  return new Response(JSON.stringify({ error: "unauthorized" }), {
    status: 401,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

export async function resolveTenant(
  req: Request,
  svc: DbClient,
  cors: Record<string, string>,
): Promise<{ userId: string; contaId: string } | Response> {
  const token = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  if (!token || token === "undefined" || token === "null") return unauthorized(cors);

  const { data: userData, error: userError } = await svc.auth.getUser(token);
  const user = userData?.user;
  if (userError || !user) return unauthorized(cors);

  const { data: profile, error: profileError } = await svc
    .from("profiles")
    .select("active_workspace_id")
    .eq("id", user.id)
    .maybeSingle();
  if (profileError) throw new Error(`profile lookup failed: ${profileError.message}`);
  const contaId = profile?.active_workspace_id as string | null | undefined;
  if (!contaId) return unauthorized(cors);

  const { data: membership, error: memberError } = await svc
    .from("workspace_members")
    .select("user_id")
    .eq("user_id", user.id)
    .eq("workspace_id", contaId)
    .maybeSingle();
  if (memberError) throw new Error(`membership lookup failed: ${memberError.message}`);
  if (!membership) return unauthorized(cors);

  return { userId: user.id as string, contaId };
}

/** Loads a client only when it belongs to `contaId`; null otherwise (callers answer 404). */
export async function loadClientInTenant(
  svc: DbClient,
  clientId: number,
  contaId: string,
): Promise<{ id: number; nome: string } | null> {
  const { data, error } = await svc
    .from("clientes")
    .select("id, nome")
    .eq("id", clientId)
    .eq("conta_id", contaId)
    .maybeSingle();
  if (error) throw new Error(`client lookup failed: ${error.message}`);
  if (!data) return null;
  return { id: data.id as number, nome: data.nome as string };
}
