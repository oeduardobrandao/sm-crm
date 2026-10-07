import type { EventInput } from '@fullcalendar/core';
import { addMinutes } from 'date-fns';
import { formatFinancialBRL } from '@/lib/financialAccess';
import { dotColorMap } from '../nicheCalendars/types';
import {
  CAMADA_COR,
  CAMADA_ORDEM,
  COR_DATA_IMPORTANTE,
  COR_PRAZO_ESTOURADO,
  type CamadaItem,
} from './tipos';

/** Visual length of a post in the week/day grids (a post is an instant). */
export const DURACAO_POST_MIN = 30;

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

/** Prefix "Semana: " / "Mês: " unless the name already starts with it. */
function comRotulo(prefixo: string, nome: string): string {
  return nome.toLowerCase().startsWith(prefixo.toLowerCase()) ? nome : `${prefixo}: ${nome}`;
}

/** Chip title of a layer item (also the list view text). */
export function tituloDaCamada(item: CamadaItem): string {
  switch (item.camada) {
    case 'posts':
      return item.post.titulo?.trim() || `Post de ${item.post.cliente_nome || 'cliente'}`;
    case 'prazos':
      return item.prazo.clienteId !== null
        ? `${item.prazo.etapaNome} · ${item.prazo.clienteNome}`
        : item.prazo.etapaNome;
    case 'recebimentos':
    case 'pagamentos': {
      const total = item.itens.reduce((s, i) => s + (Number(i.valor) || 0), 0);
      const contagem =
        item.camada === 'recebimentos'
          ? plural(item.itens.length, 'recebimento', 'recebimentos')
          : plural(item.itens.length, 'pagamento', 'pagamentos');
      return `${contagem} · ${formatFinancialBRL(total, true)}`;
    }
    case 'datas':
      return item.cliente.nome ? `${item.titulo} · ${item.cliente.nome}` : item.titulo;
    case 'comemorativas':
      if (item.rotulo === 'mes') return comRotulo('Mês', item.nome);
      if (item.rotulo === 'semana') return comRotulo('Semana', item.nome);
      return item.nome;
  }
}

/** Ink of the item: the layer colour, red for an overdue deadline, the niche
 *  type colour for commemorative dates, indigo for an important client date. */
export function corDaCamada(item: CamadaItem): string {
  if (item.camada === 'prazos' && item.prazo.estourado) return COR_PRAZO_ESTOURADO;
  if (item.camada === 'comemorativas') return dotColorMap[item.tipo] ?? CAMADA_COR.comemorativas;
  if (item.camada === 'datas' && item.tipo === 'data') return COR_DATA_IMPORTANTE;
  return CAMADA_COR[item.camada];
}

/**
 * FullCalendar input of a layer item. Read-only (`editable: false`), styled apart
 * from Agenda events (`agenda-camada`, never `agenda-ev`), and identified by
 * `extendedProps.camada` so clicks and drags dispatch on it. Ids are prefixed so
 * they never collide with occurrence ids in `data-ocorrencia-id`.
 */
export function toCamadaEventInput(item: CamadaItem): EventInput {
  const classNames = ['agenda-camada', `agenda-camada--${item.camada}`];
  if (item.camada === 'prazos' && item.prazo.estourado) classNames.push('agenda-camada--atrasado');
  const cor = corDaCamada(item);
  const base = {
    id: `camada:${item.id}`,
    title: tituloDaCamada(item),
    editable: false,
    startEditable: false,
    durationEditable: false,
    classNames,
    backgroundColor: 'var(--card-bg)',
    borderColor: cor,
    textColor: 'var(--text-main)',
    extendedProps: { camada: item, ordem: CAMADA_ORDEM[item.camada] },
  };
  if (item.camada === 'posts') {
    const inicio = new Date(item.inicio);
    return { ...base, start: inicio, end: addMinutes(inicio, DURACAO_POST_MIN), allDay: false };
  }
  return { ...base, start: item.dia, allDay: true };
}
