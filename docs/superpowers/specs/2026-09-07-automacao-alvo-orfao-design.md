# Automação de comentário com alvo órfão

**Data:** 2026-09-07
**Estado:** desenho revisado após review externo, aguardando plano de implementação

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

### 1. Detecção: reconciliação no cron, não trigger

Coluna nova em `instagram_comment_automations`:

```sql
ALTER TABLE instagram_comment_automations
  ADD COLUMN target_unlinked_at timestamptz;
```

Tabela pequena (12 linhas em prod), migration barata. Nada é adicionado a
`workflow_posts`, que é a maior tabela do schema.

A marca é mantida por uma **fase de reconciliação idempotente** no
`instagram-automation-cron`, que roda a cada 5 minutos (`*/5 * * * *` em prod),
imediatamente depois da fase 3 (o sweep de convergência). Duas metades no mesmo
`UPDATE ... FROM workflow_posts`, uma RPC `reconcile_unlinked_automation_targets()`
service-role-only:

- **carimba** `target_unlinked_at = COALESCE(wp.published_at, wp.updated_at, now())`
  onde `a.workflow_post_id IS NOT NULL AND a.ig_media_id IS NULL
  AND wp.status = 'postado' AND wp.instagram_media_id IS NULL
  AND a.target_unlinked_at IS NULL`
- **limpa** `target_unlinked_at = NULL` onde a marca existe mas a condição não vale
  mais, seja porque a mídia chegou, seja porque o alvo mudou

Repete as guardas silenciosas de deriva do `z3` (`wp.cliente_id = a.client_id`,
`tipo <> 'stories'`, `COALESCE(platform,'instagram') <> 'tiktok'`): o sistema nunca
aborta e a deriva nunca marca.

`'postado'` é status de máquina e os custom statuses nunca o assumem (ver
`20260811000002_storage_autoclean_rpcs.sql`), então a condição é confiável.

**Por que reconciliação em vez de trigger.** Um trigger em `workflow_posts` só pega
transições futuras de status. Ele deixaria de fora três casos reais:

1. os órfãos que **já existem** hoje, incluindo o caso conhecido, que exigiriam um
   backfill separado na migration;
2. post criado já como `postado` pelo importador (`20260729000004_data_import_jobs.sql`
   escreve esse status direto no INSERT), que nunca passa por um `UPDATE OF status`;
3. automação criada **depois** que o post já está `postado`.

A reconciliação cobre os três de graça, é a mesma linha de SQL, e o primeiro tick
depois do deploy já é o backfill. O custo é até 5 minutos de latência, irrelevante
diante da carência de 15 minutos da notificação.

Nada é adicionado ao `z3` nem ao `sweep_pending_instagram_automation_links`: a metade
que limpa cobre o caso da mídia chegar tarde. O resolver
`ica_a1_resolve_workflow_post_target` **é** editado, para limpar `target_unlinked_at`
no mesmo bloco em que hoje limpa `pending_post_deleted_at`, de modo que a tela reaja na
hora quando o usuário re-mira, sem esperar o próximo tick.

`target_unlinked_at` é independente do CHECK `ica_tombstone_inactive`: não força
`ativo = false` e não participa da regra de reativação em dois passos.

A marca é gravada **independente de `ativo`**, para que a listagem mostre o motivo
certo também nas automações que o usuário já desligou por desistência. Quem filtra por
`ativo` é a notificação, não a reconciliação.

### 2. Notificação, no cron

Sai da mesma fase nova, depois da reconciliação, para automações com
`target_unlinked_at` mais antigo que **15 minutos**, ainda com `ig_media_id` nulo e com
**`ativo = true`**. As sete fases atuais viram oito e o comentário de cabeçalho do
handler é renumerado junto.

A carência de 15 minutos torna impossível notificar por causa de ordem de escrita: uma
mídia que chegue tarde limpa a marca antes da janela vencer. (No caminho feliz o
problema nem existe: `mark_platform_published` grava `instagram_media_id` em um
`UPDATE` próprio e só depois chama `record_post_status_change(..., 'postado', ...)`.)

