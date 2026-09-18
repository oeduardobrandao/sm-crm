import { scheduleInstagramPost } from '@/services/instagram';
import { scheduleTikTokPost } from '@/services/tiktok';
import type { WorkflowPost } from '@/store';
import type { Platform } from './components/PlatformSelector';
import { targetsTikTokService } from './autoScheduleNudge';

/** O mínimo que o agendamento precisa de um post. Satisfeito por WorkflowPost
 *  (drawer, retorno de updateWorkflowPost) e por ActivePost (kanban). */
export type SchedulablePost = Pick<WorkflowPost, 'id' | 'platform' | 'scheduled_at'>;

export function scheduleSuccessMessage(platform: Platform): string {
  if (platform === 'both') return 'Post agendado para publicação no Instagram e no TikTok';
  if (platform === 'tiktok') return 'Post agendado para publicação no TikTok';
  return 'Post agendado para publicação no Instagram';
}

/**
 * A única fonte da regra de roteamento por plataforma do agendamento, extraída
 * de ScheduleButton.handleSchedule. `platform === 'both'` chama SÓ o serviço do
 * TikTok: o servidor do TikTok valida as duas plataformas nesse caso (ver o
 * comentário de cabeçalho de ScheduleButton.tsx, linhas 34-43). Chamar os dois
 * agendaria em dobro.
 *
 * O chamador é quem trata o erro: todo erro do endpoint (inclusive os `details`
 * de validateForScheduling) sobe como Error e vira toast.error(err.message).
 */
export async function scheduleApprovedPost(
  post: SchedulablePost,
): Promise<{ ok: boolean; status: string }> {
  const platform: Platform = post.platform ?? 'instagram';
  if (targetsTikTokService(platform)) return scheduleTikTokPost(post.id!, post.scheduled_at!);
  return scheduleInstagramPost(post.id!);
}
