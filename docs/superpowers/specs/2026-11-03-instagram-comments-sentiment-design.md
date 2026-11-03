# Comentários do Instagram + leitura por IA (sentimento e ideias)

Status: aprovado. Data: 2026-11-03.

## Intenção

A agência já tem a permissão de comentários da Meta (`instagram_business_manage_comments`). Hoje
o Mesaas mostra só a **contagem** de comentários de cada post; o texto só passa pela automação de
comentário para DM (`instagram-webhook`), nunca chega ao social media. O social
media quer abrir um post e:

1. ver os comentários daquele post;
2. receber uma leitura rápida de um modelo leve (Gemini) sobre o clima da conversa: apoio,
   dúvida, crítica, discussão/polêmica, spam, e o tom geral;
3. receber ideias de conteúdo tiradas do que o público está falando, e salvá-las em Ideias com
   um clique.

E, num nível acima, a mesma leitura somando os posts recentes do cliente, para responder "como
o público desse cliente está reagindo neste mês e o que ele pede".

Sucesso: o social media entende o clima de um post em segundos, sem rolar 200 comentários, e sai
com 3 a 5 pautas que nasceram do público.

## Decisões do usuário

- **Onde:** por post **e** um resumo da conta (cliente).
- **Quando roda a IA:** sob demanda (botão), com o resultado guardado e reaproveitado até
  chegarem comentários novos.
- **Ideias:** botão "Salvar como ideia" em cada sugestão, criando uma ideia em `ideias`.
- **Armazenamento:** comentários buscados **ao vivo** no Instagram; só o resultado da IA é
  guardado. Nenhuma tabela de comentários.

## Objetivos

- Lista de comentários por post (com respostas aninhadas contadas, não expandidas no v1).
- Análise por post: rótulo de sentimento geral, distribuição por categoria, resumo em 2 a 3
  frases, temas recorrentes, perguntas frequentes, 3 a 5 ideias de conteúdo.
- Análise da conta: mesma estrutura, sobre os posts do cliente nos últimos 30 dias.
- "Salvar como ideia" grava em `ideias` do cliente.
- Resultado em cache; aviso de "N comentários novos desde a análise" com botão para refazer.

## Não objetivos (v1)

- Responder, ocultar ou apagar comentários pelo CRM.
- Análise automática no `instagram-sync-cron`.
- Guardar texto de comentário ou nome de quem comentou.
- TikTok, YouTube, Google Meu Negócio.
- Alertas ("comentário negativo chegou").
- Fazer valer `rate_ai_analyses_per_month` (a coluna existe e nada a usa hoje; fica como está).

## Anti-objetivos

- Mostrar ou guardar `@username` de quem comentou dentro do resultado da IA. A IA cita temas e
  paráfrases, nunca nomes.
- Custo que cresce com o número de contas conectadas sem ninguém olhar (por isso sob demanda).
- Ideia salva aparecer para o cliente no Hub sem a agência escolher.

## Estado atual (recon)

- Escopos: `supabase/functions/_shared/instagram-scopes.ts`. O de comentários é opcional e só é
  pedido no OAuth com `IG_AUTOMATION_SCOPES_LIVE=true`. Os concedidos ficam em
  `instagram_accounts.permissions[]`; o teste de escopo é sobre essa coluna (como em
  `apps/crm/src/store/integrations.ts`), não `hasCommentsScope`, que só existe no momento da troca
  do token. Conta conectada antes da flag não tem o escopo e precisa reconectar. A flag liga os dois
  escopos opcionais juntos (comentários **e** mensagens).
- Nenhum código lê `/{media-id}/comments`; existe `igRequest` em `_shared/instagram-messaging.ts`
  para chamadas Graph de comentário, a reaproveitar. A contagem vem de `/me/media?limit=50` e vira
  `instagram_posts.comments` (`instagram-sync-cron`, **de hora em hora**, só os 50 posts mais
  recentes, sem paginação).
- `/disconnect` (`instagram-integration`) **não apaga** a linha de `instagram_accounts`: zera o
  token e marca `disconnected`. Reconectar o mesmo cliente reaproveita o mesmo `id` (upsert por
  `client_id`), mesmo se for outra conta do Instagram.
- Gemini: `instagram-analytics` chama `gemini-2.5-flash` direto por `fetch` (rotas
  `/ai-analysis*`, gate `feature_instagram_ai` em `_shared/feature-guard.ts`, rate limit
  `ig-ai:${contaId}` 10/h). Existe helper com retry em `_shared/report-template/ai.ts`.
- UI de post: `apps/crm/src/pages/analytics-conta/AnalyticsContaPage.tsx` (linha expandida com
  `PostInsightsDetail`), phone `analytics-conta/phone/PostDetailSheet.tsx`. Serviço:
  `apps/crm/src/services/analytics.ts`.
