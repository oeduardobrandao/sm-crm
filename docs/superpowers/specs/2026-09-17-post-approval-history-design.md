# Histórico de aprovação e comentários por post (Hub)

**Data:** 2026-09-17 (revisado dez vezes após review externa)
**Status:** Design proposto, aguardando aprovação
**Origem:** Feedback direto de Anna Lourenço (CLD Advogados), repassado via Hanna

> **Nota de revisão (2ª rodada):** a rodada anterior deste documento concluiu
> que "o thread de comentários já existe e já é visível" — baseado em
> `PostCard.tsx` ter uma seção "Comentários" pronta. Uma segunda review
> (Codex) apontou, e uma checagem direta no código confirmou, que essa
> conclusão era otimista demais: `PostCard.tsx` **não é usado por nenhuma
> página real**. `InstagramPostCard`, `StoryPostCard` e `TextPostCard` — os
> três componentes que de fato renderizam os posts em Aprovações e Postagens
> — recebem a prop `approvals` mas nunca a renderizam. A única referência viva
> a `PostCard` fora do próprio arquivo é o teste dele. Ou seja: a Anna está
> certa, hoje não existe nenhum histórico/comentário visível no Hub, em
> nenhum dos três tipos de card reais. O dado (`post_approvals`) já existe e
> já é buscado por `hub-posts`; a UI para mostrá-lo, não. Esta revisão corrige
> a seção 1 e o resto do documento para refletir isso, e também corrige uma
> definição de KPI que a mesma review mostrou estar errada.
>
> **Nota de revisão (3ª rodada):** uma terceira review (Codex) focou em
> lacunas de segurança e de mecânica de banco que as rodadas anteriores
> deixaram como "decidir no plano" — algumas dessas lacunas eram graves o
> bastante (autorização do endpoint sob demanda, mecânica da migration da
> tag de motivo) para valer a pena resolver aqui, não empurrar adiante.
> Detalhes abaixo, marcados inline.
>
> **Nota de revisão (4ª rodada):** uma quarta review (Codex) corrigiu um erro
> real que a 3ª rodada introduziu: eu tinha afirmado que ampliar
> `record_client_approval` via `CREATE OR REPLACE FUNCTION` preservava o OID
> e os grants existentes. Isso está errado — acrescentar um parâmetro cria
> uma function nova e distinta no Postgres (identidade = nome + **tipos** dos
> parâmetros), que não herda o `revoke all from public` já existente na
> função de 6 argumentos, e ficaria exposta a `PUBLIC` por padrão. Confirmado
> direto na migration (`20260606000001_post_status_events.sql:150-151`).
> Corrigido na seção 3.
>
> **Nota de revisão (5ª rodada):** uma quinta review (Codex) achou que a
> correção da 4ª rodada ainda estava incompleta — manter as duas assinaturas
> da RPC vivas ao mesmo tempo (mesmo com grants corretos em ambas) deixa toda
> chamada existente ambígua para o Postgres, o que quebraria aprovação e
> correção em produção. A correção certa é substituir a function, não
> empilhar um overload. Também achou que a regra de "esconder status
> interno" da 3ª rodada, do jeito que estava escrita, apagava o próprio
> evento de primeiro envio ao cliente. Ambos corrigidos abaixo.
>
> **Nota de revisão (6ª rodada):** uma sexta review (Codex) achou que o
> `CHECK` da tag de motivo, do jeito que ficou escrito na rodada anterior,
> não rejeitava `motivo = NULL` — clássica pegadinha de lógica de três
> valores do SQL (`IN` com `NULL` dá `NULL`, não `FALSE`, e `CHECK` só
> rejeita em `FALSE`). Corrigido com `IS NOT NULL` explícito na seção 3.
>
> **Nota de revisão (7ª rodada):** uma sétima review (Codex) achou que o piso
> temporal, especificado só para `post_status_events`, deixava de fora as
> linhas `post_approvals` inseridas diretamente pela equipe (`mensagem`, via
> `replyToPostApproval`, sem checagem de status) — uma nota interna anterior
> ao primeiro envio vazaria pro cliente. Corrigido na seção 1: o mesmo piso
> agora se aplica às duas fontes.
>
> **Nota de revisão (8ª rodada):** uma oitava review (Codex) achou que o piso
> temporal não bastava — mesmo depois do primeiro envio, uma linha `mensagem`
> escrita pela equipe (`is_workspace_user = true`, via `replyToPostApproval`,
> usada hoje na página Mensagens do CRM) nunca foi pensada como algo que o
> cliente veria: o trigger de notificação dessa ação avisa só owner/admin,
> nunca o cliente, e nenhuma UI hoje mostra essas linhas pra fora da equipe.
> Corrigido na seção 1: a aba Comentários do Hub só mostra mensagens do
> cliente e mensagens da equipe escritas por um caminho novo, dedicado a essa
> feature — não o `replyToPostApproval` existente.
>
> **Nota de revisão (9ª rodada):** uma nona review (Codex) achou que a
> constraint obrigatória da tag de motivo não podia ir ao ar na mesma
> migration que a troca de assinatura da RPC: `hub-approve` chama a RPC com
> os mesmos 6 argumentos até ser redeployado, então toda correção enviada
> nessa janela chegaria com `motivo = NULL` e seria rejeitada — quebrando a
> submissão de correção em produção, não uma janela inofensiva. Corrigido na
> seção 3 com um rollout em 3 fases: constraint permissiva primeiro, depois o
> redeploy da edge function/UI, só então a constraint obrigatória.
>
> **Nota de revisão (10ª rodada):** uma décima review (Codex) achou dois
> problemas na seção 1: (a) "um caminho de escrita novo" não é suficiente
> pra distinguir mensagens internas de mensagens novas client-facing sem uma
> coluna persistida, já que as duas caem na mesma tabela com os mesmos
> campos; e (b) o piso temporal, aplicado a toda linha de `post_approvals`,
> apagaria aprovações/comentários do próprio cliente em posts sem um evento
> de primeiro envio registrado (post anterior à migration do trigger, ou
> trigger que falhou). Corrigido, e depois simplificado (sem coluna nova —
> ver seção 1): a aba Comentários mostra só mensagens do cliente nesta
> entrega, e conteúdo do cliente nunca é filtrado pelo piso temporal.

