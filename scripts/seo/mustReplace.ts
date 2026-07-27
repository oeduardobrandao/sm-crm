/** All prerender injections use String.replace against markers in the built
 * shell (title/description regexes, `</head>`, `<div id="root"></div>`). If
 * the shell's markup ever drifts, a plain `.replace()` silently no-ops and
 * ships a broken page while the build stays green. This wrapper makes that
 * failure loud: it throws unless the replacement actually changed the html.
 *
 * `replacement` is applied via a replacer FUNCTION, never as a string. A
 * string replacement lets JavaScript reinterpret `$&`, `` $` ``, `$'` and
 * `$$` inside it as special substitution patterns — and `renderToStaticMarkup`
 * routinely manufactures those sequences by escaping ordinary prose (`&` ->
 * `&amp;`, `'` -> `&#x27;`), silently deleting text and splicing in the
 * matched marker. A function replacer disables that interpretation entirely. */
export function mustReplace(
  html: string,
  pattern: string | RegExp,
  replacement: string,
  label: string,
): string {
  const out = html.replace(pattern, () => replacement);
  if (out === html) throw new Error(`prerender: marker not found: ${label}`);
  return out;
}
