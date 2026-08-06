/**
 * Link de conexão do Instagram enviado ao cliente final.
 *
 * Só funções puras aqui: sem rede, sem banco, sem Deno.env. Isso é o que torna o
 * portão de liveness testável sem subir nada.
 */

export interface ConnectLinkRow {
  token: string;
  cliente_id: number;
  conta_id: string;
  created_by: string;
  expires_at: string;
  revoked_at: string | null;
  used_at: string | null;
}

export type ConnectLinkStatus = "live" | "revoked" | "expired";

/**
 * "Vivo" tem duas metades, enforçadas em lugares diferentes:
 *  - revoked_at IS NULL: persistido, garantido pelo índice único parcial
 *  - expires_at > now(): avaliado aqui, porque predicado de índice exige IMMUTABLE
 *
 * O limite de expiração é EXCLUSIVO (expires_at == now já é expirado) para casar
 * exatamente com o `.gt('expires_at', now)` do portão SQL no callback.
 */
export function connectLinkStatus(
  row: Pick<ConnectLinkRow, "expires_at" | "revoked_at">,
  nowIso: string,
): ConnectLinkStatus {
  if (row.revoked_at !== null && row.revoked_at !== undefined) return "revoked";
  if (Date.parse(row.expires_at) <= Date.parse(nowIso)) return "expired";
  return "live";
}

export function connectLinkLive(
  row: Pick<ConnectLinkRow, "expires_at" | "revoked_at">,
  nowIso: string,
): boolean {
  return connectLinkStatus(row, nowIso) === "live";
}

/** Base pública do app (APP_BASE_URL) + /conectar/<token>. Nunca OAUTH_REDIRECT_BASE. */
export function buildConnectUrl(baseUrl: string, token: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/conectar/${token}`;
}

/**
 * Validação deliberadamente conservadora. O objetivo não é aceitar todo endereço
 * válido por RFC, é impedir que POST /email vire relay para lixo arbitrário.
 */
export function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim());
}