## Contexto

Hoje o Hub do cliente tem três pontos de atrito de rastreabilidade, segundo a Anna:

1. **Aba "Aprovações":** ao aprovar ou pedir correção, o card "some" — parece perder o histórico.
2. **Aba "Postagens":** mostra só a versão final, sem o processo que levou até ali.
3. **Aba "Mensagens":** um chat único por workspace mistura pedidos de ajuste de posts diferentes numa fila só.

Confirmado: nenhum dos três componentes de card realmente usados (`InstagramPostCard`,
`StoryPostCard`, `TextPostCard`) mostra o histórico de aprovações/correções ou
qualquer comentário passado — só um campo de comentário avulso, usado uma vez,
no momento de aprovar/pedir correção (`shared.correctionCommentRequired`,
duplicado nos três arquivos). O feedback da Anna é preciso.

### O que já existe hoje (dado, não UI)

- `post_approvals` (`supabase/migrations/20260402_workflow_posts.sql`): uma linha por ação — `aprovado`, `correcao` (via RPC `record_client_approval`, que também move o status) e `mensagem` (via `hub-approve/handler.ts`, texto livre, **sem** mudar status). O endpoint `hub-posts` já devolve essas linhas por token/cliente (`supabase/functions/hub-posts/handler.ts:141`) — só não chegam a aparecer na tela.
- `post_status_events` (`20260606000001_post_status_events.sql`): trigger que loga toda transição de status real (guard `from_status IS DISTINCT FROM to_status`), ligado a `post_approvals` via `post_approval_id` quando a transição veio de uma ação do cliente.
- `post_content_versions` (`20260923000001...` + fixups `20260923000004-8`): snapshot do **texto** (`conteudo`, `conteudo_plain`, `ig_caption`, `tiktok_caption`, `changed_fields`) a cada edição que muda algo — não guarda mídia, e não referencia diretamente qual aprovação/evento a gerou (exceto `suggestion_id`, só quando vem de uma sugestão aceita).
- Já existe, em analytics de workflow (`20260903000030_workflow_analytics_events.sql`, CTEs `pse`/`ciclos`/`latencias`), uma convenção de pareamento de ciclo "enviado → primeira resposta do cliente" para medir tempo de resposta — mas ela mede uma coisa mais restrita do que precisamos aqui (ver seção 3), então é referência de padrão, não uma peça pronta para reaproveitar literalmente.
- No CRM já existe um equivalente funcional pro histórico de status (`buildPostTimeline()`/`PostTimelinePopover.tsx`) e pra versões de conteúdo (`buildVersionTimeline()`/`PostVersionHistorySheet.tsx`), em `apps/crm/src/pages/entregas/components/`. `buildPostTimeline()` só anexa o comentário de uma aprovação via `post_approval_id` de um evento de status — uma linha `mensagem` (sem transição) ou uma segunda correção antes de um reenvio (sem novo evento de status) não aparecem nele. A implementação do Hub não pode reusar essa função como está.

