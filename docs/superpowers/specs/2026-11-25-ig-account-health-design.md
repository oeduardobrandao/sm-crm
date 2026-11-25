# Saúde do Instagram vs contas do mesmo tamanho (Analytics da conta)

Data: 2026-11-25. Status: rascunho para aprovação.

## Intenção

Na página Analytics da conta (`apps/crm/src/pages/analytics-conta/AnalyticsContaPage.tsx`), mostrar ao
social media um cartão "Seu Instagram está indo bem?" que responde numa olhada se a conta do cliente
vai bem **comparada com contas do mesmo tamanho**, e não só com o próprio histórico (que é o que
`apps/crm/src/lib/ig-rates.ts` já faz por post). Serve para a agência mostrar ao cliente onde ele está
e o que puxar (ex.: "Posts em 30 dias: Ruim").

Referência visual: print enviado pelo usuário (veredito geral grande, barra com marcador, 4 cartões de
métrica com veredito, "Você" vs "Contas do seu tamanho", rodapé com o tamanho do grupo e "melhor post").

## Metas

- Veredito geral + 4 métricas, cada uma com percentil contra o grupo de tamanho.
- Fonte dos números do grupo: **híbrida** (decisão do usuário). Tabela de referência de mercado
  semeada na migration; por faixa e métrica, troca automaticamente para dados agregados das contas do
  Mesaas quando houver amostra suficiente. O rodapé diz qual fonte foi usada.
- Nenhum dado de linha de outra agência chega ao navegador; só pontos de corte agregados.

## Não-metas

- Não é o "Analisar outro @" do print (analisar conta não conectada). Só a conta conectada do cliente.
- Não entra em relatórios PDF, Hub nem MCP nesta fase.
- Não muda o score por post existente (`igAlignedScore`).

## Anti-metas

- Publicar percentil de faixa com poucas contas do Mesaas (reidentificável). Piso duro de amostra.
- Apresentar número de mercado como se fosse medido no Mesaas.

## Abordagens consideradas

- **A. Tabela de pontos de corte noturna + cálculo no cliente (escolhida pelo usuário).** Tabela
  `ig_peer_benchmarks` com percentis por faixa e métrica; seed de mercado; cron SQL noturno recalcula
  das contas do Mesaas. O CRM calcula as 4 métricas da conta e posiciona. Barato por visualização, a
  fronteira de privacidade fica no Postgres, trocar de fonte não precisa de deploy.
- B. Calcular sob demanda no `instagram-analytics` com service role. Sempre atual, mas varre contas de
  todas as agências a cada visualização e a fronteira de privacidade fica no código.
- C. Só tabela fixa no frontend. Descartada: perde a metade "dados do Mesaas".

## Desenho

### Faixas de seguidores

`lt1k` (< 1 mil), `1k_5k`, `5k_20k`, `20k_100k`, `100k_plus` (limite inferior inclusivo). Faixa da conta
pelo `instagram_accounts.follower_count` atual. Rótulo no rodapé: "de 5 mil a 20 mil seguidores".

### As 4 métricas (mesma definição para a conta e para o grupo)

Janela fixa, independente do seletor de período da página. "Post de feed" = `instagram_posts` com
`media_type` em `IMAGE`, `VIDEO`, `CAROUSEL_ALBUM` (stories ficam em outra tabela). Reel =
`media_product_type = 'REELS'`. O `/me/media` do sync já recebe esse campo mas não o persiste: a
migration cria `instagram_posts.media_product_type text` e todo upsert de post passa a gravá-lo
(`instagram-sync-cron` e qualquer outro caminho que faça upsert em `instagram_posts`, a conferir com
grep). Histórico sem o campo: `media_type = 'VIDEO'` com `media_product_type` nulo conta como reel
(o sync regrava os 50 posts mais recentes a cada execução, então a janela de 90 dias se preenche
sozinha em poucas horas para quase toda conta).

