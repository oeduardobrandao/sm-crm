// Calendário do cliente (board 4). Days arrive bucketed in São Paulo time from the server;
// dates are plain YYYY-MM-DD strings, read as UTC here so no local zone shifts them.
import { useState } from 'react';
import { CalendarDays, Sparkles } from 'lucide-react';
import type { Host } from '../bridge';
import type { CalendarData, CalendarPost } from '../types';
import {
  Button,
  Card,
  LINK_FAILED,
  MESAAS_ORIGIN,
  MESSAGE_FAILED,
  Notice,
  STATUS_LABEL,
  TIPO_LABEL,
  joinPt,
  plural,
} from '../ui';

const WEEKDAY_SHORT = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
const WEEKDAY_LONG = ['segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado', 'domingo'];
const MONTHS = [
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

function parts(date: string) {
  const [y, m, d] = date.split('-').map((x) => parseInt(x, 10));
  const dt = new Date(Date.UTC(y, m - 1, d));
  return { y, m, d, wd: (dt.getUTCDay() + 6) % 7 };
}

/** "2 a 22 de novembro", "27 de outubro a 16 de novembro", years only when they differ. */
export function rangeLabel(first: string, last: string): string {
  const a = parts(first);
  const b = parts(last);
  if (a.y !== b.y)
    return `${a.d} de ${MONTHS[a.m - 1]} de ${a.y} a ${b.d} de ${MONTHS[b.m - 1]} de ${b.y}`;
  if (a.m !== b.m) return `${a.d} de ${MONTHS[a.m - 1]} a ${b.d} de ${MONTHS[b.m - 1]}`;
  return `${a.d} a ${b.d} de ${MONTHS[b.m - 1]}`;
}

/** "quarta, 11/11" */
export function gapLabel(date: string): string {
  const p = parts(date);
  return `${WEEKDAY_LONG[p.wd]}, ${String(p.d).padStart(2, '0')}/${String(p.m).padStart(2, '0')}`;
}

function PostLine({ p }: { p: CalendarPost }) {
  return (
    <span className="mw-cal-post">
      <span className={`mw-cal-tipo mw-tipo-${p.tipo}`}>
        <span className="mw-dot" aria-hidden="true" />
        {TIPO_LABEL[p.tipo] ?? p.tipo}
      </span>
      <span className="mw-cal-title">{p.titulo}</span>
      <span className={`mw-status mw-status-${p.status}`}>
        {STATUS_LABEL[p.status] ?? p.status}
      </span>
    </span>
  );
}

export function ClientCalendar({ host, data }: { host: Host; data: CalendarData }) {
  const days = Array.isArray(data.days) ? data.days : [];
  const [err, setErr] = useState<string>();
  const weeks: (typeof days)[] = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));

  const posts = days.flatMap((d) => d.posts ?? []);
  const waiting = posts.filter((p) => p.status === 'enviado_cliente').length;
  const gaps = days.filter((d) => d.gap);

  const summary = [
    posts.length ? plural(posts.length, 'post', 'posts') : 'Nenhum post',
    waiting ? `${waiting} aguardando aprovação` : null,
    gaps.length ? plural(gaps.length, 'dia de costume sem post', 'dias de costume sem post') : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const title = days.length
    ? `${data.client.nome} · ${rangeLabel(days[0].date, days[days.length - 1].date)}`
    : data.client.nome;

  const suggest = () =>
    host
      .sendMessage(
        `Sugira posts para ${data.client.nome} nos dias de costume sem post: ${joinPt(gaps.map((g) => gapLabel(g.date)))}.`,
      )
      .catch(() => setErr(MESSAGE_FAILED));

  const open = () => {
    // Only ever open a Mesaas page, whatever the payload says.
    if (typeof data.open_url !== 'string' || !data.open_url.startsWith(`${MESAAS_ORIGIN}/`)) {
      setErr(LINK_FAILED);
      return;
    }
    host.openLink(data.open_url).catch(() => setErr(LINK_FAILED));
  };

  return (
    <Card
      label="Calendário do cliente no Mesaas"
      title={title}
      subtitle={summary}
      footer={
        <>
          {gaps.length ? (
            <Button onClick={suggest}>
              <Sparkles size={14} aria-hidden="true" />
              Sugerir posts para os dias vazios
            </Button>
          ) : null}
          <Button variant="ghost" onClick={open}>
            <CalendarDays size={14} aria-hidden="true" />
            Abrir calendário no Mesaas
          </Button>
        </>
      }
    >
      <div className="mw-cal" role="table" aria-label="Calendário">
        <div className="mw-cal-week mw-cal-head" role="row">
          {WEEKDAY_SHORT.map((w) => (
            <span key={w} role="columnheader">
              {w}
            </span>
          ))}
        </div>
        {weeks.map((week, wi) => (
          <div className="mw-cal-week" role="row" key={wi}>
            {week.map((day) => {
              const p = parts(day.date);
              const list = day.posts ?? [];
              const cls = list.length
                ? 'mw-cal-day mw-cal-filled'
                : day.gap
                  ? 'mw-cal-day mw-cal-gap'
                  : 'mw-cal-day mw-cal-empty';
              return (
                <div className={cls} role="cell" key={day.date} data-date={day.date}>
                  <span className="mw-cal-n">
                    <span className="mw-cal-wd">{WEEKDAY_SHORT[p.wd]} </span>
                    {p.d}
                  </span>
                  {list.slice(0, 2).map((post) => (
                    <PostLine key={post.id} p={post} />
                  ))}
                  {list.length > 2 ? <span className="mw-cal-more">+{list.length - 2}</span> : null}
                  {day.gap && !list.length ? (
                    <span className="mw-cal-gap-label">Sem post</span>
                  ) : null}
                </div>
              );
            })}
          </div>
        ))}
      </div>
      {err ? <Notice tone="error">{err}</Notice> : null}
    </Card>
  );
}
