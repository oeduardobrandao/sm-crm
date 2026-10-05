# Agenda: eventos, recorrência, convites e lembretes (sub-projeto 1) — design

Status: rascunho para revisão · Branch: `claude/full-featured-calendar-app-c56639`

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

Este documento só implementa o sub-projeto 1, mas modela o que 2 e 3 vão precisar (`cliente_id` no evento, identidade estável de ocorrência, regra guardada em colunas convertíveis para RRULE) para não exigir migração destrutiva depois.

## Decisões deste sub-projeto

1. **Abordagem B: regra + ocorrências materializadas.** A série guarda a regra (fonte da verdade). Ocorrências são linhas reais geradas até um horizonte móvel de 24 meses. Estado por ocorrência (RSVP, exceções, lembrete enviado) mora na linha da ocorrência. Precedente direto no repo: `tarefa_series` (migration `20260925000030`), que já gera ocorrências no banco, com escrita só por RPC e cron gerador.
2. **Toda a matemática de data fica no banco** (PL/pgSQL), como em tarefas. Nenhum `rrule.js` no front nem no Deno: um motor só, testado em psql.
3. **Fuso:** um fuso por evento, gravado (`tz`, padrão `America/Sao_Paulo`). Regras são expandidas em horário de parede local e convertidas para instante com `AT TIME ZONE tz`, então horário de verão futuro é tratado pelo Postgres. A UI do sub-projeto 1 não expõe a escolha de fuso (sempre São Paulo); fica para depois.
4. **Identidade de participante = auth uid** (`auth.users.id`), amarrada a `workspace_members`. Notificações já são por uid. `membros` não serve: nem todo usuário tem `membros` (o owner, por exemplo) e `membros` sem `crm_user_id` não loga. Convidados externos por e-mail ficam para o sub-projeto 3.
5. **Calendário de UI: FullCalendar 6.1.21 (MIT)** — `@fullcalendar/react`, `core`, `daygrid`, `timegrid`, `list`, `interaction`. A linha 7.x saiu em 2026 mas os plugins ainda não estão em `latest`; ficamos na 6.1.x, que declara peer React 19. Sem `@fullcalendar/rrule` (ocorrências chegam materializadas). Nada do tier premium (resource/timeline).
6. **E-mail de convite, alteração e cancelamento vai pelo digest existente** (`notification-email-cron`: tipos novos entram como e-mail-elegíveis, chegam em até ~15 min, respeitam as preferências da Central de Notificações). **Lembrete vai por cron próprio**, a cada minuto, com envio direto (o digest tem 10 min de assentamento e não serve para "10 minutos antes").
7. **Sem gate de plano.** O módulo de permissão `calendario` já existe (`apps/crm/src/lib/permissions.ts`, `has_permission_for`): `ver` lista, `editar` cria/edita.

## Modelo de dados

Prefixo `agenda_` para não confundir com o calendário de posts das Entregas. Todas as tabelas têm `conta_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE`.

### `agenda_eventos` (a série; um evento avulso é uma série sem regra)

| Coluna | Tipo | Notas |
|---|---|---|
| `id` | `bigint generated always as identity` PK | |
| `conta_id` | `uuid NOT NULL` | |
| `organizador_id` | `uuid NULL REFERENCES auth.users ON DELETE SET NULL` | quem criou; nullable pela regra de `20261001000001` |
| `titulo` | `text NOT NULL` | 1..200, trim |
| `descricao` | `text NULL` | ≤ 5000, texto puro |
| `local` | `text NULL` | ≤ 300 |
| `link_reuniao` | `text NULL` | ≤ 500, `^https?://` (CHECK); renderizado com `sanitizeUrl()` |
| `tipo` | `text NOT NULL DEFAULT 'reuniao'` | CHECK IN (`reuniao`,`gravacao`,`captacao`,`apresentacao`,`interno`,`outro`); define a cor padrão |
| `cor` | `text NULL` | chave de paleta (CHECK em lista fixa de 8 chaves) que sobrepõe a cor do tipo |
| `cliente_id` | `bigint NULL` | FK composta `(cliente_id, conta_id) REFERENCES clientes(id, conta_id) ON DELETE SET NULL (cliente_id)`; se a FK composta exigir índice único `(id, conta_id)` em `clientes` e ele não existir, a migration cria |
| `privado` | `boolean NOT NULL DEFAULT false` | |
| `dia_inteiro` | `boolean NOT NULL DEFAULT false` | |
| `tz` | `text NOT NULL DEFAULT 'America/Sao_Paulo'` | CHECK: `now() AT TIME ZONE tz` não lança (validado no guard) |
| `dtstart` | `timestamp NOT NULL` | horário de parede local da 1ª ocorrência; `dia_inteiro` ⇒ 00:00 |
| `duracao_min` | `int NOT NULL` | > 0; timed ≤ 14 dias; `dia_inteiro` ⇒ múltiplo de 1440, ≤ 31 dias |
| `freq` | `text NULL` | NULL = não repete; CHECK IN (`daily`,`weekly`,`monthly`,`yearly`) |
| `intervalo` | `int NOT NULL DEFAULT 1` | 1..99 |
| `dias_semana` | `int[] NULL` | `weekly`: obrigatório, valores 0..6 (0 = domingo), sem repetição |
| `mensal_modo` | `text NULL` | `monthly`: obrigatório, IN (`dia_mes`,`dia_semana`) |
| `mensal_ordinal` | `int NULL` | `monthly` + `dia_semana`: IN (1,2,3,4,-1); o dia da semana vem de `dtstart` |
| `ate` | `date NULL` | fim por data (inclusive, em data local) |
| `contagem` | `int NULL` | fim por número de ocorrências, 1..730 |
| `lembretes` | `int[] NOT NULL DEFAULT '{}'` | minutos antes de `inicio`; ≤ 5 itens; valores em -1440..40320 (negativo = depois do início, usado por dia-inteiro "no dia às 9h") |
| `serie_origem_id` | `bigint NULL REFERENCES agenda_eventos(id) ON DELETE SET NULL` | linhagem de um split "este e os seguintes" (informativo, para o feed do sub-projeto 2) |
| `horizonte_ate` | `date NULL` | até onde já materializou (NULL = sem regra) |
| `created_at`, `updated_at` | `timestamptz` | trigger de `updated_at` |

