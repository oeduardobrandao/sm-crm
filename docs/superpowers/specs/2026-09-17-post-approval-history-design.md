# Histórico de aprovação e comentários por post (Hub)

**Data:** 2026-09-17 (revisado após review externa)
**Status:** Design proposto, aguardando aprovação
**Origem:** Feedback direto de Anna Lourenço (CLD Advogados), repassado via Hanna

> **Nota de revisão:** a v1 deste documento partiu de uma premissa errada — que
> não existe nenhum comentário por post hoje. Duas revisões externas
> independentes (Codex e Fable), cada uma checada contra o código real,
> mostraram que um thread de comentários por post **já existe** no Hub. A
> seção 1 e a antiga seção 4 foram reescritas por causa disso; o resto do
> documento (filtro de status, KPIs, tag de motivo) segue a ideia original,
> mas com as lacunas de definição que as revisões acharam, corrigidas.

## Contexto

Hoje o Hub do cliente tem três pontos de atrito de rastreabilidade, segundo a Anna:

1. **Aba "Aprovações":** ao aprovar ou pedir correção, o card "some" — parece perder o histórico.
2. **Aba "Postagens":** mostra só a versão final, sem o processo que levou até ali.
3. **Aba "Mensagens":** um chat único por workspace mistura pedidos de ajuste de posts diferentes numa fila só.

### O que já existe hoje (corrigido após review)

- **O comentário por post já existe.** `post_approvals` (`supabase/migrations/20260402_workflow_posts.sql`) grava uma linha por ação: `aprovado`, `correcao` (ambas via `record_client_approval`, que também move o status) e `mensagem` (via `hub-approve/handler.ts`, texto livre, **sem** mudar status). `PostCard.tsx` (usado por `InstagramPostCard`/`StoryPostCard`/`TextPostCard`) já renderiza essas linhas numa seção "Comentários" com distinção visual time/cliente e uma caixa de resposta (`handleReply` → ação `mensagem`).
- **Esse thread já aparece em mais de uma aba.** `PostagensPage` usa `VISIBLE_STATUSES` (`enviado_cliente`, `aprovado_cliente`, `correcao_cliente`, `agendado`, `postado`, `falha_publicacao` — `apps/hub/src/lib/postView.ts`) e mostra o post com o mesmo `PostCard`/thread em **qualquer** status. Só a `AprovacoesPage` filtra para `status === 'enviado_cliente'` (fila do que está pendente agora) — é isso, especificamente, que faz o card "sumir" da aba Aprovações quando ela age nele. O post e seu histórico continuam existindo e visíveis em Postagens.
- `post_status_events` (`20260606000001_post_status_events.sql`): trigger que loga toda transição de status real (guard `from_status IS DISTINCT FROM to_status`), ligado a `post_approvals` via `post_approval_id` quando a transição veio de uma ação do cliente.
- `post_content_versions` (`20260923000001...` + fixups `20260923000004-8`): snapshot do **texto** (`conteudo`, `conteudo_plain`, `ig_caption`, `tiktok_caption`, `changed_fields`) a cada edição que muda algo — não guarda mídia.
- Já existe uma convenção de pareamento de ciclo "enviado → fechado" para medir tempo de resposta, usada em analytics de workflow (`20260903000030_workflow_analytics_events.sql`, CTEs `pse`/`ciclos`/`latencias`): abre o ciclo no evento que leva a `enviado_cliente`, fecha no primeiro evento seguinte com `from_status = 'enviado_cliente'`, desempatando por `(created_at, id)` pra transições atômicas com timestamp igual. Isso é exatamente o que precisamos para "tempo de resposta" — não uma regra nova.
- No CRM já existe um equivalente funcional pro histórico de status (`buildPostTimeline()`/`PostTimelinePopover.tsx`) e pra versões de conteúdo (`buildVersionTimeline()`/`PostVersionHistorySheet.tsx`), em `apps/crm/src/pages/entregas/components/`. **Atenção:** `buildPostTimeline()` só anexa o comentário de uma aprovação via `post_approval_id` de um evento de status — uma linha `mensagem` (sem transição) ou uma segunda correção antes de um reenvio (sem novo evento de status, pelo guard acima) não aparecem nele. A implementação do Hub não pode reusar essa função como está; precisa de uma query que já traga `post_approvals` standalone também.

### O que é, de fato, novo

