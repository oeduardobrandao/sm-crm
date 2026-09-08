import { useEffect, useState, type MouseEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { MentionText } from '@/components/mentions/MentionText';
import { mentionHref } from '@/components/mentions/mentionHref';
import type { MentionEntityType } from '@/components/mentions/types';
import { ReadOnlyTipTap } from '@/pages/entregas/components/ReadOnlyTipTap';
import { extractR2Keys, injectSignedUrls, resolveInlineImageUrls } from '@/services/inlineImage';
import type { TarefaDescriptionDoc } from '../tarefaDescription';

interface TarefaDescriptionContentProps {
  richContent: TarefaDescriptionDoc | null | undefined;
  plainText: string | null | undefined;
}

export function TarefaDescriptionContent({
  richContent,
  plainText,
}: TarefaDescriptionContentProps) {
  const navigate = useNavigate();
  const [resolvedContent, setResolvedContent] = useState<TarefaDescriptionDoc | null>(
    richContent ?? null,
  );
  const [ready, setReady] = useState(() => !richContent || extractR2Keys(richContent).length === 0);

  useEffect(() => {
    setResolvedContent(richContent ?? null);
    if (!richContent) {
      setReady(true);
      return;
    }
    const keys = extractR2Keys(richContent);
    if (keys.length === 0) {
      setReady(true);
      return;
    }

    let cancelled = false;
    setReady(false);
    resolveInlineImageUrls(keys)
      .then((urls) => {
        if (!cancelled) setResolvedContent(injectSignedUrls(richContent, urls));
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [richContent]);

  if (!ready) return <div className="text-sm text-muted-foreground">Carregando descrição...</div>;
  if (resolvedContent) {
    const handleMentionClick = (event: MouseEvent<HTMLDivElement>) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const mention = target.closest<HTMLElement>('span[data-mention]');
      if (!mention) return;
      const id = Number(mention.dataset.id);
      if (!Number.isFinite(id)) return;
      const parentId = mention.dataset.parentId ? Number(mention.dataset.parentId) : null;
      const href = mentionHref({
        entityType: mention.dataset.entityType as MentionEntityType,
        id,
        label: mention.dataset.label ?? '',
        parentId: Number.isFinite(parentId) ? parentId : null,
      });
      if (href) navigate(href);
    };

    return (
      <div onClick={handleMentionClick}>
        <ReadOnlyTipTap content={resolvedContent} />
      </div>
    );
  }
  return plainText ? <MentionText text={plainText} /> : null;
}
