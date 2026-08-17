import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AlertCircle, RefreshCw, ChevronDown, ChevronUp } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { retryInstagramPublish } from '../../../services/instagram';
import { getPublishErrorDisplay } from '../publishErrorCopy';
import type { WorkflowPost } from '../../../store/posts';

interface PublishErrorBlockProps {
  post: WorkflowPost;
  clienteId?: number;
  onStatusChange?: () => void;
}

/** Highlighted, actionable-cause block for a post stuck in `falha_publicacao`. Shown in
 * the WorkflowDrawer above ScheduleButton's own (terser) inline error line. */
export function PublishErrorBlock({ post, clienteId, onStatusChange }: PublishErrorBlockProps) {
  const { t } = useTranslation('posts');
  const [loading, setLoading] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const d = getPublishErrorDisplay(post.publish_error_code);

  async function handleRetry() {
    if (!post.id) return;
    setLoading(true);
    try {
      await retryInstagramPublish(post.id);
      toast.success('Post reagendado. A publicação será tentada novamente.');
      onStatusChange?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao tentar novamente.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="rounded-md border p-3 mb-3 text-sm"
      style={{
        borderColor: 'var(--danger)',
        background: 'color-mix(in srgb, var(--danger) 8%, transparent)',
      }}
    >
      <p
        className="flex items-center gap-1.5 font-semibold"
        style={{ color: 'var(--danger-text)' }}
      >
        <AlertCircle className="h-4 w-4" /> {d.titulo}
      </p>
      <p className="mt-1" style={{ color: 'var(--danger-text)' }}>
        {d.explicacao}
      </p>

      {d.acao === 'reconnect' && clienteId != null && (
        <Button asChild size="sm" className="mt-2 text-xs font-semibold">
          <Link to={`/clientes/${clienteId}/redes-sociais`}>{t('publishError.reconnectCta')}</Link>
        </Button>
      )}
      {d.acao === 'retry' && (
        <Button
          size="sm"
          className="mt-2 text-xs font-semibold"
          disabled={loading}
          onClick={handleRetry}
          style={{ background: '#f55a42', color: 'white' }}
        >
          <RefreshCw className="h-3 w-3 mr-1" /> Tentar novamente
        </Button>
      )}

      {d.mostrarDetalhes && post.publish_error && (
        <div className="mt-2">
          <button
            type="button"
            className="flex items-center gap-1 text-xs opacity-75"
            style={{ color: 'var(--danger-text)' }}
            onClick={() => setShowDetails((v) => !v)}
          >
            {showDetails ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            Detalhes técnicos
          </button>
          {showDetails && (
            <p
              className="mt-1 text-xs font-mono opacity-75"
              style={{ color: 'var(--danger-text)' }}
            >
              {post.publish_error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
