# Design: Melhorias na Gestão de Status de Posts

**Data:** 2026-04-09  
**Escopo:** Página de Entregas (KanbanView, WorkflowDrawer) e fluxo de aprovação do cliente

---

## Problema

1. **Reset silencioso de aprovação:** Ao editar o conteúdo de um post que já foi aprovado (`aprovado_interno` ou `aprovado_cliente`), o sistema resetava silenciosamente o status para `revisao_interna`, sem avisar o usuário. Isso causava posts voltando para estados anteriores inesperadamente, exigindo nova aprovação do cliente sem o usuário perceber o motivo.

2. **Etapa de Aprovação do Cliente sem escolha:** Ao "Concluir" uma etapa do tipo `aprovacao_cliente` (via drag-and-drop ou botão Concluir no card), o sistema avançava o card automaticamente sem oferecer a opção de aprovação interna. Não havia como aprovar internamente sem passar pelo portal do cliente.

---

## Solução

### Mudança 1 — Confirmação ao editar post aprovado

**Arquivo:** `src/pages/entregas/components/WorkflowDrawer.tsx`  
**Função afetada:** `scheduleContentSave` (linha ~167)

**Regra:** Somente alterações no **editor de texto** (conteúdo do post) disparam o diálogo. Alterações em propriedades via `handleFieldChange` (tipo, responsável, etc.) continuam silenciosas.

**Fluxo:**
1. Usuário começa a digitar num post com status `aprovado_interno` ou `aprovado_cliente`
2. Sistema interrompe o save e abre um `AlertDialog`
3. Mensagem: *"Este post foi aprovado. Editá-lo vai invalidar a aprovação e resetar o status para 'Em revisão'. Deseja continuar?"*
4. **Cancelar:** descarta a edição, post permanece intacto e aprovado
5. **Confirmar edição:** reseta status para `revisao_interna` e prossegue com o save normalmente
6. Uma vez confirmado para aquele post naquela sessão (drawer aberto), edições subsequentes no mesmo post salvam diretamente sem novo diálogo

**Estado necessário:** `pendingEditPost: WorkflowPost | null` — guarda o post que aguarda confirmação, e `confirmedEditIds: Set<number>` — IDs de posts já confirmados na sessão atual do drawer.

---

### Mudança 2 — Modal de escolha ao concluir etapa de Aprovação do Cliente

**Arquivos afetados:**
- `src/pages/entregas/views/KanbanView.tsx` — lógica de drag-and-drop (linha ~220) e botão Concluir (linha ~294)
- `src/store.ts` — nova função `approvePostsInternally`

**Regra:** O modal só aparece quando a etapa sendo concluída tem `tipo === 'aprovacao_cliente'`. Para etapas normais (`padrao`), o comportamento existente é mantido.

**Fluxo:**
1. Usuário arrasta card para próxima coluna OU clica em Concluir, e a etapa atual é `aprovacao_cliente`
2. Modal abre com título: *"Como deseja prosseguir com a aprovação?"*
3. Duas opções:
   - **"Aprovar internamente"** — chama nova função `approvePostsInternally(workflowId)` que marca todos os posts do workflow com status `aprovado_cliente`, depois chama `completeEtapa`, avançando o card
   - **"Enviar ao portal do cliente"** — chama `sendPostsToCliente(workflowId)` (função existente) que move posts `aprovado_interno` → `enviado_cliente`, **sem** avançar o card (workflow permanece na etapa de aprovação aguardando resposta)
4. Botão **Cancelar** fecha o modal sem ação

**Nova função em store.ts:**
```ts
export async function approvePostsInternally(workflowId: number): Promise<void> {
  // Marca posts do workflow que ainda não foram agendados/postados como 'aprovado_cliente'
  const { error } = await supabase
    .from('workflow_posts')
    .update({ status: 'aprovado_cliente' })
    .eq('workflow_id', workflowId)
    .not('status', 'in', '("agendado","postado")');
  if (error) throw error;
}
```

**Estado necessário em KanbanView:** `approvalChoiceCard: BoardCard | null` — card aguardando escolha do modal.

---

## Arquivos a modificar

| Arquivo | Mudança |
|---|---|
| `src/pages/entregas/components/WorkflowDrawer.tsx` | Adicionar diálogo de confirmação em `scheduleContentSave`, estados `pendingEditPost` e `confirmedEditIds` |
| `src/pages/entregas/views/KanbanView.tsx` | Interceptar `completeEtapa` quando etapa é `aprovacao_cliente`, adicionar modal de escolha e estado `approvalChoiceCard` |
| `src/store.ts` | Adicionar função `approvePostsInternally` |

---

## O que NÃO muda

- `handleFieldChange` em WorkflowDrawer — sem diálogo para propriedades
- Fluxo de aprovação pelo portal do cliente (PortalPage, portal-approve edge function)
- Etapas do tipo `padrao` — sem modal de escolha
- Comportamento de drag-and-drop para etapas normais
