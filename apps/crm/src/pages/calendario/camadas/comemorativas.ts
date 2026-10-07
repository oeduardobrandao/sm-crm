import type { NicheCalendarDef, NicheEvent } from '../nicheCalendars/types';
import { diaLocal, mesesDoIntervalo } from './recorrencias';
import type { CamadaItem } from './tipos';

/**
 * Where a commemorative date of the niche calendars falls in a given month.
 * `dia`: a concrete day (`data` = local yyyy-MM-dd; `ate` = "DD/MM" closing a
 * range). `mes`: nothing day-shaped ("Outubro", "Junho–Julho", "Semana anterior"):
 * the grid shows it on the 1st of each month it covers.
 */
export type ResolucaoComemorativa = { tipo: 'dia'; data: string; ate?: string } | { tipo: 'mes' };

const pad2 = (n: number) => String(n).padStart(2, '0');
const diasNoMes = (ano: number, mes0: number) => new Date(ano, mes0 + 1, 0).getDate();

/** Lower-case without accents: "Últ. sáb." -> "ult. sab.". º/ª survive NFD. */
const normalizar = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** Easter Sunday (Meeus/Jones/Butcher, Gregorian). */
export function pascoa(ano: number): Date {
  const a = ano % 19;
  const b = Math.floor(ano / 100);
  const c = ano % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(ano, mes - 1, dia);
}

const somarDias = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

