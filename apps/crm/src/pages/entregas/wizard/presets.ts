import { CalendarDays, Clapperboard, Palette, PenLine, Rocket } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { i18n } from '@mesaas/i18n';

export interface WorkflowPresetEtapa {
  nome: string;
  prazo_dias: number;
  tipo_prazo: 'uteis' | 'corridos';
  tipo: 'padrao' | 'aprovacao_cliente';
}

export interface WorkflowPreset {
  id: string;
  nome: string;
  descricao: string;
  icon: LucideIcon;
  recorrente: boolean;
  modo_prazo: 'padrao' | 'data_fixa' | 'data_entrega';
  etapas: WorkflowPresetEtapa[];
}

// Names and descriptions are getters so they resolve in the current UI language when read,
// never frozen at module load. The etapa name is what a new fluxo stores, so it follows the
// language the fluxo is created in.
const tr = (key: string) => i18n.t(`workflows:presets.${key}`);
const p = (
  key: string,
  prazo_dias: number,
  tipo_prazo: 'uteis' | 'corridos' = 'uteis',
): WorkflowPresetEtapa => ({
  get nome() {
    return tr(`etapas.${key}`);
  },
  prazo_dias,
  tipo_prazo,
  tipo: 'padrao',
});
const ap = (key: string, prazo_dias: number): WorkflowPresetEtapa => ({
  get nome() {
    return tr(`etapas.${key}`);
  },
  prazo_dias,
  tipo_prazo: 'corridos',
  tipo: 'aprovacao_cliente',
});

export const STANDARD_PRESETS: WorkflowPreset[] = [
  {
    id: 'posts-mensais',
    get nome() {
      return tr('postsMensais.nome');
    },
    get descricao() {
      return tr('postsMensais.descricao');
    },
    icon: CalendarDays,
    recorrente: true,
    modo_prazo: 'data_entrega',
    etapas: [
      p('criacao', 4),
      p('revisaoInterna', 1),
      ap('aprovacaoCliente', 3),
      p('ajustes', 2),
      p('agendamento', 1),
    ],
  },
  {
    id: 'aprovacao-dupla',
    get nome() {
      return tr('aprovacaoDupla.nome');
    },
    get descricao() {
      return tr('aprovacaoDupla.descricao');
    },
    icon: PenLine,
    recorrente: true,
    modo_prazo: 'padrao',
    etapas: [
      p('redacao', 3),
      ap('aprovacaoTexto', 2),
      p('design', 3),
      ap('aprovacaoArte', 2),
      p('ajustesFinais', 1),
      p('agendamento', 1),
    ],
  },
  {
    id: 'reels-video',
    get nome() {
      return tr('reelsVideo.nome');
    },
    get descricao() {
      return tr('reelsVideo.descricao');
    },
    icon: Clapperboard,
    recorrente: false,
    modo_prazo: 'padrao',
    etapas: [
      p('roteiro', 2),
      p('gravacao', 2),
      p('edicao', 3),
      ap('aprovacaoCliente', 2),
      p('publicacao', 1),
    ],
  },
  {
    id: 'campanha-lancamento',
    get nome() {
      return tr('campanhaLancamento.nome');
    },
    get descricao() {
      return tr('campanhaLancamento.descricao');
    },
    icon: Rocket,
    recorrente: false,
    modo_prazo: 'padrao',
    etapas: [
      p('planejamento', 3),
      p('criativos', 4),
      p('revisao', 1),
      ap('aprovacaoCliente', 2),
      p('veiculacao', 3),
      p('relatorio', 2),
    ],
  },
  {
    id: 'identidade-branding',
    get nome() {
      return tr('identidadeBranding.nome');
    },
    get descricao() {
      return tr('identidadeBranding.descricao');
    },
    icon: Palette,
    recorrente: false,
    modo_prazo: 'padrao',
    etapas: [
      p('pesquisa', 5),
      p('proposta', 5),
      ap('aprovacaoCliente', 3),
      p('refinamento', 4),
      p('entregaFinal', 2),
    ],
  },
];

export function presetDurationDays(preset: WorkflowPreset): number {
  return preset.etapas.reduce((sum, e) => sum + e.prazo_dias, 0);
}
