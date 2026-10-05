# Agenda: eventos, recorrência, convites e lembretes (sub-projeto 1) — design

Status: revisado (Fable + Codex, 2026-10-05) · Branch: `claude/full-featured-calendar-app-c56639` · Mockups: https://claude.ai/artifact/X43LyHBG7mLXL7bnqENzg6

## Objetivo

Transformar `/calendario` num calendário de verdade, no estilo Google Agenda: a equipe cria eventos (reuniões, gravações, captações, apresentações), convida colegas, responde aos convites, recebe lembretes no app e por e-mail, e enxerga a agenda da equipe em visão de mês, semana, dia e lista.

## Iniciativa completa e onde este documento entra

A iniciativa "Agenda" foi decomposta em quatro sub-projetos, cada um com spec, plano e PR próprios:

| # | Sub-projeto | Conteúdo |
|---|---|---|
| **1** | **Núcleo de eventos (este documento)** | Eventos, recorrência completa, privado/ocupado, convites para a equipe com RSVP, lembretes (app + e-mail), visões mês/semana/dia/lista |
| 2 | Google e calendários externos | Botão "Adicionar ao Google Agenda", arquivo `.ics`, feed de assinatura pessoal (iCal URL) |
| 3 | Hub | Eventos visíveis ao cliente, confirmar/recusar, pedir remarcação (equipe aprova), e-mail imediato ao cliente com `.ics` + lembrete no digest "Pendências do Hub" |
| 4 | Camadas | Recebimentos, prazos, datas importantes, datas comemorativas e posts agendados como sobreposições liga/desliga da Agenda |

Decisões do usuário que valem para a iniciativa toda: público = equipe + clientes no Hub (3); cliente vê, confirma/recusa e pede remarcação (3); Google = botão + `.ics` + feed (2); recorrência completa com "somente este / este e os seguintes / todos" (1); eventos compartilhados com opção "privado" que aparece como "ocupado" (1); e-mail imediato ao cliente (3); todos os planos (o calendário não ganha gate; as partes de Hub só aparecem onde o workspace já tem `feature_hub_portal`, e o e-mail ao cliente de workspace sem Hub sai com `.ics` e sem botão de ação; e-mails de convite/alteração/cancelamento ao cliente são transacionais: respeitam só `send_event_email` + `unsub_at` do cliente, não o switch `send_client_event_emails` do workspace) (3).

Este documento só implementa o sub-projeto 1, mas modela o que 2 e 3 vão precisar (`cliente_id` no evento, identidade estável de ocorrência, RSVP por ocorrência, regra guardada em colunas convertíveis para RRULE) para não exigir migração destrutiva depois.

## Decisões deste sub-projeto

1. **Abordagem B: regra + ocorrências materializadas.** A série guarda a regra (fonte da verdade). Ocorrências são linhas reais geradas até um horizonte móvel de 24 meses. Estado por ocorrência (RSVP, exceções, lembrete enviado) mora na linha da ocorrência. Precedente direto: `tarefa_series` (migration `20260925000030`).
2. **Toda a matemática de data fica no banco** (PL/pgSQL), como em tarefas. Nenhum `rrule.js` no front nem no Deno.
3. **Fuso:** cada série grava o fuso de quem a criou (`tz`, IANA, vindo de `Intl.DateTimeFormat().resolvedOptions().timeZone` no navegador; padrão `America/Sao_Paulo`). Regras são expandidas em horário de parede desse fuso e convertidas para instante com `AT TIME ZONE tz`. O FullCalendar roda em `timeZone: 'local'` (padrão; sem plugin de fuso): cada pessoa vê os eventos no horário do próprio navegador. Eventos de dia inteiro são sempre datas, nunca instantes, na UI (ver "Dia inteiro").
4. **Identidade de participante = auth uid**, amarrada a `workspace_members`. A lista de pessoas (filtro e seletor de participantes) usa o roster de `getWorkspaceUsers()` (`workspace_members → profiles`, id = uuid), nunca `membros` (ids numéricos; nem todo usuário tem `membros`, e `membros` inclui gente sem login). Convidados externos por e-mail ficam para o sub-projeto 3.
5. **Calendário de UI: FullCalendar 6.1.21 (MIT)**: `@fullcalendar/react`, `core`, `daygrid`, `timegrid`, `list`, `interaction`, todos `~6.1.21` (a 7.x de `core`/`react` exige `temporal-polyfill` e os plugins de visão ainda não têm 7.x em `latest`). Sem `@fullcalendar/rrule`, sem tier premium.
6. **E-mail de convite, alteração e cancelamento vai pelo digest existente** (`notification-email-cron`, chega em até ~15 min, respeita as preferências da Central). **Lembrete tem caminho próprio**: um job pg_cron SQL a cada minuto gera os lembretes in-app e marca os e-mails pendentes; a edge function de envio só é chamada nos minutos em que há e-mail pendente.
7. **Sem gate de plano.** Módulo de permissão `calendario` já existe: `ver` lista e responde, `editar` cria.
8. **Quem edita (regra de produto explícita):** o organizador; e owner/admin (pelo `workspace_members.role`) em eventos não privados. Ter `calendario: editar` permite criar e editar os próprios eventos, não os dos colegas, inclusive para papéis customizados (que usam o chassi `agent`). É o comportamento padrão do Google ("convidados não podem modificar o evento"). Todos os casos exigem `has_permission('calendario','editar')`.
9. **Entrega em duas migrations e um PR:** (A) núcleo: tabelas, funções, RPCs, tipos de notificação, digest; (B) lembretes: ledger, claim, job pg_cron e edge function. B tem kill switch próprio (`cron.unschedule('agenda-lembretes')`) e rollback independente.

## Modelo de dados

Prefixo `agenda_`. Todas as tabelas têm `conta_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE`. **Filhos amarram `conta_id` ao pai por FK composta** (padrão `membros_id_conta_uq` / `post_process_steps`): os pais ganham `UNIQUE (id, conta_id)` e os filhos referenciam `(pai_id, conta_id)`, de modo que nenhuma linha filha pode pertencer a outro workspace mesmo que um RPC esqueça um predicado.

### `agenda_eventos` (a série; um evento avulso é uma série sem regra)