CHECKs de coerência: `freq IS NULL ⇒ dias_semana, mensal_modo, mensal_ordinal, ate, contagem IS NULL`; `NOT (ate IS NOT NULL AND contagem IS NOT NULL)`; `ate IS NULL OR ate >= dtstart::date`; `ate <= dtstart::date + 5 anos`; regras por `freq` como na tabela.

Semântica da regra (alinhada a RFC 5545 / Google, para o feed do sub-projeto 2 emitir RRULE fiel):
- `monthly` + `dia_mes` usa o dia de `dtstart`; **meses sem esse dia são pulados** (dia 31 não cai em abril). Difere de propósito de tarefas, que fazem clamp: tarefas são prazos, eventos têm que bater com o RRULE `BYMONTHDAY`.
- `monthly` + `dia_semana`: "a 2ª terça", "a última sexta" (`mensal_ordinal = -1`). Ordinal 5 não existe na UI (Google também não oferece).
- `yearly` usa mês/dia de `dtstart`; 29/02 só cai em ano bissexto.
- `weekly` com `intervalo > 1` conta semanas segunda→domingo (`date_trunc('week')`), igual a `tarefa_next_date`; `WKST=MO` no RRULE.
- "Todo dia útil" = `weekly` com `dias_semana = {1,2,3,4,5}`.

### `agenda_ocorrencias`

| Coluna | Tipo | Notas |
|---|---|---|
| `id` | `bigint identity` PK | |
| `conta_id` | `uuid NOT NULL` | |
| `evento_id` | `bigint NOT NULL REFERENCES agenda_eventos ON DELETE CASCADE` | |
| `data_original` | `date NOT NULL` | data local que a regra produziu; **identidade estável** com `evento_id` |
| `inicio` | `timestamptz NOT NULL` | instante efetivo |
| `fim` | `timestamptz NOT NULL` | `> inicio` |
| `horario_alterado` | `boolean NOT NULL DEFAULT false` | exceção de horário ("somente este" ou arrastar) |
| `titulo`, `descricao`, `local`, `link_reuniao` | `text NULL` | exceções de conteúdo; NULL = herda da série |
| `cancelada` | `boolean NOT NULL DEFAULT false` | "excluir somente este": lápide, impede que a regeneração recrie a data (EXDATE) |

`UNIQUE (evento_id, data_original)`. Regras nunca produzem duas ocorrências na mesma data local (frequência mínima diária), então a data é chave suficiente e sobrevive a mudança de horário da série. Índices: `(conta_id, inicio) WHERE NOT cancelada` (listagem e lembretes) e `(evento_id, data_original)` (pela unique).

### `agenda_participantes` (por série)

| Coluna | Tipo | Notas |
|---|---|---|
| `evento_id` | `bigint NOT NULL REFERENCES agenda_eventos ON DELETE CASCADE` | |
| `conta_id` | `uuid NOT NULL` | |
| `user_id` | `uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE` | |
| `resposta` | `text NOT NULL DEFAULT 'pendente'` | IN (`pendente`,`sim`,`nao`,`talvez`) |
| `respondido_em` | `timestamptz NULL` | |

PK `(evento_id, user_id)`. O organizador entra como participante com `resposta = 'sim'`. ≤ 50 participantes por evento.

### `agenda_respostas` (RSVP de uma ocorrência só)

`(ocorrencia_id bigint REFERENCES agenda_ocorrencias ON DELETE CASCADE, user_id uuid REFERENCES auth.users ON DELETE CASCADE, conta_id, resposta, respondido_em)`, PK `(ocorrencia_id, user_id)`. Resposta efetiva = `coalesce(agenda_respostas.resposta, agenda_participantes.resposta)`.

### `agenda_lembretes_enviados` (ledger de dedupe)

