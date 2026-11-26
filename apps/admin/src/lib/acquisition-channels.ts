/**
 * Acquisition channels of a workspace (where the signup came from), as classified by the
 * backend (`workspace_acquisition`). The order of ACQUISITION_CHANNELS is the order of the
 * filter and of the Métricas report.
 */
export type AcquisitionChannel =
  | 'meta_ads'
  | 'google_ads'
  | 'chatgpt_ads'
  | 'other_ads'
  | 'instagram'
  | 'other_social'
  | 'search'
  | 'ai'
  | 'email'
  | 'affiliate'
  | 'other_sites'
  | 'direct'
  | 'unknown'
  | 'demo'
  | 'no_data';

export const ACQUISITION_CHANNELS: readonly AcquisitionChannel[] = [
  'meta_ads',
  'google_ads',
  'chatgpt_ads',
  'other_ads',
  'instagram',
  'other_social',
  'search',
  'ai',
  'email',
  'affiliate',
  'other_sites',
  'direct',
  'unknown',
  'demo',
  'no_data',
];

const LABELS: Record<AcquisitionChannel, string> = {
  meta_ads: 'Meta Ads',
  google_ads: 'Google Ads',
  chatgpt_ads: 'ChatGPT Ads',
  other_ads: 'Outros anúncios',
  instagram: 'Instagram (orgânico)',
  other_social: 'Outras redes',
  search: 'Busca orgânica',
  ai: 'IA (ChatGPT, Claude…)',
  email: 'E-mail',
  affiliate: 'Afiliado',
  other_sites: 'Outros sites',
  direct: 'Direto',
  unknown: 'Não capturado',
  demo: 'Demo (vendas)',
  no_data: 'Sem dados',
};

export function isAcquisitionChannel(value: unknown): value is AcquisitionChannel {
  return typeof value === 'string' && (ACQUISITION_CHANNELS as readonly string[]).includes(value);
}

/** An unrecognised string (a classifier value newer than this build) reads as "Outros sites". */
export function channelLabel(c: AcquisitionChannel | string | null | undefined): string {
  if (c === null || c === undefined) return LABELS.no_data;
  return isAcquisitionChannel(c) ? LABELS[c] : LABELS.other_sites;
}

export type ChannelTone = 'primary' | 'info' | 'success' | 'warning' | 'neutral';

const TONES: Record<AcquisitionChannel, ChannelTone> = {
  meta_ads: 'primary',
  google_ads: 'primary',
  chatgpt_ads: 'primary',
  other_ads: 'primary',
  instagram: 'info',
  other_social: 'info',
  search: 'success',
  ai: 'success',
  email: 'warning',
  affiliate: 'warning',
  other_sites: 'neutral',
  direct: 'neutral',
  unknown: 'neutral',
  demo: 'neutral',
  no_data: 'neutral',
};

/** Badge variant for a channel. */
export function channelTone(c: AcquisitionChannel): ChannelTone {
  return TONES[c] ?? 'neutral';
}
