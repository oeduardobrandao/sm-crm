# Status Management Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar confirmação ao editar posts aprovados e um modal de escolha ao concluir etapas do tipo `aprovacao_cliente`.

**Architecture:** Duas mudanças independentes e cirúrgicas: (1) interceptar `scheduleContentSave` em `WorkflowDrawer` para exibir um `AlertDialog` antes de resetar status; (2) interceptar `completeEtapa` em `KanbanView` quando a etapa é `aprovacao_cliente`, exibindo um modal com duas opções via novo componente em `WorkflowModals`. Nova função `approvePostsInternally` adicionada ao `store.ts`.

**Tech Stack:** React, TypeScript, Supabase JS client, shadcn/ui AlertDialog + Dialog, sonner toast

---

## File Map

| Arquivo | Mudança |
|---|---|
| `src/store.ts` | Adicionar `approvePostsInternally` |
| `src/pages/entregas/components/WorkflowModals.tsx` | Adicionar `ClientApprovalChoiceDialog` |
| `src/pages/entregas/components/WorkflowDrawer.tsx` | Estados `pendingEditPost` + `confirmedEditIds`, diálogo de confirmação em `scheduleContentSave` |
| `src/pages/entregas/views/KanbanView.tsx` | Estado `approvalChoiceCard`, interceptar forward em drag-and-drop e botão Concluir quando etapa é `aprovacao_cliente` |

---

## Task 1: Adicionar `approvePostsInternally` ao store

**Files:**
- Modify: `src/store.ts` (após linha 1336, depois de `sendPostsToCliente`)

- [ ] **Step 1: Adicionar a função após `sendPostsToCliente`**

Em `src/store.ts`, logo após a função `sendPostsToCliente` (linha ~1336), inserir:

```ts
export async function approvePostsInternally(workflowId: number): Promise<void> {
  const { error } = await supabase
    .from('workflow_posts')
    .update({ status: 'aprovado_cliente' })
    .eq('workflow_id', workflowId)
    .not('status', 'in', '("agendado","postado")');
  if (error) throw error;
}
```

- [ ] **Step 2: Verificar que o TypeScript compila sem erros**

```bash
cd /Users/eduardosouza/Projects/sm-crm && npx tsc --noEmit 2>&1 | head -20
```

Esperado: sem erros relacionados a `approvePostsInternally`.

- [ ] **Step 3: Commit**

```bash
git add src/store.ts
git commit -m "feat(store): add approvePostsInternally function"
```

---

## Task 2: Adicionar `ClientApprovalChoiceDialog` em WorkflowModals

**Files:**
- Modify: `src/pages/entregas/components/WorkflowModals.tsx` (append ao final do arquivo)

- [ ] **Step 1: Adicionar o componente ao final do arquivo**

Em `src/pages/entregas/components/WorkflowModals.tsx`, após a última linha (linha 781), adicionar:

```tsx
// ClientApprovalChoiceDialog — shown when completing an aprovacao_cliente step
interface ClientApprovalChoiceDialogProps {
  open: boolean;
  workflowTitle: string;
  onApproveInternally: () => void;
  onSendToPortal: () => void;
  onCancel: () => void;
}
export function ClientApprovalChoiceDialog({
  open,
  workflowTitle,
  onApproveInternally,
  onSendToPortal,
  onCancel,
}: ClientApprovalChoiceDialogProps) {
  return (
    <Dialog open={open} onOpenChange={open => { if (!open) onCancel(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Como deseja prosseguir com a aprovação?</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          "{workflowTitle}" está em etapa de aprovação do cliente.
        </p>
        <DialogFooter className="flex-col gap-2 sm:flex-col">
          <Button className="w-full" onClick={onApproveInternally}>
            Aprovar internamente
          </Button>
          <Button className="w-full" variant="outline" onClick={onSendToPortal}>
            Enviar ao portal do cliente
          </Button>
          <Button className="w-full" variant="ghost" onClick={onCancel}>
            Cancelar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Verificar que o TypeScript compila sem erros**

```bash
cd /Users/eduardosouza/Projects/sm-crm && npx tsc --noEmit 2>&1 | head -20
```

Esperado: sem erros.

- [ ] **Step 3: Commit**

```bash
git add src/pages/entregas/components/WorkflowModals.tsx
git commit -m "feat(modals): add ClientApprovalChoiceDialog component"
```

---

## Task 3: Diálogo de confirmação ao editar post aprovado no WorkflowDrawer

**Files:**
- Modify: `src/pages/entregas/components/WorkflowDrawer.tsx`

- [ ] **Step 1: Adicionar estados para controle do diálogo**

Em `WorkflowDrawer.tsx`, após a linha 77 (`const [savingIds, ...]`), adicionar:

```tsx
// Confirmation dialog for editing approved posts
const [pendingEditPost, setPendingEditPost] = useState<WorkflowPost | null>(null);
const [pendingEditData, setPendingEditData] = useState<{ json: Record<string, unknown>; plain: string } | null>(null);
const confirmedEditIds = useRef<Set<number>>(new Set());
```

- [ ] **Step 2: Modificar `scheduleContentSave` para interceptar edições em posts aprovados**

Substituir o corpo da função `scheduleContentSave` (linhas 167-190) pelo seguinte:

```tsx
const scheduleContentSave = (
  post: WorkflowPost,
  json: Record<string, unknown>,
  plain: string
) => {
  const id = post.id!;
  const isApproved = post.status === 'aprovado_interno' || post.status === 'aprovado_cliente';

  // If post is approved and not yet confirmed in this session, show confirmation dialog
  if (isApproved && !confirmedEditIds.current.has(id)) {
    setPendingEditPost(post);
    setPendingEditData({ json, plain });
    return;
  }

  // If post was approved and already confirmed, reset status on first save
  if (isApproved) {
    updateWorkflowPost(id, { status: 'revisao_interna' }).then(() => refresh());
  }

  setSavingIds(prev => new Set(prev).add(id));
  if (saveTimers.current[id]) clearTimeout(saveTimers.current[id]);
  saveTimers.current[id] = setTimeout(async () => {
    try {
      await updateWorkflowPost(id, { conteudo: json, conteudo_plain: plain });
      refresh();
    } catch { toast.error('Erro ao salvar conteúdo'); }
    finally {
      setSavingIds(prev => { const s = new Set(prev); s.delete(id); return s; });
    }
  }, 1500);
};
```

- [ ] **Step 3: Adicionar handlers para confirmar/cancelar a edição**

Após a função `scheduleContentSave` modificada (antes da função `handleSendToCliente`), adicionar:

```tsx
const handleConfirmEdit = () => {
  if (!pendingEditPost || !pendingEditData) return;
  const id = pendingEditPost.id!;
  confirmedEditIds.current.add(id);
  // Reset approval status and proceed with save
  updateWorkflowPost(id, { status: 'revisao_interna' }).then(() => refresh());
  setSavingIds(prev => new Set(prev).add(id));
  if (saveTimers.current[id]) clearTimeout(saveTimers.current[id]);
  saveTimers.current[id] = setTimeout(async () => {
    try {
      await updateWorkflowPost(id, { conteudo: pendingEditData.json, conteudo_plain: pendingEditData.plain });
      refresh();
    } catch { toast.error('Erro ao salvar conteúdo'); }
    finally {
      setSavingIds(prev => { const s = new Set(prev); s.delete(id); return s; });
    }
  }, 1500);
  setPendingEditPost(null);
  setPendingEditData(null);
};

const handleCancelEdit = () => {
  setPendingEditPost(null);
  setPendingEditData(null);
  // Force re-render to restore post content by refreshing
  refresh();
};
```

- [ ] **Step 4: Adicionar o AlertDialog no JSX do drawer**

Em `WorkflowDrawer.tsx`, no retorno do componente, logo após o `AlertDialog` de delete existente (após linha 349), adicionar:

```tsx
{/* Confirmation dialog for editing approved posts */}
<AlertDialog open={!!pendingEditPost} onOpenChange={open => { if (!open) handleCancelEdit(); }}>
  <AlertDialogContent>
    <AlertDialogHeader>
      <AlertDialogTitle>Post aprovado</AlertDialogTitle>
      <AlertDialogDescription>
        Este post foi aprovado. Editá-lo vai invalidar a aprovação e resetar o status para "Em revisão". Deseja continuar?
      </AlertDialogDescription>
    </AlertDialogHeader>
    <AlertDialogFooter>
      <AlertDialogCancel onClick={handleCancelEdit}>Cancelar</AlertDialogCancel>
      <AlertDialogAction onClick={handleConfirmEdit}>Confirmar edição</AlertDialogAction>
    </AlertDialogFooter>
  </AlertDialogContent>