`(ocorrencia_id REFERENCES agenda_ocorrencias ON DELETE CASCADE, user_id uuid, minutos int, conta_id, enviado_em timestamptz DEFAULT now())`, PK `(ocorrencia_id, user_id, minutos)`. O `INSERT ... ON CONFLICT DO NOTHING RETURNING` é o claim atômico. Limpeza: o gerador diário apaga linhas com `enviado_em < now() - 30 dias`.

### Privilégios e RLS

Padrão `tarefa_series` (escrita só por RPC):
- `REVOKE ALL ON <tabela> FROM PUBLIC, anon, authenticated; GRANT SELECT ... TO authenticated; GRANT ALL ... TO service_role` nas cinco tabelas, mais o bloco `DO` de pós-condição que falha a migration se `authenticated` tiver algo além de SELECT ou `anon` tiver qualquer coisa.
- Política de SELECT em `agenda_eventos`: `conta_id IN (SELECT get_my_conta_id()) AND (SELECT has_permission('calendario','ver')) AND (NOT privado OR organizador_id = auth.uid() OR EXISTS (participante auth.uid() deste evento, tabela externa qualificada))`.
- `agenda_ocorrencias`, `agenda_participantes`, `agenda_respostas`: SELECT via `EXISTS` no `agenda_eventos` pai (a política do pai se aplica dentro do EXISTS, então privado continua escondido).
- `agenda_lembretes_enviados`: sem política para `authenticated` (só service_role).
- Política `*_service_role_bypass` FOR ALL TO service_role em todas.

A leitura direta das tabelas existe para o formulário de edição (carregar regra e participantes de um evento que o usuário pode ver). A grade do calendário lê pelo RPC `agenda_listar`, que é quem faz a máscara de "ocupado".

## Funções no banco

Todas `SET search_path = public`. Funções de data puras mantêm EXECUTE padrão (como `tarefa_next_date`). Internas SECURITY DEFINER: `REVOKE ALL ... FROM PUBLIC, anon, authenticated; GRANT EXECUTE TO service_role`. RPCs de cliente SECURITY DEFINER: `REVOKE ALL ... FROM PUBLIC, anon, authenticated, service_role; GRANT EXECUTE TO authenticated, service_role`. Os nomes entram no array da suíte de lockdown de definer (`96_lockdown_definer_function_grants.sql` ou suíte irmã).

Preâmbulo comum dos RPCs de cliente: `v_conta := get_my_conta_id(); v_user := auth.uid();` raise se NULL; `conta_id` e `user_id` nunca vêm de parâmetro; toda linha referenciada é filtrada por `conta_id = v_conta`; `cliente_id` precisa existir em `clientes` de `v_conta`; cada participante precisa ter linha em `workspace_members` com `workspace_id = v_conta`.

### Matemática de datas

- `agenda_datas_regra(p_evento agenda_eventos, p_de date, p_ate date) RETURNS SETOF date` — IMMUTABLE no conteúdo da linha. Enumera as datas da regra em `[p_de, p_ate]`, respeitando `ate` e `contagem`. Implementação por `generate_series` sobre o período (dia/semana/mês/ano) ancorado em `dtstart::date` com passo `intervalo`, filtrando candidatos; `contagem` é aplicada contando desde `dtstart` (limite de 730, então a enumeração desde o início é barata). Sem regra: só `dtstart::date`.
- `agenda_instante(p_data date, p_dtstart timestamp, p_tz text) RETURNS timestamptz` = `(p_data + p_dtstart::time) AT TIME ZONE p_tz`.
- `agenda_hoje(p_tz text) RETURNS date` com override por GUC `app.agenda_hoje` para as suítes (padrão `tarefa_hoje_sp`).

### Materialização

`agenda_materializar(p_evento_id bigint, p_ate date)` (interna): para cada data de `agenda_datas_regra(e, coalesce(horizonte_ate + 1, dtstart::date), p_ate)`, `INSERT ... ON CONFLICT (evento_id, data_original) DO NOTHING` com `inicio = agenda_instante(data, dtstart, tz)` e `fim = inicio + duracao_min`. Atualiza `horizonte_ate = p_ate` (ou a última data, quando a regra termina antes). Horizonte padrão: `agenda_hoje(tz) + 24 meses`.

`agenda_regenerar(p_evento_id bigint)` (interna), usada quando regra, `dtstart` ou `duracao_min` mudam com escopo "todos":
1. Calcula o conjunto novo de datas em `[dtstart::date, horizonte]`.
2. Apaga ocorrências cuja `data_original` saiu do conjunto (inclusive exceções e RSVPs por ocorrência delas; aceito, o Google faz igual).
3. Nas que ficaram e têm `horario_alterado = false`, recalcula `inicio`/`fim` com o `dtstart`/`duracao_min` novos.
4. Insere as datas novas.
5. Lápides (`cancelada`) cuja data continua na regra permanecem.

### Gerador diário