Notificar uma automação que o usuário já desligou seria ruído: ele não espera nada
dela. Ela continua marcada na tela, que é onde a informação importa.

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

A ação só é renderizada para quem tem `automacoes: 'editar'`, o mesmo gate que a rota
usa (ver 6). Sem a permissão, o badge aparece sozinho e explica o estado.

### 5. Re-mirar: modo novo no diálogo

O fluxo atual não suporta esta ação e não basta reusar o que existe. Duas mudanças
explícitas em `AutomationFormDialog`:

**Abrir na aba certa.** Uma automação pendente abre hoje na aba `production`
(`AutomationFormDialog.tsx:174`). O diálogo ganha uma prop
`initialTab?: 'production' | 'published'`; a ação do aviso abre com `'published'`.

**Preservar o vínculo interno.** `selectPost` zera `workflow_post_id` de propósito
(`AutomationFormDialog.tsx:837`), com o comentário de que o estado "ligado" só chega
pré-semeado de `editing`. Correto para uma escolha qualquer, errado aqui: neste fluxo
o par interno **é** conhecido, é o `workflow_post_id` do próprio órfão. Entra um
handler distinto, `selectPublishedForUnlinkedTarget(post)`, que monta o mesmo alvo
`kind: 'published'` mas carrega o `workflow_post_id` semeado em vez de `null`,
produzindo o estado "ligado" que o modelo de 5 estados já prevê. `selectPost` fica
intocado.

O patch resultante grava `ig_media_id` e mantém `workflow_post_id`. O resolver limpa
`target_unlinked_at` nesse mesmo write.

### 6. Rota de mídias publicadas, ao vivo

**Por que ao vivo.** O espelho `instagram_posts` não é confiável para este caso. Achei
em prod um cliente cujo feed sincronizou com sucesso hoje às 14:07 e cuja mídia mais
recente é de 31/08: o post publicado em 04/09 não está lá. Se o seletor lesse o
espelho, o usuário ficaria sem saída justamente no cenário que o desenho existe para
resolver.

Rota nova em `automation-media`. **Não é uma cópia do gate existente**, é uma adição, e
o handler de hoje precisa de três coisas que ele não tem:

- ele responde `405` a tudo que não é `POST` (`handler.ts:42`). Para não mexer nessa
  guarda, a rota é `POST published-media` com corpo JSON, e não um `GET`;
- ele **não** verifica propriedade de `client_id` em rota nenhuma, porque nenhuma rota
  atual recebe um. Esta recebe, então valida que o `client_id` pertence à `conta_id`
  do chamador **antes** de tocar em qualquer token;
- o `assertPlanFeature` de hoje cobre só `presign`/`finalize`.

**Permissão: `automacoes: 'editar'`, não owner/admin.** É a mesma que a RLS
`ica_insert/update/delete` exige para escrever a automação, e a rota existe só para
servir uma escrita dessas. O preset de `agent` tem `automacoes: 'editar'` desde a
migração `20260904000002`, decisão deliberada da Task 11 documentada em
`apps/crm/src/lib/permissions.ts` e no próprio handler; negar `agent` aqui seria uma
regressão do modelo de permissões, não um endurecimento.

**Sem gate de entitlement.** A regra documentada no handler é que
`feature_instagram_automation` é INSERT-only: "downgrade bloqueia alocar mídia NOVA,
mas não impede ver ou apagar a que já existe". Re-mirar é um UPDATE de automação
existente, então não passa por `assertPlanFeature`.

**Contrato, com paginação por cursor.** `/me/media` da Graph API é paginado por cursor
e não devolve total, enquanto o seletor de hoje é por offset com `total`
(`POSTS_PAGE_SIZE = 10`, `postsPage`). Os dois modelos não se encaixam, então a aba
Publicados neste modo troca a paginação numerada por "carregar mais":

