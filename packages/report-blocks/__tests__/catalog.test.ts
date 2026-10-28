import { describe, expect, it } from 'vitest';
import { WIDGET_CATALOG, WIDGET_CATEGORIES } from '../catalog';
import { BLOCK_TYPES, blockPlatform } from '../types';

describe('WIDGET_CATALOG', () => {
  it('cobre todos os tipos de bloco, sem duplicatas', () => {
    const types = WIDGET_CATALOG.map((w) => w.type);
    expect(new Set(types).size).toBe(types.length);
    // `section` não é widget: seções vêm do menu de seção, não do drawer.
    const widgetTypes = BLOCK_TYPES.filter((t) => t !== 'section');
    expect([...types].sort()).toEqual([...widgetTypes].sort());
  });

  it('toda entrada tem label pt-BR não vazio e categoria válida', () => {
    for (const w of WIDGET_CATALOG) {
      expect(w.label.length).toBeGreaterThan(0);
      expect(w.label).not.toContain('—');
      expect(WIDGET_CATEGORIES).toContain(w.category);
    }
  });

  it('catalog: every entry carries a platform; Instagram data, tiktok_* tiktok, neutral null', () => {
    for (const w of WIDGET_CATALOG) {
      expect(Object.prototype.hasOwnProperty.call(w, 'platform'), w.type).toBe(true);
      expect(w.platform, w.type).toBe(blockPlatform(w.type));
      if (w.type.startsWith('tiktok_')) expect(w.platform, w.type).toBe('tiktok');
      if (['Texto', 'Mídia', 'Estrutura'].includes(w.category))
        expect(w.platform, w.type).toBe(null);
    }
    expect(WIDGET_CATALOG.find((w) => w.type === 'kpi_reach')?.platform).toBe('instagram');
  });

  it('entradas TikTok com os rótulos do relatório', () => {
    const label = (t: string) => WIDGET_CATALOG.find((w) => w.type === t)?.label;
    expect(label('tiktok_kpi_engagement_rate')).toBe('Engajamento por visualização');
    expect(label('tiktok_kpi_posts_count')).toBe('Vídeos publicados');
    expect(label('tiktok_kpi_likes_total')).toBe('Curtidas totais do perfil');
    expect(label('tiktok_chart_followers')).toBe('Crescimento de seguidores');
    expect(label('tiktok_chart_best_times')).toBe('Melhor horário para postar');
    expect(label('tiktok_top_posts')).toBe('Vídeos em destaque');
    expect(label('tiktok_post_list')).toBe('Lista de vídeos');
  });

  it('a ordem de categorias começa em Números e termina em Estrutura', () => {
    expect(WIDGET_CATEGORIES[0]).toBe('Números');
    expect(WIDGET_CATEGORIES[WIDGET_CATEGORIES.length - 1]).toBe('Estrutura');
  });
});
