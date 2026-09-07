import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Regressão do incidente de produção de 2026-09-02: o combo do Ritmo de
// entrega usa um dataset type:'line' dentro de <Bar>, e o RitmoChart não
// registrava o LineController -> `"line" is not a registered controller` só
// no bundle de produção. Em dev (e neste ambiente de teste) importar
// react-chartjs-2 registra todos os controllers como efeito colateral dos
// componentes tipados; o tree-shaking do build remove o export `Line` não
// usado e leva o registro junto. Por isso um teste de registry passa aqui
// mesmo com o bug: a única guarda honesta em jsdom é exigir o registro
// EXPLÍCITO no código-fonte da seção (a verificação executável fica no
// build de produção, ver o runbook do incidente na memória do projeto).
const SECTIONS = join(__dirname, '..', 'sections');

function fonte(nome: string): string {
  return readFileSync(join(SECTIONS, nome), 'utf8');
}

describe('registro explícito de controllers do Chart.js nas seções', () => {
  it('RitmoChart importa e registra o LineController do dataset type:line', () => {
    const src = fonte('RitmoChart.tsx');
    expect(src).toMatch(/LineController/);
    expect(src).toMatch(/ChartJS\.register\(([^)]*\n)*[^)]*LineController/);
  });

  it('RitmoChart e AprovacaoSection registram o BarController explicitamente', () => {
    for (const nome of ['RitmoChart.tsx', 'AprovacaoSection.tsx']) {
      const src = fonte(nome);
      expect(src, nome).toMatch(/ChartJS\.register\(([^)]*\n)*[^)]*BarController/);
    }
  });
});
