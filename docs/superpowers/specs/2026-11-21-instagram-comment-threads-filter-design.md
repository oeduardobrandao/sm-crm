# Comentários em conversa e filtro por tipo (aba Comentários do post)

Mockups: https://claude.ai/artifact/7KEg9qnxtsQ3AK4C2z95QM
Base: moderação de comentários (PR #858, spec `2026-11-21-instagram-comment-moderation-design.md`).

## Intent

No celular, a lista de comentários de um post confunde: respostas aparecem todas abertas,
recuadas, e a hierarquia se perde numa lista longa. O usuário pediu (1) a lista como no
Instagram, só os comentários principais, com "Ver N respostas" para abrir a conversa, e
(2) filtrar os comentários pelo resultado da leitura da IA, para moderar mais rápido
(achar spam e críticas sem rolar 200 comentários).

## Goals

- Conversas recolhidas por padrão, abertas por toque, no celular e no desktop (é o mesmo
  componente; o Instagram faz o mesmo na web).
- Cada comentário do público ganha um tipo na leitura ("Analisar" / "Refazer leitura"),
  com os mesmos tipos da barra de distribuição: `apoio`, `duvida`, `critica`, `discussao`,
  `spam`.
- Chips de filtro acima da lista: Todos + um por tipo, com contagem.

## Non-goals

- Leitura da conta (card da conta) não ganha tipos nem filtro: ela não tem lista de comentários.
- Não recalcular a barra de distribuição a partir dos tipos (ela segue vindo da parte
  "leitura" da IA; pequenas diferenças entre o % da barra e a contagem do chip são aceitas).
- Classificar automaticamente ao abrir a lista, ou só os comentários novos (decidido: não;
  gastaria a cota diária do Workers AI).
- Responder comentários.

## Anti-goals

- O filtro nunca esconde comentário sem aviso: comentário sem tipo só some quando um tipo
  está escolhido, e uma linha diz quantos estão sem tipo.
- Falha na classificação nunca derruba a leitura: a leitura salva sem tipos.
- Nenhum comentário some da lista por causa do agrupamento (mantém a garantia de
  `groupComments`).

## Approaches considered

- **A. Terceira chamada de IA dentro de "Analisar" (escolhida pelo usuário).** Roda em
  paralelo com "leitura" e "ideias"; os tipos vão salvos dentro de `result` (jsonb), sem
  migration, mesma cota de 20 leituras/hora. Comentários que chegam depois ficam sem tipo
  até "Refazer leitura".
- B. Ação "Classificar" separada + tabela de tipos, incremental. Mais código, outra rota,
  outra cota, um segundo botão.
- C. Classificação automática ao abrir a lista. Sem clique, mas gasta a cota do Workers AI
  (10 mil neurons/dia) a cada post aberto.

Tipos (categorias da barra) em vez de sentimento positivo/negativo: escolha do usuário.
Spam e crítica são o que se oculta ou exclui, e os tipos casam com a barra já na tela.

## Design

### Backend (`supabase/functions/instagram-analytics`)

**Nova parte de IA `tipos`** em `comments-ai.ts`, só no scope `post`:

- Entrada: os comentários do público (`from_owner === false`, texto não vazio), na ordem da
  lista, que couberem em `PROMPT_COMMENT_CHARS`, numerados a partir de 1 dentro de um
  bloco delimitado por nonce (`<<<COMENTARIOS_tag ... >>>`), uma linha por comentário
  (`7| texto`). Os números são índices locais; o id do Instagram nunca vai ao prompt.
- Saída pedida: `{"tipos":{"1":"a","2":"d",...}}` com códigos de uma letra
  (`a`=apoio, `d`=duvida, `c`=critica, `i`=discussao, `s`=spam) para economizar tokens.
  Formato exato e letras são do builder; o que importa: chave por índice, valor validado
  contra os cinco tipos.
- Validação (`validateTipos`): ignora índice fora do intervalo, valor desconhecido,
  duplicata; aceita resposta parcial (índice faltando = sem tipo). Resultado:
  `Record<commentId, Categoria>` mapeado de volta pelo índice. Se menos de metade dos
  comentários enviados vier com tipo válido, trata como sem tipos (saída ruim).
- **Lotes em paralelo (decisão do autor):** o gargalo é o tempo de geração da saída, então a
  classificação vai em lotes de até 100 comentários, cada lote numa chamada própria, todas
  em paralelo com `leitura` e `ideias`. A entrada total é quase a mesma (cada lote leva só os
  seus comentários), então o custo em neurons quase não muda e a espera cai pela metade num
  post de 200. A regra de "pelo menos metade com tipo" vale por lote: lote ruim ou com
  timeout fica sem tipos, os outros valem. Medir no staging com um post grande; se ainda
  estourar o prazo, o builder reduz o lote.
- `MAX_OUTPUT_TOKENS.tipos`: suficiente para 100 pares (builder ajusta).
  Mesmo modelo (`COMMENTS_MODEL`) e mesmo prazo da análise.
- `analyze()` dispara tudo junto. `leitura` e `ideias` seguem obrigatórias
  (mesmos erros de hoje). Os lotes de `tipos` são opcionais: rejeitado, com timeout ou
  inválido, loga `[comments-routes] comments-analysis tipos failed: <motivo>` e a leitura
  salva sem os tipos daquele lote. A espera total continua sendo a da chamada mais lenta,
  dentro do mesmo prazo.

**Armazenamento (decisão do autor: registra o que foi tentado, não só o que deu certo):**
em `instagram_comment_analyses.result`, sem migration:

- `tipos_status: "ok" | "failed"`: `"failed"` quando nenhum lote deu certo (ou não havia
  comentário do público para enviar: aí `"ok"` com mapa vazio). Leituras antigas não têm o
  campo, e é isso que as distingue.
- `tipos: Record<commentId, Categoria | null>` com **todo comentário enviado**: `null` =
  enviado, mas sem tipo válido (lote falhou ou o modelo pulou). Comentário fora do mapa =
  não foi enviado (texto vazio, passou do teto de caracteres, da conta, ou chegou depois).

`toStored` passa adiante como está. O GET da lista já devolve `cached_analysis`, então o
frontend recebe os tipos sem rota nova.

**Redação:** `tipos` não contém texto, só ids e códigos; `redactIdentities` não toca nele.

**Tipos (TS):** `CommentAnalysis` ganha `tipos?: Record<string, Categoria | null>` e
`tipos_status?: "ok" | "failed"`; `Categoria`
= chaves de `distribuicao`, exportada nos dois lados (`comments-ai.ts` e
`apps/crm/src/services/instagramComments.ts`).

### Frontend (`apps/crm/src/pages/analytics-conta/comments/`)

**Conversas recolhidas (`CommentsList`, todas as telas):**

- Renderiza os grupos de `groupComments`. Um grupo com respostas mostra, abaixo do
  comentário principal, o botão "Ver N respostas" (N = respostas do grupo na lista).
  Aberto, as respostas aparecem recuadas como hoje e o botão vira "Ocultar respostas".
  Estado aberto por grupo, local ao painel (`Set<string>` de ids), começa tudo fechado.
- Quando o Instagram tem mais respostas do que as do grupo
  (`replies_more` ou `replies_count > respostas do grupo`), o grupo aberto mostra
  "Mais N respostas · ver no Instagram" (link `sanitizeUrl(post.permalink)`; com
  `replies_more` sem número confiável, "Mais respostas · ver no Instagram").
- A linha de meta deixa de mostrar "N respostas" quando o botão de conversa está presente.
- Paginação segue por comentário principal (`COMMENTS_PAGE = 20` grupos); "Ver mais N
  comentários" conta todos os comentários restantes, como hoje.
- Botão de conversa: `aria-expanded`, `aria-controls` apontando para a lista de respostas.

**Tipo na linha:** comentário com tipo mostra, na linha de meta, um quadradinho com a cor
`igc-cat--<tipo>` e o nome do tipo (`distribution.<tipo>`). Comentário da própria conta e
comentário sem tipo não mostram nada.

**Chips de filtro:**

- Aparecem só quando `cached_analysis.result.tipos_status === "ok"`. Ordem da barra: Todos, Apoio,
  Dúvida, Crítica, Discussão, Spam. Contagem = comentários na lista atual com aquele tipo
  (Todos = todos os comentários da lista). Chip com zero fica oculto, exceto o ativo.
  No celular rolam na horizontal; no desktop quebram linha. `role="group"` com rótulo,
  cada chip `aria-pressed`.
- Com um tipo ativo: lista **plana** de todos os comentários com aquele tipo (principal ou
  resposta), na ordem da lista. Uma resposta mostra "Em resposta a @fulano" (nome do pai na
  lista; sem pai na lista, sem a linha). Comentário principal mostra "N respostas" na meta
  como hoje. Paginação plana de 20.
- Com um tipo ativo e comentários do público sem tipo na lista, até duas linhas
  (sem botão; o "Refazer leitura" está na leitura logo acima), decisão do autor:
  - fora do mapa e com `timestamp` depois de `analyzed_at`: "N comentários chegaram depois
    da leitura e ainda não têm tipo. Refaça a leitura para incluí-los.";
  - o resto (no mapa com `null`, ou fora do mapa e anterior à leitura): "N comentários não
    foram classificados." Sem promessa de que refazer resolve.
- Tipo ativo cujo chip foi a zero (ex.: excluiu o último spam): volta para Todos.
- Filtro reseta ao trocar de post (estado do painel).
- Moderação continua igual em qualquer modo (menu ⋯ por linha). Excluir tira a linha e
  atualiza as contagens; ocultar mantém.

**Leitura antiga sem tipos:** no lugar dos chips, um aviso discreto: "Filtre os
comentários por tipo. Esta leitura é anterior ao filtro. Refaça a leitura para classificar
cada comentário." com botão "Refazer leitura" (chama o mesmo `analyze()` do painel;
desabilitado durante a análise). Sem nenhuma leitura: nem chips nem aviso.

