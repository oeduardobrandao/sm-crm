import type { Lead } from '@/store';

/** Lead statuses in pipeline order; labels come from `common:status.*`. */
export const LEAD_STATUS_KEYS = [
  'novo',
  'contatado',
  'qualificado',
  'perdido',
  'convertido',
] as const satisfies readonly Lead['status'][];

/** Canal values stored on a lead; labels come from `leads:channels.*`. */
export const CANAL_KEYS = [
  'Instagram',
  'Facebook',
  'Google Ads',
  'Indicação',
  'Site',
  'WhatsApp',
  'Typeform',
  'Outro',
] as const;

/** Faturamento ranges; labels come from `leads:revenue.*`, the stored value is the pt string. */
export const FATURAMENTO_KEYS = ['upTo5k', '5kTo10k', '10kTo20k', '20kTo50k', 'above50k'] as const;
export const FATURAMENTO_DB_VALUES: Record<string, string> = {
  upTo5k: 'Até R$ 5.000/mês',
  '5kTo10k': 'De R$ 5.000 a R$ 10.000/mês',
  '10kTo20k': 'De R$ 10.000 a R$ 20.000/mês',
  '20kTo50k': 'De R$ 20.000 a R$ 50.000/mês',
  above50k: 'Acima de R$ 50.000/mês',
};