- Ideias: `ideias` + `createIdeia()` em `apps/crm/src/store/ideias.ts` (origem `agencia`,
  `visivel_no_hub` escolhido; trigger notifica o cliente quando visível).

## O desenho

### Backend: rotas novas em `instagram-analytics`

Todas com JWT do usuário, conferindo que o cliente é do workspace (`conta_id`), como as rotas
atuais da função.

1. `GET /post-comments/:clientId/:postId` (`postId` = `instagram_posts.instagram_post_id`)
   - Confere que o post pertence à conta Instagram do cliente.
   - Sem o escopo de comentários na conta: `409 { error: "missing_comments_scope" }`.
   - Busca ao vivo `GET /{media-id}/comments?fields=id,text,timestamp,username,like_count,replies.limit(25){id}`
     paginando até **200 comentários** de nível superior (mais recentes primeiro). A Graph não
     dá total de respostas: o card mostra "N respostas" pelo tamanho da página aninhada, e
     "25+ respostas" quando ela vem cheia ou tem `paging.next`. Devolve
     `{ comments: [...], total_fetched, truncated, cached_analysis }`, onde `cached_analysis` é
     o último resultado salvo para o post (ou `null`) com `comments_count_at_analysis`.
   - A lista vai ao navegador com `username` (é o que o social media vê no Instagram); nada disso
     é gravado.
   - Erro da Graph: mensagem genérica ao cliente, detalhe só no log.

2. `POST /comments-analysis/:clientId/:postId`
   - Busca os comentários ao vivo (mesmo limite de 200), manda à IA só o **texto** (sem
     `username`), junto da legenda do post e do tipo de mídia.
   - Menos de 5 comentários: `422 { error: "too_few_comments" }`, sem chamar a IA.
   - Grava o resultado em `instagram_comment_analyses` (abaixo) e devolve.

3. `POST /comments-analysis-account/:clientId`
   - Posts do cliente com `posted_at` nos últimos 30 dias e `comments > 0`, os **15 com mais
     comentários**; até **60 comentários** por post (total ≤ 900). Cada bloco vai à IA com a
     legenda resumida (primeiros 200 caracteres) para a IA ligar tema a post.
   - A escolha dos 15 usa `instagram_posts.comments`, de propósito: o espelho é atualizado de
     hora em hora para os 50 posts recentes, que cobrem os 30 dias de quase todo cliente. Um post
     que ganhou comentários na última hora pode ficar de fora; aceitável.
   - Mínimo de 10 comentários no total, senão `422 too_few_comments`.
   - Grava com `scope = 'account'`.

4. `GET /comments-analysis-account/:clientId` devolve o último resultado salvo da conta (ou
   `null`) e `current_comments`: a soma atual de `instagram_posts.comments` dos posts dos últimos
   30 dias, para o cartão abrir sem custo e mostrar "N comentários novos desde a análise".

**Prazos.** O Edge Runtime mata a função sem passar pelo `catch` nem logar. Toda chamada externa
leva `AbortSignal.timeout`: 8 s por página da Graph, 25 s por chamada ao Gemini (o backoff entre
tentativas conta no mesmo prazo). Orçamento total por requisição de 50 s: na lista, estourou =
devolve o que já buscou com `truncated: true`; na análise, para de buscar comentários aos 20 s e
segue com o que tem; se o Gemini não responder no prazo, `504 { error: "ai_timeout" }` genérico,
detalhe só no log.

**Conta trocada ou desconectada.** A linha de análise guarda `ig_user_id`. Toda leitura filtra
pelo `ig_user_id` atual da conta, então uma análise de outra conta reconectada no mesmo cliente
nunca aparece. O `/disconnect` passa a apagar explicitamente as análises daquela
`instagram_account_id` (a cascata da FK só cobre a exclusão da linha, que o disconnect não faz).

Gate: rotas `/post-comments*` e `/comments-analysis*` exigem a flag nova
`feature_instagram_comments_ai` em `_shared/feature-guard.ts`. Rate limit próprio
`ig-comments-ai:${contaId}`, 20 análises/hora por workspace (só as rotas POST); a lista de
comentários usa `ig-comments-read:${contaId}`, 120/h.

### Modelo

`gemini-2.5-flash-lite`, `responseMimeType: application/json` com `responseSchema`,
`temperature 0.3`. Reaproveitar o padrão de retry/backoff (429 e erro de rede) de
`_shared/report-template/ai.ts`, extraído para um `_shared/gemini.ts` pequeno se isso não mexer
nos chamadores atuais; senão um helper local. Sem `GEMINI_API_KEY`: `503 ai_unavailable`, e a lista
de comentários segue funcionando.

