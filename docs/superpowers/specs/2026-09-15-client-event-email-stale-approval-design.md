# Digest de aprovações pendentes nunca notifica posts "velhos" — Design

## Contexto

Investigando uma reclamação do workspace Hanna Marques (`d8074873-596f-49e5-995d-4b51ce62569d`)
de que clientes não estavam recebendo os e-mails de "Pendências do Hub", encontramos um bug
estrutural no `client-event-email-cron` (não específico desse workspace).

O cron roda a cada 15 min, e para cada cliente busca (a) posts atualmente com
`status = 'enviado_cliente'` (aguardando aprovação) e (b) mensagens não lidas do
workspace, dentro da janela `(lower, event_claim_through]`, onde hoje:

```
const floor = new Date(now.getTime() - SEVENTY_TWO_HOURS_MS);
const lower = maxDate(row.event_cursor_at, floor);
```

O piso de 72h é intencional (comentário original em `handler.ts:34-37`): evita despejar
um backlog de dias em quem nunca recebeu e-mail ou reativou o recebimento depois de muito
tempo opt-out. **Não faz sentido para aprovações pendentes**, cuja consulta já é limitada a
posts cujo status *atual* ainda é `enviado_cliente` — não existe risco de "despejo", e um
post pendente há mais de 72h é exatamente o caso que mais precisa ser avisado.

Pior: como `event_cursor_at` é um único watermark que avança até `upper` independente do
que o piso excluiu, um post pendente excluído pelo piso numa execução fica **órfão
permanentemente** — toda execução futura usa esse cursor já avançado como piso inferior, e
o post nunca mais entra em nenhuma janela.

Efeito colateral hoje, à parte da não-notificação: um cliente cujo único conteúdo elegível
está há mais de 72h no passado bate `skippedNoContent` a cada tick (a cada ~15 min,
indefinidamente — o único freio é o gate de 30 min de `event_claimed_at` na RPC de claim).
Depois do fix, esse cliente processa o conteúdo uma vez e avança o cursor normalmente, em
vez de ser reconsiderado para sempre sem nunca produzir nada.

### Evidência levantada (produção, 2026-09-15)

No workspace Hanna Marques:

- Nenhum e-mail de evento a cliente foi enviado com sucesso antes de 2026-09-14 12:30
  (primeiro `client_event_email_sent` em `audit_log` para essa conta) — indício de que o
  toggle `workspaces.send_client_event_emails` (default `false`) só foi ligado por volta
  dessa data.
- Cliente 406 (CLD Advogados): 6 posts enviados para aprovação em 2026-09-09, **ainda
  pendentes hoje** (6 dias), nunca notificados — `event_cursor_at` nulo, então após o fix de
  código estes já passam a ser cobertos (piso vira "desde sempre", sem precisar de backfill).
- Cliente 417 (Roberta Lopes): mesmo padrão, 6 posts parados desde 2026-09-09.
- **Órfãos por cursor já avançado** (não resolvido só com o fix de código, precisa do
  backfill): usando o critério correto (ver seção Backfill — comparar contra `audit_log`,
  não só "chegou antes do cursor atual"), são **10 posts** em 4 clientes: 405 Rachel
  Gonzaga (2), 407 Universitário & Uni-Jr. (2), 409 Daniela (3), 416 Lorena Borges (3).
  Uma primeira passada usando só "`created_at` do post `<=` cursor atual" (sem cruzar com
  `audit_log`) apontou 15 posts nesses mesmos 4 clientes, mas 5 desses já tinham sido
  entregues normalmente (confirmado em `audit_log.metadata.posts` das linhas de
  2026-09-14/15) — esse critério mais simples conta "qualquer post ainda pendente enviado
  antes do cursor", que inclui tanto órfão quanto post mailado corretamente cujo cliente só
  ainda não aprovou. Ver seção Backfill para o critério certo.