| Chave | Rótulo | Definição | Precisa de |
|---|---|---|---|
| `engagement_rate` | Taxa de engajamento | mediana de (likes + comments) dos 12 posts de feed mais recentes dos últimos 90 dias ÷ `follower_count` | ≥ 3 posts e seguidores > 0 |
| `posts_30d` | Posts em 30 dias | contagem de posts de feed com `posted_at` nos últimos 30 dias | conta com algum post de feed em 90 dias (0 é valor válido) |
| `reel_views` | Visualizações nos reels | mediana de `impressions` dos 12 reels mais recentes dos últimos 90 dias (excluindo os que têm `impressions` em `unavailable_metrics`) | ≥ 3 reels |
| `reels_share` | Reels no seu feed | reels ÷ posts de feed, sobre os 12 posts de feed mais recentes dos últimos 90 dias | ≥ 3 posts |

Métrica sem dados suficientes: cartão mostra "Sem dados suficientes" e fica fora do veredito geral.
Copy auxiliar da taxa de engajamento: "Mediana de curtidas + comentários dos seus posts recentes ÷ seguidores."

**As 4 métricas são calculadas só em SQL**, numa função `ig_account_health_metrics(p_account_id uuid)`
(STABLE, SECURITY INVOKER) que devolve as 4 métricas, os contadores de amostra e o id do melhor post. O
cron chama a mesma função por conta; o CRM chama por RPC `ig_account_health(p_client_id bigint)`
(SECURITY INVOKER, então RLS e acesso por cliente valem). Uma definição só, sem paridade TS/SQL a
manter e sem ler posts linha a linha no navegador (nada de truncamento por limite do PostgREST).

Limite conhecido do sync: ele busca só a primeira página (50 mídias) por execução. Os posts se acumulam
por upsert, então só uma conta com mais de 50 posts de feed entre duas sincronizações perderia algum,
o que não muda a contagem de 30 dias na prática. Fora do escopo.

### Tabela `ig_peer_benchmarks`

```
band text, metric text,
source text not null check (source in ('mercado','mesaas')),
sample_size int,          -- contas na amostra (mesaas) ou null (mercado)
cuts numeric[] not null,  -- 99 valores: p1, p2, ..., p99, não decrescentes
computed_at timestamptz not null,
primary key (band, metric)
```

- Tabela irmã `ig_peer_benchmarks_mercado` (mesmo formato, sem `sample_size`), só seed.
- Ambas: RLS ligada; `REVOKE ALL FROM PUBLIC, anon, authenticated`. `ig_peer_benchmarks` ganha
  `GRANT SELECT` para `authenticated` e policy SELECT `using (true)` (dado agregado, não pertence a
  workspace). `ig_peer_benchmarks_mercado` fica sem grant para o CRM. Sem `cliente_id`, então fora do
  drift de acesso por cliente.
- Seed copia o mercado para `ig_peer_benchmarks` na própria migration, então a página funciona antes
  da primeira execução do cron.

### Cron `ig_peer_benchmarks_refresh()` (pg_cron, diário `17 6 * * *` UTC)

SQL puro, SECURITY DEFINER, `search_path` fixo, EXECUTE revogado de `PUBLIC, anon, authenticated`.

1. Contas elegíveis: `instagram_accounts` com `follower_count > 0` e `last_synced_at` nos últimos 14
   dias, deduplicadas por `instagram_user_id` (a mesma conta conectada em dois workspaces conta uma
   vez; fica a de `last_synced_at` mais recente).
2. Calcula as 4 métricas por conta com as definições acima (métrica sem dado suficiente: conta fora da
   amostra daquela métrica).
3. Por (faixa, métrica): se `n >= 30`, grava `source='mesaas'`, `sample_size=n`, `cuts` via
   `percentile_cont` em 0.01..0.99; senão copia a linha de mercado (se existir; sem linha de mercado,
a linha some). A gravação `mesaas` só acontece com a chave `platform_settings.ig_peer_benchmarks_mesaas`
(`{enabled}`) ligada, padrão desligada: liga-se só depois da Política de Privacidade nova estar no ar.
Desligada, o cron mantém tudo em mercado. Upsert numa transação só. Voltar
   para mercado é automático quando a amostra do Mesaas cai.

Mudar o piso (30) é editar a função; não há secret.

### Seed de mercado

