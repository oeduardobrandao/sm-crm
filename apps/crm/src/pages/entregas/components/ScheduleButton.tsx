import { useState } from 'react';
import { toast } from 'sonner';
import { Calendar, AlertCircle, RefreshCw, X, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import type { WorkflowPost } from '../../../store';
import { scheduleInstagramPost, cancelInstagramSchedule, retryInstagramPublish, publishInstagramPostNow } from '../../../services/instagram';

interface ScheduleButtonProps {
  post: WorkflowPost;
  hasInstagramAccount: boolean;
  onStatusChange: () => void;
}

export function ScheduleButton({ post, hasInstagramAccount, onStatusChange }: ScheduleButtonProps) {
  const [loading, setLoading] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  if (!hasInstagramAccount) return null;

  const handlePublishNow = async () => {
    setLoading(true);
    try {
      const result = await publishInstagramPostNow(post.id!);
      if (result.status === 'postado') {
        toast.success('Post publicado no Instagram!');
      } else {
        toast.info(result.message ?? 'Post será publicado automaticamente em instantes.');
      }
      onStatusChange();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSchedule = async () => {
    setLoading(true);
    try {
      await scheduleInstagramPost(post.id!);
      toast.success('Post agendado para publicação no Instagram');
      onStatusChange();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = async () => {
    setLoading(true);
    try {
      await cancelInstagramSchedule(post.id!);
      toast.success('Agendamento cancelado');
      onStatusChange();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleRetry = async () => {
    setLoading(true);
    try {
      await retryInstagramPublish(post.id!);
      toast.success('Post reenviado para publicação');
      onStatusChange();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (post.status === 'agendado') {
    return (
      <div className="flex items-center gap-2 mt-3">
        <div className="flex items-center gap-1.5 px-2.5 h-8 rounded-lg text-xs font-semibold"
          style={{ background: 'rgba(62, 207, 142, 0.12)', color: '#3ecf8e' }}>
          <Calendar className="h-3.5 w-3.5" /> Agendado
        </div>
        <Button variant="outline" size="sm" onClick={handleCancel} disabled={loading}
          className="h-8 text-xs" style={{ color: '#f55a42', borderColor: 'rgba(245, 90, 66, 0.25)' }}>
          <X className="h-3 w-3 mr-1" /> Cancelar
        </Button>
      </div>
    );
  }

  if (post.status === 'falha_publicacao') {
    return (
      <div className="mt-3">
        <Button onClick={handleRetry} disabled={loading} size="sm"
          className="text-xs font-semibold"
          style={{ background: '#f55a42', color: 'white' }}>
          <RefreshCw className="h-3 w-3 mr-1" /> Tentar novamente
        </Button>
        {post.publish_error && (
          <p className="text-xs mt-1 flex items-center gap-1" style={{ color: '#f55a42' }}>
            <AlertCircle className="h-3 w-3" /> {post.publish_error}
          </p>
        )}
      </div>
    );
  }

  if (post.status === 'aprovado_cliente') {
    const canSchedule = !!post.scheduled_at && !!post.ig_caption?.trim();
    const canPublishNow = !!post.ig_caption?.trim();
    const missingItems: string[] = [];
    if (!post.scheduled_at) missingItems.push('data de publicação');
    if (!post.ig_caption?.trim()) missingItems.push('legenda do Instagram');

    return (
      <div className="mt-3">
        <div className="flex items-center gap-2">
          <Button onClick={handleSchedule} disabled={!canSchedule || loading} size="sm"
            className="text-xs font-semibold"
            style={canSchedule ? { background: '#eab308', color: '#12151a' } : undefined}>
            <Calendar className="h-3 w-3 mr-1" /> Agendar publicação
          </Button>
          <Button onClick={() => setConfirmOpen(true)} disabled={!canPublishNow || loading} size="sm"
            className="text-xs font-semibold"
            style={canPublishNow ? { background: '#E1306C', color: 'white' } : undefined}>
            <Send className="h-3 w-3 mr-1" /> Publicar agora
          </Button>
        </div>
        {!canPublishNow && missingItems.length > 0 && (
          <p className="text-xs mt-1 flex items-center gap-1" style={{ color: '#f5a342' }}>
            <AlertCircle className="h-3 w-3" /> Falta: {missingItems.join(', ')}
          </p>
        )}
        <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Publicar agora?</AlertDialogTitle>
              <AlertDialogDescription>
                O post será publicado imediatamente no Instagram. Esta ação não pode ser desfeita.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={loading}>Cancelar</AlertDialogCancel>
              <AlertDialogAction
                disabled={loading}
                onClick={handlePublishNow}
                style={{ background: '#E1306C', color: 'white' }}
              >
                {loading ? 'Publicando…' : 'Publicar'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    );
  }

  return null;
}
