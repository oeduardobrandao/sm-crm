// Renderer read-only de JSON TipTap (nós do StarterKit). Todo texto passa por
// escape — o HTML resultante é seguro para dangerouslySetInnerHTML porque só
// emitimos tags da allowlist abaixo e texto escapado.
interface Node {
  type?: string;
  text?: string;
  attrs?: { level?: number };
  marks?: { type: string }[];
  content?: Node[];
}

function esc(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function renderText(node: Node): string {
  let html = esc(node.text ?? '');
  for (const mark of node.marks ?? []) {
    if (mark.type === 'bold') html = `<strong>${html}</strong>`;
    else if (mark.type === 'italic') html = `<em>${html}</em>`;
    else if (mark.type === 'strike') html = `<s>${html}</s>`;
    // Marks desconhecidas (link etc.): texto puro, sem a mark.
  }
  return html;
}

function children(node: Node): string {
  return (node.content ?? []).map(renderNode).join('');
}

function renderNode(node: Node): string {
  switch (node.type) {
    case 'text':
      return renderText(node);
    case 'paragraph':
      return `<p>${children(node)}</p>`;
    case 'heading': {
      const level = Math.min(Math.max(node.attrs?.level ?? 2, 1), 4);
      return `<h${level}>${children(node)}</h${level}>`;
    }
    case 'bulletList':
      return `<ul>${children(node)}</ul>`;
    case 'orderedList':
      return `<ol>${children(node)}</ol>`;
    case 'listItem':
      return `<li>${children(node)}</li>`;
    case 'blockquote':
      return `<blockquote>${children(node)}</blockquote>`;
    case 'hardBreak':
      return '<br>';
    case 'horizontalRule':
      return '<hr>';
    default:
      return children(node); // nó desconhecido: só os filhos
  }
}

export function tiptapToHtml(doc: unknown): string {
  if (typeof doc !== 'object' || doc === null) return '';
  const root = doc as Node;
  if (root.type !== 'doc') return '';
  return children(root);
}
