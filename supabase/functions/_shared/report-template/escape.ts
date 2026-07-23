const ESCAPE_MAP: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
  // `{` is escaped so interpolated data can never forge a `{{TOKEN}}`: the report
  // renderer substitutes page numbers AFTER user content is in the document, so a
  // caption containing the literal `{{PAGE_NO}}` would otherwise be replaced and
  // shift every later footer number. `&#123;` renders as `{`, so text is unchanged.
  "{": "&#123;",
};

const ESCAPE_RE = /[&<>"'{]/g;

export function escapeHtml(str: string): string {
  if (str == null) return "";
  return String(str).replace(ESCAPE_RE, (ch) => ESCAPE_MAP[ch]);
}
