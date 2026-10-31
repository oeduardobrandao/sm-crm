import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';
import { Badge } from '@/components/ui/badge';

// Follower history as a smooth area line: total + period delta on top, a hover
// crosshair with a per-day tooltip, and a ring on each day a post went out.
// Also drawn by the TikTok tab, which passes its own line colour and empty copy.

const PLOT_H = 240;
const PAD_TOP = 14;
const PAD_BOTTOM = 10;
const PAD_X = 10;
const TIP_W = 184;
const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const MONTHS_LONG = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
];

const fmt = (n: number) => n.toLocaleString('pt-BR');
const signed = (n: number) => `${n >= 0 ? '+' : ''}${fmt(n)}`;

// 'YYYY-MM-DD' read as a calendar day, never through Date (UTC midnight would
// show the previous day in Brazil).
function parseDay(date: string) {
  const [, m, d] = date
    .split('T')[0]
    .split('-')
    .map((p) => parseInt(p, 10));
  return { day: d, month: m - 1 };
}

function niceStep(raw: number) {
  const x = Math.max(raw, 1);
  const pow = Math.pow(10, Math.floor(Math.log10(x)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * pow >= x) return m * pow;
  return 10 * pow;
}

function smoothPath(pts: [number, number][]) {
  let d = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C${c1x.toFixed(1)} ${c1y.toFixed(1)} ${c2x.toFixed(1)} ${c2y.toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  return d;
}

export function FollowerChart({
  history,
  postDates,
  color = '#E1306C',
  emptyText = 'Dados insuficientes. O histórico é construído diariamente.',
}: {
  history: any[];
  postDates: any[];
  color?: string;
  emptyText?: string;
}) {
  const gradientId = useId();
  const plotRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = plotRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([entry]) => {
      const w = Math.round(entry.contentRect.width);
      if (w > 0) setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [history.length]);

  const chart = useMemo(() => {
    if (history.length < 2) return null;
    const postsPerDay = new Map<string, number>();
    for (const p of postDates) postsPerDay.set(p.date, (postsPerDay.get(p.date) ?? 0) + 1);
    const points = history.map((h, i) => {
      const day = String(h.date).split('T')[0];
      const value = Number(h.follower_count) || 0;
      const prev = i > 0 ? Number(history[i - 1].follower_count) || 0 : null;
      return {
        day,
        value,
        delta: prev == null ? null : value - prev,
        posts: postsPerDay.get(day) ?? 0,
      };
    });
    const values = points.map((p) => p.value);
    const lo = Math.min(...values);
    const hi = Math.max(...values);
    const step = niceStep((hi - lo) / 3);
    const yMin = Math.floor(lo / step) * step;
    let yMax = Math.ceil(hi / step) * step;
    if (yMax === yMin) yMax += step;
    const ticks: number[] = [];
    for (let t = yMin; t <= yMax + step / 1000; t += step) ticks.push(t);
    return { points, ticks, yMin, yMax };
  }, [history, postDates]);

  if (!chart) return <p style={{ color: 'var(--text-muted)', marginTop: '1rem' }}>{emptyText}</p>;

  const { points, ticks, yMin, yMax } = chart;
  const n = points.length;
  const x = (i: number) => PAD_X + (i * (width - 2 * PAD_X)) / (n - 1);
  const y = (v: number) =>
    PAD_TOP + (1 - (v - yMin) / (yMax - yMin)) * (PLOT_H - PAD_TOP - PAD_BOTTOM);
  const coords = points.map((p, i) => [x(i), y(p.value)] as [number, number]);
  const lineD = smoothPath(coords);
  const areaD = `${lineD} L${coords[n - 1][0].toFixed(1)} ${PLOT_H} L${coords[0][0].toFixed(1)} ${PLOT_H} Z`;

  const first = points[0].value;
  const last = points[n - 1].value;
  const total = last - first;
  const pct = first > 0 ? (total / first) * 100 : 0;

  const labelEvery = Math.max(1, Math.ceil(n / 6));
  const xLabels: number[] = [];
  for (let i = n - 1; i >= 0; i -= labelEvery) xLabels.push(i);

  const active = hover ?? n - 1;
  const ap = points[active];
  const [ax, ay] = coords[active];
  const apDay = parseDay(ap.day);
  const tipLeft = Math.max(0, Math.min(width - TIP_W, ax - TIP_W / 2));
  const tipAbove = ay > 120;

  const pickFromPointer = (e: PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const rel = e.clientX - rect.left - PAD_X;
    const i = Math.round((rel / (width - 2 * PAD_X)) * (n - 1));
    setHover(Math.max(0, Math.min(n - 1, i)));
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowLeft') setHover(Math.max(0, active - 1));
    else if (e.key === 'ArrowRight') setHover(Math.min(n - 1, active + 1));
    else if (e.key === 'Escape') setHover(null);
    else return;
    e.preventDefault();
  };

  return (
    <div className="fc">
      <div className="fc-summary">
        <span className="fc-total">{fmt(last)}</span>
        <Badge variant={total >= 0 ? 'success' : 'danger'}>{signed(total)}</Badge>
        <span className="fc-pct">
          {pct >= 0 ? '+' : ''}
          {pct.toFixed(1).replace('.', ',')}% no período
        </span>
      </div>

      <div className="fc-body">
        <div className="fc-yaxis" aria-hidden="true">
          {ticks.map((t) => (
            <span key={t} style={{ top: y(t) - 7 }}>
              {fmt(t)}
            </span>
          ))}
        </div>
        <div className="fc-plot-col">
          <div
            ref={plotRef}
            className="fc-plot"
            tabIndex={0}
            role="img"
            aria-label={`Seguidores de ${fmt(first)} a ${fmt(last)} no período. Use as setas para ver cada dia.`}
            onPointerMove={pickFromPointer}
            onPointerDown={pickFromPointer}
            onPointerLeave={() => setHover(null)}
            onBlur={() => setHover(null)}
            onKeyDown={onKeyDown}
          >
            <svg width={width} height={PLOT_H} aria-hidden="true">
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor={color} stopOpacity={0.16} />
                  <stop offset="1" stopColor={color} stopOpacity={0} />
                </linearGradient>
              </defs>
              {ticks.map((t) => (
                <line key={t} className="fc-grid" x1={0} x2={width} y1={y(t)} y2={y(t)} />
              ))}
              <path d={areaD} fill={`url(#${gradientId})`} />
              {hover != null && <line className="fc-cross" x1={ax} x2={ax} y1={0} y2={PLOT_H} />}
              <path
                d={lineD}
                fill="none"
                stroke={color}
                strokeWidth={2.5}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              {points.map((p, i) =>
                p.posts > 0 ? (
                  <circle
                    key={p.day}
                    className="fc-post"
                    cx={coords[i][0]}
                    cy={coords[i][1]}
                    r={4}
                    stroke={color}
                    strokeWidth={2}
                  />
                ) : null,
              )}
              <circle cx={ax} cy={ay} r={9} fill={color} opacity={0.15} />
              <circle className="fc-dot" cx={ax} cy={ay} r={5} fill={color} strokeWidth={2} />
            </svg>

            {hover != null && (
              <div
                className="fc-tip"
                style={{
                  left: tipLeft,
                  top: tipAbove ? undefined : ay + 18,
                  bottom: tipAbove ? PLOT_H - ay + 18 : undefined,
                }}
              >
                <span className="fc-tip-date">
                  {apDay.day} de {MONTHS_LONG[apDay.month]}
                </span>
                <span className="fc-tip-value">{fmt(ap.value)} seguidores</span>
                {ap.delta != null && (
                  <span className={`fc-tip-delta ${ap.delta >= 0 ? 'is-up' : 'is-down'}`}>
                    {signed(ap.delta)} no dia
                  </span>
                )}
                {ap.posts > 0 && (
                  <span className="fc-tip-post">
                    <span className="fc-ring" style={{ borderColor: color }} />
                    {ap.posts === 1 ? '1 post publicado' : `${ap.posts} posts publicados`}
                  </span>
                )}
              </div>
            )}
          </div>
          <div className="fc-xaxis" aria-hidden="true">
            {xLabels.map((i) => {
              const d = parseDay(points[i].day);
              return (
                <span key={i} style={{ left: coords[i][0] - 30 }}>
                  {d.day} {MONTHS[d.month]}
                </span>
              );
            })}
          </div>
        </div>
      </div>

      {points.some((p) => p.posts > 0) && (
        <div className="fc-legend">
          <span className="fc-ring" style={{ borderColor: color }} />
          Dia com post publicado
        </div>
      )}
    </div>
  );
}