- **Não** uma tabela de comentários — ela já existe. O que falta é: (a) uma forma melhor de ver o post fora da fila de pendentes quando ele já foi respondido (a Anna já tem isso em Postagens, mas talvez não tenha percebido — vale confirmar com ela antes de gastar esforço redesenhando algo que já funciona); (b) separar visualmente, dentro do mesmo thread, "eventos do processo" (envio, correção, reenvio, aprovação — já rotulados) de "comentários livres" (mensagem), como duas abas dentro do card, já que hoje é uma lista única; (c) o diff de conteúdo por versão (`post_content_versions` nunca foi exposto no Hub); (d) o filtro de status; (e) os KPIs; (f) a tag de motivo de correção.

## Decisões de escopo (validadas com a Hanna, revistas após review externa)

| Ponto em aberto | Decisão |
|---|---|
| "Rejeitado" vs "Em Refação" | **Mesmo status**, sem mudança de enum. Mas por recomendação da review externa: **não introduzir a palavra "Rejeitado" na UI** por enquanto — usar só "Em Refação", pra não sugerir que existe uma rejeição terminal quando não existe. Confirmar com a Anna se ela realmente precisa de um estado "descartado, não volta pra fila" antes de expor esse rótulo. |
| Comentários gerais | **Já existem** (thread de `post_approvals`, ação `mensagem`). Não requer tabela nova. O trabalho aqui é reorganizar a apresentação (separar em aba "Comentários" dentro do card, ao lado de "Histórico"), não criar o dado. |
| Onde a timeline/thread aparece | Aprovações (só posts pendentes) e Postagens (todos os status visíveis ao cliente) — como já é hoje. Nenhuma mudança de escopo de página; o que muda é o conteúdo do card em ambas. |
| Onde os KPIs aparecem | Por post (dentro do card) **e** um resumo agregado (painel acima da lista). Janela de tempo, e se o agregado respeita o filtro de status ativo, ficam para a fase de plano — ver "Riscos" abaixo. |
| Diff de conteúdo | Incluído, só texto (legenda), sob demanda ao clicar num evento — não fica sempre visível. Diff de mídia fica **fora de escopo**: `post_content_versions` não guarda snapshot de mídia; um evento de troca de mídia aparece como texto genérico ("Mídia foi alterada"), sem miniatura antiga. |
| Categorização de motivo de ajuste | Tag manual no momento do pedido de correção (chip: Legenda / Imagem-vídeo / Data / Outro), não inferência por IA. Só vale daqui pra frente. |
| Notificação de comentário novo | Indicador passivo (badge de não lidos), reaproveitando o padrão de `mensagens_last_seen` já usado no chat de workspace, adaptado por post. Sem e-mail/WhatsApp nesta versão. |

## Design

### 1. Timeline de eventos + comentários por post (dentro do card já existente)

- **Não é uma feature nova de UI de card** — é uma reorganização do bloco "Comentários" que já existe em `PostCard.tsx`, em duas abas dentro do mesmo espaço: **Histórico** (linhas com `action IN ('aprovado','correcao')`, já rotuladas e coloridas por ator, mais os eventos de `post_status_events` que não têm `post_approval_id` — ex.: reenvio automático) e **Comentários** (linhas com `action = 'mensagem'`, sem alterar status — igual à caixa de resposta que já existe hoje).
- A query precisa trazer `post_approvals` diretamente (não só via `post_status_events.post_approval_id`), porque uma segunda correção antes de um reenvio, ou uma mensagem solta, não geram evento de status novo.
- Cada linha de **Histórico** com mudança de conteúdo pode ser clicada para expandir o diff de texto (trecho removido riscado / novo destacado), usando `post_content_versions.conteudo`/`conteudo_plain`/`changed_fields`. Como não existe hoje uma referência direta de uma aprovação para a versão de conteúdo correspondente, a correlação será por `post_id` + janela de tempo mais próxima (a definir com precisão no plano — ver Riscos).
- **Vazamento pro cliente:** o diff e a timeline só podem expor dados client-facing. `post_content_versions`/`post_status_events` guardam nomes de membros da equipe, status internos (`rascunho`, `revisao_interna`, `aprovado_interno`) e o conteúdo pode ter marcações de comentário interno (`CommentHighlightReadonly`). A query do Hub precisa de um allowlist explícito de eventos/versões visíveis (status ∈ `VISIBLE_STATUSES`, sem marcação interna), e um piso de "a partir do primeiro envio ao cliente" — não expor rascunhos anteriores.
- Fonte de dados servida via extensão do endpoint `hub-posts` (que já devolve `post_approvals` por token/cliente) com uma consulta por post sob demanda para `post_content_versions` — não embutir todos os snapshots completos (JSON grande) no payload de listagem inteiro, que hoje já lista todos os posts de uma vez.

### 2. Filtro de status