`agenda_gerar_horizonte()` (interna, pg_cron SQL-only, como `generate_recurring_tarefas`): para séries com `freq IS NOT NULL` e `horizonte_ate < agenda_hoje(tz) + 24 meses` e regra ainda viva, chama `agenda_materializar`. Também limpa o ledger de lembretes com mais de 30 dias. Agenda: `cron.schedule('agenda-horizonte', '23 4 * * *', ...)` (minuto fora dos já usados; conferir `20260925110001_stagger_cron_schedules.sql`).

### RPCs de cliente

**`agenda_listar(p_de timestamptz, p_ate timestamptz, p_usuarios uuid[] DEFAULT NULL)`** — STABLE, SECURITY DEFINER. Exige `has_permission('calendario','ver')`. `p_ate - p_de ≤ 100 dias` (raise acima). Retorna ocorrências não canceladas com `inicio < p_ate AND fim > p_de`, filtradas por `p_usuarios` (organizador ou participante no conjunto) quando não nulo:

`ocorrencia_id, evento_id, inicio, fim, dia_inteiro, titulo, descricao, local, link_reuniao, tipo, cor, cliente_id, cliente_nome, privado, mascarado, recorrente, organizador_id, participantes jsonb ([{user_id, resposta}] com resposta efetiva), minha_resposta, pode_editar`

- Conteúdo = `coalesce(exceção da ocorrência, série)`.
- **Máscara:** se `privado` e o usuário não é organizador nem participante, retorna `titulo = 'Ocupado'`, `mascarado = true` e `descricao, local, link_reuniao, cliente_id, cliente_nome, tipo` como NULL; `participantes` só com o organizador (sem resposta), para o filtro "por pessoa" e o "ocupado" continuarem funcionando.
- Participantes que não estão mais em `workspace_members` são omitidos.
- `pode_editar` = `organizador_id = v_user OR (papel do usuário em workspace_members IN ('owner','admin') AND NOT privado)`, sempre AND `has_permission('calendario','editar')`. Organizador sem `editar` não edita. Evento com organizador removido do workspace (`organizador_id` órfão ou NULL) fica editável por owner/admin.

**`agenda_ocorrencia(p_ocorrencia_id bigint)`** — mesma linha e mesma máscara, para o deep link `?evento=<ocorrencia_id>`. Ocorrência inexistente, de outro workspace ou cancelada retorna zero linhas.

**`agenda_evento_criar(p_evento jsonb, p_participantes uuid[]) RETURNS TABLE (evento_id bigint, ocorrencia_id bigint)`** — exige `editar`. Valida o payload (o guard da tabela é o backstop), insere a série com `organizador_id = v_user`, insere participantes (organizador com `sim`, demais `pendente`, dedupe, valida membresia), materializa até o horizonte e devolve a 1ª ocorrência. Notifica `event_invited` aos participantes exceto o organizador.

**`agenda_evento_editar(p_ocorrencia_id bigint, p_escopo text, p_evento jsonb, p_participantes uuid[] DEFAULT NULL) RETURNS bigint`** — `p_escopo IN ('esta','seguintes','todas')`. Trava a série (`FOR UPDATE`) e exige `pode_editar`. Retorna o id da ocorrência que representa a editada (pode mudar no split).
- Evento sem regra: escopo é ignorado, edita a série e a ocorrência única.
- `seguintes` na primeira ocorrência da série é normalizado para `todas`.
- **`esta`:** grava exceções na ocorrência: conteúdo (`titulo`, `descricao`, `local`, `link_reuniao`) e horário (`inicio`, `fim`, `horario_alterado = true`). `tipo`, `cor`, `cliente_id`, `privado`, `dia_inteiro`, `lembretes`, regra e participantes **não** são editáveis em `esta` (a UI desabilita com o texto "Vale para toda a série"; o RPC raise se vierem diferentes da série).
- **`todas`:** atualiza a série com o payload inteiro. Se regra, `dtstart`, `duracao_min`, `dia_inteiro` ou `tz` mudaram, chama `agenda_regenerar`. Exceções de conteúdo das ocorrências sobreviventes são mantidas. Participantes: `p_participantes` não nulo substitui o conjunto (adicionados entram `pendente`, removidos saem com suas respostas por ocorrência).
- **`seguintes`:** split. Na série antiga, `ate = data_original - 1` (`contagem` vira `ate` equivalente, `contagem = NULL`) e ocorrências com `data_original >=` o ponto de corte saem dela. Cria a série nova com o payload, `dtstart` = novo início da ocorrência editada, `serie_origem_id` = antiga, participantes = `p_participantes` ou cópia dos antigos (respostas da série copiadas). Ocorrências antigas a partir do corte cuja `data_original` está na regra nova são **re-parentadas** (`UPDATE evento_id`), preservando exceções de conteúdo, lápides e RSVPs por ocorrência; as que não batem são apagadas; as que faltam são materializadas. `contagem` da série nova conta a partir do corte.
- Notificações: `event_updated` aos participantes atuais (exceto o ator) quando mudar título, horário, regra, local, link ou `dia_inteiro` (mudança só de descrição, cor ou lembretes não notifica). Adicionados recebem `event_invited`, removidos recebem `event_cancelled` com `metadata.motivo = 'removido'`.