### O que é, de fato, novo

- **UI de histórico/comentário nos três cards reais.** Isso é trabalho novo de verdade, não uma reorganização de algo que já roda. Recomendação de implementação: extrair um componente compartilhado (ex. `PostHistoryPanel`) usado pelos três, em vez de implementar a mesma coisa três vezes — hoje já há sinal de duplicação (o aviso de "comentário obrigatório na correção" está copiado nos três arquivos).
- Duas abas dentro desse painel: **Histórico** (linhas `aprovado`/`correcao`, mais transições de status sem `post_approval_id`) e **Comentários** (linhas `mensagem`) — a query já traz os dois tipos de `post_approvals`, é só uma questão de agrupar na apresentação.
- A aba **Comentários** inclui uma caixa de composição nova (nenhum dos três cards reais tem uma hoje — só a caixa existente no `PostCard.tsx` morto). Precisa definir: em quais status é permitido comentar (provavelmente qualquer um visível ao cliente, não só enquanto pendente), e validação server-side em `hub-approve` para a ação `mensagem` — hoje ela aceita `comentario` nulo/vazio sem rejeitar; a nova aba de comentários precisa de um mínimo de conteúdo (trim + não-vazio) pra não poluir o histórico e o indicador de não lido com eventos vazios.
- Diff de conteúdo por versão (novo).
- Filtro de status (novo).
- KPIs (novo, com uma definição de ciclo própria — ver seção 3).
- Tag de motivo de correção (novo).

## Decisões de escopo (validadas com a Hanna, revisadas duas vezes após review externa)

