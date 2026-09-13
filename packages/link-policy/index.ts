/**
 * Link URL policy shared by every TipTap surface that can render or persist a `link` mark:
 * the Hub's read-only renderer (`apps/hub/src/components/RichTextContent.tsx` -- it backs
 * portal pages AND post captions), the CRM's page editor
 * (`apps/crm/src/pages/cliente-detalhe/hub/pageEditorSchema.ts`), and the CRM's post caption
 * editor (`apps/crm/src/pages/entregas/components/PostEditor.tsx`). Defined ONCE here, in a
 * package both apps' Vite/tsconfig already alias as `@mesaas/link-policy`, so the write side
 * and the read side cannot drift apart -- a scheme an editor accepts but the renderer
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
 * Meant to be passed straight into TipTap's Link extension for a READ-ONLY surface
 * (`autolink: false`, hrefs only ever come from `parseHTML`/`renderHTML`, always already
 * resolved):
 *   `Link.configure({ isAllowedUri: (url) => isAllowedRichTextLinkUrl(url) })`
 *
 * A surface with `autolink: true` (or `linkOnPaste: true`) must use
 * `isAllowedRichTextAutolinkUrl` instead -- see its own doc comment below for why. And a
 * surface that applies a link IMPERATIVELY (a toolbar/popover calling `setLink`/
 * `toggleLink`, as opposed to autolink typing the mark itself) must run the raw input
 * through `normalizeRichTextLinkUrl` FIRST and use its return value as the href -- see that
 * function's doc comment for why `isAllowedUri` alone does not cover this case even though
 * it is the very same wrapper that makes autolink work.
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

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DOMAIN_LABEL = '[a-z0-9](?:[a-z0-9-]*[a-z0-9])?';
const DOMAIN_SHAPE = new RegExp(`^${DOMAIN_LABEL}(?:\\.${DOMAIN_LABEL})+$`, 'i');

/**
 * `isAllowedUri` for a Link extension configured with `autolink: true` (and/or
 * `linkOnPaste: true`).
 *
 * TipTap's autolink plugin validates the RAW TYPED TEXT of the candidate link, never the
 * href it is about to assign the mark: `@tiptap/extension-link`'s internal `autolink()`
 * helper does `.filter((link) => options.validate(link.value))` before ever looking at
 * `link.href`, and `options.validate` is built straight from `isAllowedUri`
 * (`node_modules/@tiptap/extension-link/dist/index.js`, the `autolink()` plugin's
 * `appendTransaction` and the `addProseMirrorPlugins` wiring around it -- the paste
 * handler has the identical shape, filtering `item.value`). So passing
 * `isAllowedRichTextLinkUrl` straight through as `isAllowedUri` rejects every
 * schemeless candidate outright: `contato@exemplo.com` and `www.exemplo.com` have no
 * `scheme:` prefix at all, so they never even reach the http/mailto allow-list, and
 * autolink silently stops producing a mark for the exact email/bare-domain cases the
 * policy exists to keep working (dead link traded for no link, same outcome).
 *
 * This wrapper resolves the candidate to the href TipTap/linkify would actually assign
 * before testing it against the strict policy above: a value that already carries a
 * scheme (a typed `https://…`, a `setLink`/`toggleLink` call, a pasted anchor's real
 * `href`) is tested as-is; a schemeless value is resolved to `mailto:<value>` when it has
 * an email shape, or to `<defaultProtocol>://<value>` when its host segment looks like a
 * real dotted domain. Anything else schemeless -- a relative path (`/pagina-interna`), an
 * anchor (`#ancora`), or a single dotless word -- is rejected outright, same as the
 * strict policy already does for a resolved href with no real host.
 *
 * Resolution itself lives in `resolveAutolinkCandidate` below, shared with
 * `normalizeRichTextLinkUrl` -- this function only turns that resolution into a yes/no.
 */
export function isAllowedRichTextAutolinkUrl(
  value: string | null | undefined,
  ctx?: { defaultProtocol?: string },
): boolean {
  if (!value) return false;
  const trimmed = value.trim();
  if (!trimmed) return false;

  const resolved = resolveAutolinkCandidate(trimmed, ctx);
  if (resolved === null) return false;
  return isAllowedRichTextLinkUrl(resolved);
}

