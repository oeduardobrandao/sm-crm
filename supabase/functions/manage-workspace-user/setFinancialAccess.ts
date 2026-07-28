interface RpcClient {
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): Promise<{ data?: unknown; error?: { message: string } | null }>;
}

export interface SetFinancialAccessInput {
  actorUserId: string;
  targetUserId: string;
  workspaceId: string;
  value: boolean;
}

export interface SetFinancialAccessResult {
  status: number;
  message: string;
  changed: boolean;
}

/**
 * Dependency-injected so it can be tested behaviourally. All authorization
 * lives in the RPC, which resolves the caller from workspace_members — NOT from
 * profiles, whose role goes stale on workspace switch.
 *
 * Never returns raw error details to the client; the RPC's sentinel messages are
 * mapped to generic pt-BR copy.
 */
export async function handleSetFinancialAccess(
  client: RpcClient,
  input: SetFinancialAccessInput,
): Promise<SetFinancialAccessResult> {
  const { data, error } = await client.rpc("set_financial_access", {
    p_actor: input.actorUserId,
    p_target: input.targetUserId,
    p_workspace: input.workspaceId,
    p_value: input.value,
  });

  if (error) {
    const m = error.message ?? "";
    if (m.includes("not_owner")) {
      return { status: 403, message: "Apenas o proprietário pode alterar esse acesso.", changed: false };
    }
    if (m.includes("target_not_admin")) {
      return { status: 400, message: "Esse acesso só se aplica a administradores.", changed: false };
    }
    if (m.includes("target_not_member")) {
      return { status: 404, message: "Membro não encontrado neste workspace.", changed: false };
    }
    console.error("[set-financial-access] rpc failed:", m);
    return { status: 500, message: "Não foi possível atualizar o acesso.", changed: false };
  }

  const changed = data === "updated";
  return {
    status: 200,
    message: changed ? "Acesso financeiro atualizado." : "Nenhuma alteração.",
    changed,
  };
}
