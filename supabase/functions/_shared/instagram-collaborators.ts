// Colaboradores do Instagram (posts collab): helpers puros compartilhados pelo
// cron e pelo publish-now. Spec 2026-10-19-instagram-collaborators-design.md.

/**
 * `workflow_posts.ig_collaborators` lido de forma defensiva: null, ausente (RPC
 * de claim antiga) ou qualquer coisa que não seja array vira []. Só strings
 * sobrevivem.
 */
export function normalizeCollaborators(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string");
}

/**
 * `workflow_posts.ig_user_tags` (menções do Stories), lido com a mesma defesa
 * de normalizeCollaborators.
 */
export function normalizeUserTags(v: unknown): string[] {
  return normalizeCollaborators(v);
}

/**
 * Quais colaboradores a Meta recusou, a partir do `error_user_msg` localizado
 * (ex.: "Os seguintes usuários não podem ser acessados: clinicaviva").
 * Tokens = mensagem em minúsculas quebrada em [^a-z0-9._]+, casamento exato
 * (então "ana" nunca casa com "anamaria"). Um ponto final colado ao último nome
 * é descartado na comparação: usernames do Instagram não terminam em ponto.
 * Sem mensagem ou sem interseção: [] (comportamento definido, não erro).
 */
export function refusedCollaborators(
  collaborators: string[],
  userMsg: string | undefined | null,
): string[] {
  if (!userMsg) return [];
  const tokens = new Set<string>();
  for (const t of userMsg.toLowerCase().split(/[^a-z0-9._]+/)) {
    if (!t) continue;
    tokens.add(t);
    tokens.add(t.replace(/\.+$/, ""));
  }
  return collaborators.filter((c) => tokens.has(c));
}

/**
 * Campos extras que o escritor de falha grava junto com o código. Só
 * COLLABORATOR_INVALID grava `ig_collaborators_refused` (possivelmente []);
 * qualquer outro código não toca a coluna.
 */
export function buildCollaboratorFailureFields(
  code: string,
  collaborators: string[],
  userMsg: string | undefined | null,
): { ig_collaborators_refused?: string[] } {
  if (code !== "COLLABORATOR_INVALID") return {};
  return { ig_collaborators_refused: refusedCollaborators(collaborators, userMsg) };
}
