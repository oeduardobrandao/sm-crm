# Histórico de aprovação e comentários por post (Hub)

**Data:** 2026-09-17 (revisado duas vezes após review externa)
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
| Notificação de comentário novo | Indicador passivo (badge de não lidos). Sem e-mail/WhatsApp nesta versão. Schema exato tratado como trabalho próprio (ver seção 4), não um detalhe de rodapé. |

## Design

### 1. Histórico + comentários dentro do card (trabalho novo de UI)

- Novo painel (idealmente um componente compartilhado pelos três tipos de card, para não triplicar a implementação e a manutenção), com duas abas: **Histórico** (`post_approvals` com `action IN ('aprovado','correcao')`, mais eventos de `post_status_events` sem `post_approval_id`) e **Comentários** (`action = 'mensagem'`).
- A query precisa trazer `post_approvals` diretamente (não só via `post_status_events.post_approval_id`) — uma segunda correção antes de um reenvio, ou uma mensagem solta, não geram evento de status novo.
- **Diff de conteúdo — condicionado a uma referência confiável.** `post_content_versions` não referencia qual aprovação/evento a gerou (exceto `suggestion_id`, só para sugestões aceitas). Pareamento por "timestamp mais próximo" **não é seguro**: a coalescência de edições em até 5 minutos, um reenvio que não muda texto, e uma edição adjacente de outra ação podem todos produzir uma correlação errada. Duas opções, a decidir no plano: (a) gravar uma referência explícita entre o evento de reenvio/aprovação e a versão de conteúdo no momento em que ambos acontecem (mudança de schema pequena, mas nova), ou (b) cortar o diff desta entrega e mostrar só "conteúdo foi alterado" sem o texto do diff. Não implementar a correlação por proximidade de tempo como se fosse confiável.
- **Vazamento pro cliente.** A query do Hub precisa de um allowlist explícito, não apenas "status ∈ VISIBLE_STATUSES": (a) eventos/versões visíveis só a partir do primeiro envio ao cliente; (b) `actor_name` de membros da equipe — decidir se aparece (ex. "Equipe Hanna") ou é genérico ("Equipe"); (c) o conteúdo (`conteudo` em TipTap JSON) pode carregar `commentHighlight` com `threadId`/`resolved` de comentários internos — hoje o app oculta isso só na renderização (`CommentHighlightReadonly`), mas um endpoint novo que devolva o JSON cru para o Hub processar expõe esses campos no payload se não for explicitamente higienizado antes de responder.
- Fonte de dados: extensão do endpoint `hub-posts` para incluir os campos necessários de `post_status_events`, e uma consulta por post sob demanda para `post_content_versions` (só quando o painel é aberto) — não embutir os snapshots completos no payload de listagem.

### 2. Filtro de status (só em Postagens)

- Chips: Todos / Pendente de Aprovação (`enviado_cliente`) / Correção solicitada (`correcao_cliente`) / Aprovado (`aprovado_cliente`), com contagem ao vivo, reaproveitando `CLIENT_STATUS_LABELS`/`VISIBLE_STATUSES` (`apps/hub/src/lib/postView.ts`).
- Nenhuma mudança de schema.
- Não entra em Aprovações nesta fase (ver tabela de decisões).

### 3. KPIs

- **Definição de ciclo — escrita do zero para este caso, não reaproveitada literalmente de `20260903000030`.** Aquele CTE mede "tempo até a primeira resposta do cliente" e fecha só no primeiro evento com `from_status = 'enviado_cliente'`; ele nem seleciona `to_status`, então não dá pra saber ali se o ciclo fechou por aprovação ou por correção. Uma aprovação vinda direto de `correcao_cliente` (sem reenvio, permitida por `hub-approve`) **não fecha ciclo nenhum** nessa regra — não é um caso já resolvido, como uma versão anterior deste documento chegou a afirmar. A query de KPI precisa da própria máquina de estados, testada, cobrindo pelo menos: (a) envio → primeira resposta (aprovação ou correção), (b) reenvio → resposta seguinte, (c) o caso de aprovação direta a partir de `correcao_cliente` sem reenvio interveniente, tratado explicitamente (não implicitamente "coberto" por outra regra). Definição exata de "rodada" e de "tempo de resposta" fica para o plano, com casos de teste para cada cenário acima.
- **Por post:** dentro do card, número de rodadas + tempo médio de resposta daquele post, usando a máquina de estados acima.
- **Agregado:** painel separado, entregue depois dos KPIs por post — janela de tempo, média vs. mediana, tratamento de zero amostras, e se respeita o filtro de status ativo são decisões que mudam o número exibido e ficam para o plano, não para agora.
- **Motivo de ajuste:** tag obrigatória só quando `action = 'correcao'` — constraint condicional no banco (`CHECK`), não só validação client-side, para não permitir linha sem categoria via chamada direta à RPC. Muda a assinatura de `record_client_approval` (grants precisam ser reconcedidos se a assinatura mudar) e exige tocar as três implementações de UI (`InstagramPostCard`, `StoryPostCard`, `TextPostCard`) que hoje já duplicam essa lógica de comentário obrigatório na correção — outro motivo para extrair o componente compartilhado da seção 1. Requer redeploy de `hub-approve` com `--no-verify-jwt`. Histórico anterior ao deploy fica sem tag ("Outro/sem categoria" no ranking, não excluído).

### 4. Indicador de comentário não lido

- Tratado como trabalho de schema/RPC próprio, não um detalhe de plano. `mensagens_last_seen` não serve como está: seus `CHECK`s e índices únicos pressupõem exatamente um marcador por cliente ou por usuário na conta inteira (não por post), e seus RPCs já alimentam Hub, CRM e o cron de e-mail de mensagens — mexer nele arrisca essas três coisas. Precisa de uma tabela/RPC nova por post (leitor: cliente do Hub ou usuário do CRM; quando um post conta como "lido"; comportamento para respostas da equipe), definida no plano.

## Fora de escopo (explicitamente)

- Rótulo "Rejeitado" como estado distinto de "Em Refação"/"Correção solicitada" na UI.
- Redesenho da view de histórico já existente no CRM.
- Diff lado a lado de mídia (imagem/vídeo).
- Categorização por IA dos motivos de ajuste.
- Notificação ativa (e-mail/WhatsApp) de comentário novo.
- Retroatividade da tag de motivo de ajuste para posts já existentes.
- Filtro de status na aba Aprovações (ela continua sendo só a fila de pendentes).
- Painel de KPI agregado na mesma entrega dos KPIs por post (fases separadas).

## Riscos / pontos a validar antes de construir

1. Confirmar que "Rejeitado" não precisa ser um estado diferente de "Em Refação" na prática da Anna.
2. Confirmar que tags de motivo (4 opções fixas) cobrem os casos reais dela.
3. Confirmar que um indicador passivo de comentário é suficiente por agora.
4. **Decidir no plano:** se o diff de conteúdo é viável (referência explícita evento↔versão) ou cortado desta entrega; a máquina de estados exata de "rodada"/"tempo de resposta", com casos de teste; o schema do indicador de não lido por post; a janela/agregação do painel de KPI agregado.