- Confirmado que não é problema de infraestrutura de envio: 7 dos 12 clientes do workspace
  recebem e-mails normalmente (Resend, domínio, `RESEND_API_KEY` — tudo OK), e a conta tem
  `feature_hub_portal` habilitado e tokens de hub válidos para todos os 12 clientes.

### Base de implementação

Este worktree (`.claude/worktrees/feature-requirements-54a250`) está **87 commits atrás de
`origin/main`** e carrega 2 commits soltos (`test(analytics): add stories analytics service
tests`, `feat(analytics): add instagram_story_insights table...`) que são uma tentativa
duplicada e órfã da mesma feature já mergeada corretamente via PR #426
(`feat(analytics): Instagram Stories metrics`). `client-event-email-cron` **não existe neste
worktree** — só existe em `origin/main` (introduzido no commit `883652c9`, que não é
ancestral deste HEAD). Toda referência a arquivo/linha nesta spec foi verificada lendo o
checkout principal (`/Users/eduardosouza/Projects/sm-crm`), não este worktree — e as
evidências de produção acima foram lidas direto do banco (`npx supabase db query`), não
deste código local.

**Implicação para implementação**: não dar `git rebase`/merge neste worktree (arrastaria os
2 commits órfãos de stories, que não devem ir para o PR deste fix). Em vez disso, criar um
branch novo a partir de `origin/main` atual (worktree descartável) e implementar lá. O
deploy também precisa vir desse branch — este worktree não tem a function para dar deploy.

## Decisões (confirmadas em brainstorming 2026-09-15)

1. **Piso de 72h se divide por tipo de conteúdo**: removido para aprovações pendentes,
   mantido para mensagens não lidas. Não remover globalmente nem apenas aumentar o valor
   (adia o problema, não resolve — qualquer piso fixo ainda torna órfão um post mais velho
   que ele). A razão para manter alguma proteção do lado de mensagens não é "despejo de
   conteúdo" (o e-mail só mostra uma contagem, não o corpo das mensagens — ver Design
   técnico), é que uma contagem grande e velha ("47 mensagens não lidas") é pior UX do que
   uma pequena e precisa, e mudar esse comportamento não é o bug que estamos corrigindo —
   melhor manter o fix cirúrgico no lado de aprovações.
2. **Sem cadência de lembrete recorrente.** Cada evento continua sendo mencionado uma
   única vez, no primeiro digest cuja janela o alcança — igual ao comportamento atual, só
   removendo o ponto cego. Uma reincidência (lembrar de novo se o cliente continuar
   ignorando) fica fora de escopo, é problema separado.
3. **Rollout é plataforma inteira, não só Hanna Marques.** É um bug estrutural do cron.
   Diferente do que a primeira leitura sugeria, a "onda de recuperação" por cliente é
   pequena — o critério correto de órfão (ver Backfill) é bem mais restrito do que "todo
   post ainda pendente enviado há muito tempo", então não é um flood nem para o cliente nem
   pra caixa de entrada de ninguém.
4. **Backfill é script ad-hoc, não migration.** É uma correção de dado point-in-time
   (quais posts estão hoje genuinamente órfãos), não uma mudança de schema. Roda via
   `npx supabase db query --linked`, uma única vez, dentro de uma janela com o cron
   pausado (ver Rollout) — não é uma ferramenta para rodar repetidamente depois disso.

## Design técnico

Arquivo tocado: `supabase/functions/client-event-email-cron/handler.ts`. Sem migration, sem
mudança de schema.

Hoje um único `lower` alimenta as duas consultas (aprovações e mensagens). Passa a haver
dois limites inferiores independentes:

```ts
// Aprovações: sem piso. A consulta já é limitada a posts cujo status ATUAL ainda é
// enviado_cliente, então não há risco de despejo — um post pendente há muito tempo é
// exatamente o que o cliente mais precisa ver.
const approvalsLower = row.event_cursor_at ? new Date(row.event_cursor_at) : EPOCH;

// Mensagens: mantém o piso de 72h. O e-mail só renderiza a CONTAGEM de mensagens não
// lidas (unreadMessages: messages.length), não o conteúdo — então o risco não é "despejar
// texto antigo", é mostrar um número grande e velho que não ajuda o cliente a agir. Já tem
// também seu próprio limite natural via mensagens_last_seen (lastSeenAt) — isso é
// independente do piso de 72h e continua valendo dos dois lados.
const messagesFloor = new Date(now.getTime() - SEVENTY_TWO_HOURS_MS);
const messagesCursorLower = maxDate(row.event_cursor_at, messagesFloor);
const msgLower = maxDate(lastSeenAt, messagesCursorLower);
```

`EPOCH = new Date(0)`. `msgLower` só pode ser calculado depois da leitura de
`mensagens_last_seen` (`lastSeenAt`), que no handler atual acontece depois da consulta de
aprovações — a ordem das declarações no arquivo final precisa respeitar isso (o snippet
acima é ilustrativo, não a ordem literal de execução).

Por que EPOCH em vez de só aumentar o piso para um valor generoso (ex.: 90 dias): a
mensagem central do e-mail já é limitada em tamanho por `RENDERED_POSTS_CAP`
(`_shared/client-event-email.ts`) — um backlog grande não vira um e-mail gigante, vira um
e-mail com "+N" no fim. Não existe um valor de piso que resolva o problema de fato; qualquer
valor fixo só empurra a mesma falha para posts ainda mais velhos. EPOCH é a escolha que
efetivamente fecha o buraco.

Nada mais muda na paginação: `EVENTS_QUERY_CAP` (1000 linhas, drena do mais antigo para o
mais novo entre execuções) e a lógica de fechamento de grupos empatados por `created_at` só
olham para `upper`/linhas já buscadas, nunca para `lower` — é exatamente por isso que alargar
a janela de aprovações é seguro sem tocar nesse mecanismo.

**Comentários que ficam desatualizados e precisam ser reescritos** (todos descrevem hoje um
piso único compartilhado): o bloco de cabeçalho do arquivo (linhas 34-37), a nota sobre
"GREATEST'd against now()-72h" (linhas 26-27), o comentário sobre `msgLower` (linhas
380-382), e a nota sobre `boundIso` sempre `> lowerIso` (linhas 527-529) — essa invariante
continua verdadeira com dois limites (toda linha buscada é `> approvalsLower` ou
`> msgLower`, ambos `>= cursor`), só o texto precisa citar os dois nomes em vez de um.
`lowerIso` (variável hoje computada uma vez para as duas consultas) deixa de ser usada
diretamente e deve ser removida — o lint do Deno acusa a variável não usada se ficar.

### Limitações aceitas

**Acoplamento pelo cursor compartilhado.** Aprovações e mensagens têm limites inferiores
independentes, mas ainda avançam o **mesmo** `event_cursor_at`, e o bound final
(`boundIso`) é o mínimo entre os dois quando qualquer um bate o cap de 1000 linhas
(`EVENTS_QUERY_CAP`). Se um cliente tiver um backlog de aprovações grande o bastante para
bater esse cap — agora mais alcançável, já que a janela deixou de ter piso —, o bound mais
conservador do lado de aprovações também atrasa mensagens recentes desse cliente por
múltiplos ciclos de 15 min. Isso exige >1000 posts pendentes simultâneos para UM cliente —
volume não observado nos dados auditados nesta spec (o pior caso real encontrado foi 10
posts) — então tratamos como limitação aceita, não como algo que este fix precisa resolver.
Se doer na prática, a solução é dois cursores por cliente (schema novo, fora de escopo).

**Grupo de empate maior que 2x o cap.** `appendTiedTail` já documenta (comentário original)
que um grupo de linhas com o mesmo `created_at` maior que `2 * EVENTS_QUERY_CAP` (2000) não é
completamente resolvido — loga um aviso e segue com o grupo possivelmente incompleto.
Pré-existente ao fix; alargar a janela de aprovações aumenta a chance de efetivamente
exercitar um backlog grande o bastante para tocar esse caminho, mas o caso extremo em si
(2000+ transições de status no mesmo timestamp truncado, para o mesmo cliente) segue
extremamente improvável. Aceito como limitação pré-existente.

