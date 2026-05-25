import DiffMatchPatch from 'diff-match-patch';

const dmp = new DiffMatchPatch();

interface TipTapNode {
  type: string;
  content?: TipTapNode[];
  text?: string;
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
  attrs?: Record<string, unknown>;
}

const TEXT_CONTAINER_TYPES = new Set(['paragraph', 'heading']);

function extractText(node: TipTapNode): string {
  if (node.text != null) return node.text;
  if (!node.content) return '';
  return node.content.map(extractText).join('');
}

function diffsToTextNodes(diffs: [number, string][]): TipTapNode[] {
  const nodes: TipTapNode[] = [];
  for (const [op, text] of diffs) {
    if (!text) continue;
    if (op === -1) {
      nodes.push({
        type: 'text',
        text,
        marks: [
          { type: 'textStyle', attrs: { color: '#be123c' } },
          { type: 'strike' },
        ],
      });
    } else if (op === 1) {
      nodes.push({
        type: 'text',
        text,
        marks: [
          { type: 'highlight', attrs: { color: '#bbf7d0' } },
        ],
      });
    } else {
      nodes.push({ type: 'text', text });
    }
  }
  return nodes;
}

function markAllText(node: TipTapNode, mode: 'insert' | 'delete'): TipTapNode {
  if (node.type === 'text') {
    const diffMarks: TipTapNode['marks'] = mode === 'delete'
      ? [{ type: 'textStyle', attrs: { color: '#be123c' } }, { type: 'strike' }]
      : [{ type: 'highlight', attrs: { color: '#bbf7d0' } }];
    return { ...node, marks: [...(node.marks || []), ...diffMarks] };
  }
  if (node.content) {
    return { ...node, content: node.content.map(c => markAllText(c, mode)) };
  }
  return { ...node };
}

function diffNodes(orig: TipTapNode, sugg: TipTapNode): TipTapNode[] {
  if (orig.type !== sugg.type) {
    return [markAllText(orig, 'delete'), markAllText(sugg, 'insert')];
  }

  if (TEXT_CONTAINER_TYPES.has(orig.type)) {
    const origText = extractText(orig);
    const suggText = extractText(sugg);

    if (origText === suggText) return [{ ...sugg }];

    const diffs = dmp.diff_main(origText, suggText);
    dmp.diff_cleanupSemantic(diffs);

    return [{ ...sugg, content: diffsToTextNodes(diffs) }];
  }

  if (orig.content && sugg.content) {
    const result: TipTapNode[] = [];
    const maxLen = Math.max(orig.content.length, sugg.content.length);

    for (let i = 0; i < maxLen; i++) {
      if (i >= sugg.content.length) {
        result.push(markAllText(orig.content[i], 'delete'));
      } else if (i >= orig.content.length) {
        result.push(markAllText(sugg.content[i], 'insert'));
      } else {
        result.push(...diffNodes(orig.content[i], sugg.content[i]));
      }
    }

    return [{ ...sugg, content: result }];
  }

  return [{ ...sugg }];
}

export function computeTipTapDiff(
  original: Record<string, unknown>,
  suggested: Record<string, unknown>,
): Record<string, unknown> {
  const result = diffNodes(original as unknown as TipTapNode, suggested as unknown as TipTapNode);
  return result[0] as unknown as Record<string, unknown>;
}