| Coluna | Tipo | Notas |
|---|---|---|
| `id` | `bigint generated always as identity` PK | `UNIQUE (id, conta_id)` |
| `conta_id` | `uuid NOT NULL` | |
| `organizador_id` | `uuid NULL REFERENCES auth.users ON DELETE SET NULL` | nullable pela regra de `20261001000001` |
| `titulo` | `text NOT NULL` | 1..200, trim |
| `descricao` | `text NULL` | ≤ 5000, texto puro |
| `local` | `text NULL` | ≤ 300 |
| `link_reuniao` | `text NULL` | ≤ 500, `^https?://` (CHECK); renderizado com `sanitizeUrl()` |
| `tipo` | `text NOT NULL DEFAULT 'reuniao'` | CHECK IN (`reuniao`,`gravacao`,`captacao`,`apresentacao`,`interno`,`outro`) |
| `cor` | `text NULL` | chave de paleta (CHECK em 8 chaves fixas) que sobrepõe a cor do tipo |
| `cliente_id` | `bigint NULL` | FK `(cliente_id, conta_id) REFERENCES clientes(id, conta_id) ON DELETE SET NULL (cliente_id)` (`clientes_id_conta_uq` já existe, `20260815000002`) |
| `privado` | `boolean NOT NULL DEFAULT false` | |
| `dia_inteiro` | `boolean NOT NULL DEFAULT false` | |
| `tz` | `text NOT NULL DEFAULT 'America/Sao_Paulo'` | validado no guard (trigger), não em CHECK: `'2000-01-01'::timestamp AT TIME ZONE tz` dentro de `BEGIN/EXCEPTION` |
| `dtstart` | `timestamp NOT NULL` | parede local (em `tz`) da 1ª ocorrência; `dia_inteiro` ⇒ 00:00 |
| `duracao_min` | `int NULL` | evento com horário: > 0 e ≤ 14 dias; `dia_inteiro` ⇒ NULL |
| `duracao_dias` | `int NULL` | `dia_inteiro`: 1..31; senão NULL |
| `freq` | `text NULL` | NULL = não repete; CHECK IN (`daily`,`weekly`,`monthly`,`yearly`) |
| `intervalo` | `int NOT NULL DEFAULT 1` | 1..99 |
| `dias_semana` | `int[] NULL` | `weekly`: obrigatório, 0..6 (0 = domingo), sem repetição |
| `mensal_modo` | `text NULL` | `monthly`: obrigatório, IN (`dia_mes`,`dia_semana`) |
| `mensal_ordinal` | `int NULL` | `monthly` + `dia_semana`: IN (1,2,3,4,-1); o dia da semana vem de `dtstart` |
| `ate` | `date NULL` | fim por data (inclusive, data local) |
| `contagem` | `int NULL` | fim por número de ocorrências, 1..730 |
| `lembretes` | `int[] NOT NULL DEFAULT '{}'` | minutos antes de `inicio`; ≤ 5, sem repetição; -1440..40320 (negativo = depois do início, para "no dia às 9h" de dia inteiro) |
| `serie_origem_id` | `bigint NULL REFERENCES agenda_eventos(id) ON DELETE SET NULL` | linhagem de split (para o feed do sub-projeto 2) |
| `horizonte_ate` | `date NULL` | até onde já materializou |
| `materializacao_completa` | `boolean NOT NULL DEFAULT false` | true quando a regra se esgotou (`ate`/`contagem`) ou não há regra; o gerador ignora essas séries |
| `created_at`, `updated_at` | `timestamptz` | trigger de `updated_at` |

CHECKs de coerência: `freq IS NULL ⇒ dias_semana, mensal_modo, mensal_ordinal, ate, contagem IS NULL`; `NOT (ate IS NOT NULL AND contagem IS NOT NULL)`; `ate IS NULL OR ate >= dtstart::date`; `ate <= dtstart::date + interval '5 years'`; `dia_inteiro = (duracao_dias IS NOT NULL) AND dia_inteiro = (duracao_min IS NULL)`; regras por `freq` como na tabela.

**Semântica da regra** (alinhada a RFC 5545 / Google, para o feed do sub-projeto 2 emitir RRULE fiel):
- **`dtstart` é sempre a 1ª ocorrência.** Os RPCs normalizam: se `dtstart` não satisfaz a regra (semanal sem o dia da semana de `dtstart`, por exemplo), `dtstart` avança para a primeira data da regra ≥ `dtstart` antes de gravar, e o RPC devolve a data normalizada (a UI mostra o aviso "A série começa em {data}"). Assim `contagem`, identidade e RRULE ficam coerentes.
- `monthly` + `dia_mes` usa o dia de `dtstart`; **meses sem esse dia são pulados** (dia 31 não cai em abril). Difere de propósito de tarefas (clamp): eventos têm que bater com `BYMONTHDAY`.
- `monthly` + `dia_semana`: "a 2ª terça", "a última sexta" (`mensal_ordinal = -1`).
- `yearly` usa mês/dia de `dtstart`; 29/02 só em ano bissexto.
- `weekly` com `intervalo > 1` conta semanas segunda→domingo (`date_trunc('week')`), igual a `tarefa_next_date`; `WKST=MO`.
- "Todo dia útil" = `weekly` com `dias_semana = {1,2,3,4,5}`.
- `contagem` conta ocorrências da regra desde `dtstart`, **incluindo lápides** (como `COUNT` no RFC 5545).

### `agenda_ocorrencias`

| Coluna | Tipo | Notas |
|---|---|---|
| `id` | `bigint identity` PK | `UNIQUE (id, conta_id)` |
| `conta_id` | `uuid NOT NULL` | |
| `evento_id` | `bigint NOT NULL` | FK `(evento_id, conta_id) REFERENCES agenda_eventos(id, conta_id) ON DELETE CASCADE` |
| `data_original` | `date NOT NULL` | data local que a regra produziu; **identidade estável** com `evento_id` |
| `inicio` | `timestamptz NOT NULL` | instante efetivo |
| `fim` | `timestamptz NOT NULL` | `> inicio` |
| `horario_alterado` | `boolean NOT NULL DEFAULT false` | exceção de horário/data ("este evento" ou arrastar) |
| `titulo`, `descricao`, `local`, `link_reuniao` | `text NULL` | exceções de conteúdo; NULL = herda da série |
| `cancelada` | `boolean NOT NULL DEFAULT false` | "excluir este evento": lápide (EXDATE) |

`UNIQUE (evento_id, data_original)`: regras nunca produzem duas ocorrências na mesma data local, então a data é chave suficiente e sobrevive a mudança de horário da série. Índices: `(conta_id, inicio, fim) WHERE NOT cancelada` (listagem por workspace) e `(evento_id, inicio) WHERE NOT cancelada` (lembretes).