**Custo de consulta em conta antiga com cursor nulo — verificado, não é um problema real.**
A preocupação inicial era que, com `EPOCH`, a consulta de aprovações para um cliente nunca
antes emailado varreria todo o histórico de `post_status_events` da CONTA. Rodamos
`EXPLAIN ANALYZE` em produção contra o workspace com mais volume da plataforma
(`cbaf0da8-d042-46dd-a8ee-cd5ca2b857a0`, 3.955 linhas em `post_status_events`) simulando
`EPOCH` como limite inferior: **0.571ms**. O plano usa `idx_workflow_posts_cliente` primeiro
(o filtro real do handler é por `workflow_posts.cliente_id`, não por `conta_id` — a consulta
é implicitamente por CLIENTE, não por conta inteira) e só então entra em
`post_status_events` via `idx_post_status_events_post_created_at (post_id, created_at)` — o
volume relevante é "posts de um cliente" (dezenas), não "eventos da conta inteira"
(milhares). Nenhum índice novo necessário; item removido da lista de verificação do
rollout.

## Testes

Em `supabase/functions/__tests__/client-event-email-cron_test.ts`:

**Atualizar** (comportamento muda):
- `"NULL cursor: lower bound is now-72h, an event 80h old is excluded"` (linha 393) — o
  evento de 80h deve passar a ser **incluído** e enviado, não pulado.
- `"cursor 5 days old: lower bound is still now-72h (GREATEST)"` (linha 418) — os dois
  eventos (o de 5 dias e o recente) devem aparecer no mesmo digest, já que aprovações não
  usam mais o piso.

**Adicionar** (comportamento novo a travar):
- Equivalente aos dois testes acima, mas para mensagens — provando que o piso de 72h
  continua valendo do lado de mensagens.
- Caso misto, verificado pelo conteúdo real (não só `emailed === 1`): mesmo cliente, mesma
  execução, uma aprovação pendente há mais de 72h *e* uma mensagem não lida há mais de 72h
  — o teste deve checar `metadata`/HTML resultante mostrando a aprovação presente e a
  contagem de mensagens em 0, não só que um e-mail saiu.
- Caso "estado pós-backfill": cursor mais antigo que 72h, com uma aprovação e uma mensagem
  ambas entre o cursor e `now-72h` — a aprovação deve sair, a mensagem não. Esse é
  exatamente o estado em que um cliente fica logo depois do backfill rebobinar o cursor, e é
  diferente do caso de cursor nulo (já coberto pelos testes atualizados acima).

## Backfill

Cobre os posts que hoje estão genuinamente órfãos por cursor — o fix de código sozinho não
os resgata, porque o cursor desses clientes já avançou para depois do `created_at` do evento
que os trouxe para `enviado_cliente`, e a consulta corrigida ainda exige `created_at >
cursor`.

Não cobre (nem precisa cobrir) clientes com `event_cursor_at` nulo — esses já passam a ser
descobertos de graça assim que o fix de código for pra produção, já que o piso deles vira
`EPOCH`.

### Critério de órfão (corrigido após duas rodadas de revisão externa)

**Por que "post ainda pendente com `created_at <= cursor`" não é o critério certo.** Depois
que um envio bem-sucedido acontece, o cursor avança para perto de "agora" — cobrindo todo
post que acabou de ser mandado, aprovado ou não pelo cliente. Um post que foi mailado
corretamente e o cliente simplesmente ainda não aprovou também satisfaz `created_at <=
cursor`, exatamente como um órfão de verdade. Rodar esse critério contra o Hanna Marques
apontou 15 posts; cruzando com `audit_log`, 5 desses já tinham sido entregues (confirmado
em `metadata.posts` das linhas de 2026-09-14/15) — o critério solto teria rebobinado o
cursor e reenviado menção a posts que não precisavam disso.