```
POST /automation-media/published-media
body:  { client_id: number, cursor?: string, limit?: number }   // limit default 25, teto 50
200:   { posts: [{ id, caption, media_type, thumbnail_url, permalink, timestamp }],
         next_cursor: string | null }
```

`next_cursor` é o `paging.cursors.after` da Graph API, repassado opaco. Erro da Graph
API nunca vaza para o cliente: mensagem genérica fora, detalhe no log.

## Testes

**SQL** (`supabase/tests/entitlements/`, gated pelo job `entitlement-tests`)

- `reconcile_unlinked_automation_targets()` carimba a automação pendente cujo post está
  `postado` sem mídia
- é idempotente: rodar duas vezes não altera o timestamp já gravado
- limpa a marca quando a mídia chega depois
- limpa a marca quando o alvo muda
- não carimba no caminho da API, onde a mídia chega antes do status
- guardas de deriva: cliente diferente, `stories` e `tiktok` não carimbam
- carimba independente de `ativo`
- escolher alvo novo pelo resolver limpa a marca na hora
- a marca não altera `ativo` nem colide com `ica_tombstone_inactive`
- a RPC é service_role-only, e o REVOKE cobre `anon` e `authenticated` explicitamente
  (defaults de prod dão grant direto, ver `reference_supabase_revoke_public_strips_service_role`)

**Deno** (`supabase/functions/__tests__/`)

- fase nova notifica só depois dos 15 minutos de carência
- automação com `ativo = false` é carimbada mas **não** notifica
- automação vinculada dentro da janela não gera notificação
- dedupe de 24h por (workspace, cliente) continua valendo
- `POST published-media`: 401 sem token, 403 sem `automacoes: 'editar'`,
  **200 para `agent`** (que tem a permissão), 403 para `client_id` de outra workspace,
  200 com a lista mapeada e `next_cursor` repassado
- segunda página com `cursor` chama a Graph API com o `after` certo
- erro da Graph API vira mensagem genérica

**Vitest** (`apps/crm/src/**/__tests__/`)

- célula de alvo nos cinco estados, com a precedência acima
- a ação não renderiza sem `automacoes: 'editar'`
- a ação abre o diálogo com `initialTab: 'published'`
- `selectPublishedForUnlinkedTarget` preserva `workflow_post_id`, e `selectPost` segue
  zerando (teste de não-regressão do comportamento existente)
- "carregar mais" concatena a página seguinte pelo `next_cursor`
- `notification-config` devolve a copy nova para `target_never_published` e mantém a
  antiga para os outros motivos

## Ordem de rollout

1. Migration (coluna, RPC de reconciliação, edição do resolver).
2. `instagram-automation-cron` e `automation-media`, com `--use-api --no-verify-jwt`.
3. Frontend, por último, via merge.

O acoplamento **duro** é um só: o frontend não pode expor a ação "Escolher post
publicado" antes da rota `published-media` existir, senão o clique bate em 404. E o
cron não pode consultar `target_unlinked_at` antes da coluna existir.

O inverso é apenas indesejado, não quebrado: a listagem usa `select('*')`
(`store/instagramAutomations.ts:97`), então uma coluna ainda inexistente simplesmente
não vem na resposta, `target_unlinked_at` fica `undefined` e a célula cai no estado
pendente de hoje. Frontend adiantado degrada para o comportamento atual, não para erro.

Antes de abrir o PR, reconferir o tail de `origin/main` em `supabase/migrations/` e
renumerar a migration acima dele.

## Recuperação do caso conhecido

A automação `3dd0a373` "Calendário Setembro" está desligada desde 01/09. O alvo
publicado dela é `18133930105628236` (CAROUSEL_ALBUM, 31/08 23:52:49), três minutos
antes do `published_at` do `workflow_posts` 4038.

O primeiro tick do cron depois do deploy a carimba, sem backfill dedicado: é
exatamente o caso que a reconciliação cobre e o trigger não cobriria. Por estar
desligada, ela não gera notificação. Aparece marcada na listagem, e o usuário re-mira
pela UI. Nada é corrigido por script.