Valores para as 20 linhas (5 faixas × 4 métricas) vêm de benchmarks públicos de Instagram por faixa de
seguidores (relatórios de engajamento por tier de seguidores, frequência de postagem, alcance de reels,
proporção de formatos). O builder pesquisa e registra **cada fonte e ano num comentário da migration**.
Onde a fonte só dá mediana (ou mediana + quartis), os 99 cortes são interpolados numa log-normal
ajustada a esses pontos (para `reels_share`, numa distribuição limitada a 0..1); o comentário diz que é
estimativa. **Só se semeia uma métrica quando a fonte mede a mesma coisa** que a nossa definição (ou
quando a conversão é exata, ex.: frequência semanal × 30/7). Fonte com definição diferente (ex.:
engajamento incluindo saves, ou por alcance em vez de seguidores) não entra: a linha fica sem seed.

Sem fonte crível e equivalente para uma (faixa, métrica): a linha de mercado **não é semeada** (nada de corte
inventado). `ig_peer_benchmarks` não tem a linha até o Mesaas chegar a 30 contas; o cartão daquela
métrica mostra o valor "Você" sem veredito e o texto "Ainda sem referência para contas do seu tamanho",
e a métrica fica fora do veredito geral. Expectativa realista: com ~150 contas conectadas hoje, a maior
parte das faixas fica em mercado por bastante tempo.

Lacuna conhecida (pré-existente, fora do escopo; a página inteira de Analytics já tem a mesma
lacuna para essa conta, então o cartão só se comporta como o resto da página): `instagram_posts` é único por `instagram_post_id`,
então a mesma conta IG conectada em dois workspaces tem os posts presos à linha que sincronizou por
último; o cliente do outro workspace cai em "Ainda não dá para comparar". O dedup do cron fica com a
linha de `last_synced_at` mais recente, que é a dona dos posts.

### Cálculo no CRM

- `apps/crm/src/lib/ig-account-health.ts` (puro, testado): `bandFor(followers)`,
  `percentileFromCuts(value, cuts)`, `verdictFor(pct)`, `overall(pcts)` (média simples das métricas
  presentes).
- `percentileFromCuts` usa posto médio sobre os 99 cortes, para empates serem determinísticos:
  `lt = #cortes < v`, `eq = #cortes == v`. Com `eq > 0`, percentil = `lt + eq/2 + 0.5` (ex.: zero em
  `posts_30d` com p1..p40 iguais a 0 dá 20,5, não 1 nem 40). Com `eq = 0`, interpolação linear entre o
  corte abaixo e o acima (`v` abaixo de p1 entre 0 e 1, acima de p99 entre 99 e 100). Arredonda para
  inteiro no fim, limitado a 0..100.
- Leitura: `getAccountHealth(clientId)` no data layer = RPC `ig_account_health` (métricas da conta +
  as linhas de `ig_peer_benchmarks` da faixa numa chamada). Query própria `['ig-account-health',
  clientId]`, `staleTime` de 1 h, invalidada junto no "Sincronizar".
- Valor "Contas do seu tamanho" = mediana do grupo (`cuts[49]`, o p50).

### Vereditos (percentil 0–100)

| Faixa | Rótulo | Tom | Ícone (lucide) |
|---|---|---|---|
| ≥ 80 | Muito bom | verde forte | `TrendingUp` |
| 60–79 | Bom | verde | `TrendingUp` |
| 40–59 | Na média | neutro | `Minus` |
| 20–39 | Ruim | laranja | `TrendingDown` |
| < 20 | Muito ruim | vermelho (`--danger-text` no texto) | `TrendingDown` |

Barra: trilho com tique no 50, preenchimento até o percentil na cor do tom, marcador redondo. Texto
"À frente de 71% das contas do seu tamanho".

### Cartão (layout)

- Topo: "Seu Instagram está indo bem?", veredito geral grande, barra, "Somando as N métricas, você está
  à frente de X% das contas do seu tamanho". Linha de destaque: frase da métrica de maior percentil
  ("Seu engajamento é 1,93% por post; em contas do seu tamanho é 0,20%.").
