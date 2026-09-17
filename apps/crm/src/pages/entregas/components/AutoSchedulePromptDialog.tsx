import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { DateTimePicker } from '@/components/ui/date-time-picker';
import { updateWorkflowPost } from '@/store';
import { isEligibleToScheduleNow } from '../autoScheduleNudge';
import { scheduleApprovedPost, scheduleSuccessMessage } from '../scheduleApprovedPost';

export interface AutoSchedulePromptPost {
  id: number;
  titulo: string;
  platform?: 'instagram' | 'tiktok' | 'both';
  scheduled_at: string | null;
}

export interface AutoSchedulePromptDialogProps {
  /** null fecha o diálogo; não-null abre para esse post. */
  post: AutoSchedulePromptPost | null;
  onClose: () => void;
  /** Só após sucesso, para o caller invalidar as próprias queries. */
  onScheduled: () => void;
}

/**
 * Aviso de agendamento automático para UM post (peças 1 e 3 da spec
 * 2026-09-17-manual-approval-auto-schedule-nudge-design.md). Quem decide se
 * deve aparecer é o caller, via shouldOfferAutoSchedule(); este componente só
 * cuida dos dois caminhos de agendar.
 *
 * Erro do endpoint fecha e mostra toast.error, sem estado de erro inline: é o
 * mesmo padrão do ScheduleButton (handleSchedule e o diálogo de publicar
 * agora). O post continua em aprovado_cliente, e o indicador persistente segue
 * oferecendo a ação.
 */
export function AutoSchedulePromptDialog({
  post,
  onClose,
  onScheduled,
}: AutoSchedulePromptDialogProps) {
  const [loading, setLoading] = useState(false);
  const [pickedDate, setPickedDate] = useState<Date | undefined>(undefined);

  // Pré-preenche o picker com a data antiga (decisão 1) a cada post novo, e
  // limpa a escolha anterior para o diálogo não reaproveitar a data de outro post.
  useEffect(() => {
    setPickedDate(post?.scheduled_at ? new Date(post.scheduled_at) : undefined);
  }, [post?.id, post?.scheduled_at]);

  if (!post) return null;

  const eligible = isEligibleToScheduleNow(post.scheduled_at);
  const platform = post.platform ?? 'instagram';

  const finish = (err?: unknown) => {
    setLoading(false);
    onClose();
    if (err) toast.error((err as Error).message || 'Erro ao agendar');
    else {
      toast.success(scheduleSuccessMessage(platform));
      onScheduled();
    }
  };

  const handleScheduleNow = async () => {
    setLoading(true);
    try {
      await scheduleApprovedPost(post);
      finish();
    } catch (err) {
      finish(err);
    }
  };

  const handleSetDateAndSchedule = async () => {
    if (!pickedDate) return;
    setLoading(true);
    try {
      // A linha DEVOLVIDA pela escrita, nunca o `post` capturado antes da
      // escolha: para tiktok/both, scheduleApprovedPost lê scheduled_at do
      // objeto e mandaria a data antiga (ou null) no corpo do request.
      const updated = await updateWorkflowPost(post.id, {
        scheduled_at: pickedDate.toISOString(),
      });
      await scheduleApprovedPost(updated);
      finish();
    } catch (err) {
      finish(err);
    }
  };

  const formattedDate = post.scheduled_at
    ? format(new Date(post.scheduled_at), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })
    : null;

  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open && !loading) onClose();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Agendar a publicação agora?</AlertDialogTitle>
          <AlertDialogDescription>
            {eligible
              ? `Este cliente agenda a publicação automaticamente quando um post é aprovado. Deseja agendar "${post.titulo || 'Post sem título'}" para ${formattedDate}?`
              : `Este cliente agenda a publicação automaticamente quando um post é aprovado, mas este post não tem uma data válida. Escolha uma data para agendar "${post.titulo || 'Post sem título'}".`}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {!eligible && (
          <div className="px-1">
            <DateTimePicker
              value={pickedDate}
              onChange={setPickedDate}
              futureOnly
              className="w-full"
            />
          </div>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={loading}>Cancelar</AlertDialogCancel>
          {eligible ? (
            <Button onClick={handleScheduleNow} disabled={loading}>
              Agendar
            </Button>
          ) : (
            <Button
              onClick={handleSetDateAndSchedule}
              disabled={loading || !pickedDate || !isEligibleToScheduleNow(pickedDate.toISOString())}
            >
              Definir e agendar
            </Button>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
