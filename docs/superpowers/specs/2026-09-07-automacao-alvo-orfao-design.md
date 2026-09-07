# Automação de comentário com alvo órfão

**Data:** 2026-09-07
**Estado:** desenho aprovado, aguardando plano de implementação

## Problema

Uma automação de comentário para DM mirada em "post em produção" guarda
`workflow_post_id` e fica com `ig_media_id` nulo até a publicação. O vínculo é feito
pelo trigger `workflow_posts_z3_link_ig_automations`, que dispara
`AFTER UPDATE OF instagram_media_id` quando o campo passa a não-nulo.

Só a publicação via API preenche `instagram_media_id`. Quando o post é marcado como
"postado" na mão, o campo fica nulo para sempre e a automação nunca casa comentário
nenhum. Não há tombstone (o `z4` só existe no `DELETE`), não há notificação e a
listagem segue exibindo `pendingBadge` ("Aguardando publicação") indefinidamente,
mesmo com o post já no ar.

O usuário não tem como saber. O sintoma que chega é "automação de post específico não
dispara, a de todos os posts funciona".

### Evidência de produção (2026-09-07)

Auditoria das 12 automações de prod. O bug histórico do alvo em UUID está extinto:
zero alvos nesse formato, as 4 migrations aplicadas, os 3 triggers habilitados, nenhum
evento de webhook sem `media.id` em 7 dias, e 58 envios todos `sent` sem nenhum
`skip_reason`. A automação específica `fb8aeaee` disparou em 34 de 34 comentários
elegíveis. **A feature funciona.** O que resta é este defeito.

Caso confirmado, automação `3dd0a373` "Calendário Setembro":

| Momento | Fato |
|---|---|
| 31/08 23:34 | automação criada, alvo = `workflow_posts` 4038, em produção |
| 31/08 23:55 | publicação falha com `CAROUSEL_LIMIT` (12 itens, a API aceita 10) |
| 31/08 23:55 | usuário publica na mão. `instagram_media_id` fica NULL |
| 31/08 → 01/09 | o post real (`18133930105628236`) recebe 13 comentários e 6 DMs, **todos pela automação global** |
| 01/09 13:31 | usuário desliga a automação, com `dms_sent_count = 0` |

**Prevalência: 421 dos 1.037 posts `postado` em prod (41%) não têm
`instagram_media_id`.** 383 sem erro de publicação registrado e 38 com erro. Qualquer
automação mirada em um desses fica muda.

## Não faz parte deste desenho

- Casar heurístico entre `workflow_posts` e mídia do feed por proximidade de data.
  Descartado: pode vincular a mídia errada e mandar DM pela automação errada.
- Preencher `instagram_media_id` retroativamente nos 421 posts.
- O sync de feed travado do cliente 103 (feed sincroniza com sucesso mas não traz
  mídias posteriores a 31/08). Investigação separada, já registrada.

## Desenho

### 1. Detecção, no banco

Coluna nova em `instagram_comment_automations`:

```sql
ALTER TABLE instagram_comment_automations
  ADD COLUMN target_unlinked_at timestamptz;
```

Tabela pequena (12 linhas em prod), migration barata. Nada é adicionado a
`workflow_posts`, que é a maior tabela do schema.

Trigger novo:

```sql
CREATE TRIGGER workflow_posts_z5_flag_unlinked_ig_automations
  AFTER UPDATE OF status ON workflow_posts
  FOR EACH ROW
  WHEN (NEW.status = 'postado'
        AND NEW.instagram_media_id IS NULL
        AND OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION flag_unlinked_instagram_automations();
```

A função carimba `target_unlinked_at = now()` nas automações com
`workflow_post_id = NEW.id AND ig_media_id IS NULL AND target_unlinked_at IS NULL`,
e nada mais. Repete as mesmas guardas silenciosas de deriva do `z3`
(`wp.cliente_id = a.client_id`, `tipo <> 'stories'`,
`COALESCE(platform,'instagram') <> 'tiktok'`): o sistema nunca aborta e a deriva nunca
marca.

`'postado'` é status de máquina e os custom statuses nunca o assumem (ver
`20260811000002_storage_autoclean_rpcs.sql`), então a condição é confiável.

