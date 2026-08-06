// deno-lint-ignore no-explicit-any
type DbClient = { from: (table: string) => any };

export interface ConsumedLink {
  cliente_id: number;
  conta_id: string;
  created_by: string;
}

/**
 * Portão do callback. Atômico apenas para a SUA PRÓPRIA instrução.
 *
 * Uma releitura de revoked_at seguida do upsert em instagram_accounts NÃO basta:
 * a revogação pode cair entre as duas. Este UPDATE condicional com RETURNING é
 * uma única operação no banco, exatamente o padrão que o callback já usa para
 * consumir o nonce do oauth_states -- checar revoked_at/expires_at e marcar
 * used_at é atômico entre si.
 *
 * O que isto NÃO garante: o lock da linha é liberado assim que este UPDATE
 * comita. O upsert em instagram_accounts é uma chamada HTTP separada ao
 * PostgREST, ou seja, outra transação. Uma revogação que caia depois deste
 * portão e antes daquele upsert ainda passa. O chamador deve minimizar o que
 * roda entre os dois -- hoje só a checagem de mismatch client_id/state, sem
 * round-trip -- mas fechar essa janela por completo exigiria colocar o upsert
 * na mesma transação do portão, o que este módulo não faz.
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
