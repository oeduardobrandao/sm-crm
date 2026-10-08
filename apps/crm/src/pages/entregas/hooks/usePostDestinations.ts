import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { trackUnsavedWork } from '@mesaas/app-lifecycle';
import type { PlatformId } from '@mesaas/platforms';
import {
  addPostDestination,
  getBoardPlatforms,
  getPostTargets,
  removePostDestination,
  savePostCaption,
  type WorkflowPost,
} from '@/store';

/**
 * Destinos de UM post no editor (P2, feature_multiplatform). `enabled` = flag ligada
 * e post expandido: desligado, nenhuma query roda e nada do store é tocado (os testes
 * dos drawers mockam '@/store' com uma lista fixa; por isso todo acesso ao store fica
 * dentro de closures).
 */
export function usePostDestinations(post: WorkflowPost, enabled: boolean, onRefresh: () => void) {
  const qc = useQueryClient();
  const postId = post.id ?? null;

  const targetsQuery = useQuery({
    // platform na chave: o banco muda destinos sem passar por aqui (z7 tira o TikTok
    // quando o tipo vira stories, a2/z8 em outros caminhos) e platform é derivado
    // deles, então toda mudança de Instagram/TikTok vira chave nova e refaz a busca.
    // Geral não mexe em platform: as escritas daqui invalidam o prefixo explicitamente.
    queryKey: ['post-targets', postId, post.platform ?? null],
    queryFn: () => getPostTargets(postId!),
    enabled: enabled && postId != null,
    // Chave nova não pisca "Carregando destinos…": mostra os destinos anteriores até chegar.
    // Só do MESMO post: de outro post, a legenda Geral dele apareceria (e seria editável) aqui.
    placeholderData: (prev, prevQuery) => (prevQuery?.queryKey[1] === postId ? prev : undefined),
  });
  const boardQuery = useQuery({
    queryKey: ['board-platforms', post.workflow_id ?? null, post.cliente_id],
    queryFn: () =>
      getBoardPlatforms({ workflow_id: post.workflow_id ?? null, cliente_id: post.cliente_id }),
    enabled,
    staleTime: 60_000,
  });

  const toggle = useMutation({
    mutationFn: (v: { platform: PlatformId; on: boolean; seedCaption: string | null }) => {
      if (postId == null) throw new Error('post sem id');
      if (!v.on) return trackUnsavedWork(removePostDestination(postId, v.platform));
      if (!post.conta_id) throw new Error('post sem conta_id');
      // INSERT + cópia da legenda em voo: uma troca silenciosa de versão no meio
      // deixaria o destino sem legenda. Mesmo padrão de PostMediaGallery.tsx:440.
      return trackUnsavedWork(
        addPostDestination({
          postId,
          contaId: post.conta_id,
          platform: v.platform,
          seedCaption: v.seedCaption,
        }),
      );
    },
    onError: () => toast.error('Não foi possível atualizar os destinos.'),
    // Também em erro: o INSERT pode ter passado e só a cópia da legenda falhado.
    // Retorna a promise: o TanStack espera por ela, então toggle.isPending só cai
    // quando `targets` já está fresco (um segundo clique rápido não age sobre dados velhos
    // e não consegue tirar o último destino).
    onSettled: () => {
      // platform (derivado no banco), ig_caption e tiktok_caption vêm da query do drawer.
      onRefresh();
      return Promise.all([
        qc.invalidateQueries({ queryKey: ['post-targets', postId] }),
        qc.invalidateQueries({ queryKey: ['active-posts'] }),
      ]);
    },
  });

  const saveCaption = async (platform: 'tiktok' | 'geral', text: string) => {
    if (postId == null) return;
    try {
      await savePostCaption(postId, platform, text);
    } catch (err) {
      toast.error('Não foi possível salvar a legenda.');
      throw err;
    }
    // useCaptionDraft só larga o rascunho quando o valor das props alcança o salvo.
    if (platform === 'geral') await qc.invalidateQueries({ queryKey: ['post-targets', postId] });
    else onRefresh();
  };

  return {
    targets: targetsQuery.data,
    boardPlatforms: boardQuery.data,
    isLoading: enabled && (targetsQuery.isLoading || boardQuery.isLoading),
    isError: targetsQuery.isError || boardQuery.isError,
    refetch: () => {
      void targetsQuery.refetch();
      void boardQuery.refetch();
    },
    toggle,
    saveCaption,
  };
}