**Geração de `inicio`/`fim`:** horário: `inicio = (data + dtstart::time) AT TIME ZONE tz`, `fim = inicio + duracao_min` (tempo decorrido, como o Google). Dia inteiro: `inicio = data::timestamp AT TIME ZONE tz`, `fim = (data + duracao_dias)::timestamp AT TIME ZONE tz` (aritmética de data local, depois conversão; nunca `+ 24h`).

### `agenda_participantes` (por série)

`evento_id`, `conta_id` (FK composta para `agenda_eventos`, ON DELETE CASCADE), `user_id uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE`, `resposta text NOT NULL DEFAULT 'pendente'` (IN `pendente`,`sim`,`nao`,`talvez`), `respondido_em timestamptz`. PK `(evento_id, user_id)`. O organizador entra como participante com `resposta = 'sim'`. ≤ 50 participantes.

### `agenda_respostas` (RSVP de uma ocorrência só)

`ocorrencia_id`, `conta_id` (FK composta para `agenda_ocorrencias`, ON DELETE CASCADE), `user_id` (FK auth.users CASCADE), `resposta` (IN `sim`,`nao`,`talvez`), `respondido_em`. PK `(ocorrencia_id, user_id)`. Resposta efetiva = `coalesce(agenda_respostas.resposta, agenda_participantes.resposta)`. Fica no sub-projeto 1 (e não é cortada por YAGNI) porque o sub-projeto 3 depende dela: o cliente confirma uma gravação específica, não a série.

### `agenda_lembretes` (ledger, migration B)

| Coluna | Notas |
|---|---|
| `ocorrencia_id`, `conta_id` | FK composta para `agenda_ocorrencias`, ON DELETE CASCADE |
| `user_id` | FK auth.users CASCADE |
| `minutos` | o item de `lembretes` que disparou |
| `inicio_alvo timestamptz` | o `inicio` da ocorrência no momento do disparo |
| `notification_id uuid NULL` | linha in-app criada |
| `email_status text NOT NULL` | IN (`nao`,`pendente`,`enviando`,`enviado`,`falhou`) |
| `email_tentativas int NOT NULL DEFAULT 0`, `email_lease_ate timestamptz NULL` | |
| `criado_em timestamptz DEFAULT now()` | |

PK `(ocorrencia_id, user_id, minutos, inicio_alvo)`. **Incluir `inicio_alvo` na chave resolve as transições de edição sem regra extra:** mover o evento de 10:00 para 11:00 muda o alvo, então o lembrete de 10 min dispara de novo às 10:50 (o das 9:50 já saiu e não se repete); trocar `lembretes` de {10} para {30} cria uma chave nova; reeditar sem mudar horário nem minutos não reenvia. Índice parcial `(email_lease_ate) WHERE email_status IN ('pendente','enviando')`. Limpeza: o gerador diário apaga linhas com `criado_em < now() - 30 dias`.

### Privilégios e RLS

Padrão `tarefa_series` (escrita só por RPC):
- `REVOKE ALL ... FROM PUBLIC, anon, authenticated; GRANT SELECT ... TO authenticated; GRANT ALL ... TO service_role` em `agenda_eventos`, `agenda_ocorrencias`, `agenda_participantes`, `agenda_respostas`. `agenda_lembretes`: `REVOKE ALL FROM PUBLIC, anon, authenticated`, sem GRANT a `authenticated` (só service_role). Bloco `DO` de pós-condição por tabela (SELECT-only nas quatro, nada em `agenda_lembretes` e em `anon`).
- **Sem recursão de política:** o `EXISTS` cruzado `agenda_eventos ↔ agenda_participantes` daria `42P17` (precedente: `20260612120000_fix_workspace_members_rls_recursion.sql`). A política de `agenda_eventos` usa um helper `agenda_pode_ver_evento(p_evento_id bigint, p_privado boolean, p_organizador uuid) RETURNS boolean`, `SECURITY DEFINER STABLE`, owner postgres (lê `agenda_participantes` sem RLS): `NOT p_privado OR p_organizador = auth.uid() OR EXISTS (participante auth.uid())`. `REVOKE ALL FROM PUBLIC, anon; GRANT EXECUTE TO authenticated, service_role`; entra na lista de exceções "invoker-context" da suíte 96 (`96_lockdown_definer_function_grants.sql:100-103`).
- Política de `agenda_eventos`: `conta_id IN (SELECT get_my_conta_id()) AND (SELECT has_permission('calendario','ver')) AND agenda_pode_ver_evento(id, privado, organizador_id)`.
- `agenda_ocorrencias`, `agenda_participantes`, `agenda_respostas`: `conta_id IN (SELECT get_my_conta_id()) AND EXISTS (SELECT 1 FROM agenda_eventos e WHERE e.id = <tabela>.evento_id)` (a política do pai se aplica dentro do EXISTS; a direção é só filho→pai, sem ciclo). `agenda_respostas` chega ao pai via `agenda_ocorrencias`.
- `*_service_role_bypass` FOR ALL TO service_role em todas.

A leitura direta das tabelas existe para o formulário de edição (série + participantes). A grade lê por `agenda_listar`, que faz a máscara de "ocupado".

## Funções no banco

Todas `SET search_path = public`. Funções de data puras mantêm EXECUTE padrão (como `tarefa_next_date`). Internas SECURITY DEFINER: `REVOKE ALL ... FROM PUBLIC, anon, authenticated; GRANT EXECUTE TO service_role`. RPCs de cliente SECURITY DEFINER: `REVOKE ALL ... FROM PUBLIC, anon, authenticated, service_role; GRANT EXECUTE TO authenticated, service_role`. Todos os nomes entram na suíte 96 (ou irmã).

Preâmbulo comum dos RPCs de cliente: `v_conta := get_my_conta_id(); v_user := auth.uid();` raise se NULL; `conta_id`/`user_id` nunca vêm de parâmetro; toda linha referenciada é filtrada por `conta_id = v_conta`; `cliente_id` precisa existir em `clientes` de `v_conta`; cada participante precisa ter linha em `workspace_members` com `workspace_id = v_conta`. Mensagens de erro em pt-BR, prefixadas `agenda:` para o mapeamento no front.

### Matemática de datas

- `agenda_datas_regra(p_evento agenda_eventos, p_de date, p_ate date) RETURNS SETOF date`: datas da regra em `[p_de, p_ate]`, respeitando `ate` e `contagem` (contando desde `dtstart`; limite 730 torna a enumeração desde o início barata). Sem regra: só `dtstart::date`. Implementação por `generate_series` sobre o período ancorado em `dtstart::date`, filtrando candidatos.
- `agenda_normalizar_dtstart(p_evento agenda_eventos) RETURNS timestamp`: primeira data da regra ≥ `dtstart::date`, com a hora de `dtstart`; raise "agenda: a repetição não gera nenhuma data" se não houver.
- `agenda_inicio_fim(p_evento agenda_eventos, p_data date, OUT inicio timestamptz, OUT fim timestamptz)`: as fórmulas de "Geração de inicio/fim".
- `agenda_hoje(p_tz text) RETURNS date` com override por GUC `app.agenda_hoje` para as suítes.

