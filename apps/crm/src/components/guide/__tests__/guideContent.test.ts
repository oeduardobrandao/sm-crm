import { describe, expect, it } from 'vitest';
import { GUIDE_TRAILS, allPages, filterTrails, requiredSignals } from '../guideContent';

const ALL_ON = () => true;

describe('guideContent', () => {
  it('tem 3 trilhas com 5, 4 e 6 páginas (15 no total)', () => {
    expect(GUIDE_TRAILS.map((t) => t.pages.length)).toEqual([5, 4, 6]);
    expect(allPages(GUIDE_TRAILS)).toHaveLength(15);
  });

  it('todos os ids de página são únicos', () => {
    const ids = allPages(GUIDE_TRAILS).map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('sem feature_hub_portal a página do hub sai e o total vira 14', () => {
    const trails = filterTrails((flag) => flag !== 'feature_hub_portal');
    expect(allPages(trails)).toHaveLength(14);
    expect(allPages(trails).some((p) => p.id === 't1p4')).toBe(false);
  });

  it('sinais exigidos derivam da trilha filtrada (hub fora sem a flag)', () => {
    expect(requiredSignals(filterTrails(ALL_ON))).toEqual([
      'hasCliente',
      'hasInstagram',
      'hasHubToken',
      'hasMembro',
      'hasWorkflow',
    ]);
    expect(requiredSignals(filterTrails((f) => f !== 'feature_hub_portal'))).not.toContain(
      'hasHubToken',
    );
  });

  it('deep links por cliente caem em /clientes sem cliente', () => {
    const pages = allPages(GUIDE_TRAILS);
    const ig = pages.find((p) => p.id === 't1p3')!;
    expect(ig.action!.to({ latestClienteId: 7 })).toBe('/clientes/7/redes-sociais');
    expect(ig.action!.to({ latestClienteId: null })).toBe('/clientes');
    const hub = pages.find((p) => p.id === 't1p4')!;
    expect(hub.action!.to({ latestClienteId: 7 })).toBe('/clientes/7/hub');
  });

  it('cópia visível não usa em-dash', () => {
    for (const p of allPages(GUIDE_TRAILS)) {
      expect(p.title, p.id).not.toContain('—');
      expect(p.lead, p.id).not.toContain('—');
    }
  });

  it('pontes e conclusão estão nas últimas páginas', () => {
    expect(GUIDE_TRAILS[0].pages[4].bridgeTo).toBe('t2');
    expect(GUIDE_TRAILS[1].pages[3].bridgeTo).toBe('t3');
    expect(GUIDE_TRAILS[2].pages[5].conclude).toBe(true);
  });
});