**Critério certo tem DUAS partes, não uma.** A primeira revisão externa apontou (corretamente)
que "chegou antes do cursor" sozinho é solto demais; a segunda revisão apontou (também
corretamente) que só o teste de `audit_log` sozinho é solto demais na direção oposta — sem
exigir que o cursor já tenha passado do evento, um post que acabou de chegar (ainda à
FRENTE do cursor, que o cron corrigido enviaria normalmente no próximo tick) também não tem
ainda nenhuma linha de `audit_log` dentro de `[t_e, t_e+72h)` simplesmente porque essa janela
de 72h **ainda não terminou** — e seria classificado como órfão por engano. As duas condições
juntas são necessárias e suficientes:

1. **`arrived_at <= event_cursor_at` (necessária):** sem isso, o post nem está "preso" —
   ele está simplesmente esperando o próximo tick, o que já funciona.
2. **Não existe envio bem-sucedido para esse cliente dentro de `[arrived_at, arrived_at +
   72h)` (distingue órfão de "mailado e cliente não aprovou ainda"):** prova — seja `e` o
   evento (chegada em `enviado_cliente`, timestamp `t_e`) e `S` o primeiro envio
   bem-sucedido daquele cliente depois de `t_e`. Como nenhum envio aconteceu entre `t_e` e
   `S`, o cursor no início de `S` ainda é `< t_e`. Se `S` acontece menos de 72h depois de
   `t_e`, o piso de `S` (`run_S - 72h`) também é `< t_e`, então o limite inferior de `S` é
   `< t_e` e o evento **entra** na janela — entregue. Se `S` acontece 72h ou mais depois de
   `t_e`, o piso de `S` já é `>= t_e`, o evento fica de fora da janela mas o cursor mesmo
   assim avança para `upper_S >= t_e` — **órfão**, e como todo envio seguinte já parte de um
   cursor `>= t_e`, nunca mais é revisitado.

**Duas ressalvas assumidas por essa prova:**
- `audit_log` é best-effort (a escrita pode falhar sem desfazer o envio, ver comentário do
  handler) — um buraco no audit faz o critério tratar um post entregue como órfão e
  mencioná-lo de novo. Aceitável: pior caso é uma menção redundante, não perda de
  notificação.
- A prova assume que `S` não foi truncado pelo cap de `EVENTS_QUERY_CAP` (1000 linhas) — se
  foi, o cursor pode ter avançado só até um `safeUpperMs` mais conservador que `upper_S`, e
  a aritmética acima não se sustenta necessariamente. Mesma situação já aceita em
  "Limitações aceitas" (exige >1000 eventos pendentes para UM cliente numa única janela;
  não observado nos dados auditados nesta spec).

**Isto não é uma ferramenta para rodar repetidamente a qualquer momento.** O critério
responde "esse evento foi entregue pelo comportamento ANTIGO (com piso)?" — depois que o
fix de código está no ar e o cron volta a rodar, um envio bem-sucedido pode legitimamente
acontecer mais de 72h depois da chegada do post (é o comportamento novo, sem piso!), e o
critério classificaria esse post — já corretamente entregue pelo código novo — como órfão de
novo. Por isso o runbook abaixo pausa o cron ANTES do deploy e só o retoma DEPOIS do
backfill: dentro dessa janela pausada, nenhum envio novo acontece, então o critério está
respondendo exatamente a pergunta certa (histórico sob o comportamento antigo) e o script só
precisa rodar uma vez.