**Classificação falhou nesta leitura** (`tipos_status === "failed"`): no lugar dos chips,
"Não deu para classificar os comentários nesta leitura. Refaça a leitura para tentar de
novo." com o mesmo botão "Refazer leitura". Nunca diz que a leitura é antiga.

**i18n:** chaves novas em `packages/i18n/locales/{pt,en}/analyticsComments.json`:
`threads.view` (plural "Ver 1 resposta"/"Ver N respostas"), `threads.hide`,
`threads.moreOnInstagram` (com e sem número), `filter.ariaLabel`, `filter.all`,
`filter.lateArrivals` e `filter.unclassified` (plural), `filter.inReplyTo`, `filter.legacyTitle`, `filter.legacyText`, `filter.failedText`,
`filter.redo`. Sem travessão na copy.

**CSS:** em `apps/crm/app.css`, junto das regras `igc-*` (página autenticada).

## Constraints

- Deno edge function; `npm run check:functions` é o único type gate do backend.
- Ordem de deploy: `instagram-analytics` antes do merge (o frontend novo funciona com a
  function antiga: sem `tipos`, mostra o aviso de leitura antiga; a function nova com o
  frontend antigo só acrescenta um campo ignorado).
- Workers AI: a terceira chamada consome neurons a mais por leitura; a cota de 20
  leituras/hora por workspace não muda.

## Left to the builder

- Formato exato do prompt e das letras, e o valor de `MAX_OUTPUT_TOKENS.tipos`.
- Se `tipos` usa o mesmo nonce/bloco das outras partes ou um próprio (as outras partes não
  numeram linhas).
- Estrutura interna dos componentes (extrair `CommentThread` / `CommentFilters` se ajudar).
