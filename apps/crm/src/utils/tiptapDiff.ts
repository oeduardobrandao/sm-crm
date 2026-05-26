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

function alignChildren(
  orig: TipTapNode[],
  sugg: TipTapNode[],
): Array<{ orig: TipTapNode | null; sugg: TipTapNode | null }> {
  const m = orig.length;
  const n = sugg.length;

  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (orig[i - 1].type === sugg[j - 1].type) {
        const textSame = extractText(orig[i - 1]) === extractText(sugg[j - 1]);
        dp[i][j] = Math.max(dp[i - 1][j - 1] + (textSame ? 3 : 1), dp[i - 1][j], dp[i][j - 1]);
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  const aligned: Array<{ orig: TipTapNode | null; sugg: TipTapNode | null }> = [];
  let i = m, j = n;
  while (i > 0 || j > 0) {
    if (
      i > 0 && j > 0 &&
      orig[i - 1].type === sugg[j - 1].type &&
      dp[i][j] === dp[i - 1][j - 1] + (extractText(orig[i - 1]) === extractText(sugg[j - 1]) ? 3 : 1)
    ) {
      aligned.unshift({ orig: orig[i - 1], sugg: sugg[j - 1] });
      i--; j--;
    } else if (i > 0 && dp[i][j] === dp[i - 1][j]) {
      aligned.unshift({ orig: orig[i - 1], sugg: null });
      i--;
    } else {
      aligned.unshift({ orig: null, sugg: sugg[j - 1] });
      j--;
    }
  }

  return aligned;
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
    const aligned = alignChildren(orig.content, sugg.content);
    const result: TipTapNode[] = [];

    for (const pair of aligned) {
      if (!pair.orig) {
        result.push(markAllText(pair.sugg!, 'insert'));
      } else if (!pair.sugg) {
        result.push(markAllText(pair.orig, 'delete'));
      } else {
        result.push(...diffNodes(pair.orig, pair.sugg));
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