**O rewind não é seletivo — e isso é intencional, não um bug escondido.** O `UPDATE`
identifica QUAIS clientes têm pelo menos um órfão e para QUE PONTO mínimo rebobinar o cursor
deles. Mas o cursor é único por cliente: depois do rewind, o próximo digest desse cliente
inclui **todo** post ainda pendente com `arrived_at` depois do ponto de rewind — não só os
órfãos identificados. Verificado em produção: rebobinar o cursor da cliente 405 (Rachel
Gonzaga) para antes do órfão mais antigo (post 4729, 2026-09-08) também reincluiria os posts
5058/5037/5028 (arrived_at 2026-09-14), que já tinham sido entregues corretamente e o
cliente simplesmente ainda não aprovou. Não há como evitar isso sem um mecanismo
completamente separado (um ledger por evento entregue, ou um envio avulso fora do cron) —
fora de escopo. Aceito como parte do "efeito colateral" já combinado na decisão de rollout:
o digest de recuperação de um cliente afetado pode mencionar de novo posts que ele já tinha
visto, não só os genuinamente novos. Informacional, não dispara ação, acontece uma única vez
por cliente.

Preview (somente leitura — rodar dentro da janela com o cron pausado, ver Rollout):

```sql
WITH current_arrival AS (
  SELECT DISTINCT ON (wp.id)
         wp.id AS post_id, wp.cliente_id, pse.created_at AS arrived_at
  FROM workflow_posts wp
  JOIN post_status_events pse
    ON pse.post_id = wp.id AND pse.to_status = 'enviado_cliente'
  WHERE wp.status = 'enviado_cliente'
  ORDER BY wp.id, pse.created_at DESC
),
orphaned_posts AS (
  SELECT ca.post_id, ca.cliente_id, ca.arrived_at
  FROM current_arrival ca
  JOIN clientes cl ON cl.id = ca.cliente_id
  WHERE cl.event_cursor_at IS NOT NULL
    AND ca.arrived_at <= cl.event_cursor_at   -- necessária: já precisa estar "preso"
    AND NOT EXISTS (                          -- suficiente: nunca foi entregue
      SELECT 1 FROM audit_log a
      WHERE a.action = 'client_event_email_sent'
        AND a.resource_type = 'cliente'
        AND a.resource_id = ca.cliente_id::text
        AND a.created_at >= ca.arrived_at
        AND a.created_at <  ca.arrived_at + interval '72 hours'
    )
)
SELECT op.cliente_id, cl.nome, cl.conta_id, cl.event_cursor_at AS current_cursor,
       min(op.arrived_at) - interval '1 second' AS new_cursor,
       count(*) AS orphaned_posts
FROM orphaned_posts op
JOIN clientes cl ON cl.id = op.cliente_id
GROUP BY op.cliente_id, cl.nome, cl.conta_id, cl.event_cursor_at
ORDER BY cl.conta_id, op.cliente_id;
```

Backfill (rewind do cursor para o cliente voltar a enxergar os posts órfãos; `event_claim_through
IS NULL` é uma segunda trava contra um lease em andamento, além da pausa do cron):

```sql
WITH current_arrival AS (
  SELECT DISTINCT ON (wp.id)
         wp.id AS post_id, wp.cliente_id, pse.created_at AS arrived_at
  FROM workflow_posts wp
  JOIN post_status_events pse
    ON pse.post_id = wp.id AND pse.to_status = 'enviado_cliente'
  WHERE wp.status = 'enviado_cliente'
  ORDER BY wp.id, pse.created_at DESC
),
orphaned AS (
  SELECT ca.cliente_id, min(ca.arrived_at) - interval '1 second' AS new_cursor
  FROM current_arrival ca
  JOIN clientes cl ON cl.id = ca.cliente_id
  WHERE cl.event_cursor_at IS NOT NULL
    AND ca.arrived_at <= cl.event_cursor_at   -- necessária: já precisa estar "preso"
    AND NOT EXISTS (                          -- suficiente: nunca foi entregue
      SELECT 1 FROM audit_log a
      WHERE a.action = 'client_event_email_sent'
        AND a.resource_type = 'cliente'
        AND a.resource_id = ca.cliente_id::text
        AND a.created_at >= ca.arrived_at
        AND a.created_at <  ca.arrived_at + interval '72 hours'
    )
  GROUP BY ca.cliente_id
)
UPDATE clientes c
SET event_cursor_at = orphaned.new_cursor
FROM orphaned
WHERE c.id = orphaned.cliente_id
  AND c.event_claim_through IS NULL
RETURNING c.id, c.nome, c.conta_id, c.event_cursor_at;
```