### Materialização

`agenda_materializar(p_evento_id bigint, p_ate date)` (interna): insere as datas de `agenda_datas_regra(e, coalesce(horizonte_ate + 1, dtstart::date), p_ate)` com `ON CONFLICT (evento_id, data_original) DO NOTHING` e `agenda_inicio_fim`. Atualiza `horizonte_ate`; marca `materializacao_completa = true` quando não há regra ou a regra termina antes de `p_ate`. Horizonte: `agenda_hoje(tz) + 24 meses`.

`agenda_regenerar(p_evento_id bigint, p_reset_horario boolean)` (interna), chamada quando regra, `dtstart`, duração, `dia_inteiro` ou `tz` mudam com escopo "todos" (e na série nova de um split):
1. Calcula o conjunto novo de datas em `[dtstart::date, horizonte]`.
2. Apaga ocorrências cuja `data_original` saiu do conjunto (inclusive exceções e RSVPs por ocorrência delas; o Google faz igual).
3. Nas que ficaram: recalcula `inicio`/`fim` das que têm `horario_alterado = false`; com `p_reset_horario = true` (mudou `dia_inteiro` ou `tz`), recalcula todas e zera `horario_alterado`, porque uma exceção com horário não faz sentido numa série de dia inteiro e vice-versa.
4. Insere as datas novas. Lápides cuja data continua na regra permanecem.

### Gerador diário

`agenda_gerar_horizonte()` (interna, pg_cron SQL-only, como `generate_recurring_tarefas`): para séries com `NOT materializacao_completa` e `horizonte_ate < agenda_hoje(tz) + 24 meses`, chama `agenda_materializar`. Na migration B, também apaga ledger com mais de 30 dias. `cron.schedule('agenda-horizonte', '23 4 * * *', ...)` (minuto livre na tabela de `20260925110001`).

### Como o payload vira `dtstart` (todas as edições)

O formulário e o arrastar carregam o início/fim **da ocorrência** que o usuário abriu, não o `dtstart` da série. Regra única, aplicada no RPC:

- `v_delta_dias := (novo_inicio_local::date) - (inicio_atual_local_da_ocorrencia::date)`, onde "local" é no `tz` da série. É o deslocamento de data que o usuário fez **nesta** edição.
- `v_hora := novo_inicio_local::time`; a duração vem de `novo_fim - novo_inicio` (ou dos dias, em dia inteiro).
- **`todas`:** `dtstart_novo := (dtstart_atual::date + v_delta_dias) + v_hora`, depois `agenda_normalizar_dtstart`.
- **`seguintes`:** `dtstart_novo := (data_original + v_delta_dias) + v_hora`, depois normalização. Partir de `data_original` (e não da data atual da ocorrência) impede que uma exceção antiga de "este evento" transforme uma regra "2ª terça" em "2ª quarta".
- **A regra vem sempre explícita no payload** (o formulário a calcula). As opções prontas do Repetir são derivadas da data de início, então mudar a data em "Semanal: cada terça" faz o formulário mandar "cada quarta"; uma regra personalizada vai como está e a normalização cuida de um `dtstart` fora dela.

### RPCs de cliente

**`agenda_listar(p_de timestamptz, p_ate timestamptz, p_ocorrencia_id bigint DEFAULT NULL)`**: STABLE, SECURITY DEFINER, exige `has_permission('calendario','ver')`. Com `p_ocorrencia_id`, ignora o intervalo e devolve só essa ocorrência (deep link); sem ele, exige `p_ate - p_de ≤ 100 dias` e devolve as ocorrências não canceladas com `inicio < p_ate AND fim > p_de` do workspace, acrescentando `inicio >= p_de - 31 dias` (duração máxima de um evento) para o índice `(conta_id, inicio, fim)` limitar a varredura dos dois lados. O filtro por pessoa é feito no cliente (uma chave de query só). Colunas:

`ocorrencia_id, evento_id, data_original, inicio, fim, dia_inteiro, data_inicio_local, data_fim_local, titulo, descricao, local, link_reuniao, tipo, cor, cliente_id, cliente_nome, privado, mascarado, recorrente, regra jsonb, organizador_id, participantes jsonb, minha_resposta, pode_editar, pode_responder`

- Conteúdo = `coalesce(exceção da ocorrência, série)`.
- `data_inicio_local`/`data_fim_local` (date, fim exclusivo) = datas no `tz` da série; usadas para eventos de dia inteiro na UI.
- `participantes` = `[{user_id, resposta}]` com resposta efetiva, só de quem ainda está em `workspace_members`.
- **Máscara** (privado, usuário não é organizador nem participante): `titulo = 'Ocupado'`, `mascarado = true`; `descricao, local, link_reuniao, cliente_id, cliente_nome, tipo, cor, regra` NULL; `participantes` com os `user_id` de todos os participantes **sem** resposta (o "ocupado" aparece na agenda de cada envolvido no filtro por pessoa; revela só quem está ocupado, que o bloco já revela).
- `pode_editar` = `has_permission('calendario','editar') AND (organizador_id = v_user OR (papel em workspace_members IN ('owner','admin') AND NOT privado))`.
- `pode_responder` = participante e não organizador.

**`agenda_evento_criar(p_evento jsonb, p_participantes uuid[]) RETURNS TABLE (evento_id bigint, ocorrencia_id bigint, dtstart timestamp)`**: exige `editar`. Valida o payload, normaliza `dtstart`, insere a série (`organizador_id = v_user`), insere participantes (organizador `sim`, demais `pendente`, dedupe, membresia validada), materializa até o horizonte e devolve a 1ª ocorrência e o `dtstart` normalizado. Notifica `event_invited`.