- Grade 2×2 de métricas (1 coluna no phone shell).
- Rodapé: fonte `mesaas` → "*Comparado com 344 contas do seu tamanho no Mesaas (de 5 mil a 20 mil
  seguidores)."; fonte `mercado` → "*Referência de mercado para contas de 5 mil a 20 mil seguidores."
  Fontes mistas na mesma faixa: cada cartão de métrica marca a sua (`*` Mesaas, `†` mercado) e o rodapé
  tem as duas linhas. Com Mesaas em métricas diferentes, o número de contas citado é o menor `sample_size`.
- Na fonte `mercado` os textos dizem "à frente de cerca de X%".
- "Seu melhor post dos últimos 30 dias teve 1,4x o resultado normal da sua conta. Ver o post": maior
  (likes + comments) nos 30 dias ÷ mediana da conta nos 90 dias; "Ver o post" abre o
  `PostMetricsDialog` existente no desktop e o `PostDetailSheet` no `ContaPhone`. O cartão recebe um
callback `onOpenPost(postId)`; cada shell passa o seu, procurando o post na lista que já carregou e,
se ele não estiver lá (filtro de período), buscando-o por id. Some se houver < 2 posts em 30 dias ou mediana 0.
- Posição: topo da aba de visão geral, antes da grade de KPIs; desktop e `ContaPhone`.
- Tokens do CRM (legado hex para tons, shadcn para superfícies); funciona claro e escuro; Vidro herda.

### Estados

Carregando: skeleton do cartão. Conta sem seguidores ou sem post de feed em 90 dias: cartão
"Ainda não dá para comparar. Publique alguns posts e sincronize." Erro de leitura: cartão some (não
crítico, como o baseline). Conta desconectada: segue o estado da página.

### Privacidade

Dados agregados entre agências. Piso n ≥ 30 por faixa e métrica; só cortes percentis saem do banco.
A Política de Privacidade hoje promete, na seção de redes sociais, que esses dados são usados "somente
para mostrar o desempenho da conta ao seu workspace". Essa frase tem de ser **reescrita** (não só
complementada) para incluir o uso agregado e anônimo em referências de comparação. A redação final é
aprovação do usuário. A chave `ig_peer_benchmarks_mesaas` só liga depois dessa política no ar; até lá o
produto funciona só com mercado.

### Testes

- Vitest: `ig-account-health.test.ts` (faixas nas bordas, posto médio com empates e nas pontas,
  vereditos nas bordas, overall com métrica ausente).
- Componente: render com fonte mesaas, mercado e mista; métrica sem referência; estado vazio; phone
  abre `PostDetailSheet`, desktop abre `PostMetricsDialog`.
- psql (`supabase/tests/entitlements/`): `ig_account_health_metrics` com fixture (0/2/3 posts,
  `unavailable_metrics`, reel por `media_product_type` e por `VIDEO` nulo, janelas de 30/90 dias, melhor
  post); `ig_account_health` respeita RLS e acesso por cliente; `authenticated` lê `ig_peer_benchmarks`,
  não escreve, não lê `ig_peer_benchmarks_mercado`, não executa o refresh; `anon` não lê; refresh com
  < 30 contas copia mercado; com ≥ 30 e chave ligada grava mesaas; chave desligada mantém mercado;
  dedup por `instagram_user_id`.

### Deploy

Migration (coluna `media_product_type`, tabelas, seed, funções, chave desligada, agendamento do cron;
tudo SQL, então agendar na mesma migration é seguro) → `instagram-sync-cron` (e os demais que fazem
upsert de posts) com `--no-verify-jwt` onde já é o caso → merge do frontend → política nova no ar →
ligar `ig_peer_benchmarks_mesaas`. Rollback: desligar a chave, depois frontend; tabelas e coluna ficam.

## Deixado ao builder

Números do seed de mercado (com fonte), nomes dos componentes, copy fina dentro das regras acima (sem
travessão em copy).

## Chamadas minhas (não decididas pelo usuário)

Faixas, definições das 4 métricas e janelas, cálculo em SQL, persistir `media_product_type`, posto
médio para empates, piso de 30, limiares dos vereditos, média simples no
veredito geral, posição no topo da visão geral, sem flag de plano, frase na Política de Privacidade.
