import DiffMatchPatch from 'diff-match-patch';

export interface DiffSegment {
  type: 'equal' | 'insert' | 'delete';
  text: string;
}

const dmp = new DiffMatchPatch();

// Runs of Unicode letters/digits, and runs of everything else (whitespace, punctuation,
// symbols). Every character belongs to exactly one token, so tokens.join('') === input.
const TOKEN_RE = /[\p{L}\p{N}]+|[^\p{L}\p{N}]+/gu;

/**
 * Word-level diff, built on diff-match-patch's own line-mode trick (see diff_lineMode_ in
 * the diff-match-patch source): encode each token as one synthetic character, diff the
 * encoded strings, then decode back to real text. Every insert/delete this produces is a
 * whole token -- there's no way for the underlying char-level diff to land mid-token, since
 * each "character" it sees IS a token.
 *
 * diff_cleanupSemantic runs on the STILL-ENCODED diff, before decoding. Its overlap-
 * elimination pass (finding a shared substring between an adjacent delete/insert pair) is
 * exactly what produces the mid-word chopping this function exists to avoid -- e.g.
 * "acneico" -> "antiacne" showing "a[ntia]cne[ico]" instead of a clean whole-word swap.
 * Run on encoded tokens, that same pass can only ever find shared whole tokens. Running it
 * after decoding (as diff-match-patch's own line mode does) would reintroduce the problem.
 */
export function diffWords(text1: string, text2: string): [number, string][] {
  const tokenToCode = new Map<string, number>();
  const tokenArray: string[] = [];

  function encode(text: string): string {
    let chars = '';
    for (const token of text.match(TOKEN_RE) ?? []) {
      let code = tokenToCode.get(token);
      if (code === undefined) {
        code = tokenArray.length;
        tokenArray.push(token);
        tokenToCode.set(token, code);
      }
      chars += String.fromCharCode(code);
    }
    return chars;
  }

  const diffs = dmp.diff_main(encode(text1), encode(text2), false);
  dmp.diff_cleanupSemantic(diffs);

  for (const diff of diffs) {
    let text = '';
    for (let i = 0; i < diff[1].length; i++) {
      text += tokenArray[diff[1].charCodeAt(i)];
    }
    diff[1] = text;
  }

  return diffs;
}

export function computeWordDiff(original: string, suggested: string): DiffSegment[] {
  return diffWords(original, suggested).map(([op, text]) => ({
    type: op === 0 ? 'equal' : op === 1 ? 'insert' : 'delete',
    text,
  }));
}