**Por que não há falso positivo no caminho feliz:** `mark_platform_published` grava
`instagram_media_id` em um `UPDATE` próprio e só depois chama
`record_post_status_change(..., 'postado', ...)`. Quando o status muda, a mídia já
está lá e o `WHEN` não deixa o trigger rodar.

**A marca é auto-curável.** `link_pending_instagram_automations` (z3) e
`sweep_pending_instagram_automation_links` passam a limpar `target_unlinked_at` no
mesmo `UPDATE` em que preenchem `ig_media_id`. Se algum caminho futuro gravar status
antes da mídia, o estado se corrige sozinho em vez de mentir.

O resolver `ica_a1_resolve_workflow_post_target` limpa `target_unlinked_at` quando o
usuário escolhe um alvo novo não-nulo, no mesmo bloco que hoje limpa
`pending_post_deleted_at`.

`target_unlinked_at` é **independente** do CHECK `ica_tombstone_inactive`: ele não
força `ativo = false` e não participa da regra de reativação em dois passos.

A marca é gravada **independente de `ativo`**, para que a listagem mostre o motivo
certo também nas automações que o usuário já desligou por desistência. Quem filtra por
`ativo` é a notificação, não o trigger.

### 2. Notificação, no cron

A notificação não sai do trigger. Sai de uma fase nova do
`instagram-automation-cron`, imediatamente depois da fase 3 (o sweep de convergência),
para automações com `target_unlinked_at` mais antigo que **15 minutos**, ainda com
`ig_media_id` nulo e com **`ativo = true`**. As sete fases atuais viram oito e o
comentário de cabeçalho do handler é renumerado junto.

Notificar uma automação que o usuário já desligou seria ruído: ele não espera nada
dela. Ela continua marcada na tela, que é onde a informação importa.

A carência de 15 minutos torna impossível notificar por causa de ordem de escrita: uma
mídia que chegue tarde limpa a marca antes da janela vencer.

Reusa `notifyAutomationFailure` de `_shared/automation-notify.ts` com o mesmo dedupe de
24h por (workspace, cliente), sob um valor novo em `AutomationFailureReason`:

```ts
| "target_never_published"
```

A assinatura do helper ganha um campo opcional de metadata extra, para que os três
chamadores existentes fiquem intactos. A fase nova passa `automation_id` e
`automation_name` por ele, além do `client_id` que já vai.

O dedupe herdado é por (workspace, cliente): se duas automações do mesmo cliente
ficarem órfãs no mesmo dia, sai uma notificação só. É o comportamento que os outros
motivos já têm e não vale divergir aqui. A tela mostra as duas.

### 3. Copy da notificação

`notification-config.ts` hoje devolve uma frase única para
`instagram_automation_failed`, ignorando o `reason`, e ela manda reconectar o
Instagram. Errado para este caso. Passa a ramificar por `metadata.reason`, mantendo a
frase atual como padrão dos motivos existentes:

```
título: Automação do Instagram com problema
corpo:  <nome> · o post alvo foi marcado como postado sem passar pelo app,
        então não existe mídia para monitorar. Escolha o post publicado.
```

Sem travessão, por convenção de copy do produto: ponto, dois-pontos ou "·".

### 4. Aviso na tela

Em `AutomacoesPage.tsx`, o ramo `a.workflow_post_id` da célula de alvo (hoje na linha
457) deixa de mostrar `pendingBadge` incondicionalmente. Com `target_unlinked_at`
preenchido e `ig_media_id` nulo, passa a mostrar um badge `warning` mais a ação
"Escolher post publicado".

Chaves novas em `packages/i18n/locales/{pt,en}/automations.json`, ao lado de
`pendingBadge` e `deletedPostBadge`:

```json
"unlinkedTargetBadge": "Alvo não vinculado",
"unlinkedTargetAction": "Escolher post publicado",
"unlinkedTargetHint": "O post foi marcado como postado sem passar pelo app, então não existe mídia para monitorar."
```

O mesmo estado aparece no `PostAutomationSection` do WorkflowDrawer.

Ordem de precedência da célula, do mais forte ao mais fraco, preservando a que já
existe: tombstone, depois `ig_media_id`, depois **alvo não vinculado**, depois
pendente, depois "Todos os posts".

