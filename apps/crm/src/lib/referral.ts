/**
 * Atribuição do programa de afiliados.
 *
 * Qualquer página do site aberta com `?ref=<codigo>` grava o código no navegador por
 * 60 dias. Vale o último link clicado. No cadastro, o código vai nos metadados do signUp
 * (`ref_code`) e o banco liga o workspace novo ao afiliado (trigger
 * `on_auth_user_created_zz_affiliate_referral`). O código só é validado no servidor.
 *
 * Spec: docs/superpowers/specs/2026-10-10-programa-de-afiliados-design.md
 */

export const REFERRAL_STORAGE_KEY = 'mesaas:ref';
export const REFERRAL_TTL_MS = 60 * 24 * 60 * 60 * 1000;

const CODE_RE = /^[a-z0-9]{4,32}$/;

interface StoredReferral {
  code: string;
  at: number;
}

type MinimalStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function safeStorage(): MinimalStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function normalizeReferralCode(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const code = raw.trim().toLowerCase();
  return CODE_RE.test(code) ? code : null;
}

/** Lê `?ref=` da URL e grava (último clique vence). Retorna o código gravado, se houver. */
export function captureReferral(
  search: string,
  storage: MinimalStorage | null = safeStorage(),
  now: number = Date.now(),
): string | null {
  if (!storage) return null;
  const code = normalizeReferralCode(new URLSearchParams(search).get('ref'));
  if (!code) return null;
  try {
    storage.setItem(
      REFERRAL_STORAGE_KEY,
      JSON.stringify({ code, at: now } satisfies StoredReferral),
    );
  } catch {
    return null;
  }
  return code;
}

/** Código gravado e ainda dentro dos 60 dias, ou null. */
export function getStoredReferral(
  storage: MinimalStorage | null = safeStorage(),
  now: number = Date.now(),
): string | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(REFERRAL_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredReferral>;
    const code = normalizeReferralCode(typeof parsed.code === 'string' ? parsed.code : null);
    if (!code || typeof parsed.at !== 'number' || now - parsed.at > REFERRAL_TTL_MS) {
      storage.removeItem(REFERRAL_STORAGE_KEY);
      return null;
    }
    return code;
  } catch {
    return null;
  }
}

export function clearStoredReferral(storage: MinimalStorage | null = safeStorage()): void {
  try {
    storage?.removeItem(REFERRAL_STORAGE_KEY);
  } catch {
    // sem storage, nada a limpar
  }
}

/** Link de divulgação de um código. */
export function buildReferralLink(code: string, origin = 'https://www.mesaas.com.br'): string {
  return `${origin.replace(/\/+$/, '')}/?ref=${encodeURIComponent(code)}`;
}
