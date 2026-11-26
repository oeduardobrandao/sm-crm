/**
 * Origem de aquisição do visitante.
 *
 * No boot, cada página do site monta um "toque" (UTMs em minúsculas, QUAL parâmetro de clique
 * veio, host do referrer, caminho sem query) e grava em `mesaas:acq` por 90 dias: `first`
 * uma vez só, `last` só quando o toque não é direto. Nunca guarda o valor de um id de
 * anúncio nem o código de afiliado, e não lê consentimento (só rótulos). No cadastro, o
 * valor vai nos metadados do signUp (`acq`).
 *
 * Spec: docs/superpowers/specs/2026-11-26-workspace-acquisition-source-design.md §1
 */

export const ACQUISITION_STORAGE_KEY = 'mesaas:acq';
export const ACQUISITION_TTL_MS = 90 * 24 * 60 * 60 * 1000;

export type ClickParam = 'gclid' | 'gbraid' | 'wbraid' | 'fbclid' | 'oppref' | 'msclkid';

export interface AcquisitionTouch {
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
  click: ClickParam | null;
  ref: boolean;
  referrer_host: string | null;
  landing_path: string;
  at: string;
}

export interface StoredAcquisition {
  first: AcquisitionTouch;
  last: AcquisitionTouch | null;
  v: 1;
}

type MinimalStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const CLICK_PARAMS: ClickParam[] = ['gclid', 'gbraid', 'wbraid', 'fbclid', 'oppref', 'msclkid'];
const MAX_LEN = 200;
const OWN_HOSTS = new Set(['mesaas.com.br', 'www.mesaas.com.br', 'localhost', '127.0.0.1']);
const PAYMENT_HOSTS = new Set(['checkout.stripe.com', 'billing.stripe.com', 'connect.stripe.com']);

function safeStorage(): MinimalStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function clean(raw: string | null, lower = false): string | null {
  if (raw == null) return null;
  const v = raw.trim().slice(0, MAX_LEN);
  if (!v) return null;
  return lower ? v.toLowerCase() : v;
}

function parseUrl(value: string, base?: string): URL | null {
  try {
    return new URL(value, base);
  } catch {
    return null;
  }
}

function isIgnoredHost(host: string, pageHost: string): boolean {
  return (
    host === pageHost ||
    OWN_HOSTS.has(host) ||
    PAYMENT_HOSTS.has(host) ||
    host.endsWith('.vercel.app') ||
    host === 'pagar.me' ||
    host.endsWith('.pagar.me')
  );
}

export function buildTouch(href: string, referrer: string, now: number): AcquisitionTouch {
  const url = parseUrl(href, 'https://www.mesaas.com.br');
  const params = url?.searchParams ?? new URLSearchParams();
  const pageHost = url?.hostname.toLowerCase() ?? '';

  let referrerHost: string | null = null;
  const refUrl = referrer ? parseUrl(referrer) : null;
  if (refUrl && refUrl.hostname) {
    const host = refUrl.hostname.toLowerCase();
    if (!isIgnoredHost(host, pageHost)) referrerHost = host.slice(0, MAX_LEN);
  }

  return {
    utm_source: clean(params.get('utm_source'), true),
    utm_medium: clean(params.get('utm_medium'), true),
    utm_campaign: clean(params.get('utm_campaign')),
    utm_content: clean(params.get('utm_content')),
    utm_term: clean(params.get('utm_term')),
    click: CLICK_PARAMS.find((p) => (params.get(p) ?? '').trim() !== '') ?? null,
    ref: (params.get('ref') ?? '').trim() !== '',
    referrer_host: referrerHost,
    landing_path: (url?.pathname ?? '/').slice(0, MAX_LEN),
    at: new Date(now).toISOString(),
  };
}

/** Só utm_source, utm_medium, clique, ref ou referrer contam; utm_campaign sozinho é direto. */
export function isNonDirect(t: AcquisitionTouch): boolean {
  return Boolean(t.utm_source || t.utm_medium || t.click || t.ref || t.referrer_host);
}

function isTouch(v: unknown): v is AcquisitionTouch {
  if (!v || typeof v !== 'object') return false;
  const t = v as Partial<AcquisitionTouch>;
  return typeof t.at === 'string' && typeof t.landing_path === 'string';
}

function readStored(storage: MinimalStorage, now: number): StoredAcquisition | null {
  const raw = storage.getItem(ACQUISITION_STORAGE_KEY);
  if (!raw) return null;
  let parsed: Partial<StoredAcquisition>;
  try {
    parsed = JSON.parse(raw) as Partial<StoredAcquisition>;
  } catch {
    return null;
  }
  if (!parsed || parsed.v !== 1 || !isTouch(parsed.first)) return null;
  if (parsed.last != null && !isTouch(parsed.last)) return null;
  const firstAt = Date.parse(parsed.first.at);
  if (Number.isNaN(firstAt) || now - firstAt > ACQUISITION_TTL_MS) return null;
  return { first: parsed.first, last: parsed.last ?? null, v: 1 };
}

/** Grava o toque desta visita (first uma vez; last só se não for direto). */
export function captureAcquisition(
  href: string,
  referrer: string,
  storage: MinimalStorage | null = safeStorage(),
  now: number = Date.now(),
): StoredAcquisition | null {
  if (!storage) return null;
  try {
    const touch = buildTouch(href, referrer, now);
    const existing = readStored(storage, now);
    let next: StoredAcquisition;
    if (!existing) {
      next = { first: touch, last: isNonDirect(touch) ? touch : null, v: 1 };
    } else if (isNonDirect(touch)) {
      next = { ...existing, last: touch };
    } else {
      return existing;
    }
    storage.setItem(ACQUISITION_STORAGE_KEY, JSON.stringify(next));
    return next;
  } catch {
    return null;
  }
}

/** Valor gravado e ainda dentro dos 90 dias, ou null (corrompido, versão antiga, expirado). */
export function getStoredAcquisition(
  storage: MinimalStorage | null = safeStorage(),
  now: number = Date.now(),
): StoredAcquisition | null {
  if (!storage) return null;
  try {
    return readStored(storage, now);
  } catch {
    return null;
  }
}

export function clearStoredAcquisition(storage: MinimalStorage | null = safeStorage()): void {
  try {
    storage?.removeItem(ACQUISITION_STORAGE_KEY);
  } catch {
    // sem storage, nada a limpar
  }
}
