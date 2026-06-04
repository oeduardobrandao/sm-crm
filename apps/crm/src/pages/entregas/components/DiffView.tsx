import type { DiffSegment } from '@/utils/textDiff';

interface DiffViewProps {
  segments: DiffSegment[];
}

export function DiffView({ segments }: DiffViewProps) {
  return (
    <div className="text-[13px] leading-relaxed whitespace-pre-wrap font-[var(--font-main)]">
      {segments.map((seg, i) => {
        if (seg.type === 'equal') return <span key={i}>{seg.text}</span>;
        if (seg.type === 'delete') {
          return (
            <span key={i} className="bg-rose-100 text-rose-700 line-through decoration-rose-400/70">
              {seg.text}
            </span>
          );
        }
        return (
          <span key={i} className="bg-emerald-100 text-emerald-700">
            {seg.text}
          </span>
        );
      })}
    </div>
  );
}
