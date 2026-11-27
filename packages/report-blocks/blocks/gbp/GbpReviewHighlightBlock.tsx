import type { BlockProps } from '../../BlockRenderer';
import { GbpCardHeader } from './GbpCardHeader';
import { GbpStars } from './GbpRatingBlock';
import { fmtDayMonth, googleWithData } from './format';
import { useReportLang, reportText } from '../../i18n';

/** Avaliação em destaque: a mais recente de 5 (senão 4) estrelas com texto, criada no período.
 * O nome já vem abreviado no snapshot ("Paula R."). */
export function GbpReviewHighlightBlock({ snapshot }: BlockProps) {
  const lang = useReportLang();
  const text = reportText(lang).gbp.highlight;
  const h = googleWithData(snapshot)?.highlight;
  if (!h) return null;
  const byline = [h.reviewer, h.unit_title].filter(Boolean).join(' · ');

  return (
    <div className="rb-gbp-card rb-card rb-card--pad">
      <GbpCardHeader title={text.title} stamp={text.stamp(fmtDayMonth(h.date, lang))} />
      <GbpStars rating={h.rating} />
      <blockquote className="rb-gbp-quote">{`“${h.comment}”`}</blockquote>
      {byline ? <p className="rb-gbp-sub">{byline}</p> : null}
    </div>
  );
}
