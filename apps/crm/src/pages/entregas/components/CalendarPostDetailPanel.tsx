import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { parseISO, format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  X,
  Calendar as CalendarIcon,
  Folder,
  User,
  ExternalLink,
  Trash2,
  Lock,
  Film,
  Image as ImageIcon,
} from 'lucide-react';
import { getPostPreview, type ClientePost, type Membro } from '@/store';
import { listPostMedia } from '@/services/postMedia';
import { DateTimePicker } from '@/components/ui/date-time-picker';
import { sanitizeUrl } from '@/utils/security';
import { CopyPostLinkButton } from '@/components/CopyPostLinkButton';
import { TIPO_LABELS, TIPO_COLORS, TIPO_LEGEND, type DayMarker } from '../postLabels';
import { useStatusRegistry } from '@/hooks/useStatusRegistry';
import { PostStatusChip } from './PostStatusChip';

export interface CalendarPostDetailPanelProps {
  post: ClientePost;
  hubUrl?: string;
  membros: Membro[];
  isCurrentWorkflow: boolean;
  isLocked: boolean;
  lockReason?: string;
  dayMarkers?: Map<string, DayMarker>;
  onClose: () => void;
  onReschedule: (date: Date) => void;
  onRemoveDate: () => void;
  onOpenPost: () => void;
}

export function CalendarPostDetailPanel({
  post,
  hubUrl,
  membros,
  isCurrentWorkflow,
  isLocked,
  lockReason,
  dayMarkers,
  onClose,
  onReschedule,
  onRemoveDate,
  onOpenPost,
}: CalendarPostDetailPanelProps) {
  const navigate = useNavigate();

  const { data: preview } = useQuery({
    queryKey: ['post-preview', post.id],
    queryFn: () => getPostPreview(post.id),
  });

  const { data: media = [] } = useQuery({
    queryKey: ['post-media', post.id],
    queryFn: () => listPostMedia(post.id),
  });

  const cover = media.find((m) => m.is_cover) ?? media[0] ?? null;
  const thumbUrl = cover?.thumbnail_url ?? cover?.url ?? null;

  const responsavel =
    preview?.responsavel_id != null
      ? (membros.find((m) => m.id === preview.responsavel_id)?.nome ?? null)
      : null;

  const statusRegistry = useStatusRegistry();
  const scheduled = post.scheduled_at ? parseISO(post.scheduled_at) : null;
  const excerpt = (preview?.conteudo_plain ?? '').trim();
  // A post avulso has no workflow to name -- 'Avulso' fills the slot instead of
  // rendering blank next to the Folder icon.
  const isAvulso = post.workflow_id === null;
  const workflowLabel = post.workflow_titulo ?? 'Avulso';
  // Rescheduling follows lock status only; removing a date stays own-workflow, because the
  // calendar sidebar only lists this workflow's backlog. An avulso post has no own-workflow
  // slot to remove the date from here -- it goes through the standalone publication instead.
  const canReschedule = !isLocked;
  const canRemoveDate = isCurrentWorkflow && !isLocked;
  const permalink =
    post.status === 'postado' && preview?.instagram_permalink
      ? sanitizeUrl(preview.instagram_permalink)
      : null;

  return (
    <aside className="calendar-detail-panel" role="dialog" aria-label="Detalhes do post">
      <div className="calendar-detail-head">
        <div className="calendar-detail-head-info">
          <span className="calendar-detail-eyebrow">Detalhes do post</span>
          <span className="post-tipo-badge">{TIPO_LABELS[post.tipo]}</span>
          <h3 className="calendar-detail-title">{post.titulo || 'Post sem título'}</h3>
        </div>
        <button
          className="calendar-detail-close"
          onClick={onClose}
          title="Fechar"
          aria-label="Fechar painel"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="calendar-detail-body">
        <PostStatusChip post={post} registry={statusRegistry} />

        <div className="calendar-detail-meta">
          <div className="calendar-detail-meta-row">
            <CalendarIcon className="h-4 w-4" />
            <span className="calendar-detail-mono">
              {scheduled
                ? format(scheduled, "dd MMM yyyy '·' HH:mm", { locale: ptBR })
                : 'A definir'}
            </span>
          </div>
          <div className="calendar-detail-meta-row">
            <Folder className="h-4 w-4" />
            <span>{workflowLabel}</span>
          </div>
          <div className="calendar-detail-meta-row">
            <User className="h-4 w-4" />
            <span>{responsavel ?? 'Sem responsável'}</span>
          </div>
        </div>

        <div className="calendar-detail-section">
          <div className="calendar-detail-section-label">Conteúdo</div>
          <div className="calendar-detail-preview">
            {thumbUrl ? (
              <img className="calendar-detail-thumb" src={thumbUrl} alt="" />
            ) : (
              <div
                className="calendar-detail-thumb calendar-detail-thumb--empty"
                style={{ background: TIPO_COLORS[post.tipo] }}
              >
                {post.tipo === 'reels' ? (
                  <Film className="h-5 w-5" />
                ) : (
                  <ImageIcon className="h-5 w-5" />
                )}
              </div>
            )}
            <p className="calendar-detail-excerpt">{excerpt || 'Sem conteúdo ainda.'}</p>
          </div>
          {preview?.ig_caption ? (
            <div className="calendar-detail-caption">
              <div className="calendar-detail-section-label">Legenda</div>
              <p>{preview.ig_caption}</p>
            </div>
          ) : null}
        </div>

        {!isCurrentWorkflow && (
          <div className="calendar-detail-note">
            {isAvulso ? 'Post avulso, sem fluxo.' : `Pertence ao workflow «${workflowLabel}»`}
          </div>
        )}

        {canReschedule && (
          <div className="calendar-detail-section">
            <div className="calendar-detail-section-label">Reagendar</div>
            <DateTimePicker
              value={scheduled ?? undefined}
              onChange={(date) => date && onReschedule(date)}
              futureOnly
              className="w-full"
              dayMarkers={dayMarkers}
              dayMarkerLegend={TIPO_LEGEND}
            />
          </div>
        )}

        {isCurrentWorkflow && isLocked && lockReason && (
          <div className="calendar-detail-note calendar-detail-note--lock">
            <Lock className="h-3.5 w-3.5" /> {lockReason}
          </div>
        )}
      </div>

      <div className="calendar-detail-foot">
        {permalink && (
          <a
            className="calendar-detail-btn calendar-detail-btn--primary"
            href={sanitizeUrl(permalink)}
            target="_blank"
            rel="noopener noreferrer"
          >
            <ExternalLink className="h-4 w-4" /> Ver no Instagram
          </a>
        )}
        {isCurrentWorkflow && (
          <button className="calendar-detail-btn calendar-detail-btn--primary" onClick={onOpenPost}>
            <ExternalLink className="h-4 w-4" /> Abrir post completo
          </button>
        )}
        {isAvulso && (
          <button
            className="calendar-detail-btn calendar-detail-btn--primary"
            onClick={() => navigate(`/entregas?post=${post.id}`)}
          >
            <ExternalLink className="h-4 w-4" /> Abrir publicação
          </button>
        )}
        <CopyPostLinkButton hubUrl={hubUrl} postId={post.id} />
        {canRemoveDate && (
          <button
            className="calendar-detail-btn calendar-detail-btn--danger"
            onClick={onRemoveDate}
          >
            <Trash2 className="h-4 w-4" /> Remover data
          </button>
        )}
      </div>
    </aside>
  );
}
