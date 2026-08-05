/**
 * Deep link to support on WhatsApp.
 *
 * The number runs the WhatsApp Business *app* with manual replies, not the
 * Cloud API. So there is no template, no per-message billing, no 24h customer
 * service window and no messaging tier here. The user always sends the first
 * message, which is also why no opt-in is collected anywhere for this.
 */

export type WhatsAppContext = 'onboarding' | 'dashboard';

/** wa.me rejects anything but digits: no `+`, no spaces, no punctuation. */
const DIGITS_ONLY = /^\d+$/;

const RAW_NUMBER = import.meta.env.VITE_WHATSAPP_SUPPORT_NUMBER as string | undefined;

/**
 * Fails closed on a malformed value, not only on a missing one. `+55 11 99999-9999`
 * pasted straight from a phone is the likely mistake, and it would otherwise
 * produce a live but dead link.
 */
function supportNumber(): string | null {
  const raw = (RAW_NUMBER ?? '').trim();
  return DIGITS_ONLY.test(raw) ? raw : null;
}

export function isWhatsAppSupportEnabled(): boolean {
  return supportNumber() !== null;
}

/** First whitespace-separated word; null when absent or blank. Mirrors firstNameFrom() in _shared/lifecycle-emails.ts. */
function firstName(nome: string | null | undefined): string | null {
  const first = (nome ?? '').trim().split(/\s+/)[0];
  return first ? first : null;
}

const TAIL: Record<WhatsAppContext, string> = {
  onboarding: 'Acabei de criar minha conta no Mesaas e queria ajuda pra configurar.',
  dashboard: 'Queria falar com vocês sobre o Mesaas.',
};

/**
 * No article before the name. "Sou o Ana" agrees wrong, "Sou o/a" is ugly, and
 * any fixed article misgenders half the users. "Sou Ana" is correct and neutral.
 */
function intro(nome: string | null, empresa: string | null): string {
  if (nome && empresa) return `Oi! Sou ${nome}, da ${empresa}.`;
  if (nome) return `Oi! Sou ${nome}.`;
  if (empresa) return `Oi! Sou da ${empresa}.`;
  return 'Oi!';
}

/**
 * The prefill is a hint, never an identifier: the user can edit it before
 * sending, so nothing may depend on it to resolve an account.
 */
export function buildWhatsAppSupportUrl(p: {
  nome?: string | null;
  empresa?: string | null;
  context: WhatsAppContext;
}): string | null {
  const number = supportNumber();
  if (!number) return null;
  const empresa = (p.empresa ?? '').trim() || null;
  const text = `${intro(firstName(p.nome), empresa)} ${TAIL[p.context]}`;
  return `https://wa.me/${number}?text=${encodeURIComponent(text)}`;
}