## Rollout / runbook

0. Implementar em um worktree/branch novo a partir de `origin/main` atual — não neste
   worktree (ver "Base de implementação" acima).
1. **Pausar o cron primeiro** (antes do deploy — essencial para o critério de órfão do
   backfill continuar válido, ver seção Backfill):
   ```sql
   select cron.unschedule('client-event-email-cron');
   ```
   Esperar ~90s depois de desagendar, para qualquer execução já em andamento (até
   `SEND_DEADLINE_MS` = 60s por lote) terminar sozinha.
2. Deploy de `client-event-email-cron` (`--use-api`, o bundler local está quebrado neste
   repo; `--no-verify-jwt`, autentica via `x-cron-secret` como os demais crons).
3. Rodar o preview SQL da seção Backfill contra produção, revisar a lista — essa é a lista
   ESPERADA de clientes a rebobinar.
4. Rodar o `UPDATE` de backfill contra produção. **Reconciliar**: comparar o conjunto de
   `id` no `RETURNING` contra o conjunto de `cliente_id` do preview do passo 3. Se algum
   candidato do preview não aparecer no `RETURNING`, ele tinha `event_claim_through` não
   nulo no momento do UPDATE (um lease que a pausa do passo 1 não conseguiu limpar a
   tempo) — rodar o `UPDATE` de novo (idempotente dentro dessa janela pausada) até as duas
   listas baterem, antes de seguir para o passo 5.
5. Reagendar o cron (mesma definição da migration
   `20260904000001_client_event_emails.sql:178-192`):
   ```sql
   select cron.schedule(
     'client-event-email-cron',
     '*/15 * * * *',
     $$
     select net.http_post(
       url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
               || '/functions/v1/client-event-email-cron',
       headers := jsonb_build_object(
         'Content-Type', 'application/json',
         'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
       ),
       body := '{}'::jsonb
     ) as request_id;
     $$
   );
   ```
6. Na execução seguinte (até 15 min depois), conferir em `audit_log`
   (`action = 'client_event_email_sent'`) que os clientes antes silenciosos aparecem —
   tanto os de cursor nulo (406, 417) quanto os órfãos rebobinados.
7. Nenhuma migration, nenhum flag novo. Deploy só desta function; decidido deliberadamente
   pular o passo usual de staging-antes-de-prod dado o tamanho da mudança (um arquivo, sem
   schema) — ok revisitar se o time preferir seguir o fluxo padrão mesmo assim.
   (Custo da consulta sem piso já verificado em produção — ver "Limitações aceitas" — não
   é motivo para gate nenhum aqui.)

## Fora de escopo

- Lembrete recorrente para posts pendentes há muito tempo (reincidência) — feature
  separada, não bug.
- Qualquer mudança no toggle `workspaces.send_client_event_emails` ou no motivo dele ter
  ficado desligado até 2026-09-14 nesse workspace especificamente — decisão de configuração
  da conta, não bug de código.
- `notification-email-cron` (equivalente para notificações internas à equipe) não foi
  auditado; esta spec cobre só o digest voltado ao cliente.
- Posts sem nenhuma linha de `post_status_events` com `to_status = 'enviado_cliente'` — o
  gatilho que popula essa tabela é `AFTER UPDATE OF status`, então um post inserido
  diretamente com `status = 'enviado_cliente'` (ou um post anterior à existência do
  gatilho) não tem evento de chegada e fica invisível tanto ao digest quanto ao backfill.
  Não observado nos dados auditados nesta spec; se aparecer na prática, é um gap
  independente deste fix.