**`agenda_evento_excluir(p_ocorrencia_id bigint, p_escopo text)`** — exige `pode_editar`.
- `esta`: `cancelada = true`. Se for a última ocorrência viva de uma série sem mais datas futuras, a série é apagada.
- `seguintes`: `ate = data_original - 1` + apaga as ocorrências a partir do corte. No primeiro, vira `todas`.
- `todas`: `DELETE` da série (cascata).
- Notifica `event_cancelled` aos participantes exceto o ator, **antes** do delete (metadata leva título e data, porque o link morre).

**`agenda_responder(p_ocorrencia_id bigint, p_resposta text, p_escopo text)`** — `p_resposta IN ('sim','nao','talvez')`, `p_escopo IN ('esta','todas')`. Só para quem é participante (o organizador não responde). `todas` grava em `agenda_participantes` e apaga as respostas por ocorrência futuras do usuário; `esta` faz upsert em `agenda_respostas`. Notifica `event_rsvp` ao organizador (se ainda membro e não for o ator), uma por resposta.

Ordem de travas em todos os RPCs que escrevem: série primeiro, depois ocorrências por `id`. Nada de trigger de tabela que trave na ordem inversa (lição do `tarefa_serie_excluir`, `40P01`).

### Lembretes

**`agenda_claim_lembretes(p_now timestamptz, p_limit int DEFAULT 500)`** — interna (service_role), VOLATILE. Para cada ocorrência não cancelada, participante membro atual com resposta efetiva diferente de `nao`, e cada `m` em `lembretes`, com `inicio - m minutos` em `(p_now - 15 min, p_now]`:
1. `INSERT INTO agenda_lembretes_enviados ... ON CONFLICT DO NOTHING RETURNING` (claim atômico, at-most-once).
2. Para os claims novos, insere a notificação in-app `event_reminder` (via `insert_notification_batch` ou insert direto com o mesmo shape).
3. Retorna `(notification_id, user_id, ocorrencia_id, titulo, inicio, fim, local, link_reuniao, minutos, email_habilitado)`, onde `email_habilitado` aplica a regra de `notification_email_prefs` (sem linha = ligado; `type = 'event_reminder'` ou `'__all__'` com `enabled = false` = desligado).

Lembrete atrasado mais de 15 min (cron fora do ar) é descartado, não enviado atrasado. A busca usa o índice `(conta_id, inicio)` com a janela `inicio BETWEEN p_now - 15 min - min(lembretes) AND p_now + 28 dias` (máximo de antecedência = 40320 min).

**Edge function `agenda-lembretes-cron`** (`--no-verify-jwt`, `x-cron-secret`, padrão `handler.ts` + `index.ts`):
- Chama `agenda_claim_lembretes(now())`.
- Para as linhas com `email_habilitado`, resolve o e-mail via `auth.admin.getUserById` e envia com `sendViaResend` (`_shared/lifecycle-emails.ts`), From `Mesaas <notificacoes@mesaas.com.br>`, idempotency key `agenda-lembrete:{ocorrencia_id}:{user_id}:{minutos}`, HTML no `layout()` compartilhado, tudo interpolado com `escapeHtml`, assunto com `sanitizeSubjectValue`. Marca `notifications.emailed_at = now()` nessas linhas.
- Falha de envio: loga e segue (at-most-once; o in-app já saiu). Falha do RPC: `reportCronFailure`.
- Prazo de execução de 50 s; o resto fica para o próximo tick (o claim não é feito para o que não coube, porque `p_limit` corta antes).
- pg_cron `'* * * * *'` com o padrão `net.http_post` + vault (subselect em `vault.decrypted_secrets`), agendado só depois do deploy da função. `[functions.agenda-lembretes-cron] verify_jwt = false` em `supabase/config.toml`.

### Notificações: tipos novos

| Tipo | Quem recebe | App | E-mail |
|---|---|---|---|
| `event_invited` | participante adicionado | sim | digest (elegível) |
| `event_updated` | participantes, exceto o ator | sim | digest (elegível) |
| `event_cancelled` | participantes, exceto o ator (inclui removidos) | sim | digest (elegível) |
| `event_rsvp` | organizador | sim | não |
| `event_reminder` | participantes que não recusaram | sim | cron próprio (elegível; fora do `claim_notification_emails`) |

Link das notificações: `/calendario?evento={ocorrencia_id}` (cancelado: `/calendario?data={yyyy-mm-dd}`). Metadata: `evento_id, ocorrencia_id, titulo, inicio, fim, dia_inteiro, recorrente, escopo, ator_nome`. Notificação de evento privado só chega a envolvidos, então o título na metadata não vaza.

