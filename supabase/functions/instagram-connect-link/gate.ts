// deno-lint-ignore no-explicit-any
type DbClient = { from: (table: string) => any };

export interface ConsumedLink {
  cliente_id: number;
  conta_id: string;
  created_by: string;
}

/**
 * Portão atômico do callback.
 *
 * Uma releitura de revoked_at seguida do upsert em instagram_accounts NÃO basta:
 * a revogação pode cair entre as duas. Este UPDATE condicional com RETURNING é
 * uma única operação no banco, exatamente o padrão que o callback já usa para
 * consumir o nonce do oauth_states.
 *
 * Zero linhas devolvidas significa revogado, expirado, ou token inexistente, e o
 * chamador precisa abortar ANTES de escrever em instagram_accounts.
 *
 * Efeito colateral de semântica: used_at passa a ser "última tentativa que passou
 * o portão". Se o upsert seguinte falhar, used_at fica marcado assim mesmo. É a
 * troca certa: o portão precisa vir antes da escrita.
 */
export async function consumeConnectLink(
  db: DbClient,
  token: string,
  nowIso: string,
): Promise<ConsumedLink | null> {
  const { data } = await db
    .from("instagram_connect_links")
    .update({ used_at: nowIso })
    .eq("token", token)
    .is("revoked_at", null)
    .gt("expires_at", nowIso)
    .select("cliente_id, conta_id, created_by")
    .maybeSingle();
  return (data as ConsumedLink | null) ?? null;
}