| Ponto em aberto | Decisão |
|---|---|
| "Rejeitado" vs "Em Refação" | **Mesmo status**, sem mudança de enum. **Não introduzir a palavra "Rejeitado" na UI** por enquanto. Confirmar com a Anna se ela precisa de um estado "descartado" antes de expor esse rótulo. |
| Rótulo do filtro para `correcao_cliente` | O rótulo já usado no resto do Hub (`CLIENT_STATUS_LABELS.correcao_cliente`) é **"Correção solicitada"**, não "Em Refação" — a Anna usou sua própria palavra, o sistema usa outra. Decisão: manter **"Correção solicitada"** no filtro, pela consistência com o resto do Hub, em vez de introduzir um rótulo divergente só para o chip. Se a Hanna preferir a palavra da Anna, é uma troca de string em um único lugar (`CLIENT_STATUS_LABELS`), não uma decisão de arquitetura. |
| Comentários gerais | O **dado** já existe (`post_approvals`, ação `mensagem`); a **UI** não existe em nenhum card real hoje — ver acima. Nenhuma tabela nova. |
| Onde a timeline/comentários aparecem | Dentro do card, nos três tipos (Instagram, Story, Texto), em Aprovações (só pendentes) e Postagens (todos os status visíveis ao cliente). Nenhuma mudança de escopo de página. |
| Filtro de status: em quais páginas | Só em **Postagens**. Aprovações já reduz a lista a `status = 'enviado_cliente'` antes de renderizar — um chip "Todos/Aprovado/Correção" ali não teria o que filtrar sem also mudar o que a página lista, o que é uma mudança de escopo à parte (ver Fora de escopo). |
| Onde os KPIs aparecem | Por post (dentro do card) **e** um resumo agregado (painel acima da lista), como fases separadas de entrega — o agregado só depois de definir janela/agregação (ver Riscos). |
| Diff de conteúdo | Incluído, só texto (legenda), sob demanda ao clicar num evento. Só entra na entrega se houver uma referência confiável entre o evento e a versão de conteúdo (ver seção 1) — do contrário, é cortado desta fase, não aproximado por timestamp. |
| Categorização de motivo de ajuste | Tag manual (chip: Legenda / Imagem-vídeo / Data / Outro) ao pedir correção, obrigatória só quando `action = 'correcao'` (constraint condicional no banco, não só validação no cliente). Só vale daqui pra frente. |
| Notificação de comentário novo | **Cortado desta entrega** (ver seção 4) — nem passivo nem ativo. Motivo: o Hub não tem identidade de leitor individual (é por token), o que muda o schema do zero; vira feature própria depois. |

## Design

### 1. Histórico + comentários dentro do card (trabalho novo de UI)

- Novo painel (idealmente um componente compartilhado pelos três tipos de card, para não triplicar a implementação e a manutenção), com duas abas: **Histórico** (`post_approvals` com `action IN ('aprovado','correcao')`, mais eventos de `post_status_events` sem `post_approval_id`) e **Comentários** (`action = 'mensagem'`, com a ressalva abaixo).
- **A aba Comentários não pode incluir toda linha `mensagem` histórica — e "escrita por um caminho novo" precisa de uma marca persistida, não só de uma intenção de design.** `replyToPostApproval` (a função por trás do "Responder sobre o post…" na página Mensagens do CRM) grava `is_workspace_user = true`, e o trigger de notificação dessa ação (`supabase/migrations/20260505100001_approval_notification_rpc.sql:108-136`) só notifica **owner/admin** (papéis internos) — nunca o cliente. Ou seja, essa é hoje uma ferramenta de coordenação interna da equipe sobre o post, sem nenhum canal que confirme ou garanta que o cliente algum dia veria aquilo. Só dizer "nova ação/endpoint" não basta: uma linha `mensagem` escrita pela equipe através do caminho novo e uma escrita pelo `replyToPostApproval` existente caem na **mesma tabela**, com os mesmos campos (`is_workspace_user = true`, `token`/`author_user_id` igualmente nulos/preenchidos) — sem uma coluna que registre a origem, a query do Hub não tem como diferenciar as duas, e teria que escolher entre expor a conversa interna ou esconder também as respostas novas da própria feature.
  - **Simplificação: sem coluna nova.** A primeira correção deste ponto propôs uma coluna `visivel_cliente` que uma "nova ação de equipe" marcaria como `true`. Mas essa nova ação não existe nesta entrega: o composer novo vive dentro do painel do Hub, e o Hub não tem identidade de equipe — só o cliente escreve por ali. Ou seja, toda escrita nova nesse caminho já é `is_workspace_user = false` por construção; não existe nenhum caminho, nesta entrega, que precisaria gravar uma marca "equipe, mas visível ao cliente". Regra final, mais simples: a aba Comentários do Hub mostra só `action = 'mensagem' AND is_workspace_user = false`. Toda resposta da equipe (`is_workspace_user = true`, hoje só via `replyToPostApproval` na página Mensagens do CRM) fica de fora, sem exceção, nesta entrega — não é preciso tocar em `replyToPostApproval` nem adicionar coluna alguma. Se a Hanna quiser que a equipe também responda visivelmente pelo mesmo canal, isso é um endpoint/composer novo do lado do CRM, decisão e trabalho futuros (mesma nota já registrada abaixo).