/**
 * Shared resolution step behind `isAllowedRichTextAutolinkUrl` (above) and
 * `normalizeRichTextLinkUrl` (below): turns a schemeless candidate into the href it
 * should be tested/stored as, or returns `null` when nothing sensible can be resolved
 * (a relative path, an anchor, a dotless word). A value that already carries a scheme is
 * returned unchanged -- untouched even when it will go on to fail the strict policy (an
 * `ftp://…` or credentialed URL), because rejecting an explicit scheme is that policy's
 * job, not the resolver's.
 */
function resolveAutolinkCandidate(
  value: string,
  ctx?: { defaultProtocol?: string },
): string | null {
  if (/^[a-z][a-z\d+.-]*:/i.test(value)) {
    return value;
  }

  if (EMAIL_SHAPE.test(value)) {
    return `mailto:${value}`;
  }

  // Only the segment before the first `/`, `?` or `#` is the host -- a relative path
  // (`/pagina-interna`) or an anchor (`#ancora`) yields an empty candidate here and
  // fails the dotted-domain shape below, same as a schemeless value with no dot at all
  // (`pagina-interna`).
  const host = value.split(/[/?#]/, 1)[0];
  if (!DOMAIN_SHAPE.test(host)) return null;

  const protocol = ctx?.defaultProtocol || 'http';
  return `${protocol}://${value}`;
}

/**
 * Normalizes a candidate href for an IMPERATIVE link application -- a toolbar/popover
 * calling `setLink`/`toggleLink` -- to what the link mark will actually store, then tests
 * the result against the strict policy above. Returns the normalized href when it passes,
 * `null` when it does not (unresolvable, or resolves to something the policy still
 * rejects) -- a caller getting `null` back must not apply a link at all.
 *
 * Why this exists, and why `isAllowedRichTextAutolinkUrl` alone does not cover it:
 * `isAllowedRichTextAutolinkUrl` is wired as `isAllowedUri` on both CRM editors' Link
 * extension (pageEditorSchema.ts, PostEditor.tsx) precisely so autolink keeps producing a
 * mark for a typed email/bare domain (see that function's doc comment). But `isAllowedUri`
 * only gates whether TipTap's `setLink` command applies the mark -- it never rewrites the
 * href the mark stores. Typing "exemplo.com" into the Link toolbar's popover and calling
 * `setLink({ href: 'exemplo.com' })` passes `isAllowedUri` (which resolves the candidate
 * internally, to `https://exemplo.com`, purely to decide yes/no) but the mark's `href`
 * attribute is left as the raw, unresolved "exemplo.com" -- the exact schemeless shape
 * `isAllowedRichTextLinkUrl` rejects on read. The Hub then renders `href=""`: the CRM shows
 * what looks like a working link, the portal shows a dead one, no error on either side. A
 * caller applying a link imperatively must call this function FIRST and use its return
 * value as the href passed to `setLink`, never the raw input.
 *
 * Resolution rules (same shape as the autolink wrapper, but hardcoded to `https` rather
 * than TipTap-autolink's `http` default -- there is no ProseMirror `defaultProtocol` ctx
 * outside the autolink/paste plugins for a toolbar popover to inherit from):
 *   - already has a scheme (`https://…`, `mailto:…`, `tel:…`, but also a scheme the policy
 *     rejects, like `javascript:…`) -- tested as-is, unchanged.
 *   - looks like an email (`contato@exemplo.com`) -- resolved to `mailto:contato@exemplo.com`.
 *   - looks like a bare host (`exemplo.com`, `www.exemplo.com`, `exemplo.com/pagina`) --
 *     resolved to `https://exemplo.com`, `https://www.exemplo.com`, `https://exemplo.com/pagina`.
 *   - anything else schemeless (a relative path, an anchor, a dotless word) -- unresolvable,
 *     returns `null` without ever reaching the strict policy.
 */
export function normalizeRichTextLinkUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const resolved = resolveAutolinkCandidate(trimmed, { defaultProtocol: 'https' });
  if (resolved === null) return null;

  return isAllowedRichTextLinkUrl(resolved) ? resolved : null;
}
