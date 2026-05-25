import DiffMatchPatch from 'diff-match-patch';

export interface DiffSegment {
  type: 'equal' | 'insert' | 'delete';
  text: string;
}

const dmp = new DiffMatchPatch();

export function computeWordDiff(original: string, suggested: string): DiffSegment[] {
  const diffs = dmp.diff_main(original, suggested);
  dmp.diff_cleanupSemantic(diffs);
  return diffs.map(([op, text]) => ({
    type: op === 0 ? 'equal' : op === 1 ? 'insert' : 'delete',
    text,
  }));
}
