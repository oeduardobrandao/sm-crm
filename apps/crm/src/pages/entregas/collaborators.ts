import { i18n } from '@mesaas/i18n';
/** Máximo de colaboradores por post (limite do Instagram). */
export const MAX_COLLABORATORS = 3;

const USERNAME_RE = /^[a-z0-9._]{1,30}$/;
const PROFILE_URL_RE = /^(?:https?:\/\/)?(?:www\.)?instagram\.com\/([^/?#\s]+)/i;
// Caminhos de post/reel/explorar, não de perfil: a URL inteira fica e cai em "inválido".
const NON_PROFILE_PATHS = new Set(['p', 'reel', 'reels', 'explore', 'stories', 'tv']);

/**
 * Quebra o texto digitado/colado em usernames normalizados: separa por vírgula,
 * espaço e quebra de linha; extrai o usuário de URLs de perfil; remove um "@"
 * inicial; baixa a caixa. Descarta vazios. Não valida (ver validateCollaborator).
 */
export function parseCollaboratorInput(raw: string): string[] {
  const out: string[] = [];
  for (const piece of raw.split(/[\s,]+/)) {
    let value = piece.trim();
    if (!value) continue;
    const url = PROFILE_URL_RE.exec(value);
    if (url && !NON_PROFILE_PATHS.has(url[1].toLowerCase())) value = url[1];
    if (value.startsWith('@')) value = value.slice(1);
    value = value.toLowerCase();
    if (value) out.push(value);
  }
  return out;
}

export type CollaboratorProblem = 'invalid' | 'duplicate' | 'limit';

export function validateCollaborator(u: string, current: string[]): CollaboratorProblem | null {
  if (!USERNAME_RE.test(u)) return 'invalid';
  if (current.includes(u)) return 'duplicate';
  if (current.length >= MAX_COLLABORATORS) return 'limit';
  return null;
}

export const COLLAB_ERROR_COPY: Record<'invalid' | 'duplicate', (u: string) => string> = {
  invalid: () => i18n.t('entregas:collaborators.invalid'),
  duplicate: (u) => i18n.t('entregas:collaborators.duplicate', { username: u }),
};
