import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { PostEditor } from '@/pages/entregas/components/PostEditor';
import {
  extractR2Keys,
  injectSignedUrls,
  resolveInlineImageUrls,
  uploadInlineImage,
} from '@/services/inlineImage';
import type { TarefaDescriptionDoc } from '../tarefaDescription';

interface TarefaDescriptionEditorProps {
  initialContent: TarefaDescriptionDoc;
  onUpdate: (doc: TarefaDescriptionDoc, plainText: string) => void;
  onUploadStateChange?: (uploading: boolean) => void;
}

export function TarefaDescriptionEditor({
  initialContent,
  onUpdate,
  onUploadStateChange,
}: TarefaDescriptionEditorProps) {
  const { t } = useTranslation('tasksForm');
  const [resolvedContent, setResolvedContent] = useState<TarefaDescriptionDoc>(initialContent);
  const [ready, setReady] = useState(() => extractR2Keys(initialContent).length === 0);

  useEffect(() => {
    const keys = extractR2Keys(initialContent);
    if (keys.length === 0) {
      setResolvedContent(initialContent);
      setReady(true);
      return;
    }

    let cancelled = false;
    setReady(false);
    resolveInlineImageUrls(keys)
      .then((urls) => {
        if (!cancelled) setResolvedContent(injectSignedUrls(initialContent, urls));
      })
      .catch(() => {
        if (!cancelled) setResolvedContent(initialContent);
      })
      .finally(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [initialContent]);

  if (!ready) {
    return <div className="text-sm text-muted-foreground">{t('description.loading')}</div>;
  }

  return (
    <PostEditor
      initialContent={resolvedContent}
      onUpdate={onUpdate}
      placeholder={t('description.placeholder')}
      ariaLabel={t('description.label')}
      showCharacterCount={false}
      onUploadStateChange={onUploadStateChange}
      onUploadInlineImage={async (file) => {
        try {
          return await uploadInlineImage(file);
        } catch (error) {
          toast.error(
            error instanceof Error && error.message === 'quota_exceeded'
              ? t('description.quotaExceeded')
              : t('description.uploadFailed'),
          );
          throw error;
        }
      }}
    />
  );
}
