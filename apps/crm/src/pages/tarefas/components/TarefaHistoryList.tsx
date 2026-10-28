import {
  Building2,
  CalendarClock,
  CircleCheck,
  CircleDot,
  FileText,
  ListMinus,
  ListPlus,
  Plus,
  Repeat,
  RotateCcw,
  SquareCheck,
  Tag,
  Type,
  UserRound,
  type LucideIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useIntlLocale } from '@mesaas/i18n';
import type { TarefaEventoTipo } from '../../../store';
import type { TarefaTimelineNode, TarefaTimelineTone } from '../tarefaTimeline';

/** Onto the existing `.history-step-icon--*` / `.history-step-line--*` classes (app.css). */
const TONE_CLASS: Record<TarefaTimelineTone, string> = {
  success: 'ok',
  warning: 'late',
  info: 'published',
  primary: 'approved',
  neutral: 'neutral',
};

const TIPO_ICON: Record<TarefaEventoTipo, LucideIcon> = {
  criada: Plus,
  status: CircleDot,
  responsavel: UserRound,
  prazo: CalendarClock,
  titulo: Type,
  descricao: FileText,
  cliente: Building2,
  recorrencia: Repeat,
  subtarefa_adicionada: ListPlus,
  subtarefa_concluida: SquareCheck,
  subtarefa_reaberta: RotateCcw,
  subtarefa_removida: ListMinus,
  tag_adicionada: Tag,
  tag_removida: Tag,
};

function iconOf(node: TarefaTimelineNode): LucideIcon {
  if (node.tipo === 'status' && node.tone === 'success') return CircleCheck;
  return TIPO_ICON[node.tipo];
}

export function TarefaHistoryList({ nodes }: { nodes: TarefaTimelineNode[] }) {
  const { t } = useTranslation('tasksForm');
  const locale = useIntlLocale();
  const short = (iso: string) =>
    new Date(iso).toLocaleString(locale, {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  const full = (iso: string) =>
    new Date(iso).toLocaleString(locale, {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

  return (
    <div>
      {nodes.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('historico.empty')}</p>
      ) : (
        <ol className="history-timeline">
          {nodes.map((node, i) => {
            const tone = TONE_CLASS[node.tone];
            const Icon = iconOf(node);
            return (
              <li key={node.key} className="history-step">
                <div className="history-step-track">
                  <div className={`history-step-icon history-step-icon--${tone}`}>
                    <Icon className="h-3 w-3" aria-hidden="true" />
                  </div>
                  {i < nodes.length - 1 && (
                    <div className={`history-step-line history-step-line--${tone}`} />
                  )}
                </div>
                <div className="history-step-body">
                  <div className="history-step-name">{node.text}</div>
                  <div className="history-step-detail">
                    <time dateTime={node.at} title={full(node.at)}>
                      {short(node.at)}
                    </time>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}
      <p className="mt-1 text-xs text-muted-foreground">{t('historico.footnote')}</p>
    </div>
  );
}