</AlertDialog>
```

- [ ] **Step 5: Verificar que o TypeScript compila sem erros**

```bash
cd /Users/eduardosouza/Projects/sm-crm && npx tsc --noEmit 2>&1 | head -20
```

Esperado: sem erros.

- [ ] **Step 6: Commit**

```bash
git add src/pages/entregas/components/WorkflowDrawer.tsx
git commit -m "feat(drawer): add confirmation dialog when editing approved posts"
```

---

## Task 4: Modal de escolha ao concluir etapa `aprovacao_cliente` no KanbanView

**Files:**
- Modify: `src/pages/entregas/views/KanbanView.tsx`

- [ ] **Step 1: Adicionar imports necessários**

Em `KanbanView.tsx`, modificar a linha de import do store (linha 10) para incluir as novas funções:

```tsx
import { completeEtapa, revertEtapa, updateWorkflowPositions, approvePostsInternally, sendPostsToCliente } from '../../../store';
```

Modificar a linha de import dos modals (linha 14) para incluir o novo componente:

```tsx
import { RevertConfirmDialog, ClientApprovalChoiceDialog } from '../components/WorkflowModals';
```

- [ ] **Step 2: Adicionar estado `approvalChoiceCard`**

Em `KanbanView.tsx`, após a linha 110 (`const [revertTarget, ...]`), adicionar:

```tsx
const [approvalChoiceCard, setApprovalChoiceCard] = useState<BoardCard | null>(null);
```

- [ ] **Step 3: Criar helper `handleForwardCard` que centraliza a lógica de avançar**

Em `KanbanView.tsx`, após o estado `approvalChoiceCard` adicionado no step 2, adicionar:

```tsx
const handleForwardCard = useCallback((card: BoardCard) => {
  if (card.etapa.tipo === 'aprovacao_cliente') {
    setApprovalChoiceCard(card);
  } else {
    (async () => {
      try {
        const result = await completeEtapa(card.workflow.id!, card.etapa.id!);
        if (result.workflow.status === 'concluido' && card.workflow.recorrente) {
          onRecurring(card.workflow.id!);
        } else {
          toast.success('Etapa concluída!');
        }
        onRefresh();
      } catch (err: unknown) {
        toast.error((err as Error).message || 'Erro ao avançar etapa');
      }
    })();
  }
}, [onRefresh, onRecurring]);
```

- [ ] **Step 4: Adicionar handlers do modal de escolha**

Após `handleForwardCard`, adicionar:

```tsx
const handleApproveInternally = async () => {
  if (!approvalChoiceCard) return;
  const card = approvalChoiceCard;
  setApprovalChoiceCard(null);
  try {
    await approvePostsInternally(card.workflow.id!);
    const result = await completeEtapa(card.workflow.id!, card.etapa.id!);
    if (result.workflow.status === 'concluido' && card.workflow.recorrente) {
      onRecurring(card.workflow.id!);
    } else {
      toast.success('Posts aprovados internamente — etapa concluída!');
    }
    onRefresh();
  } catch (err: unknown) {
    toast.error((err as Error).message || 'Erro ao aprovar internamente');
  }
};

