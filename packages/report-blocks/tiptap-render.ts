// Renderer read-only de JSON TipTap (nós do StarterKit). Todo texto passa por
// escape — o HTML resultante é seguro para dangerouslySetInnerHTML porque só
// emitimos tags da allowlist abaixo, texto escapado e estilos de allowlist
// estrita (cor #rrggbb, text-align de conjunto fechado). Nada do documento
// entra num atributo sem passar por esses filtros.
interface Node {
  type?: string;
  text?: string;
  attrs?: { level?: number; textAlign?: string };
  marks?: { type: string; attrs?: { color?: string } }[];
  content?: Node[];
}

const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const ALIGN_ALLOWED = new Set(['center', 'right', 'justify']);

// Alinhamento: só center/right/justify viram estilo (left é o default e
// não precisa de atributo). Valor fora do conjunto: ignorado.
function alignAttr(node: Node): string {
  const a = node.attrs?.textAlign;
  return typeof a === 'string' && ALIGN_ALLOWED.has(a) ? ` style="text-align: ${a}"` : '';
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
    else if (mark.type === 'underline') html = `<u>${html}</u>`;
    else if (mark.type === 'textStyle') {
      // Cor de texto: SÓ #rrggbb estrito entra no atributo style; qualquer
      // outra coisa (rgb(), nome, 8 dígitos) descarta a mark e mantém o texto.
      const color = mark.attrs?.color;
      if (typeof color === 'string' && COLOR_RE.test(color)) {
        html = `<span style="color: ${color}">${html}</span>`;
      }
    }
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
      return `<p${alignAttr(node)}>${children(node)}</p>`;
    case 'heading': {
      const level = Math.min(Math.max(node.attrs?.level ?? 2, 1), 4);
      return `<h${level}${alignAttr(node)}>${children(node)}</h${level}>`;
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
