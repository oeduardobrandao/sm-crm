import { useState } from 'react';
import { toast } from 'sonner';
import { Calendar, AlertCircle, RefreshCw, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { WorkflowPost } from '../../../store';
import { scheduleInstagramPost, cancelInstagramSchedule, retryInstagramPublish } from '../../../services/instagram';

interface ScheduleButtonProps {
  post: WorkflowPost;
  hasInstagramAccount: boolean;
  onStatusChange: () => void;
}

export function ScheduleButton({ post, hasInstagramAccount, onStatusChange }: ScheduleButtonProps) {
  const [loading, setLoading] = useState(false);

  if (!hasInstagramAccount) return null;

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
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold"
          style={{ background: 'rgba(62, 207, 142, 0.12)', color: '#3ecf8e' }}>
          <Calendar className="h-3.5 w-3.5" /> Agendado
        </div>
        <Button variant="outline" size="sm" onClick={handleCancel} disabled={loading}
          className="text-xs" style={{ color: '#f55a42', borderColor: 'rgba(245, 90, 66, 0.25)' }}>
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
    const missingItems: string[] = [];
    if (!post.scheduled_at) missingItems.push('data de publicação');
    if (!post.ig_caption?.trim()) missingItems.push('legenda do Instagram');

    return (
      <div className="mt-3">
        <Button onClick={handleSchedule} disabled={!canSchedule || loading} size="sm"
          className="text-xs font-semibold"
          style={canSchedule ? { background: '#eab308', color: '#12151a' } : undefined}>
          <Calendar className="h-3 w-3 mr-1" /> Agendar publicação
        </Button>
        {!canSchedule && missingItems.length > 0 && (
          <p className="text-xs mt-1 flex items-center gap-1" style={{ color: '#f5a342' }}>
            <AlertCircle className="h-3 w-3" /> Falta: {missingItems.join(', ')}
          </p>
        )}
      </div>
    );
  }

  return null;
}
