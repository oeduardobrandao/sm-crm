// Moved to the shared workspace package so the Hub history diff and the CRM
// suggestion/version diffs use one implementation. Import from
// '@mesaas/text-diff' in new code.
export { computeWordDiff, diffWords } from '@mesaas/text-diff';
export type { DiffSegment } from '@mesaas/text-diff';