Pontos que mudam (lista verificada no código):
1. `notifications_type_check`: DROP + ADD copiando os 22 valores de `20260815000004` e acrescentando os 5.
2. `notification_inapp_prefs_type_check`: + 5.
3. `notification_email_prefs_type_check`: + `event_invited`, `event_updated`, `event_cancelled`, `event_reminder`.
4. `claim_notification_emails`: recriar com o array + `event_invited`, `event_updated`, `event_cancelled` (não `event_reminder`), mantendo revoke/grant.
5. `_shared/notification-email.ts` `resolveDigestItem`: cabeçalho e corpo dos três tipos de digest.
6. `apps/crm/src/store/notifications.ts`: união `NotificationType`.
7. `apps/crm/src/lib/notification-catalog.ts`: 5 entradas numa categoria nova `agenda` ("Agenda"), com `CATEGORY_ORDER`/`CATEGORY_LABELS`.
8. `apps/crm/src/lib/notification-config.ts`: ícone (lucide `CalendarPlus`, `CalendarClock`, `CalendarX`, `CalendarCheck`, `AlarmClock`), tom, título e corpo.
9. Testes: `notification-catalog.test.ts` (22 → 27, e-mail 9 → 13), `notification-config.test.ts`, `notification-email_test.ts`, suítes psql 64/73 se afirmarem listas fechadas.

## Frontend (CRM)

### Dependências

`@fullcalendar/core`, `react`, `daygrid`, `timegrid`, `list`, `interaction`, todas `~6.1.21`, no `package.json` raiz (workspace). Locale `pt-br` de `@fullcalendar/core/locales/pt-br`. A página já é lazy, então o peso fica fora do bundle inicial.

### Store: `apps/crm/src/store/agenda.ts` (exportado no barrel)

Tipos `AgendaOcorrencia`, `AgendaEvento`, `AgendaParticipante`, `AgendaRegra`, `AgendaEscopo`, `AgendaResposta`. Funções: `listAgenda(de, ate, usuarios?)`, `getAgendaOcorrencia(id)`, `getAgendaEvento(eventoId)` (série + participantes, leitura direta com RLS), `criarEvento`, `editarEvento`, `excluirEvento`, `responderEvento` (wrappers de `supabase.rpc`). Mapeamento de erros conhecidos (RAISE com mensagem pt-BR) para `toast`.

### Página

`CalendarioPage` ganha uma aba nova **"Agenda"**, que passa a ser a padrão, ao lado das abas atuais (que continuam intactas até o sub-projeto 4 transformá-las em camadas). `document.title` padrão `EntregasPage` (salva e restaura).

Componentes novos em `apps/crm/src/pages/calendario/agenda/`:

- **`AgendaView.tsx`**: wrapper do FullCalendar. Visões `dayGridMonth`, `timeGridWeek`, `timeGridDay`, `listWeek`, alternadas por um toggle próprio (shadcn `ToggleGroup`) e não pela toolbar do FullCalendar; navegação "Hoje / ‹ / ›" e título do período no header da página. Semana começa na segunda (`firstDay: 1`, igual a `month-grid.tsx`), `nowIndicator`, `slotMinTime 06:00` com rolagem até o horário atual, `dayMaxEvents` com "+N". Mobile (< 768px): abre em `listWeek` e esconde o toggle de semana.
  - `datesSet` → busca `listAgenda(start, end, filtro)` via `useQuery(['agenda-ocorrencias', start, end, filtro])`, `staleTime` 30 s, `placeholderData` mantendo o período anterior.
  - Clique numa faixa vazia (`select`) abre o formulário com início/fim preenchidos. Clique num evento abre o popover.
  - `editable` só em eventos com `pode_editar && !mascarado`. Arrastar/redimensionar em evento recorrente abre o diálogo de escopo; cancelar o diálogo chama `info.revert()`. Avulso salva direto (`todas`), com toast "Evento movido" + desfazer.
  - Cor: `cor ?? cor do tipo`; mascarado em cinza listrado; resposta `pendente` com borda tracejada; `nao` com texto riscado e opacidade (como o Google).
