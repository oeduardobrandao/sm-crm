import { Link as LinkIcon } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { buildHubPostLink } from '@/lib/hubLinks';

export function CopyPostLinkButton({ hubUrl, postId }: { hubUrl?: string; postId: number }) {
  const { t } = useTranslation();
  if (!hubUrl) return null;
  async function copy() {
    try {
      await navigator.clipboard.writeText(buildHubPostLink(hubUrl!, postId));
      toast.success(t('copyPostLink.copied'));
    } catch {
      toast.error(t('copyPostLink.failed'));
    }
  }
  return (
    <button
      type="button"
      onClick={copy}
      title={t('copyPostLink.label')}
      aria-label={t('copyPostLink.label')}
      className="drawer-delete-btn"
    >
      <LinkIcon className="h-3.5 w-3.5" />
    </button>
  );
}