**`agenda_evento_editar(p_ocorrencia_id bigint, p_escopo text, p_evento jsonb, p_participantes uuid[] DEFAULT NULL) RETURNS bigint`**: `p_escopo IN ('esta','seguintes','todas')`. Trava a série `FOR UPDATE` e exige `pode_editar`. Ocorrência inexistente, de outro workspace ou cancelada: raise "agenda: este evento não existe mais". Retorna o id da ocorrência que representa a editada.
- Evento sem regra: escopo ignorado; edita série e ocorrência única (regenera).
- `seguintes` na primeira ocorrência viva da série vira `todas`.
- **`esta`:** grava exceções na ocorrência: conteúdo (`titulo`, `descricao`, `local`, `link_reuniao`) e horário (`inicio`, `fim`, `horario_alterado = true`, inclusive mudança de data; `data_original` não muda). Campos de série (`tipo`, `cor`, `cliente_id`, `privado`, `dia_inteiro`, `lembretes`, regra, participantes) diferentes dos da série: raise (a UI já desabilita "Este evento" com "Vale para toda a série").
- **`todas`:** atualiza a série com o payload e o `dtstart` derivado (seção acima). Mudou regra, `dtstart`, duração, `dia_inteiro` ou `tz`: `agenda_regenerar(id, p_reset_horario => dia_inteiro ou tz mudou)`. Exceções de conteúdo sobreviventes ficam. `p_participantes` não nulo substitui o conjunto (novos `pendente`; removidos perdem as respostas por ocorrência).
- **`seguintes`:** split no corte `c = data_original` da ocorrência editada.
  1. Série antiga: `ate = c - 1`, `contagem = NULL`, `materializacao_completa = true`.
  2. Série nova: payload + `dtstart` derivado, `serie_origem_id` = antiga, participantes = `p_participantes` ou cópia (com respostas da série). `contagem` da nova: o valor do payload se o usuário mexeu no fim da regra; senão `contagem_antiga - count(agenda_datas_regra(antiga, dtstart_antigo::date, c - 1))` (lápides contam), e se der ≤ 0 não há série nova.
  3. Ocorrências antigas com `data_original >= c`: as que estão na regra nova são **re-parentadas** (`UPDATE evento_id`), preservando exceções de conteúdo, lápides e RSVPs por ocorrência, e têm `inicio`/`fim` recalculados se `horario_alterado = false`; as demais são apagadas; as que faltam são materializadas.
  4. Se a série antiga ficou sem ocorrência viva, é apagada.
- **Notificações:** `event_updated` aos participantes atuais (exceto o ator) quando muda título, horário, data, regra, local, link ou `dia_inteiro` (só descrição, cor ou lembretes não notifica). Adicionados recebem `event_invited`; removidos, `event_cancelled` com `metadata.motivo = 'removido'`.

**`agenda_evento_excluir(p_ocorrencia_id bigint, p_escopo text)`**: exige `pode_editar`; trava a série `FOR UPDATE`.
- `esta`: `cancelada = true`.
- `seguintes`: `ate = c - 1`, `contagem = NULL`, `materializacao_completa = true` e apaga as ocorrências com `data_original >= c`. Na primeira ocorrência viva, vira `todas`.
- `todas`: `DELETE` da série (cascata).
- Depois de `esta` ou `seguintes`, série sem ocorrência viva é apagada.
- Notifica `event_cancelled` aos participantes exceto o ator, **antes** do delete (metadata leva título e data).

**`agenda_responder(p_ocorrencia_id bigint, p_resposta text, p_escopo text)`**: exige `has_permission('calendario','ver')` e `pode_responder`; `p_resposta IN ('sim','nao','talvez')`, `p_escopo IN ('esta','todas')`. Trava a série `FOR SHARE` primeiro (RSVPs concorrentes seguem em paralelo; edições `FOR UPDATE` serializam). `todas` grava em `agenda_participantes` e apaga as respostas por ocorrência do usuário com `inicio >= now()`; `esta` faz upsert em `agenda_respostas`. Notifica `event_rsvp` ao organizador (se membro e não for o ator).

**Ordem de travas:** série (`FOR UPDATE` ou `FOR SHARE`) e só então ocorrências por `id`. Nenhum trigger de tabela trava na ordem inversa (lição do `tarefa_serie_excluir`, `40P01`).

### Notificações: tipos novos

| Tipo | Quem recebe | App | E-mail |
|---|---|---|---|
| `event_invited` | participante adicionado | sim | digest |
| `event_updated` | participantes, exceto o ator | sim | digest |
| `event_cancelled` | participantes, exceto o ator (inclui removidos) | sim | digest |
| `event_rsvp` | organizador | sim | não |
| `event_reminder` | participantes que não recusaram | sim | caminho próprio (migration B) |

Fan-out: os RPCs filtram os destinatários por `workspace_members` do workspace **antes** de chamar `insert_notification_batch` (o helper não filtra, `20260430000001:194-198`), com `p_exclude_actor = v_user`. Link: `/calendario?evento={ocorrencia_id}` (cancelado: `/calendario?data={yyyy-mm-dd}`). Metadata: `evento_id, ocorrencia_id, titulo, inicio, fim, dia_inteiro, data_local, recorrente, escopo, ator_nome, motivo?`. Notificação de evento privado só vai a envolvidos.

Pontos que mudam (verificados no código):
1. `notifications_type_check`: DROP + ADD copiando os 22 valores de `20260815000004` + os 5.
2. `notification_inapp_prefs_type_check`: + 5.
3. `notification_email_prefs_type_check`: + `event_invited`, `event_updated`, `event_cancelled`, `event_reminder`.
4. `claim_notification_emails`: recriar com o array + `event_invited`, `event_updated`, `event_cancelled` (não `event_reminder`), mantendo revoke/grant.
5. `_shared/notification-email.ts` `resolveDigestItem`: os três tipos de digest.
6. `apps/crm/src/store/notifications.ts`: união `NotificationType`.
7. `apps/crm/src/lib/notification-catalog.ts`: 5 entradas na categoria nova `agenda` ("Agenda"), com `CATEGORY_ORDER`/`CATEGORY_LABELS`.
8. `apps/crm/src/lib/notification-config.ts`: ícone (lucide `CalendarPlus`, `CalendarClock`, `CalendarX`, `CalendarCheck`, `AlarmClock`), tom, título e corpo.
9. Testes: `apps/crm/src/__tests__/notification-catalog.test.ts` (22 → 27, e-mail 9 → 13), `notification-config.test.ts`, `notification-email_test.ts`. As suítes psql 64/73 contam linhas, não listas fechadas: sem mudança.

### Lembretes (migration B)

**Job pg_cron `agenda-lembretes`, `'* * * * *'`, SQL-only:** `SELECT public.agenda_tick_lembretes();`. Custo assumido: é o quarto job por minuto, e com `cron.use_background_workers` off cada execução abre uma conexão (`20260925110001`). Mitigações: o comando é SQL puro e curto (sem `net.http_post` na maioria dos minutos), não cai em minuto de pico extra, e o cron-health já tolera um "connection failed" isolado (`20260925110002`). Um lembrete perdido por falha de conexão é recuperado no minuto seguinte pela janela de 15 min.

