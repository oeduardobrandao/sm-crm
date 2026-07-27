/**
 * Blog article overlap checker — the one measurement that counts.
 *
 * Two different agents once measured the same pair of sentences at 0.667 and
 * 0.714 because their tokenizers disagreed about single-character tokens,
 * which made "≥0.55" mean different things to different people. This script
 * fixes the method so nobody has to re-derive their own:
 *
 *   - split each article into segments on . ! ? : ; and newlines
 *   - fold accents (NFD, strip combining marks) and lowercase
 *   - tokenize on runs of letters/digits — stopwords are NOT filtered, and
 *     neither is anything else (that filtering is exactly what caused the
 *     0.667/0.714 split)
 *   - only segments with 8 or more words are scored; below that the score is
 *     noise and the pair has to be read by a human anyway
 *   - score a pair of segments as the Jaccard similarity of their token sets
 *   - >= 0.55 is reported as an offending pair
 *
 * Usage:
 *   tsx scripts/blog/overlap.ts <slug-or-path>   candidate vs every published post
 *   tsx scripts/blog/overlap.ts                  full audit: every pair among published posts
 *
 * Exits non-zero when it finds an offending pair, so it can gate CI later.
 */
import { existsSync, readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { splitFrontmatter } from '../../apps/crm/src/content/blog.schema';
import { loadPostsFromDisk } from '../seo/blog-fs';

const THRESHOLD = 0.55;
const MIN_WORDS = 8;

function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/** Markdown table rows are structured data, not prose: a "Mesaas vs X"
 * comparison table's row labels name real Mesaas features, so the same label
 * ("Portal do cliente com a marca da ag\u00eancia") is *supposed* to appear
 * verbatim in every comparison article's table. Scoring those rows as prose
 * would flag correct, repeated fact for rewrite. Table syntax lines (starting
 * with `|`) are dropped before segmenting so the check only ever scores
 * actual sentences. */
function stripTables(body: string): string {
  return body
    .split('\n')
    .filter((line) => !/^\s*\|/.test(line))
    .join('\n');
}

function segments(body: string): string[] {
  return fold(stripTables(body))
    .split(/[.!?:;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Every run of letters/digits, in order — no stopword list, no length gate.
 * That "no filtering at all" is the fix, not an implementation detail. */
function words(segment: string): string[] {
  return segment.match(/[a-z0-9]+/g) ?? [];
}

function jaccard(a: Set<string>, b: Set<string>): number {
  let intersection = 0;
  for (const t of a) if (b.has(t)) intersection++;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

interface Segment {
  text: string;
  tokens: Set<string>;
}

/** Segments of an article body long enough to score (>= MIN_WORDS words). */
function scoreableSegments(body: string): Segment[] {
  const out: Segment[] = [];
  for (const text of segments(body)) {
    const w = words(text);
    if (w.length >= MIN_WORDS) out.push({ text, tokens: new Set(w) });
  }
  return out;
}

interface Offender {
  slugA: string;
  segA: string;
  slugB: string;
  segB: string;
  score: number;
}

function compare(slugA: string, bodyA: string, slugB: string, bodyB: string): Offender[] {
  const segsA = scoreableSegments(bodyA);
  const segsB = scoreableSegments(bodyB);
  const offenders: Offender[] = [];
  for (const a of segsA) {
    for (const b of segsB) {
      const score = jaccard(a.tokens, b.tokens);
      if (score >= THRESHOLD) {
        offenders.push({ slugA, segA: a.text, slugB, segB: b.text, score });
      }
    }
  }
  return offenders;
}

function loadCandidate(arg: string): { slug: string; body: string } {
  const path = resolve(arg);
  if (existsSync(path)) {
    const raw = readFileSync(path, 'utf8');
    const { body } = splitFrontmatter(raw);
    return { slug: basename(arg).replace(/\.md$/, ''), body };
  }
  const post = loadPostsFromDisk().find((p) => p.slug === arg);
  if (post) return { slug: post.slug, body: post.body };
  throw new Error(`overlap: no file or published slug matches "${arg}"`);
}

function report(offenders: Offender[], checked: number): void {
  if (offenders.length === 0) {
    console.log(`No segments at or above ${THRESHOLD} overlap (checked ${checked} post(s)).`);
    return;
  }
  offenders.sort((a, b) => b.score - a.score);
  for (const o of offenders) {
    console.log(`\n${o.score.toFixed(3)}  ${o.slugA} <-> ${o.slugB}`);
    console.log(`  A: ${o.segA}`);
    console.log(`  B: ${o.segB}`);
  }
  console.log(`\n${offenders.length} offending pair(s) at or above ${THRESHOLD}.`);
}

const arg = process.argv[2];
const posts = loadPostsFromDisk();

if (arg) {
  const candidate = loadCandidate(arg);
  const others = posts.filter((p) => p.slug !== candidate.slug);
  const offenders = others.flatMap((p) => compare(candidate.slug, candidate.body, p.slug, p.body));
  report(offenders, others.length);
  process.exit(offenders.length > 0 ? 1 : 0);
} else {
  const offenders: Offender[] = [];
  for (let i = 0; i < posts.length; i++) {
    for (let j = i + 1; j < posts.length; j++) {
      offenders.push(...compare(posts[i].slug, posts[i].body, posts[j].slug, posts[j].body));
    }
  }
  const pairCount = (posts.length * (posts.length - 1)) / 2;
  report(offenders, pairCount);
  process.exit(offenders.length > 0 ? 1 : 0);
}
