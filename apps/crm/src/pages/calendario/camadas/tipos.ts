import type { ScheduledPost } from '../../../store';
import type { PostPublishState } from '../../entregas/postLabels';
import type { NicheEvent } from '../nicheCalendars/types';
import type { DeadlineEvent } from './prazos';

/** Read-only overlays of the Agenda (spec §1). */
export type CamadaId =
  | 'posts'
  | 'prazos'
  | 'recebimentos'
  | 'pagamentos'
  | 'datas'
  | 'comemorativas';

/** One recurring receivable or team payment of a day. */
export interface CamadaPagamento {
  nome: string;
  valor: number;
  pago: boolean;
  /** `referencia_agendamento` of the transaction that marks it paid. */
  referencia: string;
  alvo: { tipo: 'cliente' | 'membro'; id: number };
  /** The configured day does not exist in that month (31 in February). */
  ajustado: boolean;
  /** Configured day of the month, shown when `ajustado`. */
  diaConfigurado: number;
}

export type CamadaItem =
  | { camada: 'posts'; id: string; inicio: string; post: ScheduledPost; estado: PostPublishState }
  | { camada: 'prazos'; id: string; dia: string; prazo: DeadlineEvent }
  | {
      camada: 'recebimentos' | 'pagamentos';
      id: string;
      dia: string;
      itens: CamadaPagamento[];
    }
  | {
      camada: 'datas';
      id: string;
      dia: string;
      tipo: 'aniversario' | 'data';
      titulo: string;
      cliente: { id: number; nome: string };
    }
  | {
      camada: 'comemorativas';
      id: string;
      dia: string;
      nome: string;
      tipo: NicheEvent['type'];
      tags: string[];
      rotulo: 'dia' | 'mes' | 'semana';
      /** Last day of a range entry ("01–07/08" → "07/08"). */
      ate?: string;
    };

export type CamadasAtivas = Record<CamadaId, boolean>;

/** Sidebar order. */
export const CAMADAS: CamadaId[] = [
  'posts',
  'prazos',
  'recebimentos',
  'pagamentos',
  'datas',
  'comemorativas',
];

export const CAMADAS_FINANCEIRAS: ReadonlySet<CamadaId> = new Set(['recebimentos', 'pagamentos']);

export const CAMADA_ROTULO: Record<CamadaId, string> = {
  posts: 'Posts agendados',
  prazos: 'Prazos de entrega',
  recebimentos: 'Recebimentos',
  pagamentos: 'Pagamentos da equipe',
  datas: 'Datas dos clientes',
  comemorativas: 'Datas comemorativas',
};

/** Layer ink: swatch in the sidebar and the dashed border of its chips. */
export const CAMADA_COR: Record<CamadaId, string> = {
  posts: '#0ea5e9',
  prazos: '#a855f7',
  recebimentos: '#22c55e',
  pagamentos: '#f97316',
  datas: '#ec4899',
  comemorativas: '#eab308',
};

export const COR_PRAZO_ESTOURADO = '#ef4444';
export const COR_DATA_IMPORTANTE = '#6366f1';

/** Position inside a day (FullCalendar `eventOrder`): Agenda events first. */
export const ORDEM_AGENDA = 0;
export const CAMADA_ORDEM: Record<CamadaId, number> = {
  posts: 1,
  prazos: 2,
  recebimentos: 3,
  pagamentos: 3,
  datas: 4,
  comemorativas: 5,
};
