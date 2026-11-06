interface RpcClient {
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data?: unknown; error?: { message: string } | null }>;
}

export type ClientScope = "todos" | "atribuidos";

export interface SetClientScopeInput {
  actorUserId: string;
  targetUserId: string;
  workspaceId: string;
  scope: ClientScope;
  clienteIds: number[];
}

export interface SetClientScopeResult {
  status: number;
  message: string;
  changed: boolean;
}

export const MAX_SCOPE_CLIENTES = 2000;

function fail(status: number, message: string): SetClientScopeResult {
  return { status, message, changed: false };
}

/**
 * Dependency-injected so it can be tested behaviourally. Input is validated
 * here (400 before any RPC call); all authorization lives in the RPC, which
 * resolves the caller from workspace_members, not from profiles.
 *
 * The validated clienteIds are forwarded even when scope is 'todos' (the RPC
 * decides what to do with them), so the caller controls that choice.
 *
 * Never returns raw error details to the client; the RPC's sentinel messages
 * are mapped to generic pt-BR copy.
 */
export async function handleSetClientScope(
  client: RpcClient,
  input: SetClientScopeInput,
): Promise<SetClientScopeResult> {
  if (!input.targetUserId) return fail(400, "Membro não informado.");
  if (input.scope !== "todos" && input.scope !== "atribuidos") {
    return fail(400, "Escopo inválido.");
  }
  const ids = input.clienteIds as unknown;
  if (
    !Array.isArray(ids) ||
    ids.length > MAX_SCOPE_CLIENTES ||
    !ids.every((n) => typeof n === "number" && Number.isInteger(n) && n > 0)
  ) {
    return fail(400, "Lista de clientes inválida.");
  }

  const { data, error } = await client.rpc("set_member_client_scope", {
    p_actor: input.actorUserId,
    p_workspace: input.workspaceId,
    p_user: input.targetUserId,
    p_scope: input.scope,
    p_cliente_ids: ids,
  });

  if (error) {
    const m = error.message ?? "";
    if (m.includes("not_owner")) return fail(403, "Apenas o proprietário pode alterar esse acesso.");
    if (m.includes("target_is_owner")) return fail(400, "O proprietário sempre vê todos os clientes.");
    if (m.includes("target_not_member")) return fail(404, "Membro não encontrado neste workspace.");
    if (m.includes("invalid_scope")) return fail(400, "Escopo inválido.");
    if (m.includes("cliente_not_in_workspace")) {
      return fail(400, "Algum cliente selecionado não pertence a este workspace.");
    }
    if (m.includes("feature_disabled")) return fail(403, "Recurso indisponível no seu plano.");
    console.error("[set-client-scope] rpc failed:", m);
    return fail(500, "Não foi possível salvar o acesso.");
  }

  const changed = (data as { changed?: unknown } | null)?.changed === true;
  return {
    status: 200,
    message: changed ? "Acesso atualizado." : "Nenhuma alteração.",
    changed,
  };
}