Prompt em pt-BR. O texto dos comentários vai delimitado e marcado como dado do público, com a
instrução de ignorar ordens contidas nele (comentário é entrada não confiável).

**Nada de identidade no resultado.** O prompt proíbe nomes e `@`, mas o servidor não confia
nisso: antes de gravar, todo texto do resultado passa por uma redação que troca qualquer `@handle`
e qualquer `username` dos comentários buscados (palavra inteira, sem caixa) por "alguém do
público". Trechos literais de comentário sem nome são aceitos (são o que o público disse, sem
autoria). Se depois da redação um campo obrigatório ficar vazio, vale a regra de saída inválida.

Saída (validada no servidor; inválida = `502 ai_bad_output`, nada é gravado). O servidor
acrescenta um `id` (uuid) a cada ideia antes de gravar:

```jsonc
{
  "sentimento_geral": "positivo" | "misto" | "negativo" | "polemico",
  "resumo": "2 a 3 frases",
  "distribuicao": {            // percentuais inteiros, somam 100
    "apoio": 0, "duvida": 0, "critica": 0, "discussao": 0, "spam": 0
  },
  "temas": [{ "tema": "...", "peso": 0-100, "exemplo": "paráfrase curta, sem nome" }], // até 5
  "perguntas_frequentes": ["..."],                                                   // até 5
  "ideias": [{ "titulo": "...", "descricao": "...", "motivo": "o que no público originou" }] // 3 a 5
}
```

Na análise da conta, cada tema pode trazer `post_ids` (instagram_post_id) de onde veio.

### Tabela `instagram_comment_analyses`

| coluna | tipo |
|---|---|
| `id` | uuid pk |
| `conta_id` | uuid, workspace |
| `instagram_account_id` | fk `instagram_accounts` **on delete cascade** |
| `ig_user_id` | text, a conta do Instagram analisada |
| `scope` | `'post' \| 'account'` |
| `instagram_post_id` | text, null quando `account` |
| `comments_analyzed` | int |
| `comments_count_at_analysis` | int (`instagram_posts.comments` no momento; para a conta, a soma) |
| `period_start`, `period_end` | date, só `account` |
| `result` | jsonb (o objeto acima) |
| `model` | text |
| `analyzed_by` | uuid |
| `analyzed_at` | timestamptz |

Só a última análise importa: upsert por (`instagram_account_id`, `scope`, `instagram_post_id`)
com índice único `NULLS NOT DISTINCT`; o `ON CONFLICT DO UPDATE` regrava **todas** as colunas,
inclusive `ig_user_id`, `analyzed_by` e `analyzed_at = now()`. RLS: leitura para membros do
workspace; escrita só pela função (service role). Apagada pelo `/disconnect` (acima) e, em
cascata, se a linha da conta for excluída.

### Ideia salva, sem duplicar

Coluna nova `ideias.origem_sugestao_id text`, nula, com índice único parcial
(`workspace_id`, `origem_sugestao_id`) onde não nula. "Salvar como ideia" grava o `id` da
sugestão nela. Ao abrir uma análise, o CRM consulta as ideias com esses ids e mostra "Salva" nas
que já existem, para qualquer usuário e depois de recarregar. Um segundo clique bate no índice
e não duplica. Refazer a análise gera ids novos: as sugestões novas começam sem "Salva" (as
ideias antigas continuam em Ideias). Conferir se `ideias` tem allowlist de colunas por GRANT
antes de adicionar.

"Comentários novos desde a análise" = `instagram_posts.comments` atual (ou o total buscado ao
vivo, o que for maior) menos `comments_count_at_analysis`. Mostrado quando > 0.

### Plano / flag

Flag `feature_instagram_comments_ai`, padrão `false`, ligada por override no workspace piloto do
usuário (padrão do projeto: flags nascem desligadas). Segue a receita de
`20261108000001_google_feature_flags.sql`: migration da coluna, `FEATURE_COLUMNS` em
`_shared/entitlements.ts`, redeploy dos importadores de `entitlements.ts`, tipos do CRM
(`useWorkspaceLimits.ts`, `entitlement-errors.ts`) e Admin (`api.ts`, `plan-form.ts`), seed e testes.

No CRM, flag desligada = a aba "Comentários" e o cartão da conta **não existem** (não montam, não
fazem consulta). Sem CTA de plano no v1, porque o recurso ainda não está à venda.

### Frontend (CRM)

**Por post** (linha expandida do Analytics da conta e `PostDetailSheet` no phone): uma seção
"Comentários" abaixo dos insights.

- Carrega a lista ao abrir a seção (TanStack Query, `staleTime` 5 min).
- Topo: cartão "Leitura dos comentários". Sem análise: botão "Analisar comentários". Com análise:
  chip do sentimento geral, barra da distribuição, resumo, temas, perguntas, ideias. Aviso
  "N comentários novos desde a análise · Refazer" quando houver.
