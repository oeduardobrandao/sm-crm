export function greetingKey(hour: number): 'morning' | 'afternoon' | 'evening' {
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 18) return 'afternoon';
  return 'evening';
}

/** "Quinta, 8 de outubro" / "Thursday, October 8". */
export function formatEyebrowDate(d: Date, lang: string): string {
  if (lang.startsWith('en')) {
    return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  }
  const weekday = d.toLocaleDateString('pt-BR', { weekday: 'long' }).replace(/-feira$/, '');
  const dayMonth = d.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long' });
  return `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)}, ${dayMonth}`;
}

/** Start of next Monday in the browser's zone (the zone the Hub calendar groups days in). */
export function startOfNextMonday(now: Date): Date {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  const add = (8 - d.getDay()) % 7 || 7;
  d.setDate(d.getDate() + add);
  return d;
}

export function weekCount(
  posts: { status: string; scheduled_at: string | null }[],
  now: Date,
): number {
  const start = now.getTime();
  const end = startOfNextMonday(now).getTime();
  return posts.filter((p) => {
    if (p.status !== 'agendado' && p.status !== 'aprovado_cliente') return false;
    if (!p.scheduled_at) return false;
    const t = Date.parse(p.scheduled_at);
    return t >= start && t < end;
  }).length;
}

/** Section numbers from what Home knows synchronously; Results is always last. */
export function numberSections(hasPending: boolean, hasAgenda: boolean) {
  let n = 0;
  const approvals = hasPending ? ++n : null;
  const calendar = ++n;
  const agenda = hasAgenda ? ++n : null;
  const resources = ++n;
  const results = ++n;
  return { approvals, calendar, agenda, resources, results };
}

export { pad2 } from '../../lib/pad2';
