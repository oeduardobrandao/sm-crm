import DiffMatchPatch from 'diff-match-patch';

export interface DiffSegment {
  type: 'equal' | 'insert' | 'delete';
  text: string;
}

const dmp = new DiffMatchPatch();

// Runs of Unicode letters/digits/combining marks, and runs of everything else (whitespace,
// punctuation, symbols). \p{M} (combining marks) rides along with \p{L}/\p{N} so a base
// letter stays in the same token as its own accent in decomposed Unicode (NFD) text -- e.g.
// pasted "ã" (a + combining tilde) is one token, not "a" split from the accent that
// renders on top of it. Every character belongs to exactly one token, so
// tokens.join('') === input.
const TOKEN_RE = /[\p{L}\p{N}\p{M}]+|[^\p{L}\p{N}\p{M}]+/gu;

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

  // String.fromCharCode wraps at 65536 (String.fromCharCode(65536) === String.fromCharCode(0)),
  // so a document with more than 65536 distinct tokens would silently collide token codes and
  // corrupt the diff. Bail out the same way diff-match-patch's own diff_linesToChars_ does:
  // fold every remaining token in that text into one final token once the budget runs out.
  // text1 and text2 get different budgets (mirroring diff_linesToChars_'s 40000/65535 split)
  // so their two bail-out tokens can never land on the same code.
  function encode(text: string, maxTokens: number): string {
    const tokens = text.match(TOKEN_RE) ?? [];
    let chars = '';
    for (let i = 0; i < tokens.length; i++) {
      let token = tokens[i];
      let code = tokenToCode.get(token);
      if (code === undefined) {
        if (tokenArray.length >= maxTokens) {
          token = tokens.slice(i).join('');
          i = tokens.length - 1;
          code = tokenToCode.get(token);
        }
        if (code === undefined) {
          code = tokenArray.length;
          tokenArray.push(token);
          tokenToCode.set(token, code);
        }
      }
      chars += String.fromCharCode(code);
    }
    return chars;
  }

  const diffs = dmp.diff_main(encode(text1, 40000), encode(text2, 65535), false);
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