- Chips no topo da lista (Aprovações e Postagens): Todos / Pendente de Aprovação (`enviado_cliente`) / Em Refação (`correcao_cliente`) / Aprovado (`aprovado_cliente`), com contagem ao vivo — reaproveitando os rótulos já centralizados em `CLIENT_STATUS_LABELS`/`VISIBLE_STATUSES` (`apps/hub/src/lib/postView.ts`), não uma nova lista de status.
- Nenhuma mudança de schema. Em Postagens, os chips convivem com os status "presentational" que já existem lá (`publicando`, agendado atrasado etc.) — o filtro atua sobre o status real, os rótulos de exibição continuam os de hoje.
- Em Aprovações, como a página já é só a fila pendente, o filtro tem menos efeito prático (é essencialmente "Pendente" sempre) — o filtro de status ganha mais valor em Postagens, que já cobre todos os status.

### 3. KPIs

- **Tempo de resposta:** reaproveitar a convenção já existente de pareamento de ciclo em `20260903000030_workflow_analytics_events.sql` (CTEs `pse`/`ciclos`) — abre no evento que leva a `enviado_cliente`, fecha no primeiro evento seguinte com `from_status = 'enviado_cliente'`, desempate por `(created_at, id)`. Isso já resolve corretamente: múltiplas correções antes de um reenvio (conta como um ciclo até fechar), e uma aprovação direta vinda de `correcao_cliente` sem passar de novo por `enviado_cliente` (fecha o ciclo anterior, mesma regra).
- **Rodadas de ajuste:** contagem de ciclos fechados com `pelo_cliente = true` e `to_status = 'correcao_cliente'` (mesmo padrão), não uma contagem solta de linhas em `post_approvals` — evita contar uma segunda mensagem/correção dentro do mesmo ciclo como uma rodada extra.
- **Por post:** dentro do card, número de rodadas + tempo médio de resposta daquele post especificamente.
- **Agregado:** painel acima da lista com rodadas médias, tempo médio de resposta e motivos mais frequentes (contagem de tags). **Em aberto para o plano:** a janela de tempo padrão (últimos 30 dias?), se a métrica usa média ou mediana, e se o agregado respeita o filtro de status selecionado ou é sempre workspace-wide — são escolhas que mudam a query e o número exibido, não decidir aqui às pressas.
- Motivo de ajuste: tag obrigatória (Legenda / Imagem-vídeo / Data / Outro) ao pedir correção, gravada em `post_approvals` (nova coluna) — isso muda a assinatura de `record_client_approval` e exige redeploy de `hub-approve` (com `--no-verify-jwt`, como as demais functions do hub) e da RPC. Histórico anterior ao deploy fica sem tag, tratado como "Outro/sem categoria" no ranking, não excluído silenciosamente.

### 4. Comentários — já existentes, sem tabela nova

- (Ver seção 1.) Nenhuma tabela nova. O trabalho é apresentar a mesma fonte de dados como uma aba "Comentários" separada de "Histórico" dentro do card, mantendo a caixa de resposta que já existe (`handleReply`/`submitApproval(..., 'mensagem', ...)`).
- Indicador de não lido: adaptar o padrão de `mensagens_last_seen` (hoje por `cliente_id`/`user_id`) para granularidade por post — ou usar `post_id` como chave adicional; decisão de schema exata fica pro plano.

## Fora de escopo (explicitamente)

- Rótulo "Rejeitado" como estado distinto de "Em Refação" na UI (aguardando confirmação da Anna).
- Redesenho da view de histórico já existente no CRM.
- Diff lado a lado de mídia (imagem/vídeo) — sem dado histórico de mídia hoje.
- Categorização por IA dos motivos de ajuste.
- Notificação ativa (e-mail/WhatsApp) de comentário novo.
- Retroatividade da tag de motivo de ajuste para posts já existentes.
- Mudar o comportamento da aba Aprovações (continua só fila de pendentes) — a menos que a Anna confirme que isso é o que ela realmente quer mudar, depois de saber que Postagens já mostra tudo.

## Riscos / pontos a validar antes de construir

1. **Confirmar com a Anna** se ela sabia que Postagens já mostra o histórico/comentário de posts respondidos — o problema real pode ser só descoberta/UX (ela não estar olhando lá), não ausência de dado. Isso muda o tamanho do trabalho.
2. Confirmar que "Rejeitado" não precisa ser um estado diferente de "Em Refação" na prática dela.
3. Confirmar que tags de motivo (4 opções fixas) cobrem os casos reais dela.
4. Confirmar que um indicador passivo de comentário é suficiente por agora.
5. **Definir no plano, não aqui:** a regra exata de correlação entre uma entrada de histórico e sua `post_content_versions` (por timestamp mais próximo, ou adicionar uma referência explícita no momento do reenvio); a janela/agregação exata do painel de KPI; o schema exato do indicador de não lido por post.
