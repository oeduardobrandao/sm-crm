import { CalendarDays, Clapperboard, Palette, PenLine, Rocket } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

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

const p = (
  nome: string,
  prazo_dias: number,
  tipo_prazo: 'uteis' | 'corridos' = 'uteis',
): WorkflowPresetEtapa => ({ nome, prazo_dias, tipo_prazo, tipo: 'padrao' });
const ap = (nome: string, prazo_dias: number): WorkflowPresetEtapa => ({
  nome,
  prazo_dias,
  tipo_prazo: 'corridos',
  tipo: 'aprovacao_cliente',
});

export const STANDARD_PRESETS: WorkflowPreset[] = [
  {
    id: 'posts-mensais',
    nome: 'Posts mensais',
    descricao: 'O ciclo mensal clássico: criação, revisão e aprovação do cliente.',
    icon: CalendarDays,
    recorrente: true,
    modo_prazo: 'data_entrega',
    etapas: [
      p('Criação', 4),
      p('Revisão interna', 1),
      ap('Aprovação do cliente', 3),
      p('Ajustes', 2),
      p('Agendamento', 1),
    ],
  },
  {
    id: 'aprovacao-dupla',
    nome: 'Aprovação dupla (texto + arte)',
    descricao: 'O cliente aprova o texto antes do design e a arte antes dos ajustes finais.',
    icon: PenLine,
    recorrente: true,
    modo_prazo: 'padrao',
    etapas: [
      p('Redação', 3),
      ap('Aprovação do texto', 2),
      p('Design', 3),
      ap('Aprovação da arte', 2),
      p('Ajustes finais', 1),
      p('Agendamento', 1),
    ],
  },
  {
    id: 'reels-video',
    nome: 'Reels / vídeo',
    descricao: 'Do roteiro à publicação, com aprovação do cliente antes de publicar.',
    icon: Clapperboard,
    recorrente: false,
    modo_prazo: 'padrao',
    etapas: [
      p('Roteiro', 2),
      p('Gravação', 2),
      p('Edição', 3),
      ap('Aprovação do cliente', 2),
      p('Publicação', 1),
    ],
  },
  {
    id: 'campanha-lancamento',
    nome: 'Campanha / lançamento',
    descricao: 'Planejamento, criativos, veiculação e relatório final.',
    icon: Rocket,
    recorrente: false,
    modo_prazo: 'padrao',
    etapas: [
      p('Planejamento', 3),
      p('Criativos', 4),
      p('Revisão', 1),
      ap('Aprovação do cliente', 2),
      p('Veiculação', 3),
      p('Relatório', 2),
    ],
  },
  {
    id: 'identidade-branding',
    nome: 'Identidade / branding',
    descricao: 'Pesquisa, proposta, aprovação e entrega final.',
    icon: Palette,
    recorrente: false,
    modo_prazo: 'padrao',
    etapas: [
      p('Pesquisa', 5),
      p('Proposta', 5),
      ap('Aprovação do cliente', 3),
      p('Refinamento', 4),
      p('Entrega final', 2),
    ],
  },
];

export function presetDurationDays(preset: WorkflowPreset): number {
  return preset.etapas.reduce((sum, e) => sum + e.prazo_dias, 0);
}
