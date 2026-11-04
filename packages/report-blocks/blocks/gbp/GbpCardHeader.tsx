/** Cabeçalho comum dos cartões GMN: estampa de período (opcional), título e subtítulo. */
export function GbpCardHeader({
  title,
  stamp,
  sub,
}: {
  title: string;
  stamp?: string | null;
  sub?: string | null;
}) {
  return (
    <div className="rb-gbp-head">
      {stamp ? <p className="rb-gbp-stamp">{stamp}</p> : null}
      <p className="rb-card-title rb-gbp-title">{title}</p>
      {sub ? <p className="rb-gbp-sub">{sub}</p> : null}
    </div>
  );
}