- **`AgendaSidebar.tsx`**: botão "Criar evento", mini-mês (`components/ui/calendar.tsx`) que navega a grade, filtro "Minha agenda / Toda a equipe" e lista de pessoas com checkbox e avatar (`avatarColorClass` + `getInitials`, markup de `ResponsaveisPanel`). Filtro persistido em `localStorage` (`agenda-filtro`, com try/catch). Em ≤ 1100px vira um `Sheet` acionado por botão.
- **`EventoPopover.tsx`**: título, data/horário legível ("Terça, 7 de outubro · 14:00 – 15:00"), resumo da recorrência, local, link "Entrar na reunião" (`sanitizeUrl`), cliente, descrição, participantes com status (sim/não/talvez/pendente), botões de RSVP "Sim / Não / Talvez" (só para participante; em recorrente pergunta "Este evento / Todos os eventos"), e ações Editar/Excluir quando `pode_editar`. Mascarado mostra só "Ocupado" e o horário.
- **`EventoFormDialog.tsx`** + **`eventoFormSchema.ts`** (react-hook-form + zod, padrão `TarefaFormDialog`; `confirmClose`/`onConfirmClose` no `DialogContent`, que já cobre `useUnsavedWork`). Campos: título, tipo (com cor), dia inteiro, data e hora de início e fim (`DatePicker` + seletor de hora com passo de 15 min), Repetir, participantes (combobox multi com `ui/command.tsx` + chips com avatar), cliente (`Select`, como em tarefas), local, link da reunião, descrição, lembretes (lista com até 5: "Na hora", "5/10/15/30 min antes", "1 hora antes", "1 dia antes"; dia inteiro: "No dia às 9h", "1 dia antes às 9h", "1 semana antes às 9h"), privado (switch com "Outras pessoas verão apenas 'Ocupado'"). Padrão de lembrete: `{10}` em evento com horário, `{}` em dia inteiro.
- **`RepetirSelect.tsx`** + **`RecorrenciaPersonalizadaDialog.tsx`**: opções no estilo Google, derivadas da data de início: "Não se repete", "Todos os dias", "Semanal: cada {terça}", "Mensal: no dia {7}", "Mensal: na {primeira} {terça}", "Mensal: na última {terça}" (só quando a data é a última daquele dia no mês), "Anual: em {7 de outubro}", "Todos os dias úteis (segunda a sexta)", "Personalizar…". O diálogo personalizado: repetir a cada N {dias|semanas|meses|anos}, chips de dias (reusa `WEEKDAY_CHIPS` de `pages/tarefas/recorrenciaLogic.ts`), modo mensal, termina "Nunca / Em {data} / Após N ocorrências".
- **`EscopoEventoDialog.tsx`**: AlertDialog "Editar evento recorrente" / "Excluir evento recorrente" com rádio "Este evento / Este e os seguintes / Todos os eventos". Quando o formulário mudou campos que só valem para a série, "Este evento" fica desabilitado com "Vale para toda a série".
- **`agendaLogic.ts`** (funções puras, testadas): regra ↔ valores do formulário, `descreverRegra(regra, dtstart)` em pt-BR, opções do `RepetirSelect`, mapeamento `AgendaOcorrencia` → `EventInput`, rótulo de lembrete, `ehUltimaSemanaDoMes`, quais campos mudados obrigam escopo de série.

### Deep link

`/calendario?evento=<ocorrencia_id>` seleciona a aba Agenda, chama `getAgendaOcorrencia`, posiciona a grade na data e abre o popover. Sem resultado: toast "Este evento não existe mais ou você não tem acesso." e o parâmetro é removido. `?data=yyyy-mm-dd` só posiciona.

### Outros pontos do CRM

- `AuthContext` (purga por revogação de módulo): `calendario` ganha a chave `agenda-ocorrencias`.
- Mutations invalidam `['agenda-ocorrencias']` (prefixo) e, no RSVP, as chaves do sino.
- Estilos do FullCalendar em `apps/crm/style.css`, num bloco `.agenda-*` que sobrescreve as variáveis `--fc-*` com os tokens do CRM (claro e `[data-theme='dark']`). Nenhuma classe existente de `.calendar-*`/`.scheduled-*` é removida (são compartilhadas).
- Copy sem travessão (memória `feedback_no_emdash_user_copy`).
- `vercel.json` já cobre `/calendario`; nenhuma rota nova.

## Erros e casos-limite

- Usuário removido do workspace: some da lista de participantes, não recebe lembrete (o claim checa `workspace_members`) e suas notificações antigas já ficam invisíveis pela RLS de `notifications`.
- Organizador removido: evento continua; owner/admin editam (se não for privado). Evento privado de organizador removido fica invisível para todos e é editável por ninguém; aceito (o organizador pode reentrar; limpeza fica para depois).
- Cliente apagado: `cliente_id` vira NULL pela FK.
- Ocorrência cancelada pelo popover de outra aba aberta: o RPC de edição recebe `p_ocorrencia_id` inexistente/cancelada e raise "Este evento não existe mais."; a UI invalida e fecha.
- Série que termina por `contagem` dentro do horizonte: `horizonte_ate` = última data; o gerador pula.
- Navegar além de 24 meses: séries sem fim não aparecem lá. Aceito na v1; o gerador estende o horizonte todo dia.
- Concorrência de edição na mesma série: `FOR UPDATE` serializa; o segundo vê o estado novo.
- Evento que atravessa a meia-noite: aparece nos dois dias; a busca por `inicio < p_ate AND fim > p_de` já cobre.
- Drag para outro dia de uma ocorrência com `esta`: `data_original` não muda (identidade), só `inicio`/`fim`. A regeneração "todas" posterior não reposiciona essa ocorrência (`horario_alterado`).

## Testes