### 5. Re-mirar, ao vivo

A ação abre o `AutomationFormDialog` na aba "Publicados", mas com a fonte trocada: em
vez da tabela espelho `instagram_posts`, uma busca ao vivo na Graph API.

**Por que ao vivo.** O espelho não é confiável para este caso. Achei em prod um cliente
cujo feed sincronizou com sucesso hoje às 14:07 e cuja mídia mais recente é de 31/08:
o post publicado em 04/09 não está lá. Se o seletor lesse o espelho, o usuário ficaria
sem saída justamente no cenário que o desenho existe para resolver.

Rota nova em `automation-media`: `GET /published-media?client_id=<id>`. Copia o gate de
auth do #422, já em `supabase/functions/automation-media/handler.ts:45`: cliente
service-role, `getUser(token)`, `conta_id` do perfil, papel via `workspace_members`
(nunca `profiles.role`), e `assertPlanFeature(svc, contaId, "feature_instagram_automation")`.
Verifica que o `client_id` pedido pertence à `conta_id` do chamador antes de tocar em
qualquer token.

Chama `graph.instagram.com/me/media` com o token descriptografado da conta e devolve
`{ id, caption, media_type, thumbnail_url, permalink, timestamp }`. Erro da Graph API
nunca vaza para o cliente: mensagem genérica fora, detalhe no log.

Escolher um post grava `ig_media_id` e **mantém** `workflow_post_id`. Esse é o estado
"ligado" que o modelo de 5 estados já prevê, e é o que descreve a verdade: o post
interno existe e agora se sabe qual mídia ele virou. O resolver limpa
`target_unlinked_at` nesse mesmo write.

## Testes

**SQL** (`supabase/tests/entitlements/`, gated pelo job `entitlement-tests`)

- status vira `postado` sem mídia: marca as automações pendentes daquele post
- caminho da API (`mark_platform_published`): não marca, porque a mídia vem antes
- mídia chega depois: `z3` limpa a marca junto com o vínculo
- `sweep_pending_instagram_automation_links` também limpa
- guardas de deriva: cliente diferente, `stories` e `tiktok` não marcam
- escolher alvo novo pelo resolver limpa a marca
- a marca não altera `ativo` nem colide com `ica_tombstone_inactive`

**Deno** (`supabase/functions/__tests__/`)

- fase nova do cron notifica só depois dos 15 minutos de carência
- dedupe de 24h por (workspace, cliente) continua valendo
- automação já vinculada dentro da janela não gera notificação
- `GET /published-media`: 401 sem token, 403 para papel `agent`, 403 sem o
  entitlement, 403 para `client_id` de outra workspace, 200 com a lista mapeada
- erro da Graph API vira mensagem genérica

**Vitest** (`apps/crm/src/**/__tests__/`)

- célula de alvo nos cinco estados, com a precedência acima
- ação "Escolher post publicado" abre o diálogo na aba Publicados
- seletor ao vivo renderiza, escolhe e monta o patch com `ig_media_id` preenchido e
  `workflow_post_id` preservado
- `notification-config` devolve a copy nova para `target_never_published` e mantém a
  antiga para os outros motivos

## Ordem de rollout

Mesma lógica do #373, e pelo mesmo motivo: frontend novo contra backend velho não pode
existir.

1. Migration (coluna, função, trigger, e as edições em `z3`, no sweep e no resolver).
2. `instagram-automation-cron` e `automation-media`, com `--use-api --no-verify-jwt`.
3. Frontend, por último, via merge.

Inverso proibido: o frontend novo lendo `target_unlinked_at` antes da coluna existir
quebra a listagem de automações inteira.

Antes de abrir o PR, reconferir o tail de `origin/main` em
`supabase/migrations/` e renumerar a migration acima dele.

## Recuperação do caso conhecido

A automação `3dd0a373` "Calendário Setembro" está desligada desde 01/09. O alvo
publicado dela é `18133930105628236` (CAROUSEL_ALBUM, 31/08 23:52:49), três minutos
antes do `published_at` do `workflow_posts` 4038. Depois do rollout ela aparece marcada
e o usuário pode re-mirar pela UI. Nada é corrigido por script.