- Cada ideia: título, descrição, "por quê", botão "Salvar como ideia". Abre o
  `NovaIdeiaDialog` em modo **criação** com uma prop nova `initialValues` (título, descrição +
  motivo + origem, cliente pré-selecionado, `origem_sugestao_id`), separada de `editing`, para o
  usuário revisar e escolher "Visível no Hub" (padrão desligado). Depois de salva, o botão vira
  "Salva" (persistente, ver acima).
- Lista: avatar com inicial, `@username`, texto, data relativa, curtidas, "N respostas".
  "Mostrando os 200 mais recentes" quando `truncated`.
- Estados: sem escopo (texto + botão "Reconectar Instagram", que leva ao fluxo de conexão
  existente), sem comentários, poucos comentários para analisar (botão desabilitado com dica),
  IA indisponível, erro de rede.

**Conta**: cartão "O que o público está dizendo" no Analytics da conta (perto do bloco de IA
existente), últimos 30 dias. Mesmo layout do cartão do post, com "de N comentários em M posts"
e, nos temas, miniaturas dos posts de origem. Abre com o último resultado salvo; botão
"Analisar" / "Atualizar".

Todo texto em pt-BR, sem travessão (regra da casa).

## Restrições

- Edge function: CORS por `buildCorsHeaders`, erro genérico ao cliente, posse do workspace
  conferida antes de qualquer leitura.
- O texto dos comentários é entrada não confiável para a IA e para o HTML: renderizar como texto
  React (nunca `dangerouslySetInnerHTML`).
- Logs nunca levam texto de comentário.
- Deploy: migration (tabela + flag) → `instagram-analytics` + os importadores de
  `entitlements.ts` → merge (frontend vai pro ar no merge).
- Nenhuma mudança de escopo OAuth (tabela abaixo). Conferir quantas contas já têm
  `instagram_business_manage_comments` antes do piloto.
- Ordem de deploy completa: migration (tabela, flag, `ideias.origem_sugestao_id`) →
  `instagram-analytics` + `instagram-integration` (o `/disconnect` novo) + importadores de
  `entitlements.ts` → merge.

### Escopos: nenhuma mudança

Os escopos que o app já pede cobrem o recurso, então esta feature **não mexe** em
`_shared/instagram-scopes.ts`, em `IG_AUTOMATION_SCOPES_LIVE` nem no fluxo de conexão.

| Escopo | Para que já é usado | Usado aqui? |
|---|---|---|
| `instagram_business_basic` | perfil e lista de mídias (`/me`, `/me/media`), base de todo o resto | sim, já concedido |
| `instagram_business_manage_insights` | métricas de post, conta e stories (sync, Analytics, relatórios) | não |
| `instagram_business_content_publish` | publicar/agendar posts | não |
| `instagram_business_manage_comments` | automação comentário para DM: ler o comentário, resposta pública, assinatura do webhook | **sim**: `GET /{media-id}/comments` exige este |
| `instagram_business_manage_messages` | a DM da automação (o POST de private reply dá 403 sem ele) | não |

Os dois opcionais foram aprovados no App Review em 2026-08-27 e `IG_AUTOMATION_SCOPES_LIVE=true`
está em prod desde então (registro da sessão da automação). A rota só confere
`instagram_business_manage_comments` em `instagram_accounts.permissions`; conta conectada antes
de 2026-08-27 que nunca reconectou cai no estado "Reconectar Instagram", que leva ao fluxo de
conexão que já existe.

## Resolvido com o usuário

1. (Resposta: coberto, seguir sem reenvio.) O uso aprovado pela Meta (automação de comentário para DM) cobre ler comentários para análise
   e enviar o texto a um provedor de IA (Google)? Se não, entra reenvio do App Review e um ajuste
   na política de privacidade antes do piloto.

## Decisões minhas (o usuário pode trocar)

- Modelo `gemini-2.5-flash-lite` (o usuário pediu "modelo leve").
- Flag nova e dark, em vez de reaproveitar `feature_instagram_ai`.
- Categorias: apoio, dúvida, crítica, discussão, spam; rótulo geral positivo/misto/negativo/polêmico.
- Limites: 200 comentários por post; conta = 15 posts × 60 comentários, 30 dias.
- Mínimos: 5 comentários (post), 10 (conta).
- "Salvar como ideia" abre o diálogo preenchido em vez de gravar direto.
- Só a última análise de cada post/conta é guardada.

## Para quem for construir decidir

- Formato exato do `responseSchema` e do prompt; validação.
- Se extrai `_shared/gemini.ts` ou fica local.
- Paginação da Graph (`after` cursor) e tratamento de mídia sem comentários habilitados.
- Ordem dos componentes e reaproveitamento visual do bloco de IA existente.