- A query precisa trazer `post_approvals` diretamente (não só via `post_status_events.post_approval_id`) — uma segunda correção antes de um reenvio, ou uma mensagem solta, não geram evento de status novo.
- **Piso temporal: não se aplica a linhas de `post_approvals` escritas pelo cliente, e não pode depender de um evento de status que pode nem existir.** Uma versão anterior deste documento propôs filtrar toda linha de `post_approvals` por `created_at >= primeiro evento com to_status = 'enviado_cliente'` — mas um post cujo primeiro envio aconteceu antes de `20260606000001` (ou cujo evento o trigger best-effort não gravou) simplesmente não tem esse evento, e aplicar esse piso apagaria **todas** as aprovações/correções/comentários do cliente para aquele post, mesmo sendo conteúdo do próprio cliente e obviamente seguro de mostrar (ele só respondeu porque já tinha recebido o post). Regra final: linhas `is_workspace_user = false` (cliente) nunca são filtradas pelo piso temporal — são sempre seguras por definição, tanto para o Histórico (`aprovado`/`correcao`) quanto para os Comentários (`mensagem`, ver acima). O piso continua valendo só para `post_status_events`/`post_content_versions`, onde a ausência gera história vazia/parcial (já aceito), não a remoção de conteúdo seguro do cliente.
- **Diff de conteúdo — condicionado a uma referência confiável.** `post_content_versions` não referencia qual aprovação/evento a gerou (exceto `suggestion_id`, só para sugestões aceitas). Pareamento por "timestamp mais próximo" **não é seguro**: a coalescência de edições em até 5 minutos, um reenvio que não muda texto, e uma edição adjacente de outra ação podem todos produzir uma correlação errada. Duas opções, a decidir no plano: (a) gravar uma referência explícita entre o evento de reenvio/aprovação e a versão de conteúdo no momento em que ambos acontecem (mudança de schema pequena, mas nova), ou (b) cortar o diff desta entrega e mostrar só "conteúdo foi alterado" sem o texto do diff. Não implementar a correlação por proximidade de tempo como se fosse confiável.
- **Autorização do endpoint sob demanda (P0 — sem isso, um token válido de um cliente pode ler o histórico de outro).** A consulta por post a `post_content_versions`/`post_status_events` tem que resolver o post através do próprio token, no mesmo padrão já usado em `hub-approve/handler.ts`: buscar `workflow_posts` por `id`, e conferir `post.conta_id === hubToken.conta_id && post.cliente_id === hubToken.cliente_id` **antes** de devolver qualquer histórico — nunca confiar num `post_id` vindo do cliente sem essa checagem. Isso não é uma decisão de plano, é obrigatório desde o design (regra do projeto: toda function confere posse do workspace antes de devolver dado).
- **Vazamento pro cliente — allowlist concreto, não “a definir”:**
  - **Regra pelo `to_status`, não pelos dois lados da transição.** Um evento entra na resposta se o seu `to_status` está em `VISIBLE_STATUSES` (`enviado_cliente`, `aprovado_cliente`, `correcao_cliente`, `agendado`, `postado`, `falha_publicacao`) — mesmo que o `from_status` seja interno. Filtrar pelos dois lados (como uma versão anterior deste documento propunha) apaga exatamente o primeiro envio ao cliente, que sai de um status interno (`rascunho`/`revisao_interna`/`aprovado_interno`, ver os fixtures de teste em `supabase/functions/__tests__/mcp-content_test.ts`) para `enviado_cliente` — sem esse evento, a timeline do cliente começaria direto numa aprovação ou correção, sem o "v1: enviado para aprovação" que a Anna pediu explicitamente. O `from_status` interno desse evento de fronteira não é exposto como está — vira um rótulo genérico fixo ("Enviado para aprovação"), nunca o nome do status interno de origem.
  - Piso temporal: eventos anteriores ao primeiro evento com `to_status = 'enviado_cliente'` daquele post nunca entram na resposta. Posts anteriores a `20260606000001` (quando o trigger de `post_status_events` passou a existir) simplesmente não têm eventos — a UI mostra histórico vazio/parcial para eles, sem tentar reconstruir o que não foi gravado (o trigger é best-effort, não uma garantia).
  - `actor_name` de equipe: exibir só um rótulo genérico ("Equipe") no Hub — não expor nomes de membros da equipe interna ao cliente por padrão; decisão final de copy fica pro plano, mas o default seguro é genérico.
  - **Conteúdo — schema de resposta higienizado, não o JSON cru.** O endpoint precisa devolver um DTO específico (ex.: só texto simples extraído, sem a árvore TipTap completa) que nunca inclua `commentHighlight`, `threadId`, `resolved` ou qualquer outra marca interna — a supressão que existe hoje (`CommentHighlightReadonly`) é só visual, no cliente, e não protege um payload de API novo. Definir esse DTO é parte do design, mesmo que os campos exatos fiquem pro plano.
