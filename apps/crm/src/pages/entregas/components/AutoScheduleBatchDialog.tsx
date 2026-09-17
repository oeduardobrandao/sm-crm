import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
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
import { getWorkflowPosts } from '@/store';
import { partitionByScheduleEligibility, targetsTikTokService } from '../autoScheduleNudge';
import { scheduleApprovedPost } from '../scheduleApprovedPost';

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

export interface AutoScheduleBatchDialogProps {
  /** null fecha o diálogo. Não-null abre e busca os posts desse fluxo. */
  workflowId: number | null;
  /** features?.feature_tiktok === true. Decisão 5 da spec: tiktok-publish exige
   *  esse flag além de feature_post_scheduling, então sem ele um post
   *  tiktok/both não é agendável mesmo com data válida. */
  tiktokFeatureEnabled: boolean;
  onClose: () => void;
  onScheduled: () => void;
}

/**
 * Resumo da aprovação em lote (peça 2 da spec). Os gates (auto_publish_on_approval,
 * feature_post_scheduling, !willRearm) são do caller; aqui só a contagem e o loop.
 *
 * Por que buscar em vez de usar um snapshot do board: nem KanbanView nem
 * EntregasTab têm as linhas de workflow_posts do fluxo (só contagens por fluxo),
 * e approvePostsInternally devolve void. A busca depois da escrita também é mais
 * fresca do que qualquer snapshot anterior a ela. Ver a nota de desvio no plano
 * docs/superpowers/plans/2026-09-17-manual-approval-auto-schedule-nudge.md.
 *
 * Sem endpoint de lote no backend: loop sequencial, aceitável porque
 * max_posts_per_workflow já limita N por fluxo.
 */
export function AutoScheduleBatchDialog({
  workflowId,
  tiktokFeatureEnabled,
  onClose,
  onScheduled,
}: AutoScheduleBatchDialogProps) {
  const [running, setRunning] = useState(false);

  const {
    data: posts,
    isLoading,
    isFetching,
  } = useQuery({
    queryKey: ['auto-schedule-batch-posts', workflowId],
    queryFn: () => getWorkflowPosts(workflowId!),
    enabled: workflowId != null,
    // Este componente fica SEMPRE montado (o pai controla por workflowId, como o
    // AlertDialog de pendingConfirm vizinho já faz), então a garantia do gcTime 0
    // NÃO é "descarta ao desmontar": quando workflowId volta para null a CHAVE
    // muda para [..., null], a chave [..., <id antigo>] fica com zero observers e
    // é evictada na hora. Reabrir para o mesmo fluxo começa então sem cache.
    // O staleTime 0 garante um refetch em toda transição enabled false -> true, e
    // o `isFetching` no disabled do botão abaixo é a trava real: mesmo se alguma
    // entrada sobrevivesse, não dá para agir sobre ela enquanto a busca está em
    // voo (clicar sobre a lista velha mandaria posts já agendados -> 422).
    staleTime: 0,
    gcTime: 0,
  });

  const approved = (posts ?? []).filter((p) => p.status === 'aprovado_cliente');
  const byDate = partitionByScheduleEligibility(
    approved.map((p) => ({ ...p, scheduled_at: p.scheduled_at ?? null })),
  );

  // Decisão 5 da spec, por post: um post tiktok/both só é agendável com
  // feature_tiktok. Sem o add-on ele desce para a lista manual em vez de ganhar
  // um balde próprio na UI -- do ponto de vista de quem usa, é a mesma ação
  // ("resolva esse à mão").
  const blockedByTikTok = (p: { platform?: string | null }) =>
    targetsTikTokService(p.platform) && !tiktokFeatureEnabled;
  const eligible = byDate.eligible.filter((p) => !blockedByTikTok(p));
  const missingDate = [...byDate.missingDate, ...byDate.eligible.filter(blockedByTikTok)];

  // Nada aprovado (aprovação em lote sem efeito, ou tudo já agendado): não vale
  // um diálogo vazio.
  useEffect(() => {
    if (workflowId != null && !isLoading && posts && approved.length === 0) onClose();
  }, [workflowId, isLoading, posts, approved.length, onClose]);

  if (workflowId == null) return null;

  const handleScheduleAll = async () => {
    setRunning(true);
    let ok = 0;
    let fail = 0;
    for (const post of eligible) {
      try {
        await scheduleApprovedPost(post);
        ok++;
      } catch {
        // Um post inválido (legenda, mídia) não deve interromper os outros; a
        // contagem final é o relatório, o post continua em aprovado_cliente e o
        // indicador persistente segue oferecendo a ação.
        fail++;
      }
    }
    setRunning(false);
    onClose();
    if (fail === 0) {
      toast.success(`${ok} ${plural(ok, 'post agendado', 'posts agendados')}.`);
    } else {
      toast.error(
        `${ok} ${plural(ok, 'post agendado', 'posts agendados')}, ${fail} ${plural(fail, 'falhou', 'falharam')}.`,
      );
    }
    if (ok > 0) onScheduled();
  };

  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open && !running) onClose();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Agendar os posts aprovados?</AlertDialogTitle>
          <AlertDialogDescription>
            {isLoading
              ? 'Carregando os posts do fluxo…'
              : `${approved.length} ${plural(approved.length, 'post aprovado', 'posts aprovados')}. ${eligible.length} ${plural(eligible.length, 'já tem data definida e pode', 'já têm data definida e podem')} ser agendado agora. Este cliente agenda a publicação automaticamente quando o próprio cliente aprova pelo portal.`}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {missingDate.length > 0 && (
          <div className="px-1 text-xs" style={{ color: 'var(--text-muted)' }}>
            <p className="font-semibold">Sem data válida, agende manualmente:</p>
            <ul>
              {missingDate.map((p) => (
                <li key={p.id}>{p.titulo || 'Post sem título'}</li>
              ))}
            </ul>
          </div>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={running}>Agora não</AlertDialogCancel>
          {/* isFetching trava a ação enquanto a busca está em voo: com staleTime 0
              toda reabertura refetcha, e agir sobre a lista anterior mandaria
              posts já agendados ao servidor (422). */}
          <Button
            onClick={handleScheduleAll}
            disabled={running || isFetching || eligible.length === 0}
          >
            {`Agendar ${eligible.length} ${plural(eligible.length, 'post', 'posts')}`}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
