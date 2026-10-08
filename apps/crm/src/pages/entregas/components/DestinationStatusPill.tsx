import { PLATFORM_DEFS, PLATFORM_IDS, type PlatformId } from '@mesaas/platforms';
import { PLATFORM_ICONS } from '@/components/platformIcons';
// type-only: PostsKanbanView.test mocks '@/store'.
import type { PostTargetSummary } from '@/store/postTargets';
import {
  DESTINATION_STATE_LABELS,
  resolveDestinationState,
  type DestinationPostFields,
  type DestinationState,
} from '../postDestinations';

// Cor só no ponto; o texto fica em --text-muted para passar AA (o verde e o
// laranja do sistema não passam como cor de texto em fundo claro).
const DOT: Record<DestinationState, string> = {
  pendente: 'var(--text-light)',
  aguardando_aprovacao: 'var(--warning)',
  agendado: 'var(--teal)',
  processando: 'var(--teal)',
  publicado: 'var(--success)',
  falha: 'var(--danger)',
  disponivel: 'var(--success)',
};

export function DestinationStatusPill({
  platform,
  state,
  hideLabelWhenPending = false,
}: {
  platform: PlatformId;
  state: DestinationState;
  hideLabelWhenPending?: boolean;
}) {
  const Icon = PLATFORM_ICONS[platform];
  const label = DESTINATION_STATE_LABELS[state];
  const name = `${PLATFORM_DEFS[platform].label}: ${label}`;
  const showLabel = !(hideLabelWhenPending && state === 'pendente');
  return (
    <span
      aria-label={name}
      title={name}
      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium"
      style={{ background: 'var(--surface-hover)', color: 'var(--text-muted)' }}
    >
      <Icon size={11} aria-hidden="true" style={{ flexShrink: 0 }} />
      {showLabel && <span aria-hidden="true">{label}</span>}
      <span
        aria-hidden="true"
        className="inline-block h-1.5 w-1.5 rounded-full"
        style={{ background: DOT[state] }}
      />
    </span>
  );
}

/** Um chip por destino no card do quadro de Publicações (spec UX 3). */
export function DestinationChips({
  post,
}: {
  post: DestinationPostFields & { targets?: PostTargetSummary[] };
}) {
  if (!post.targets || post.targets.length === 0) return null;
  // Ordena aqui (e não só em mapPostContextRow) para não depender de quem monta o post.
  // Cópia local da ordem do registro: importar sortByPlatformOrder traria o cliente do
  // Supabase para o card.
  const targets = [...post.targets].sort(
    (a, b) => PLATFORM_IDS.indexOf(a.platform) - PLATFORM_IDS.indexOf(b.platform),
  );
  return (
    <span
      data-testid="destination-chips"
      style={{ display: 'inline-flex', flexWrap: 'wrap', gap: '0.25rem', marginTop: '0.25rem' }}
    >
      {targets.map((t) => (
        <DestinationStatusPill
          key={t.platform}
          platform={t.platform}
          state={resolveDestinationState(post, t)}
          hideLabelWhenPending
        />
      ))}
    </span>
  );
}