- Fonte de dados: extensão do endpoint `hub-posts` para incluir os campos necessários de `post_status_events` (já filtrados pelo allowlist acima), e uma consulta por post sob demanda para `post_content_versions` (só quando o painel é aberto, com a mesma checagem de posse). **Paginação/limite obrigatórios**: o histórico de status/aprovações não pode ser embutido sem limite na listagem principal de `hub-posts` (hoje já devolve todos os posts de uma vez) — cada post no payload de lista carrega no máximo um resumo (ex.: status atual + contagem), e o histórico completo só é buscado quando o painel de um post específico é aberto.

### 2. Filtro de status (só em Postagens)

- Chips: Todos / Pendente de Aprovação (`enviado_cliente`) / Correção solicitada (`correcao_cliente`) / Aprovado (`aprovado_cliente`), com contagem ao vivo, reaproveitando `CLIENT_STATUS_LABELS`/`VISIBLE_STATUSES` (`apps/hub/src/lib/postView.ts`).
- Nenhuma mudança de schema.
- Não entra em Aprovações nesta fase (ver tabela de decisões).

### 3. KPIs

- **Definição de ciclo — escrita do zero para este caso, não reaproveitada literalmente de `20260903000030`.** Aquele CTE mede "tempo até a primeira resposta do cliente" e fecha só no primeiro evento com `from_status = 'enviado_cliente'`; ele nem seleciona `to_status`, então não dá pra saber ali se o ciclo fechou por aprovação ou por correção. Uma aprovação vinda direto de `correcao_cliente` (sem reenvio, permitida por `hub-approve`) **não fecha ciclo nenhum** nessa regra — não é um caso já resolvido, como uma versão anterior deste documento chegou a afirmar. A query de KPI precisa da própria máquina de estados, testada, cobrindo pelo menos: (a) envio → primeira resposta (aprovação ou correção), (b) reenvio → resposta seguinte, (c) o caso de aprovação direta a partir de `correcao_cliente` sem reenvio interveniente, tratado explicitamente (não implicitamente "coberto" por outra regra), e (d) uma segunda (ou terceira) correção pedida enquanto o post já está em `correcao_cliente` — isso grava uma linha nova em `post_approvals` mas **não** gera um novo `post_status_events` (o status não muda), então uma implementação que só olha `post_status_events` perde essas rodadas silenciosamente. A contagem de "rodadas" tem que somar as duas fontes; a query de tempo de resposta precisa decidir explicitamente se cada uma dessas correções reabre o relógio ou só a primeira conta. Definição exata de "rodada" e de "tempo de resposta" fica para o plano, com casos de teste para cada cenário acima (incluindo ordenação por `(created_at, id)` para desempate de eventos atômicos, e o fato de que dados anteriores a `20260606000001` simplesmente não têm `post_status_events` — tratado como amostra ausente, não como zero).
- **Por post:** dentro do card, número de rodadas + tempo médio de resposta daquele post, usando a máquina de estados acima.
- **Agregado:** painel separado, entregue depois dos KPIs por post — janela de tempo, média vs. mediana, tratamento de zero amostras, e se respeita o filtro de status ativo são decisões que mudam o número exibido e ficam para o plano, não para agora.
- **Motivo de ajuste:** tag obrigatória só quando `action = 'correcao'`, com validação de presença e valor no banco (`CHECK`), não só no cliente — cuidado com a semântica de três valores do SQL: `motivo IN (...)` avalia para `NULL` (não `FALSE`) quando `motivo IS NULL`, e um `CHECK` do Postgres só rejeita a linha quando a expressão dá `FALSE` — `NULL` passa. A forma final, com `IS NOT NULL` explícito: `CHECK (action <> 'correcao' OR (motivo IS NOT NULL AND motivo IN ('legenda', 'imagem_video', 'data', 'outro')))`.
- **Rollout em 3 fases — a constraint acima não pode ir ao ar junto com a coluna/RPC.** `hub-approve` sempre chama `record_client_approval` com os mesmos 6 argumentos nomeados até ser redeployado; se o `CHECK` obrigatório já estiver valendo quando só a migration subiu, toda correção enviada nessa janela chega com `motivo = NULL` e é **rejeitada** — quebra a submissão de correção em produção até o redeploy da edge function completar, não é uma janela inofensiva.
  1. **Migration 1:** adiciona a coluna (`motivo text`, nullable) e troca a assinatura da RPC (drop + create de 7 argumentos, revoke/grant só na nova assinatura — ver abaixo), mas com uma constraint **permissiva**: `CHECK (motivo IS NULL OR motivo IN ('legenda', 'imagem_video', 'data', 'outro'))` — valida o valor quando presente, sem exigir presença ainda. `hub-approve` (ainda na versão antiga) continua funcionando sem mudança, `motivo` fica `NULL` em toda correção até o próximo passo.
  2. **Redeploy de `hub-approve`** (com `--no-verify-jwt`) e das três UIs (`InstagramPostCard`, `StoryPostCard`, `TextPostCard`) já enviando a tag. A partir daqui, toda correção nova já chega com `motivo` preenchido.
  3. **Migration 2**, só depois do passo 2 confirmado no ar: troca a constraint para a versão obrigatória (`CHECK (action <> 'correcao' OR (motivo IS NOT NULL AND motivo IN (...)))`), criada como `NOT VALID` — um `CHECK` normal validaria todas as linhas existentes no momento da criação, e linhas antigas de `correcao` sem motivo (as daqui da fase 1 inclusive, e as anteriores a todo esse trabalho) fariam a migration falhar. Com `NOT VALID`, o constraint passa a valer só para linhas novas, sem tentar revalidar o histórico.
