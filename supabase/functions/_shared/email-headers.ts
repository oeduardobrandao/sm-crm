/**
 * Tenant-editable free text (workspace names) ends up in the From display
 * name (`"${name}" <sender@mesaas.com.br>`). CR/LF could break out of the
 * header into a second header (header injection) regardless of quoting, so
 * control characters are stripped outright. But a name containing an RFC
 * 5322 "special" (`, ; : @ ( ) [ ] \ "` -- e.g. "Silva, Souza & Cia") is NOT
 * dangerous by itself: it only becomes ambiguous in an UNQUOTED display
 * name, where a comma reads as a second address and `<>` can forge a
 * different address. Stripping those characters mangles legitimate business
 * names for no safety benefit. The always-valid fix is what RFC 5322 itself
 * provides: wrap the whole name in a quoted-string, escaping only the two
 * characters that are structurally special INSIDE a quoted-string (`\` and
 * `"`) -- everything else, including `<`, `>`, `,`, `;`, `(`, `)`, is just
 * literal text there. Callers keep escaping the same name separately for
 * the HTML body; this is only for the header.
 */
export function sanitizeFromName(name: string): string {
  // deno-lint-ignore no-control-regex
  const cleaned = name.replace(/[\x00-\x1f\x7f]+/g, " ").replace(/\s+/g, " ").trim() || "Mesaas";
  const escaped = cleaned.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `"${escaped}"`;
}