**`agenda_tick_lembretes()`** (interna, service_role, VOLATILE):
1. Candidatos dirigidos pela série: `agenda_eventos e WHERE cardinality(e.lembretes) > 0` (índice parcial), `CROSS JOIN unnest(e.lembretes) m`, e para cada `m` as ocorrências `o.evento_id = e.id AND NOT o.cancelada AND o.inicio > p_now - 15 min + m min AND o.inicio <= p_now + m min` (índice `(evento_id, inicio)`; cada sonda é um intervalo pequeno). As ocorrências candidatas são lidas `FOR KEY SHARE SKIP LOCKED`, para pular linhas no meio de uma exclusão em vez de esperar por elas.
2. Destinatários: participantes com resposta efetiva diferente de `nao` e linha atual em `workspace_members`.
3. `INSERT INTO agenda_lembretes (..., inicio_alvo = o.inicio, email_status) ... ON CONFLICT DO NOTHING RETURNING` é o claim (at-most-once por chave). `email_status = 'pendente'` se a pref de e-mail permite (sem linha = ligado; `event_reminder` ou `__all__` com `enabled = false` = desligado), senão `'nao'`.
4. Para cada claim novo, `INSERT INTO notifications (workspace_id, user_id, type, metadata, link) ... RETURNING id` direto (o `insert_notification_batch` devolve `void`), com `emailed_at = now()` quando o e-mail vai pelo caminho próprio, para o digest nunca pegar a linha; grava `notification_id` no ledger.
5. Se existe ledger com `email_status = 'pendente'`, chama `net.http_post` para `agenda-lembretes-email` (vault + `x-cron-secret`, padrão `20260813000006`).

Lembrete atrasado mais de 15 min (banco fora do ar) é descartado. Mover um evento já lembrado gera um lembrete novo para o novo horário (chave com `inicio_alvo`).

**Edge function `agenda-lembretes-email`** (`--no-verify-jwt`, `x-cron-secret` com `timingSafeEqual`, padrão `handler.ts` + `index.ts`, `[functions.agenda-lembretes-email] verify_jwt = false`):
- RPC `agenda_claim_emails_lembrete(p_limit int DEFAULT 100)` (service_role): `UPDATE ... SET email_status = 'enviando', email_lease_ate = now() + 2 min, email_tentativas = email_tentativas + 1 WHERE (email_status = 'pendente' OR (email_status = 'enviando' AND email_lease_ate < now())) ... FOR UPDATE SKIP LOCKED RETURNING` + dados do evento (título efetivo, início, fim, local, link, `tz`) e `user_id`.
- Para cada linha: e-mail via `auth.admin.getUserById`, envio com `sendViaResend(to, subject, html, idempotencyKey, 'Mesaas <notificacoes@mesaas.com.br>')`, idempotency key `agenda-lembrete:{ocorrencia_id}:{user_id}:{minutos}:{epoch(inicio_alvo)}`, HTML no `layout()` compartilhado, tudo com `escapeHtml`, assunto com `sanitizeSubjectValue`, horário formatado no `tz` do evento. Sucesso: `enviado`. Falha: volta a `pendente` se `email_tentativas < 3`, senão `falhou` (log, sem `reportCronFailure` por item).
- Prazo de 50 s; o que não coube volta a `pendente` (lease expira).
- Falha do RPC: `reportCronFailure`.

## Frontend (CRM)

### Dependências

`@fullcalendar/core`, `react`, `daygrid`, `timegrid`, `list`, `interaction`, todos `~6.1.21`. Locale `pt-br`. `timeZone` padrão (`'local'`). A página já é lazy.

### Store: `apps/crm/src/store/agenda.ts` (no barrel)

Tipos `AgendaOcorrencia`, `AgendaEvento`, `AgendaParticipante`, `AgendaRegra`, `AgendaEscopo`, `AgendaResposta`. Funções: `listAgenda(de, ate)`, `getAgendaOcorrencia(id)` (= `agenda_listar` com `p_ocorrencia_id`), `getAgendaEvento(eventoId)` (série + participantes, leitura direta), `criarEvento`, `editarEvento`, `excluirEvento`, `responderEvento`. `formatAgendaError(err)`: mensagens `agenda:` viram a copy do toast; o resto, "Não foi possível salvar o evento. Tente novamente." O payload enviado inclui `tz` do navegador em criar e em editar `todas`/`seguintes`.

### Página

`CalendarioPage` ganha a aba **"Agenda"**, padrão, ao lado das atuais (intactas até o sub-projeto 4). Captura e restaura `document.title` ("Agenda | Mesaas") no padrão de `EntregasPage.tsx:352-358`.

Componentes em `apps/crm/src/pages/calendario/agenda/` (visual nos mockups):

- **`AgendaView.tsx`**: FullCalendar com `dayGridMonth`, `timeGridWeek`, `timeGridDay`, `listWeek`; toggle próprio (shadcn `ToggleGroup`) e navegação "Hoje / ‹ / ›" + título do período fora da toolbar do FC. `firstDay: 1`, `nowIndicator`, `slotMinTime 06:00` com rolagem até a hora atual, `dayMaxEvents` ("+N mais"). Mobile (< 768px): abre em `listWeek`, toggle Mês/Dia/Lista, botão flutuante "Criar evento".
  - `datesSet` → `useQuery(['agenda-ocorrencias', start, end], listAgenda)`, `staleTime` 30 s, `placeholderData` do período anterior. Filtro por pessoa aplicado em memória sobre o resultado.
  - `EventInput`: evento com horário usa `inicio`/`fim` (ISO com offset; o FC em `local` converte certo); **dia inteiro usa `start = data_inicio_local`, `end = data_fim_local` (strings `yyyy-mm-dd`), `allDay: true`**, para ninguém ver o dia deslocado num fuso diferente.
  - `select` numa faixa vazia abre o formulário com início/fim. Clique num evento abre o popover.
  - `editable` só com `pode_editar && !mascarado`. Arrastar/redimensionar em recorrente abre o diálogo de escopo; cancelar chama `info.revert()`. Avulso salva direto, com toast "Evento movido" + "Desfazer".
  - Visual: tinta do tipo (ou `cor`) com ponto; mascarado listrado cinza "Ocupado"; `pendente` com borda tracejada; `nao` riscado com opacidade.