const MESES_CURTOS = [
  'jan',
  'fev',
  'mar',
  'abr',
  'mai',
  'jun',
  'jul',
  'ago',
  'set',
  'out',
  'nov',
  'dez',
];
const MESES_LONGOS = [
  'janeiro',
  'fevereiro',
  'marco',
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

/** Weekday tokens of the data. "2ª".."6ª" alone mean segunda..sexta ("Últ. 5ª");
 *  "sem" (week) anchors on the Monday. */
const DIA_DA_SEMANA: Record<string, number> = {
  dom: 0,
  seg: 1,
  ter: 2,
  qua: 3,
  qui: 4,
  sex: 5,
  sab: 6,
  sem: 1,
  '2ª': 1,
  '3ª': 2,
  '4ª': 3,
  '5ª': 4,
  '6ª': 5,
};
const TOKEN_DIA = '(dom|seg|ter|qua|qui|sex|sab|sem|[2-6]ª)';
const TOKEN_MES = `(?:\\s+(${MESES_CURTOS.join('|')})\\.?)?`;

const RE_DIA = /^(\d{1,2})\/(\d{1,2})$/;
const RE_FAIXA = /^(\d{1,2})\s*[–-]\s*(\d{1,2})\/(\d{1,2})$/;
const RE_SEMANA_DE = /^sem\.?\s*(\d{1,2})\/(\d{1,2})$/;
const RE_ORDINAL = new RegExp(`^(\\d)\\s*[ºª]\\s+${TOKEN_DIA}\\.?${TOKEN_MES}$`);
const RE_ULTIMO = new RegExp(`^(?:ultimo|ultima|ult\\.?)\\s+${TOKEN_DIA}\\.?${TOKEN_MES}$`);
const RE_PENULTIMO = new RegExp(
  `^(?:penultimo|penultima|penult\\.?)\\s+${TOKEN_DIA}\\.?${TOKEN_MES}$`,
);
const RE_POS_PASCOA = /^\+(\d+)d? da pascoa/;

/** `n`-th (1-based) weekday `dow` of the month; null when it does not exist. */
function enesimo(ano: number, mes0: number, dow: number, n: number): Date | null {
  const primeiro = new Date(ano, mes0, 1).getDay();
  const dia = 1 + ((dow - primeiro + 7) % 7) + (n - 1) * 7;
  return dia <= diasNoMes(ano, mes0) ? new Date(ano, mes0, dia) : null;
}

/** `n`-th from the end (1 = last) weekday `dow` of the month. */
function enesimoDoFim(ano: number, mes0: number, dow: number, n: number): Date {
  const ultimoDia = diasNoMes(ano, mes0);
  const ultimoDow = new Date(ano, mes0, ultimoDia).getDay();
  return new Date(ano, mes0, ultimoDia - ((ultimoDow - dow + 7) % 7) - (n - 1) * 7);
}

/** Movable feast named by the entry ("Fev/Mar (móvel)" + "Carnaval ..."). */
function festaMovelPeloNome(nome: string, ano: number): Date | null {
  const n = normalizar(nome);
  const p = pascoa(ano);
  if (n.includes('carnaval')) return somarDias(p, -47);
  if (n.includes('cinzas')) return somarDias(p, -46);
  if (n.includes('sexta-feira santa') || n.includes('sexta feira santa') || n.includes('paixao')) {
    return somarDias(p, -2);
  }
  if (n.includes('corpus christi')) return somarDias(p, 60);
  if (n.includes('pascoa')) return p;
  return null;
}

const dia = (d: Date): ResolucaoComemorativa => ({ tipo: 'dia', data: diaLocal(d) });

/** A day/month pair valid in `ano` (29/02 in a common year -> 28/02). */
function diaDoMes(ano: number, dd: number, mm: number): Date | null {
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  return new Date(ano, mm - 1, Math.min(dd, diasNoMes(ano, mm - 1)));
}

/**
 * Resolve one niche entry inside the month card it belongs to (`mes` 1-12).
 * Ordinals and "last" weekdays are relative to that month unless the text names
 * one ("2ª ter. fev."). Never throws: anything unknown is `mes`.
 */
export function resolverDataComemorativa(
  evento: Pick<NicheEvent, 'date' | 'name'>,
  mes: number,
  ano: number,
): ResolucaoComemorativa {
  const texto = normalizar(evento.date);
  const mes0Do = (token: string | undefined) =>
    token ? MESES_CURTOS.indexOf(token) : Math.min(Math.max(mes, 1), 12) - 1;

  let m = RE_DIA.exec(texto);
  if (m) {
    const d = diaDoMes(ano, Number(m[1]), Number(m[2]));
    return d ? dia(d) : { tipo: 'mes' };
  }
  m = RE_FAIXA.exec(texto);
  if (m) {
    const d = diaDoMes(ano, Number(m[1]), Number(m[3]));
    return d
      ? { tipo: 'dia', data: diaLocal(d), ate: `${pad2(Number(m[2]))}/${pad2(Number(m[3]))}` }
      : { tipo: 'mes' };
  }
  m = RE_SEMANA_DE.exec(texto);
  if (m) {
    const d = diaDoMes(ano, Number(m[1]), Number(m[2]));
    return d ? dia(d) : { tipo: 'mes' };
  }
  m = RE_ORDINAL.exec(texto);
  if (m) {
    const d = enesimo(ano, mes0Do(m[3]), DIA_DA_SEMANA[m[2]], Number(m[1]));
    return d ? dia(d) : { tipo: 'mes' };
  }
  m = RE_ULTIMO.exec(texto);
  if (m) return dia(enesimoDoFim(ano, mes0Do(m[2]), DIA_DA_SEMANA[m[1]], 1));
  m = RE_PENULTIMO.exec(texto);
  if (m) return dia(enesimoDoFim(ano, mes0Do(m[2]), DIA_DA_SEMANA[m[1]], 2));

  if (texto === 'pascoa') return dia(pascoa(ano));
  if (texto === 'carnaval') return dia(somarDias(pascoa(ano), -47));
  m = RE_POS_PASCOA.exec(texto);
  if (m) return dia(somarDias(pascoa(ano), Number(m[1])));
  if (texto.includes('(movel)')) {
    const d = festaMovelPeloNome(evento.name, ano);
    return d ? dia(d) : { tipo: 'mes' };
  }
  if (texto === 'seg. pos-bf' || texto === 'seg pos-bf') {
    // Black Friday is the day after the 4th Thursday of November.
    const quinta = enesimo(ano, 10, 4, 4)!;
    return dia(somarDias(quinta, 4));
  }
  return { tipo: 'mes' };
}

/** Months (0-11) a `mes` entry covers: the named months ("Junho–Julho"), else its card. */
function mesesCobertos(texto: string, mes0DoCartao: number): number[] {
  const nomes = normalizar(texto)
    .split(/\s*[–-]\s*/)
    .map((p) => MESES_LONGOS.indexOf(p));
  if (nomes.length === 0 || nomes.some((i) => i < 0)) return [mes0DoCartao];
  const [de, ate] = [nomes[0], nomes[nomes.length - 1]];
  const meses: number[] = [];
  for (let i = de; ; i = (i + 1) % 12) {
    meses.push(i);
    if (i === ate || meses.length === 12) break;
  }
  return meses;
}

/** Weeks keep their "Semana" label wherever they land; anything else unresolved is a month. */
function rotuloDe(tipo: NicheEvent['type'], r: ResolucaoComemorativa): 'dia' | 'mes' | 'semana' {
  if (tipo === 'week') return 'semana';
  return r.tipo === 'mes' ? 'mes' : 'dia';
}

/**
 * Every entry of the niche that falls in [inicio, fim) (`fim` exclusive). Each
 * year of the range resolves all twelve cards, so a range entry reaches the next
 * month and a movable feast listed in two cards (Carnaval in Feb and Mar) shows
 * once (deduped by name and day).
 */
export function expandirComemorativas(
  niche: NicheCalendarDef,
  inicio: Date,
  fim: Date,
): CamadaItem[] {
  const itens: CamadaItem[] = [];
  const vistos = new Set<string>();
  const primeiro = diaLocal(inicio);
  const ultimo = diaLocal(new Date(fim.getTime() - 1));
  const anos = [...new Set(mesesDoIntervalo(inicio, fim).map((x) => x.ano))];

  const adicionar = (e: NicheEvent, data: string, r: ResolucaoComemorativa) => {
    if (data < primeiro || data > ultimo) return;
    const chave = `${e.name}|${data}`;
    if (vistos.has(chave)) return;
    vistos.add(chave);
    itens.push({
      camada: 'comemorativas',
      id: `comemorativas:${niche.key}:${chave}`,
      dia: data,
      nome: e.name,
      tipo: e.type,
      tags: e.tags ?? [],
      rotulo: rotuloDe(e.type, r),
      ...(r.tipo === 'dia' && r.ate ? { ate: r.ate } : {}),
    });
  };

  for (const ano of anos) {
    for (const cartao of niche.data) {
      const mes = parseInt(cartao.num, 10);
      if (isNaN(mes)) continue;
      for (const e of cartao.events) {
        const r = resolverDataComemorativa(e, mes, ano);
        if (r.tipo === 'dia') {
          adicionar(e, r.data, r);
        } else {
          for (const m0 of mesesCobertos(e.date, mes - 1)) {
            adicionar(e, `${ano}-${pad2(m0 + 1)}-01`, r);
          }
        }
      }
    }
  }
  return itens.sort((a, b) => ('dia' in a && 'dia' in b ? a.dia.localeCompare(b.dia) : 0));
}