- **Correção da assinatura da RPC — duas rodadas de review erradas antes de chegar na correta.** Uma versão anterior deste documento disse que `CREATE OR REPLACE FUNCTION` com um parâmetro novo preserva OID e grants (errado: identidade de function no Postgres é nome + **tipos** dos parâmetros, então isso cria um **overload novo e distinto**). A correção seguinte disse "então basta repetir o revoke/grant na assinatura nova" — também incompleto: manter as **duas** assinaturas vivas ao mesmo tempo (a de 6 e a de 7 argumentos, esta com o 7º com `DEFAULT`) torna toda chamada existente **ambígua**. `hub-approve/handler.ts:139-146` sempre chama com exatamente os mesmos 6 argumentos nomeados (`p_post_id, p_token, p_action, p_comentario, p_is_workspace_user, p_new_status`); com as duas assinaturas no ar, o Postgres tem dois candidatos igualmente válidos para essa chamada (um por casamento exato, outro preenchendo o 7º por default) e recusa a resolver — toda aprovação/correção no Hub passaria a falhar. **A migration tem que substituir a função, não empilhar um overload**: `drop function record_client_approval(bigint, text, text, text, boolean, text);` seguido de `create function record_client_approval(bigint, text, text, text, boolean, text, text default null) ...` com uma única assinatura de 7 argumentos, e o `revoke all ... from public` / `grant execute ... to service_role` aplicados só a essa assinatura final. `hub-approve` continua funcionando sem mudança até ser redeployado (o 7º parâmetro tem default), então a ordem de deploy (migration antes do redeploy da edge function) segue válida, só que agora com uma única function existindo em qualquer momento, nunca duas. Esse drop+create é o que acontece na **Migration 1** do rollout em 3 fases descrito acima, junto com a constraint permissiva — não uma migration à parte.
- Exige tocar as três implementações de UI (`InstagramPostCard`, `StoryPostCard`, `TextPostCard`) que hoje já duplicam a lógica de comentário obrigatório na correção — outro motivo para extrair o componente compartilhado da seção 1. Histórico anterior ao deploy fica sem tag ("Outro/sem categoria" no ranking, não excluído).