**psql (`supabase/tests/entitlements/`, rodam no CI `entitlement-tests`)**, numeração `99_agenda_*`:
- `99_agenda_datas_regra.sql`: uma bateria por freq e modo (diário com intervalo, semanal multi-dia com intervalo 2 cruzando virada de ano, mensal dia 31 pulando meses, mensal 2ª terça e última sexta, anual 29/02, `ate`, `contagem`), mais conversão de instante com `tz`.
- `99_agenda_rls.sql`: privilégios exatos (SELECT-only, anon nada, `et_grant_hosted_parity(array[...5 tabelas])`), privado invisível nas tabelas para não envolvidos, máscara em `agenda_listar`, isolamento entre workspaces, `has_permission('calendario', ...)` com papel customizado sem `ver`/`editar`, participante de outro workspace rejeitado, `cliente_id` de outro workspace rejeitado.
- `99_agenda_edicao.sql`: criar, `esta` (exceção de conteúdo e horário), `todas` com mudança de regra (apaga datas que saíram, preserva exceções sobreviventes e lápides, recalcula horário de quem não tem `horario_alterado`), `seguintes` (split, re-parent preserva RSVP por ocorrência, `contagem` convertida), excluir nos três escopos, RSVP nos dois escopos, `pode_editar` (organizador, admin, agente não-organizador, privado), notificações geradas por cada caminho com exclusão do ator.
- `99_agenda_lembretes.sql`: janela de 15 min, dedupe em segundo claim, recusado não recebe, ex-membro não recebe, `email_habilitado` com pref por tipo e `__all__`, ocorrência cancelada ignorada.
- Lockdown de definer: os nomes novos na suíte 96 (ou irmã).

**Deno (`supabase/functions/__tests__/`)**: `agenda-lembretes-cron_test.ts` (db fake: claim → envio só dos habilitados, idempotency key, falha de envio não derruba o lote, prazo de 50 s), `cron-auth_test.ts` (+ 401 da função nova), `notification-email_test.ts` (três tipos novos no digest, escape de título).

**Vitest**: `agendaLogic.test.ts` (regra ↔ formulário, `descreverRegra` por caso, opções do `RepetirSelect` em datas-limite como dia 31 e última semana, mapeamento para `EventInput`, campos que obrigam escopo), `eventoFormSchema.test.ts`, `store/__tests__/agenda.test.ts` (payloads dos RPCs), `EventoFormDialog.test.tsx` (criação, escopo desabilitado, `confirmClose`), `EventoPopover.test.tsx` (RSVP, mascarado, ações por `pode_editar`), `CalendarioPage.test.tsx` (aba Agenda padrão, abas antigas intactas, deep link), testes de catálogo/config de notificação atualizados. FullCalendar é mockado nos testes de página (jsdom não mede layout); a verificação visual é no browser.

**Browser**: criar evento avulso e recorrente, arrastar em semana, editar "este e os seguintes", RSVP, evento privado visto por outra conta, dark mode, 375px.

## Rollout

Ordem (memória `feedback_merge_deploys_frontend_migrations_first`: o merge deploya o frontend na hora):
1. Deploy de `agenda-lembretes-cron` (`--no-verify-jwt --use-api`) e de `notification-email-cron` (digest com os tipos novos), a partir do worktree atualizado com main (conferir `git log HEAD..origin/main` vazio e `cat supabase/.temp/project-ref`).
2. `npx supabase db push --linked` (tabelas, funções, tipos de notificação, cron do horizonte e cron de lembretes no fim da migration, já que a função existe).
3. Merge do PR (frontend).
4. Verificar: criar evento com lembrete de 5 min numa conta de teste; conferir `cron.job_run_details` dos dois jobs, notificação no sino e e-mail.

Rollback: a migration é aditiva. Para desligar: `cron.unschedule('agenda-lembretes')` e `cron.unschedule('agenda-horizonte')`; o frontend antigo ignora as tabelas. Remover tipos do CHECK exige apagar as notificações desses tipos antes.

Numeração: próxima versão livre acima do topo de main na hora de abrir o PR (memória `feedback_migration_version_collision`); hoje `20261005000001`.

## Arquivos a tocar

- `supabase/migrations/2026100500000X_agenda_eventos.sql` (tabelas, RLS, funções, RPCs, tipos de notificação, `claim_notification_emails`, crons). Pode ser dividida em duas (schema/funções e crons) se o plano preferir.
- `supabase/functions/agenda-lembretes-cron/{index,handler}.ts`, `supabase/functions/_shared/agenda-email.ts` (HTML do lembrete), `supabase/functions/_shared/notification-email.ts`, `supabase/config.toml`.
- `supabase/tests/entitlements/99_agenda_*.sql` + suíte 96.
- `supabase/functions/__tests__/agenda-lembretes-cron_test.ts`, `cron-auth_test.ts`, `notification-email_test.ts`.
- `apps/crm/src/store/agenda.ts`, `store/index.ts`, `store/notifications.ts`.
- `apps/crm/src/lib/notification-catalog.ts`, `notification-config.ts` + testes.
- `apps/crm/src/pages/calendario/CalendarioPage.tsx`, `pages/calendario/agenda/*` + `__tests__`.
- `apps/crm/src/context/AuthContext.tsx` (chave de purga).
- `apps/crm/style.css` (bloco `.agenda-*`).
- `package.json` / `package-lock.json` (FullCalendar).

## Fora do escopo (vai para os sub-projetos 2-4 ou depois)

`.ics`, botão do Google e feed (2). Hub, convidado externo por e-mail, e-mail ao cliente (3). Camadas antigas dentro da grade e posts agendados (4). Escolha de fuso na UI, anexos, busca de eventos, links de agendamento, sincronização bidirecional com Google OAuth, geração automática de link do Meet, sugestão de horário livre, MCP.
