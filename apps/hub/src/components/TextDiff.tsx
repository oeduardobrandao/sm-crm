import { useMemo } from 'react';
import { computeWordDiff } from '@mesaas/text-diff';

/** Word-level diff: removed words struck through in rose, added words in emerald. */
export function TextDiff({
  before,
  after,
  className = 'text-[12px] leading-relaxed whitespace-pre-wrap hub-tx2',
}: {
  before: string;
  after: string;
  className?: string;
}) {
  const segments = useMemo(() => computeWordDiff(before, after), [before, after]);
  return (
    <p className={className}>
      {segments.map((segment, i) =>
        segment.type === 'delete' ? (
          <del
            key={i}
            className="bg-rose-50 text-rose-700 line-through dark:bg-rose-950/40 dark:text-rose-300"
          >
            {segment.text}
          </del>
        ) : segment.type === 'insert' ? (
          <ins
            key={i}
            className="bg-emerald-50 text-emerald-800 no-underline dark:bg-emerald-950/40 dark:text-emerald-300"
          >
            {segment.text}
          </ins>
        ) : (
          <span key={i}>{segment.text}</span>
        ),
      )}
    </p>
  );
}
