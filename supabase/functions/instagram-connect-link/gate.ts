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

export interface ConnectLinkOriginDeps {
  planFeature: (db: DbClient, contaId: string, featureKey: string) => Promise<boolean>;
}

export type ConnectLinkOriginResult =
  | { proceed: true; consumed: ConsumedLink }
  | { proceed: false; reason: string };

/**
 * Portão completo do fluxo originado por link, chamado pelo callback do OAuth
 * logo antes do upsert em instagram_accounts. Encapsula as três checagens que
 * têm que passar para que a escrita seja legítima:
 *
 *  1. reconferir a entitlement -- o state assinado vive 10 minutos, e um
 *     downgrade dentro dessa janela não pode resultar numa conta ativa gravada
 *     para um workspace que perdeu o feature;
 *  2. o portão atômico (consumeConnectLink) -- ver o comentário lá para o porquê
 *     de ser um UPDATE condicional e não um select seguido de update;
 *  3. a checagem de mismatch client_id/state -- o state é assinado, então isto
 *     não deveria acontecer, mas se acontecer nada é escrito.
 *
 * Devolve `proceed: false` em qualquer uma das três falhas, sempre com o mesmo
 * `reason` ("CONNECT_LINK_REVOKED") que o callback já usava como mensagem do
 * Error lançado -- classifyOAuthError depende exatamente desse texto.
 *
 * Este módulo não faz nem o upsert nem a notificação nem o e-mail: só decide se
 * o chamador pode prosseguir. Mover essas partes para cá ampliaria o escopo do
 * que está sendo mudado no callback OAuth ao vivo sem necessidade.
 */
export async function gateConnectLinkOrigin(
  deps: ConnectLinkOriginDeps,
  db: DbClient,
  linkToken: string,
  clientId: string | number,
  contaId: string,
  nowIso: string,
): Promise<ConnectLinkOriginResult> {
  if (!(await deps.planFeature(db, contaId, "feature_instagram"))) {
    return { proceed: false, reason: "CONNECT_LINK_REVOKED" };
  }
  const consumed = await consumeConnectLink(db, linkToken, nowIso);
  if (!consumed) return { proceed: false, reason: "CONNECT_LINK_REVOKED" };
  if (String(consumed.cliente_id) !== String(clientId)) {
    // O state é assinado, então isto não deveria acontecer. Se acontecer,
    // algo está muito errado e não escrevemos nada.
    console.error("[IG-CALLBACK] link/state client mismatch", consumed.cliente_id, clientId);
    return { proceed: false, reason: "CONNECT_LINK_REVOKED" };
  }
  return { proceed: true, consumed };
}