### 4. Indicador de comentário não lido — cortado desta entrega

- Movido para fora de escopo (era, nas versões anteriores deste documento, tratado como incluído). O motivo: o Hub não tem usuário autenticado individual — o acesso é por token, e o token pode rotacionar — enquanto o CRM tem usuários individuais. Isso muda o schema (chave do "leitor" é o quê: o token? o `cliente_id`? um usuário específico do CRM?) e o que conta como "lido" (abrir o card? abrir a aba Comentários especificamente?) de um jeito que não dá pra decidir de raspão dentro desta entrega. Fica como feature própria, com seu próprio design, depois que a timeline/comentários estiverem no ar.

## Fora de escopo (explicitamente)

- Rótulo "Rejeitado" como estado distinto de "Em Refação"/"Correção solicitada" na UI.
- Redesenho da view de histórico já existente no CRM.
- Diff lado a lado de mídia (imagem/vídeo).
- Categorização por IA dos motivos de ajuste.
- Indicador de não lido (passivo ou ativo) para comentário novo — feature própria, futura.
- Retroatividade da tag de motivo de ajuste para posts já existentes.
- Filtro de status na aba Aprovações (ela continua sendo só a fila de pendentes).
- Painel de KPI agregado na mesma entrega dos KPIs por post (fases separadas).

## Riscos / pontos a validar antes de construir

1. Confirmar que "Rejeitado" não precisa ser um estado diferente de "Em Refação" na prática da Anna.
2. Confirmar que tags de motivo (4 opções fixas) cobrem os casos reais dela.
3. **Decidir no plano:** se o diff de conteúdo é viável (referência explícita evento↔versão) ou cortado desta entrega; a máquina de estados exata de "rodada"/"tempo de resposta", com casos de teste cobrindo os quatro cenários da seção 3; a janela/agregação do painel de KPI agregado; em quais status a nova caixa de comentário fica habilitada.
4. Confirmar com a Hanna se as respostas da equipe já escritas hoje pela página Mensagens do CRM (`is_workspace_user = true`, via `replyToPostApproval`) devem, em algum momento, também aparecer pro cliente no Hub — o padrão desta entrega é não mostrar (ver seção 1).
