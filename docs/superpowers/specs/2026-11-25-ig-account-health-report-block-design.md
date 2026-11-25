# Saúde do Instagram como bloco do relatório

Data: 2026-11-25. Status: aprovado em conversa (abordagem e desenho); este é o registro curto.
Depende de `2026-11-25-ig-account-health-design.md` (cartão da Analytics da conta, PR #878).

## Intenção

Levar o cartão "Seu Instagram está indo bem?" para o relatório de blocos, como widget que a agência
adiciona na seção Instagram. O cliente vê no Hub e no PDF onde a conta está contra contas do mesmo
tamanho, no mês do relatório.

## Decisões do usuário

- O widget é o cartão inteiro (veredito geral + 4 métricas + melhor post), um bloco só.
- **Período = o mês do relatório**, não a data em que o relatório é gerado.

## Abordagens

- **Escolhida:** o `report-docs` calcula na geração/atualização, com a função SQL ancorada numa data,
  e congela tudo no `data_snapshot`; o bloco só lê o snapshot.
- Descartada: o bloco chamar a RPC ao renderizar. Hub e PDF não têm usuário logado e o número mudaria
  depois do relatório enviado.
- Descartada: recalcular as métricas em TypeScript a partir dos posts do snapshot. Segunda cópia das
  definições, que divergiria do SQL.

## Desenho

### Banco

- Nova sobrecarga `ig_account_health_metrics(p_account_id uuid, p_as_of timestamptz)`: mesmas
  definições, com as janelas de 30 e 90 dias terminando em `p_as_of` (exclusivo) em vez de `now()`.
  A versão de 1 argumento passa a chamar a de 2 com `now()` (comportamento do cartão do CRM igual).
- EXECUTE da sobrecarga: `service_role` (o `report-docs` usa service role) e `authenticated` (mesma
  regra da de 1 argumento); `anon` não. Migration nova acima de `20261201000003`.

### Snapshot (`_shared/report-docs/snapshot.ts`)

Campo **opcional** `instagram_health` (mesmo precedente de `comparison`; `version: 1` não muda):

```
instagram_health?: {
  as_of: string;              // data (YYYY-MM-DD) do fim usado: dia seguinte a period.effectiveEnd
  followers: number;
  band: FollowerBand | null;
  metrics: Record<HealthMetricKey, number | null>;
  benchmarks: Partial<Record<HealthMetricKey, PeerBenchmark>>;  // cortes vigentes na geração
  best_post: { ratio: number; permalink: string | null; thumbnail_url: string | null } | null;
} | null
```

- `as_of` = `period.effectiveEnd + 1 dia` (mês fechado: dia 1 do mês seguinte; mês corrente: dia
  seguinte à geração). Janelas: posts em 30 dias = 30 dias antes de `as_of`; 90 dias idem.
- `followers` = `instagram_follower_history` no `period.effectiveEnd` (ou a data anterior mais
  próxima dentro de 7 dias); sem histórico, `instagram_accounts.follower_count`. A faixa sai desse
  número (`ig_follower_band`).
- Benchmarks = as linhas de `ig_peer_benchmarks` da faixa no momento da geração.
- Melhor post: `permalink` e thumbnail do post `best_post_id`, com a thumbnail cacheada pelo mesmo
  `cachePostThumbnail` que o snapshot já usa (URL estável).
- Falha nessa leitura não derruba a geração: `instagram_health = null` e log interno (como as
  demais seções opcionais). Instagram desconectado: `null`.
- "Atualizar dados" (`refresh.ts`) recalcula igual.

### Bloco (`packages/report-blocks`)

- Tipo `account_health` (sem prefixo = Instagram para o trigger e para `blockPlatform`; nenhuma
  mudança em `validate_report_layout`). Entra em `ALLOWED_BLOCK_TYPES` de
  `_shared/report-docs/layout.ts`, no catálogo (label "Saúde do Instagram", categoria Conteúdo,
  `platform: 'instagram'`), no `BlockRenderer`, em `data-presence.ts` (tem dado quando
  `instagram_health` existe e há ao menos uma métrica com valor e referência) e em `widgetIcons.ts`.
- Tamanho: só `full`. Fora do layout padrão.
- Visual com o tema do relatório (`rb-*`, `--rb-accent`, fontes do relatório), não com o CSS do CRM:
  mesmo conteúdo e copy do cartão (veredito geral, barra, resumo, linha de destaque, grade 2×2,
  rodapé com fonte, melhor post), em uma coluna no viewer estreito do Hub. Cores de veredito fixas
  (verde/neutro/laranja/vermelho com contraste AA em fundo claro e escuro do relatório), independentes
  do accent. Sem ícones Phosphor (lucide).
- Melhor post: miniatura + "Seu melhor post do período teve 1,4x o resultado normal da conta." com
  link "Ver no Instagram" (`sanitizeUrl`); some abaixo de 1x ou sem post. No PDF o link vira texto
  clicável normal.
- Título do bloco: "Saúde do Instagram"; carimbo "Até {dd/mm}" (o `effectiveEnd`), no padrão do
  `GbpCardHeader`.
- Copy "Posts em 30 dias" fica (a janela é de 30 dias, alinhada às referências).

### Lógica compartilhada

`apps/crm/src/lib/ig-account-health.ts` (percentil por posto médio, vereditos, rótulos, formatação,
tipos) muda para `packages/report-blocks/health.ts`; o CRM passa a importar de lá (re-export no
caminho antigo não; troca os imports). Uma cópia só, mesmos testes.

### Deploy

Migration nova (staging, prod) → merge → `report-docs` **depois** do deploy de produção da Vercel desse
merge (regra das seções: um editor antigo não conhece `account_health`; bundle antigo renderiza tipo
desconhecido como nada, então nada quebra). Rollback: voltar só o `report-docs`; nunca o frontend para
antes do merge depois que existir relatório com o bloco.

## Chamadas minhas

Snapshot opcional com benchmarks congelados, seguidores pelo histórico, bloco só `full`, fora do layout
padrão, "Ver no Instagram", cores de veredito fixas, mudar a lógica para o pacote, e entregar no mesmo
PR #878 (ainda aberto).