const handleSendToPortal = async () => {
  if (!approvalChoiceCard) return;
  const card = approvalChoiceCard;
  setApprovalChoiceCard(null);
  try {
    await sendPostsToCliente(card.workflow.id!);
    toast.success('Posts enviados ao portal do cliente!');
    onRefresh();
  } catch (err: unknown) {
    toast.error((err as Error).message || 'Erro ao enviar ao portal');
  }
};
```

- [ ] **Step 5: Substituir o forward no drag-and-drop para usar `handleForwardCard`**

Em `KanbanView.tsx`, no bloco `if (diff === 1)` (linhas 219-231), substituir:

```tsx
if (diff === 1) {
  // Forward — completeEtapa
  try {
    const result = await completeEtapa(draggedCard.workflow.id!, draggedCard.etapa.id!);
    if (result.workflow.status === 'concluido' && draggedCard.workflow.recorrente) {
      onRecurring(draggedCard.workflow.id!);
    } else {
      toast.success('Etapa concluída!');
    }
    onRefresh();
  } catch (err: unknown) {
    toast.error((err as Error).message || 'Erro ao avançar etapa');
  }
}
```

Por:

```tsx
if (diff === 1) {
  handleForwardCard(draggedCard);
}
```

- [ ] **Step 6: Substituir o botão Concluir (onForwardClick) para usar `handleForwardCard`**

Em `KanbanView.tsx`, substituir o `onForwardClick` inline (linhas 292-304):

```tsx
onForwardClick={async () => {
  try {
    const result = await completeEtapa(card.workflow.id!, card.etapa.id!);
    if (result.workflow.status === 'concluido' && card.workflow.recorrente) {
      onRecurring(card.workflow.id!);
    } else {
      toast.success('Etapa concluída!');
    }
    onRefresh();
  } catch (err: unknown) {
    toast.error((err as Error).message || 'Erro ao avançar etapa');
  }
}}
```

Por:

```tsx
onForwardClick={() => handleForwardCard(card)}
```

- [ ] **Step 7: Adicionar `ClientApprovalChoiceDialog` no JSX**

Em `KanbanView.tsx`, no retorno final (antes do `</>` de fechamento, após `<RevertConfirmDialog ... />`), adicionar:

```tsx
<ClientApprovalChoiceDialog
  open={!!approvalChoiceCard}
  workflowTitle={approvalChoiceCard?.workflow.titulo || ''}
  onApproveInternally={handleApproveInternally}
  onSendToPortal={handleSendToPortal}
  onCancel={() => setApprovalChoiceCard(null)}
/>
```

- [ ] **Step 8: Verificar que o TypeScript compila sem erros**

```bash
cd /Users/eduardosouza/Projects/sm-crm && npx tsc --noEmit 2>&1 | head -20
```

Esperado: sem erros.

- [ ] **Step 9: Commit**

```bash
git add src/pages/entregas/views/KanbanView.tsx
git commit -m "feat(kanban): add approval choice modal for aprovacao_cliente steps"
```

---

## Task 5: Verificação final

- [ ] **Step 1: Build completo**

```bash
cd /Users/eduardosouza/Projects/sm-crm && npm run build 2>&1 | tail -20
```

Esperado: build sem erros.

- [ ] **Step 2: Verificação manual — diálogo de edição de post aprovado**

1. Abrir a página de Entregas
2. Clicar em um workflow que tenha um post com status `aprovado_interno` ou `aprovado_cliente`
3. Abrir o WorkflowDrawer e expandir esse post
4. Digitar algo no editor de texto
5. Esperado: modal aparece perguntando se deseja continuar
6. Clicar "Cancelar" — post deve permanecer com status aprovado
7. Digitar novamente — modal aparece de novo
8. Clicar "Confirmar edição" — post muda para `revisao_interna`, edições seguintes no mesmo post salvam sem diálogo

- [ ] **Step 3: Verificação manual — propriedades não disparam diálogo**

1. Mesmo post aprovado no drawer
2. Alterar o campo "Tipo" (feed/reels/stories/carrossel) ou responsável
3. Esperado: sem diálogo, atualização silenciosa, status permanece aprovado

- [ ] **Step 4: Verificação manual — modal de aprovação no kanban**

1. Abrir a página de Entregas no modo Kanban
2. Localizar um card na coluna de uma etapa do tipo `aprovacao_cliente`
3. Arrastar o card para a coluna seguinte OU clicar no botão Concluir
4. Esperado: modal com duas opções aparece
5. Clicar "Cancelar" — card permanece na mesma coluna
6. Repetir e clicar "Aprovar internamente" — posts ficam `aprovado_cliente`, card avança
7. Repetir (com novo card) e clicar "Enviar ao portal do cliente" — posts ficam `enviado_cliente`, card **não** avança

- [ ] **Step 5: Verificar etapas normais não são afetadas**

1. Arrastar um card de uma etapa do tipo `padrao`
2. Esperado: avança diretamente sem modal

- [ ] **Step 6: Commit final se houver ajustes**

```bash
git add -p
git commit -m "fix: address post-review adjustments to status management"
```
