// "Create from scratch" entry flow (docs/estudio-design.md §6.5), the Post Express precedent
// verbatim: pick client -> addWorkflow -> single synthetic completed etapa -> addWorkflowPost
// (status 'rascunho', tipo 'feed') -> navigate. Unlike Post Express, this does NOT call a
// separate "create the design" endpoint before navigating: `usePostDesignQuery`'s GET is itself
// a get-or-create (post-design-manage §5.4) that lazily derives the starter doc from the post's
// tipo the moment the editor route mounts and fires its first fetch — so a second explicit
// creation call here would just be a redundant round trip to the same effect.
import { useState } from 'react';
import { addWorkflow, addWorkflowEtapa } from '@/store/workflows';
import { addWorkflowPost } from '@/store/posts';

export interface EstudioDraft {
  workflowId: number;
  postId: number;
}

export function useEstudioEntryFlow() {
  const [creating, setCreating] = useState(false);

  async function createFromScratch(clientId: number, clientName: string): Promise<EstudioDraft> {
    setCreating(true);
    try {
      const now = new Date();
      const dateStr = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;

      const workflow = await addWorkflow({
        cliente_id: clientId,
        titulo: `Estúdio - ${clientName} - ${dateStr}`,
        status: 'ativo',
        etapa_atual: 0,
        recorrente: false,
        modo_prazo: 'padrao',
      });

      await addWorkflowEtapa({
        workflow_id: workflow.id!,
        ordem: 0,
        nome: 'Publicação',
        prazo_dias: 0,
        tipo_prazo: 'corridos',
        tipo: 'padrao',
        status: 'concluido',
        iniciado_em: now.toISOString(),
        responsavel_id: null,
      });

      const post = await addWorkflowPost({
        workflow_id: workflow.id!,
        status: 'rascunho',
        tipo: 'feed',
        titulo: 'Estúdio',
        conteudo: null,
        conteudo_plain: '',
        ordem: 0,
      });

      return { workflowId: workflow.id!, postId: post.id! };
    } finally {
      setCreating(false);
    }
  }

  return { createFromScratch, creating };
}
