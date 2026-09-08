/**
 * Link URL policy shared by every TipTap surface that can render or persist a `link` mark:
 * the Hub's read-only renderer (`apps/hub/src/components/RichTextContent.tsx` -- it backs
 * portal pages AND post captions) and the CRM's page editor
 * (`apps/crm/src/pages/cliente-detalhe/hub/pageEditorSchema.ts`). Defined ONCE here, in a
 * package both apps' Vite/tsconfig already alias as `@mesaas/link-policy`, so the write side
 * and the read side cannot drift apart -- a scheme the editor accepts but the renderer
 * rejects is a link that persists but silently renders dead (`href=""`), with no feedback on
 * either side.
 *
 * Policy:
 *   Allowed:  http, https, mailto, tel.
 *   Rejected: javascript, data, ftp, any URL carrying credentials (`user:pass@`), and
 *             relative or anchor-only URLs (`/pagina-interna`, `#ancora`).
 *
 * Rationale: an agency writing a contact address into a client-facing page is ordinary use
 * (autolink turns a typed email into `mailto:`, and TipTap's own default `isAllowedUri`
 * already allows `mailto`/`tel` alongside `ftp`/`ftps`/`callto`/`sms`/`cid`/`xmpp` -- wider
 * than this policy wants, and it never checks for embedded credentials). Relative and
 * anchor-only links in page content are far more likely to be a mistake than intent -- the
 * portal has its own routing.
 *
 * Meant to be passed straight into TipTap's Link extension:
 *   `Link.configure({ isAllowedUri: (url) => isAllowedRichTextLinkUrl(url) })`
 */
const ALLOWED_SCHEMES = new Set(['http', 'https', 'mailto', 'tel']);

export function isAllowedRichTextLinkUrl(value: string | null | undefined): boolean {
  if (!value) return false;
  const trimmed = value.trim();
  if (!trimmed) return false;

  // No scheme at all -- a relative path (`/pagina-interna`), a protocol-relative URL
  // (`//evil.com`), or an anchor-only URL (`#ancora`) -- is rejected outright, never
  // resolved against some assumed origin. A raw tab/newline inside the scheme itself
  // (`ja\tvascript:`, the classic filter-bypass trick) also fails this match, because a
  // control character breaks the contiguous `[a-z\d+.-]` run before it ever reaches a
  // colon.
  const schemeMatch = /^([a-z][a-z\d+.-]*):/i.exec(trimmed);
  if (!schemeMatch) return false;

  const scheme = schemeMatch[1].toLowerCase();
  if (!ALLOWED_SCHEMES.has(scheme)) return false;

  // Something has to follow the scheme -- reject a bare "mailto:" / "tel:" / "https:".
  if (trimmed.length <= schemeMatch[0].length) return false;

  if (scheme === 'http' || scheme === 'https') {
    try {
      // `new URL` applies the WHATWG tab/newline-stripping and full authority parsing for
      // us, so a control character anywhere after the scheme (`http:\t//evil.com`) still
      // resolves to the plain URL it represents rather than smuggling anything past the
      // credential check below.
      const url = new URL(trimmed);
      if (url.username || url.password) return false;
    } catch {
      return false;
    }
  }

  // mailto/tel are opaque (no authority to parse), so there's nothing further to validate --
  // "contato@exemplo.com" and "+55 11 99999-9999" are ordinary, intended content.
  return true;
}