- **`AgendaSidebar.tsx`**: "Criar evento", mini-mês (`components/ui/calendar.tsx`), "Minha agenda / Toda a equipe", pessoas do roster `getWorkspaceUsers()` com checkbox e avatar (`avatarColorClass(user_id)` + `getInitials`), legenda dos tipos. Filtro em `localStorage` (`agenda-filtro`, try/catch). ≤ 1100px: `Sheet`.
- **`EventoPopover.tsx`**: título, "Segunda, 5 de outubro · 14:00 a 16:00", resumo da recorrência, local, "Entrar na reunião" (`sanitizeUrl`), cliente, lembretes, descrição, participantes com status, RSVP "Sim / Não / Talvez" quando `pode_responder` (recorrente pergunta "Este evento / Todos os eventos"), Editar/Excluir quando `pode_editar`. Mascarado: só "Ocupado" e horário.
- **`EventoFormDialog.tsx`** + **`eventoFormSchema.ts`** (react-hook-form + zod, padrão `TarefaFormDialog`; `confirmClose`/`onConfirmClose`). Campos: título, tipo, cliente, data + hora início/fim (passo de 15 min) ou datas (dia inteiro), Dia inteiro, Repetir, participantes (combobox multi com `ui/command.tsx`, roster por uuid), local, link, descrição, lembretes (até 5; com horário: "Na hora", "5/10/15/30 minutos antes", "1 hora antes", "1 dia antes"; dia inteiro: "No dia às 9h", "1 dia antes às 9h", "1 semana antes às 9h"), privado ("Outras pessoas verão apenas 'Ocupado' nesse horário."). Padrão: `{10}` com horário, `{}` em dia inteiro. Data e hora são interpretadas no fuso do navegador.
- **`RepetirSelect.tsx`** + **`RecorrenciaPersonalizadaDialog.tsx`**: opções derivadas da data de início ("Não se repete", "Todos os dias", "Semanal: cada {segunda}", "Mensal: no dia {5}", "Mensal: na {primeira} {segunda}", "Mensal: na última {segunda}" só quando aplicável, "Anual: em {5 de outubro}", "Todos os dias úteis (segunda a sexta)", "Personalizar…"). Mudar a data recalcula a opção pronta escolhida. Personalizado: a cada N {dias|semanas|meses|anos}, dias da semana (`WEEKDAY_CHIPS`), modo mensal, termina "Nunca / Em {data} / Após N ocorrências", com o resumo em texto.
- **`EscopoEventoDialog.tsx`**: "Editar evento recorrente" / "Excluir evento recorrente?" com "Este evento / Este e os seguintes / Todos os eventos". Mudou campo de série: "Este evento" desabilitado com "Vale para toda a série".
- **`agendaLogic.ts`** (puro, testado): regra ↔ formulário, `descreverRegra` pt-BR, opções do Repetir, `AgendaOcorrencia` → `EventInput` (com o caso dia inteiro), rótulos de lembrete, `ehUltimaSemanaDoMes`, campos que obrigam escopo de série, montagem do payload de edição.

### Deep link

`/calendario?evento=<ocorrencia_id>`: aba Agenda, `getAgendaOcorrencia`, posiciona a grade e abre o popover. Sem resultado: toast "Este evento não existe mais ou você não tem acesso." e o parâmetro sai da URL. `?data=yyyy-mm-dd` só posiciona.

### Outros pontos do CRM

- `AuthContext` (purga por revogação): `calendario` ganha `agenda-ocorrencias`.
- Mutations invalidam `['agenda-ocorrencias']` (prefixo); RSVP também as chaves do sino.
- Estilos do FC em `apps/crm/style.css`, bloco `.agenda-*` sobrescrevendo `--fc-*` com os tokens do CRM (claro e `[data-theme='dark']`). Classes `.calendar-*`/`.scheduled-*` existentes ficam (são compartilhadas).
- Copy sem travessão. `vercel.json` já cobre `/calendario`.

## Erros e casos-limite

- Usuário removido do workspace: some dos participantes, não recebe lembrete nem notificação nova; notificações antigas ficam invisíveis pela RLS de `notifications`.
- Organizador removido: o evento continua; owner/admin editam se não for privado. Privado com organizador removido continua visível aos participantes (e com lembretes para eles), e ninguém edita; limitação aceita na v1.
- Cliente apagado: `cliente_id` vira NULL.
- Ocorrência apagada/cancelada em outra aba: RPC raise "agenda: este evento não existe mais"; a UI invalida e fecha.
- Navegar além de 24 meses: séries sem fim não aparecem lá; o gerador estende todo dia.
- Concorrência: `FOR UPDATE` na série serializa edições; RSVPs usam `FOR SHARE`.
- Evento que atravessa a meia-noite: aparece nos dois dias (`inicio < p_ate AND fim > p_de`).
- "Este evento" arrastado para outro dia: `data_original` fica (identidade); uma regeneração "todas" posterior não o reposiciona (`horario_alterado`), salvo mudança de `dia_inteiro`/`tz`.
- Viewer em outro fuso: eventos com horário aparecem no horário dele; dia inteiro aparece na mesma data para todos.

## Testes

**psql (`supabase/tests/entitlements/`, CI `entitlement-tests`)**, `99_agenda_*`:
- `99_agenda_datas_regra.sql`: diário com intervalo, semanal multi-dia intervalo 2 cruzando o ano, normalização de `dtstart` fora da regra, mensal dia 31 pulando meses, 2ª terça e última sexta, anual 29/02, `ate`, `contagem` com lápide, dia inteiro (fim por data local) em `tz` com horário de verão (ex.: `America/New_York`), `materializacao_completa`.
- `99_agenda_rls.sql`: privilégios exatos (`et_grant_hosted_parity(array[...])`), ledger inacessível a `authenticated`, ausência de recursão (SELECT nas quatro tabelas como `authenticated` não dá `42P17`), privado invisível nas tabelas, máscara em `agenda_listar` (inclusive participantes sem resposta), isolamento entre workspaces, FK composta rejeitando filho com `conta_id` de outro workspace (como service_role), papel customizado sem `ver`/`editar`, participante e cliente de outro workspace rejeitados.
- `99_agenda_edicao.sql`: criar; `esta` (conteúdo, horário, mudança de data); `todas` com delta de data, com mudança de regra (apaga datas que saíram, preserva exceções e lápides sobreviventes) e com mudança de `dia_inteiro` (reset de `horario_alterado`); `seguintes` (split, `contagem` derivada, re-parent preserva RSVP por ocorrência e recalcula horário, base em `data_original` quando a ocorrência tinha exceção de data, série antiga vazia apagada); excluir nos três escopos; RSVP nos dois escopos; `pode_editar` (organizador, admin, agente não organizador, papel customizado com `editar`, privado); notificações por caminho, com exclusão do ator e de ex-membros.
- `99_agenda_lembretes.sql`: janela de 15 min (inclusive `m` negativo), dedupe no segundo tick, novo lembrete após mover o evento, recusado e ex-membro não recebem, `email_status` pela pref (`event_reminder` e `__all__`), cancelada ignorada, `emailed_at` preenchido nas notificações de lembrete, claim de e-mail com lease e retentativa.
- Suíte 96: os nomes novos (e `agenda_pode_ver_evento` nas exceções invoker-context).

