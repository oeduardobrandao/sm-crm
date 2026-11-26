import { describe, expect, it } from 'vitest';
import { ACQUISITION_CHANNELS, channelLabel, channelTone } from '../acquisition-channels';

const EXPECTED: Record<string, string> = {
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

describe('acquisition-channels', () => {
  it('lists every channel in report order', () => {
    expect(ACQUISITION_CHANNELS).toEqual(Object.keys(EXPECTED));
  });

  it.each(Object.entries(EXPECTED))('labels %s as %s', (key, label) => {
    expect(channelLabel(key)).toBe(label);
  });

  it('reads null as Sem dados and an unknown string as Outros sites', () => {
    expect(channelLabel(null)).toBe('Sem dados');
    expect(channelLabel(undefined)).toBe('Sem dados');
    expect(channelLabel('tiktok_ads')).toBe('Outros sites');
  });

  it('gives every channel a tone', () => {
    for (const c of ACQUISITION_CHANNELS) {
      expect(['primary', 'info', 'success', 'warning', 'neutral']).toContain(channelTone(c));
    }
  });
});
