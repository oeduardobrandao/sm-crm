/**
 * Deno twin of apps/crm/src/lib/whatsapp.ts.
 *
 * The duplication is deliberate: the two live in different runtimes (Vite and
 * Deno). Sharing it through packages/ would drag that whole build into the edge
 * function bundle, which no function here does, for two lines of encoding.
 *
 * This variant only ever builds the onboarding text with a first name: the
 * welcome email's candidate row carries no workspace, so there is no company to
 * interpolate. See get_welcome_email_candidates().
 */

/** wa.me rejects anything but digits: no `+`, no spaces, no punctuation. */
const DIGITS_ONLY = /^\d+$/;

export function whatsAppSupportUrl(p: { firstName: string | null }): string | null {
  const raw = (Deno.env.get("WHATSAPP_SUPPORT_NUMBER") ?? "").trim();
  // Fails closed on malformed as well as missing, so a number pasted from a
  // phone cannot ship a dead link inside an email nobody re-reads.
  if (!DIGITS_ONLY.test(raw)) return null;

  // No article before the name: "Sou o Ana" agrees wrong and any fixed article
  // misgenders half the recipients.
  const intro = p.firstName ? `Oi! Sou ${p.firstName}.` : "Oi!";
  const text = `${intro} Acabei de criar minha conta no Mesaas e queria ajuda pra configurar.`;
  return `https://wa.me/${raw}?text=${encodeURIComponent(text)}`;
}
