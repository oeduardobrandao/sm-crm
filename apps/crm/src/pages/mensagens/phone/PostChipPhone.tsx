import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowUpRight, FileText, MessageSquare, Reply } from 'lucide-react';
import { ContextMenu, type ContextMenuAction } from '@/components/mobile/ContextMenu';
import {
  PostPreviewBody,
  postChipHref,
  postDiscussaoHref,
  usePostPreview,
} from '../components/PostChip';

interface Props {
  postId: number;
  workflowId: number | null;
  titulo: string | null;
  /** Bubbles only (the desktop "Responder" link): sets the composer's reply target. */
  onReply?: () => void;
  /** Team-chat blocks: the menu gains "Abrir na discussão do post" and the preview the count. */
  comDiscussao?: boolean;
}

/**
 * Linked-post chip on phones. A tap opens the post; a long-press opens the kit
 * context menu with the desktop hover card as its lifted preview (FMensagensPost) and
 * "Abrir post" / "Responder sobre este post". Preview data loads only while the menu
 * is open, like the desktop card.
 */
export function PostChipPhone({
  postId,
  workflowId,
  titulo,
  onReply,
  comDiscussao = false,
}: Props) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const preview = usePostPreview(postId, open, comDiscussao);
  const href = postChipHref(postId, workflowId);

  const actions: ContextMenuAction[] = [
    {
      label: 'Abrir post',
      icon: <ArrowUpRight aria-hidden="true" />,
      onSelect: () => navigate(href),
    },
  ];
  if (comDiscussao) {
    const discussaoHref = postDiscussaoHref(postId, workflowId);
    actions.push({
      label: 'Abrir na discussão do post',
      icon: <MessageSquare aria-hidden="true" />,
      onSelect: () => navigate(discussaoHref),
    });
  }
  if (onReply) {
    actions.push({
      label: 'Responder sobre este post',
      icon: <Reply aria-hidden="true" />,
      onSelect: onReply,
    });
  }

  return (
    <ContextMenu
      label={`Ações do post ${titulo ?? ''}`.trim()}
      open={open}
      onOpenChange={setOpen}
      className="phone-msg-chip-hold"
      sections={[actions]}
      preview={
        <div className="phone-msg-chip-preview" data-testid="post-phone-preview">
          <PostPreviewBody data={preview} fallbackTitulo={titulo} />
        </div>
      }
    >
      <Link to={href} className="phone-msg-chip">
        <FileText aria-hidden="true" className="phone-msg-chip__icon" />
        <span className="phone-msg-chip__title">{titulo ?? 'Ver post'}</span>
        <ArrowUpRight aria-hidden="true" className="phone-msg-chip__arrow" />
      </Link>
    </ContextMenu>
  );
}
