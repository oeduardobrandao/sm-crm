type Node = {
  type: string;
  content?: Node[];
  text?: string;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  attrs?: Record<string, unknown>;
};

/** Inline markdown -> text nodes with bold/italic/link marks. Unmatched syntax stays literal text. */
function inline(text: string): Node[] {
  const out: Node[] = [];
  const re = /\*\*(.+?)\*\*|\*(.+?)\*|\[(.+?)\]\((https?:\/\/[^\s)]+)\)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ type: 'text', text: text.slice(last, m.index) });
    if (m[1]) out.push({ type: 'text', text: m[1], marks: [{ type: 'bold' }] });
    else if (m[2]) out.push({ type: 'text', text: m[2], marks: [{ type: 'italic' }] });
    else out.push({ type: 'text', text: m[3], marks: [{ type: 'link', attrs: { href: m[4] } }] });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ type: 'text', text: text.slice(last) });
  return out.filter((n) => n.text !== '');
}

export function toTipTapDoc(text: string): { doc: Record<string, unknown> | null; plain: string } {
  const trimmed = (text ?? '').trim();
  if (!trimmed) return { doc: null, plain: '' };

  const content: Node[] = [];
  let bullets: Node[] = [];
  const flushBullets = () => {
    if (bullets.length) {
      content.push({ type: 'bulletList', content: bullets });
      bullets = [];
    }
  };
  for (const line of trimmed.split('\n')) {
    const l = line.trim();
    if (!l) {
      flushBullets();
      continue;
    }
    const bullet = /^[-*]\s+(.*)$/.exec(l);
    if (bullet) {
      bullets.push({
        type: 'listItem',
        content: [{ type: 'paragraph', content: inline(bullet[1]) }],
      });
    } else {
      flushBullets();
      content.push({ type: 'paragraph', content: inline(l) });
    }
  }
  flushBullets();

  const plainOf = (n: Node): string =>
    n.text ??
    (n.content ?? [])
      .map(plainOf)
      .join(n.type === 'bulletList' ? '\n' : n.type === 'doc' ? '\n' : '');
  const doc: Node = { type: 'doc', content };
  return { doc: doc as Record<string, unknown>, plain: content.map(plainOf).join('\n') };
}