**Deno (`supabase/functions/__tests__/`)**: `agenda-lembretes-email_test.ts` (claim → envio, idempotency key, falha volta a `pendente` e na 3ª vira `falhou`, prazo de 50 s, horário no `tz` do evento), `cron-auth_test.ts` (+ 401), `notification-email_test.ts` (três tipos novos, escape de título).

**Vitest**: `agendaLogic.test.ts` (regra ↔ formulário, `descreverRegra`, opções do Repetir em dia 31 e última semana, recálculo da opção ao mudar a data, `EventInput` com horário e dia inteiro, campos que obrigam escopo, payload de edição), `eventoFormSchema.test.ts`, `store/__tests__/agenda.test.ts`, `EventoFormDialog.test.tsx`, `EventoPopover.test.tsx`, `CalendarioPage.test.tsx` (aba padrão, abas antigas intactas, deep link), catálogo/config de notificação. FC mockado nos testes de página; verificação visual no browser.

**Browser**: evento avulso e recorrente, arrastar na semana, "este e os seguintes", RSVP, privado visto por outra conta, dia inteiro, dark mode, 375px.

## Rollout

Ordem (o merge deploya o frontend na hora):
1. Worktree atualizado com main (`git log HEAD..origin/main` vazio) e `cat supabase/.temp/project-ref` conferido.
2. Deploy de `notification-email-cron` (digest com os tipos novos) e `agenda-lembretes-email` (`--no-verify-jwt --use-api`).
3. `npx supabase db push --linked` (migrations A e B; B agenda `agenda-lembretes` no fim, já com a função no ar).
4. Merge do PR.
5. Verificar: evento com lembrete de 5 min numa conta de teste; `cron.job_run_details` de `agenda-lembretes` e `agenda-horizonte`; sino e e-mail.

**Rollback (runbook, com o SQL pronto em `docs/superpowers/specs/assets/2026-10-05-agenda-rollback.sql`, não aplicado por migration):**
- Só lembretes: `cron.unschedule('agenda-lembretes')`. Nada mais muda.
- Tudo: `cron.unschedule` dos dois jobs; `DELETE FROM notifications WHERE type IN (5 tipos)`; `DELETE FROM notification_inapp_prefs/notification_email_prefs WHERE type IN (...)`; recriar `claim_notification_emails` e os três CHECKs com as listas anteriores (copiadas de `20260903000001`/`20260815000004`); `DROP` das funções e tabelas `agenda_*`. Frontend: reverter o PR antes, para nenhum bundle chamar os RPCs. Os tipos novos nos CHECKs são inofensivos se ficarem, então o passo de restauração dos CHECKs é opcional num rollback parcial.

Numeração: próximas versões livres acima do topo de main ao abrir o PR (hoje `20261005000001` e `20261005000002`).

## Arquivos a tocar

- `supabase/migrations/20261005000001_agenda_eventos.sql` (A) e `20261005000002_agenda_lembretes.sql` (B).
- `supabase/functions/agenda-lembretes-email/{index,handler}.ts`, `supabase/functions/_shared/agenda-email.ts`, `supabase/functions/_shared/notification-email.ts`, `supabase/config.toml`.
- `supabase/tests/entitlements/99_agenda_*.sql` + suíte 96.
- `supabase/functions/__tests__/agenda-lembretes-email_test.ts`, `cron-auth_test.ts`, `notification-email_test.ts`.
- `apps/crm/src/store/agenda.ts`, `store/index.ts`, `store/notifications.ts`.
- `apps/crm/src/lib/notification-catalog.ts`, `notification-config.ts` + testes em `apps/crm/src/__tests__/`.
- `apps/crm/src/pages/calendario/CalendarioPage.tsx`, `pages/calendario/agenda/*` + `__tests__`.
- `apps/crm/src/context/AuthContext.tsx`.
- `apps/crm/style.css` (bloco `.agenda-*`).
- `package.json` / `package-lock.json`.
- `docs/superpowers/specs/assets/2026-10-05-agenda-rollback.sql`.

## Fora do escopo

`.ics`, botão do Google e feed (2). Hub, convidado externo, e-mail ao cliente (3). Camadas antigas na grade e posts agendados (4). Escolha de fuso na UI, anexos, busca de eventos, links de agendamento, sync bidirecional com Google, link automático do Meet, sugestão de horário livre, MCP, exclusão de evento privado órfão por owner/admin.

## Registro das revisões

Fable (21 pontos) e Codex (8 pontos), 2026-10-05. Incorporados: recursão de RLS (helper definer), claim de lembrete dirigido pela série e janela corrigida, derivação de `dtstart` por delta, `insert` direto com `RETURNING`, lacunas do split, reset de `horario_alterado`, normalização de `dtstart`, ordem de travas e `SKIP LOCKED`, job SQL-only com chamada condicional, `timeZone: 'local'` + dia inteiro como data, máscara com participantes, permissão do RSVP, `materializacao_completa`, `tz` validado no guard, ledger sem grant, filtro de membros no fan-out, caminhos de teste, `document.title`, `agenda_listar` com `p_ocorrencia_id`, filtro por pessoa no cliente (Fable); FKs compostas, ledger com `inicio_alvo`, roster por uuid, fim de dia inteiro por data local, runbook de rollback (Codex).

Decididos de forma diferente da sugestão:
- **`pode_editar` (Codex P1, Fable P3):** mantido organizador + owner/admin como regra de produto explícita (decisão 8), em vez de liberar a edição de eventos alheios para qualquer um com `calendario: editar`.
- **Cortar RSVP por ocorrência (Fable 21a):** rejeitado; o sub-projeto 3 precisa dele (cliente confirma uma gravação específica).
- **Separar lembretes num sub-projeto (Codex):** rejeitado como spec separado (lembrete é requisito do usuário e as regras do ledger agora estão resolvidas), aceito como migration B com kill switch e rollback próprios.
- **Quarto job por minuto (Fable 9):** mantido a cada minuto (precisão de lembrete), mas SQL-only e com a edge function chamada só quando há e-mail pendente; custo de conexão registrado.
