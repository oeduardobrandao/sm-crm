# Agenda: camadas, eventos no calendário do Hub e convidados externos (sub-projeto 4) - design

## Contexto

Sub-projeto 4 de 4 da iniciativa Agenda (ver `2026-10-05-agenda-eventos-core-design.md`). Os sub-projetos 1, 2 e 3 estão na `main` e em produção (#638, #639, #640, #643), escuros atrás de `plans.feature_agenda`, ligados por override só no workspace piloto.

O sub-projeto 4 tinha uma linha de escopo ("camadas"). O usuário acrescentou duas partes:

- **Camadas:** recebimentos, prazos, datas dos clientes, datas comemorativas e posts agendados como sobreposições liga/desliga da Agenda. Com `feature_agenda` ligado, as abas "Calendário" e "Datas Comemorativas" deixam de existir e viram camadas. Com o flag desligado, a página `/calendario` fica exatamente como está hoje.
- **Calendário do Hub:** os eventos compartilhados com o cliente aparecem no calendário da home do Hub, ao lado dos posts.
- **Convidados externos por e-mail** (saiu do escopo do sub-projeto 3): pessoa que não é membro do workspace nem o cliente recebe o convite por e-mail e responde numa página própria, sem login.

Decisões do usuário (2026-10-07): convidado responde numa página própria (não pelos botões nativos do Gmail/Outlook); convidado só confirma ou recusa (remarcação continua exclusiva do cliente); tudo num PR só.

O que a exploração do código mostrou e molda o desenho:

- A aba "Calendário" (id interno `financeiro`, `CalendarioPage.tsx:65-546`) é uma grade mensal feita à mão com cinco tipos de item, todos lidos no cliente: recebimentos (`clientes.data_pagamento`, dia do mês, `valor_mensal`, só `status = 'ativo'`), pagamentos da equipe (`membros.data_pagamento`, `custo_mensal`), prazos de etapa (etapa `ativo` com `iniciado_em` + `prazo_dias`, úteis ou corridos), aniversários (`clientes.data_aniversario` "MM-DD") e datas importantes (`cliente_datas`). A única ação é CONFIRMAR um recebimento ou pagamento (`AlertDialog` + `addTransacao` com `referencia_agendamento`). Recebimentos e pagamentos só aparecem com `canSeeFinancials === true`; o resto aparece para quem vê o calendário.
- A aba "Datas Comemorativas" lê módulos TS estáticos (`nicheCalendars/*`, 5 nichos, 447 datas). A data é texto livre: "12/05", mas também "2º dom.", "Últ. sex.", "Carnaval", "+60d da Páscoa (móvel)", "Outubro", "Junho–Julho".
- Posts agendados não aparecem em nenhuma aba hoje. `getScheduledPosts(startISO, endISO)` (`store/posts.ts:337`) já lista por período; abrir um post é `/entregas?drawer=<workflowId>&post=<id>` ou `/entregas?post=<id>` (avulso).
- A Agenda (`AgendaTab`/`AgendaView`, FullCalendar) já tem uma barra lateral (`AgendaSidebar.tsx`) com filtro de pessoas e legenda, reaproveitada no `Sheet` abaixo de 1100px. O `eventClick` ignora eventos sem `extendedProps.ocorrencia`.
- O calendário do Hub é `PostCalendar.tsx`, uma grade mensal feita à mão, renderizada só na home, que recebe `posts` e cola os posts por dia local de `scheduled_at`. O estado inicial de `today`/`selectedDay` usa `getUTC*` (bug existente: perto da meia-noite em UTC-3 o "hoje" é o dia seguinte).
- `agenda_hub_listar` só tem limite inferior (hoje - 30 dias) e cursor; não existe consulta por período.
- `agenda_participantes.user_id` é `NOT NULL REFERENCES auth.users`: convidado externo precisa de tabela própria. A fila `agenda_emails_cliente` (snapshot imutável, lease, 3 tentativas, idempotência por versão, cron de 1 min, `agenda-cliente-email`) é genérica em tudo menos no destinatário.
- O descadastro do cliente usa token HMAC (`signUnsubToken`, `{c: clienteId}`, chave `TOKEN_ENCRYPTION_KEY`) servido por `client-email-unsub`.

## Escopo

1. **Camadas na Agenda (CRM).** Grupo "Camadas" na barra lateral com seis interruptores: Posts agendados, Prazos de entrega, Recebimentos, Pagamentos da equipe, Datas dos clientes, Datas comemorativas (com o seletor de nicho). Itens de camada são só leitura na grade, com popover próprio e ação para a tela de origem.
2. **Dobra das abas por flag.** Flag ligado: `/calendario` mostra só a Agenda, sem barra de abas. Flag desligado: nada muda.
3. **Eventos no calendário do Hub.** `PostCalendar` mostra os eventos compartilhados do mês junto com os posts; clicar abre o cartão do evento (confirmar, recusar, remarcar).
4. **Convidados externos.** Campo "Convidados por e-mail" no formulário do evento; e-mail com `.ics` e link para a página do convite; página pública `/convite/:token` com confirmar ou recusar por data; notificação ao organizador; descadastro.

Tudo atrás de `feature_agenda`. A parte do Hub (3) exige também `feature_hub_portal`, como já é. Convidados (4) não dependem do Hub.

## Decisões

### 1. Camadas

1. **Fonte de dados:** as mesmas funções de store que a aba "Calendário" usa hoje (`getClientes`, `getMembros`, `getWorkflows` + `getWorkflowEtapasByWorkflowIds`, `getAllClienteDatas`, `getTransacoes`) mais `getScheduledPosts(start, end)`. Nenhuma migration nem RPC nova para camadas. O cálculo de prazo sai de `CalendarioPage.tsx` para um módulo puro (`calendario/camadas/prazos.ts`) usado pelas duas telas, com o mesmo resultado de hoje (mesmos testes de `deadlineStatus`).
2. **Período:** cada camada expande para o intervalo visível do FullCalendar (`periodo` do `datesSet`, que já existe). Recorrências mensais (recebimentos, pagamentos) e anuais (aniversários) são expandidas para cada mês/ano do intervalo. Dia 29-31 em mês mais curto cai no último dia do mês (hoje a aba simplesmente não mostra; a camada mostra, e o item diz "dia 31, ajustado").
3. **Permissões:** Recebimentos e Pagamentos da equipe só existem com `canSeeFinancials === true` (nem o interruptor aparece; a query de `transacoes` fica `enabled: false`; `'unknown'` conta como não). Posts, prazos e datas seguem o acesso ao calendário (`calendario:ver`), como hoje na aba. Posts respeitam o RLS existente.
4. **Interruptores:** estado `agenda-camadas` no `localStorage` (try/catch, como `agenda-filtro`), por navegador. Padrão: Posts, Prazos, Recebimentos, Pagamentos e Datas dos clientes ligados; Datas comemorativas desligada (são ~37 por mês e poluem a grade). O nicho continua em `mesaas:calendario:ultimoNicho`.
5. **Filtro de pessoas:** vale só para eventos da Agenda. Camadas não são filtradas por pessoa (posts e prazos têm responsável, mas filtrar camada por pessoa fica para depois).
6. **Renderização (FullCalendar):** cada item vira um `EventInput` com `extendedProps.camada = {tipo, ...}` e `editable: false`. O `eventClick` passa a despachar por `ocorrencia` (popover atual) ou `camada` (popover de camada); `eventAllow`/arrastar ignoram camadas.
   - **Posts:** item com hora em `scheduled_at` (duração visual de 30 min na semana/dia), ícone por plataforma, título ou "Post de <cliente>". O selo usa o estado derivado de `getPostPublishState` com `PUBLISH_STATE_LABELS`/`PUBLISH_STATE_CLASS` (`entregas/postLabels.ts`), o mesmo do resto do app (`publicando` é derivado; `postado` e `falha_publicacao` são os valores gravados).
   - **Prazos:** dia inteiro, "⚑ <etapa> · <cliente>", vermelho quando estourado (mesma regra de `formatDeadlineStatus`).
   - **Recebimentos e pagamentos:** agregados por dia num item de dia inteiro ("3 recebimentos · R$ 4.500"), como os pills de hoje; o popover lista cada um.
   - **Datas dos clientes:** dia inteiro, "Aniversário · <cliente>" com o ícone `Cake` do lucide, "<título> · <cliente>" para data importante.
   - **Comemorativas:** dia inteiro, cor do tipo (`dotColorMap`), nome.
   - Ordem no dia (`eventOrder`): eventos da Agenda primeiro, depois posts, prazos, financeiro, datas. `dayMaxEvents` já agrupa o excesso em "+N mais".
   - Estilo distinto de evento: fundo claro com borda tracejada e ícone à esquerda, para nunca parecer evento editável.
7. **Popovers de camada** (mesmo componente de âncora do `EventoPopover`):
   - **Post:** título, cliente, plataforma, horário, status; botão "Abrir post" → `/entregas?drawer=<workflowId>&post=<id>` ou `/entregas?post=<id>`.
   - **Prazo:** etapa, entrega, cliente, "faltam N dias"/"estourado há N dias"; botão "Abrir entrega" → `/entregas?drawer=<workflowId>`.
   - **Recebimentos/pagamentos do dia:** lista com nome, valor e "Pago" ou botão "Confirmar", que reusa exatamente o fluxo atual (`AlertDialog` + `addTransacao` com o mesmo `referencia_agendamento`), extraído para um hook `useConfirmarPagamento` usado pelas duas telas.
   - **Data do cliente:** título, cliente, botão "Abrir cliente" → `/clientes/<id>`.
   - **Comemorativa:** nome, tags, tipo.
8. **Datas comemorativas na grade:** resolvedor puro `resolverDataComemorativa(evento, mes, ano)` → `{tipo: 'dia', data}` | `{tipo: 'mes'}`.
   - "DD/MM": a data.
   - Ordinal ou último dia da semana ("2º dom.", "1ª sex.", "Últ. sáb.", "Penúlt. sáb.", "Últ. 5ª") relativo ao mês do cartão onde o item está.
   - Móveis pela Páscoa (algoritmo de Meeus/Butcher): "Páscoa", "Carnaval" (terça, Páscoa - 47), "+60d da Páscoa (móvel)" (Corpus Christi), "Fev/Mar (móvel)" e "Mar/Abr (móvel)" quando o nome identifica Carnaval, Quarta de Cinzas, Sexta-feira Santa ou Páscoa.
   - Black Friday e derivados: "Seg. pós-BF" = segunda depois da 4ª quinta de novembro.
   - Tudo o que não resolve a um dia ("Outubro", "Junho–Julho", "Últ. sem.", "Semana anterior", "Sem. 10/08"): `mes` → um item de dia inteiro no dia 1 de cada mês coberto, com o rótulo "Mês: <nome>" (ou "Semana: <nome>" quando o texto é de semana, no primeiro dia da semana resolvida quando resolve, senão no dia 1).
   - Um teste percorre os 5 nichos e exige que toda entrada resolva sem exceção e que nenhuma "DD/MM" caia em `mes`.
9. **Dobra por flag (`CalendarioPage`):**
   - `agendaAtiva === true`: sem barra de abas; renderiza `AgendaTab` com as camadas. O título do documento fica "Agenda | Mesaas". `?evento=`/`?data=` continuam funcionando.
   - `agendaAtiva !== true` (inclusive enquanto os limites carregam): a página de hoje, exatamente como está, com as duas abas "Calendário" e "Datas Comemorativas" (a aba "Agenda" já só existe com o flag). O `localStorage`/estado `escolha` deixa de importar quando o flag está ligado.
   - Enquanto `features` é `null` mostra o esqueleto da página em vez de piscar a aba "Calendário" e trocar para a Agenda.
   - Nenhum código das abas antigas é apagado neste PR: o caminho do flag desligado continua sendo o mesmo componente. A remoção fica para quando o flag for para todos os planos.

### 2. Eventos no calendário do Hub

1. **RPC nova `agenda_hub_periodo(p_conta uuid, p_cliente bigint, p_de timestamptz, p_ate timestamptz) RETURNS jsonb`**, só `service_role`, mesmos filtros e mesmo formato de item de `agenda_hub_listar` (compartilhado, não privado, não cancelada, cliente ativo, `feature_agenda`), ocorrências com `inicio < p_ate AND fim > p_de`, ordenadas por `inicio, id`, no máximo 300. `p_ate - p_de` até 45 dias (mesmo teto do `hub-posts` range), senão `agenda_hub:periodo_invalido`. Não muda a assinatura de `agenda_hub_listar`.
2. **`hub-agenda` GET `?token=&de=&ate=`** (ISO, validados com `isIso`, mutuamente exclusivos com o cursor e com `ocorrencia`), mesmo rate limit `hub-read`.
3. **Hub:** `hubAgendaPeriodoQuery(token, de, ate)` com chave `['hub-agenda', token, 'periodo', de]` (prefixo comum para `invalidateHubAgenda` derrubar junto), `staleTime` 30 s, `placeholderData` do mês anterior, `enabled` só com `bootstrap.feature_agenda === true`. Diferente dos posts (que só pedem período para meses anteriores ao `historyCutoff` e usam o payload do shell no resto), a consulta de eventos roda para **todo** mês mostrado (`localMonthRange` do mês), independente de `needsRange`. Carregando: os dias mostram os posts normalmente, sem esqueleto de eventos. Erro: os posts seguem, e o painel do dia mostra "Não foi possível carregar os eventos." com "Tentar novamente"; nunca derruba o calendário.
4. **`PostCalendar`** ganha a prop opcional `eventos?: HubAgendaItem[]` e `onEventoClick`.
   - Dia: o evento é colocado pelo dia local do fuso do evento (`data_inicio_local` até `data_fim_local` exclusivo para dia inteiro; dia local de `inicio` para evento com hora). Evento de vários dias aparece em cada dia.
   - Desktop: pill "N eventos" com cor própria (`--hub-acc`), antes dos pills de post. Mobile: o ponto do evento vem primeiro, no máximo 3 pontos no total.
   - Painel do dia: seção "Eventos" (hora, título, selo da resposta) acima da lista de posts. Clicar abre o `AgendaCard` existente num `HubDialog` (sheet no mobile), com confirmar, recusar, remarcar e `.ics`. As mutações já atualizam o cache por `setHubAgendaItem`; o painel lê da query do período, então a mutação também invalida `['hub-agenda', token]`.
   - Corrige o `today`/`selectedDay` inicial para dia local (`getFullYear/getMonth/getDate`).
5. **Sem flag** (`feature_agenda` falso ou ausente): a home não chama a rota e o calendário fica como hoje.

### 3. Convidados externos

1. **Tabela `agenda_convidados`**: `id bigint identity PK`, `conta_id uuid`, `evento_id bigint`, `email text NOT NULL` (guardado em minúsculas, `CHECK (email = lower(email))`), `nome text NULL` (<= 120), `token text NOT NULL UNIQUE` (64 hex, `encode(gen_random_bytes(32),'hex')`), `adicionado_por uuid`, `criado_em timestamptz`, `removido_em timestamptz NULL`.
   - FK composta `(evento_id, conta_id) → agenda_eventos(id, conta_id) ON DELETE CASCADE`.
   - Índice único parcial `(evento_id, email) WHERE removido_em IS NULL`.
   - Remoção é lógica (`removido_em`) para o e-mail de cancelamento sair e o link antigo responder "Este convite foi cancelado.". Exclusão da série apaga pelo cascade (o e-mail de cancelamento já foi enfileirado antes, com snapshot próprio).
   - Campo de série, como os participantes: muda com escopo `todas`/`seguintes`; o split de `seguintes` copia os convidados ativos para a série nova **com tokens novos**, e o convite da série nova sai por e-mail (`convite`), enquanto a série antiga manda `alteracao` com as ocorrências que saíram como canceladas. Mesmo comportamento que o cliente tem hoje.
2. **Resposta por ocorrência**, tabela `agenda_respostas_convidado(ocorrencia_id, convidado_id, conta_id, resposta IN ('sim','nao'), respondido_em, inicio_respondido timestamptz)`, PK `(ocorrencia_id, convidado_id)`, FKs compostas com cascade. Resposta efetiva com a mesma regra do cliente: vale só com `inicio_respondido = ocorrencia.inicio` e o convidado ativo; senão "aguardando". Sem "talvez".
3. **Payload:** chave nova `convidados` dentro de `p_evento` (`[{email, nome?}]`), validada por `agenda_validar_payload`; ausente na edição = sem mudança; ignorada no escopo `esta`. Não muda a assinatura de `agenda_evento_criar`/`agenda_evento_editar`.
   - E-mail válido (regex simples + até 254 caracteres), sem duplicados no payload.
   - No máximo 20 convidados ativos por série.
   - Evento `privado` não aceita convidados: "Evento privado não pode ter convidados externos.".
   - E-mail de membro do workspace (`auth.users.email` dos `workspace_members`; `profiles` não tem e-mail): "<email> já é da equipe. Adicione como participante.".
   - **Teto anti-abuso:** no máximo 100 convidados novos por workspace em 24 h (conta `criado_em`), "Limite diário de convites externos atingido. Tente amanhã.".
   - **Serialização:** a validação dos dois tetos e a gravação dos convidados rodam depois de `pg_advisory_xact_lock(hashtextextended('agenda-convidados:' || conta_id, 0))`, para duas escritas simultâneas não passarem juntas do limite. O índice único parcial só protege o e-mail duplicado.
   - Quem pode: quem pode editar o evento (mesma checagem de hoje).
4. **Leitura no CRM:** `agenda_listar` ganha `convidados jsonb` no fim (`[{id, email, nome, resposta}]` com a resposta efetiva da ocorrência; NULL quando mascarado). `DROP` + `CREATE` com os mesmos grants, como no sub-projeto 3.
5. **E-mail:** a fila `agenda_emails_cliente` passa a ter dois tipos de destinatário.
   - Colunas novas: `convidado_id bigint NULL` (sem FK, como `evento_id`, para o cancelamento sobreviver à remoção), `convidado_email text NULL`. `cliente_id` vira `NULL`-able. `CHECK (num_nonnulls(cliente_id, convidado_id) = 1)` e `CHECK ((convidado_id IS NULL) = (convidado_email IS NULL))`. A FK composta do cliente continua (nula não é checada).
   - `agenda_cliente_enfileirar` ganha `p_convidado bigint DEFAULT NULL`; a mescla passa a ser por `(destinatário, evento_id)`. Os RPCs de escrita enfileiram um item por convidado ativo afetado, nos mesmos pontos em que já enfileiram para o cliente (criar, editar, excluir, split), mais: convidado adicionado → `convite`; convidado removido → `cancelamento` com as ocorrências futuras.
   - Remarcações (`remarcacao_*`) continuam só do cliente. Quando a equipe aceita uma remarcação, o convidado recebe `alteracao` (o horário mudou).
   - **Portões no claim** para convidado: `feature_agenda` ligado; convidado ainda ativo (exceto `cancelamento`); e-mail fora de `agenda_convidados_bloqueio` do workspace; evento não privado. Portão fechado = `descartado`.
   - Mesmo cron, mesma função `agenda-cliente-email`, mesma idempotência (`agenda-cliente:<item>:<versao>`).
   - **Contrato do claim:** hoje `agenda_cliente_claim_emails` faz `JOIN clientes`; com `cliente_id` nulo o item iria para `enviando` e sumiria do resultado até o lease vencer. O claim passa a fazer `LEFT JOIN` em `clientes` e `agenda_convidados`, filtra os portões por tipo de destinatário **antes** do `UPDATE ... SET status = 'enviando'`, e devolve um contrato discriminado: `destinatario: 'cliente' | 'convidado'`, `email` (de `clientes.email` ou `convidado_email` do item), `nome` (cliente ou `agenda_convidados.nome`, que pode ser nulo), `convidado_token` (nulo para cliente e para convidado removido), `organizador_nome`, `organizador_email` (para o `Reply-To`; nulo quando o organizador não é mais membro) e o resto como hoje. Um teste psql cobre item de convidado removido em `cancelamento` saindo no claim.
6. **Conteúdo do e-mail ao convidado** (`montarEmailAgendaCliente` com variante `destinatario: 'convidado'`):
   - Saudação "Olá, <nome>!" ou "Olá!"; linha "<Organizador> convidou você em nome de <Workspace>." no convite.
   - `Reply-To`: e-mail do organizador quando ele ainda é membro; senão nenhum.
   - Botão "Responder ao convite" → `<APP_BASE_URL>/convite/<token>?ocorrencia=<id>`, com a origem de `appBaseUrl()` (`_shared/app-url.ts`, env `APP_BASE_URL`, já obrigatória e configurada em prod e staging; o CRM e o Hub servem da mesma origem). `appBaseUrl()` lança sem a env: o handler captura e manda o e-mail sem botão (o `.ics` continua anexado), como `resolveHubUrl` já degrada. Sem botão em `cancelamento`.
   - `.ics` igual ao do cliente (`METHOD:PUBLISH`, `SEQUENCE`), mesmos textos de "abra o anexo para atualizar"/"remova do seu calendário".
   - Descadastro: token HMAC com payload `{g: convidadoId}` (mesma chave e formato do `{c}`); `client-email-unsub` aceita os dois. Descadastrar grava `agenda_convidados_bloqueio(conta_id, email, criado_em)` (PK `(conta_id, email)`): aquele workspace não manda mais e-mail da Agenda para aquele endereço. A página do convite continua funcionando.
7. **Página do convite:** rota pública `/convite/:token` no app do Hub (é o app com tema por marca e sem login).
   - **`agenda-convite`** (edge function nova, `--no-verify-jwt`):
     - `GET ?token=` → `{workspace: {nome, brand_color, logo_url}, organizador_nome, titulo, itens}`, com `itens` = ocorrências não canceladas da série com `fim >= now() - 30 dias`, até 100, no formato `{ocorrencia_id, sequencia, inicio, fim, dia_inteiro, data_inicio_local, data_fim_local, tz, titulo, descricao, local, link_reuniao, resposta}`.
     - `GET /ocorrencia/<id>.ics?token=` baixa a ocorrência.
     - `POST {acao: 'responder', ocorrencia_id, resposta, inicio_visto}`.
     - CORS por `buildCorsHeaders(req)` em todas as respostas, inclusive `OPTIONS`, 404, 409, 429 e 500 (nunca `*`), no mesmo formato do `hub-agenda` (handler com dependências injetadas, `index.ts` só monta). Erros genéricos em pt-BR para fora, detalhe só no log.
   - **Rate limits:** `convite-badtoken:<ip>` 30/600 s antes de qualquer leitura com token inválido; `convite-read:<convidado>` 300/300 s; `convite-write:<convidado>` 60/3600 s.
   - **RPCs só `service_role`:** `agenda_convite_ler(p_token)`, `agenda_convite_responder(p_token, p_ocorrencia, p_resposta, p_inicio_visto)`. Checam `feature_agenda`, convidado ativo, evento não privado, ocorrência da série, não cancelada, não terminada. Erros `agenda_convite:<codigo>` mapeados como no `hub-agenda`.
   - Token inválido ou convidado removido: 404 "Este convite não está mais disponível.". Workspace com flag desligado: 404 igual.
   - **O convidado vê:** título, data e hora no fuso do evento, local, link da reunião, descrição, nome e marca do workspace, nome do organizador. Nunca os outros participantes, convidados, cliente, tipo, cor ou lembretes.
   - **UI:** cabeçalho com logo e nome do workspace, "Convite de <organizador>"; lista por dia com o mesmo cartão visual do Hub (sem o menu de remarcar): selo, "Confirmar", "Não vou", "Adicionar ao Google Agenda", "Baixar .ics", "Entrar na reunião". `?ocorrencia=` rola e destaca. Rodapé "Enviado pela Mesaas". pt-BR fixo (namespace `hubConvite`, com `en` também, seguindo o idioma do navegador como o Hub).
   - `vercel.json`: rewrite `/convite/:token` → `/hub/index.html` e header `X-Robots-Tag: noindex`. Rota no `apps/hub/src/router.tsx` fora do `HubShell`.
   - **Auditoria:** `insertAuditLog` nas respostas, como `hub-agenda`.
8. **Notificação:** tipo novo `event_guest_rsvp` ("<email ou nome> confirmou/recusou <evento>"), para o organizador ou owners e admins (`agenda_cliente_destinatarios`), só quando a resposta efetiva muda, elegível ao digest de e-mail da equipe. Metadata `convidado_nome`, `convidado_email`, `resposta`, `data_inicio_local`. Os 11 pontos de cadastro do sub-projeto 3 (CHECKs, `claim_notification_emails`, union TS, catálogo, `notification-config.ts`, `resolveDigestItem`, testes de contagem, `99_agenda_edicao.sql`, runbook).
9. **CRM, formulário e popover:**
   - `EventoFormDialog`: campo "Convidados externos" abaixo de "Participantes": entrada de e-mail que vira chip ao apertar Enter, vírgula ou espaço, com validação no cliente e contador "N de 20". Ajuda: "Recebem o convite por e-mail e respondem por um link, sem precisar de conta.". Escondido quando "Privado" está marcado. O card rápido não ganha o campo.
   - `EventoPopover`: seção "Convidados" com e-mail/nome e selo (Confirmou, Recusou, Aguardando), abaixo dos participantes.
   - Remover um chip e salvar manda o cancelamento ao convidado (o diálogo de salvar já pergunta o escopo em série).

## Interface

Os mockups ficam num artifact com: barra lateral com "Camadas", grade de mês e semana com camadas, popovers de post/prazo/recebimentos, calendário da home do Hub com eventos (desktop e mobile), página `/convite/:token` (desktop e mobile), campo de convidados no formulário e popover com convidados, e-mail ao convidado.

Textos novos (pt-BR, sem travessão):

- Camadas: "Camadas", "Posts agendados", "Prazos de entrega", "Recebimentos", "Pagamentos da equipe", "Datas dos clientes", "Datas comemorativas", "Nicho".
- Popovers: "Abrir post", "Abrir entrega", "Abrir cliente", "Confirmar", "Pago", "Estourado há N dias", "Faltam N dias", "Dia 31, ajustado para o último dia do mês".
- Hub: "N eventos", "Eventos", "Posts".
- Convite: "Convite de <nome>", "Confirmar", "Não vou", "Você confirmou", "Você recusou", "Aguardando sua resposta", "Este convite não está mais disponível.", "Este evento mudou de horário. Atualize a página.", "Este evento já aconteceu.".

## Erros e casos limite

- **Flag desligado:** `/calendario` igual a hoje; o Hub não pede o período; `agenda-convite` responde 404; a fila descarta itens de convidado; o formulário nem existe (a Agenda está escondida).
- **Convidado responde depois de a equipe mover o horário:** 409 "Este evento mudou de horário. Atualize a página." (`inicio_visto`).
- **Convidado removido e readicionado:** linha nova com token novo; o link antigo continua "não disponível".
- **E-mail do convidado igual ao do cliente compartilhado:** permitido; são canais diferentes (o cliente pelo Hub, o convidado pela página).
- **Evento vira privado com convidados:** a validação recusa ("Remova os convidados externos antes de tornar o evento privado.").
- **Cliente/membro sem `data_pagamento`:** sem item, como hoje.
- **`canSeeFinancials` muda durante a sessão:** a camada some no próximo render; a query fica desabilitada.
- **Muitos itens no dia:** `dayMaxEvents` agrupa; a visão Lista mostra tudo.
- **Falha do Resend:** retry pela fila, depois `falhou`. Ninguém é avisado (igual ao cliente).

## Testes

- **Vitest (CRM):**
  - resolvedor de comemorativas (todos os nichos, Páscoa de 2026 a 2030, ordinais e últimos);
  - expansão de recorrências (dia 31 em fevereiro, aniversário em 29/02 em ano não bissexto cai em 28/02);
  - prazos (mesmo resultado do cálculo atual, inclusive dias úteis);
  - `toCamadaEventInput` por tipo;
  - interruptores e persistência;
  - sem `canSeeFinancials` não há interruptor nem query financeira;
  - `CalendarioPage` com flag ligado (sem abas) e desligado (abas como hoje);
  - popovers e navegação;
  - campo de convidados (chips, validação, limite 20, escondido com privado);
  - popover com convidados.
- **Vitest (Hub):** `PostCalendar` com eventos (dia inteiro de vários dias, fuso, mobile), abertura do cartão, dia local inicial; página do convite (lista, responder, 404, 409, destaque).
- **Deno:**
  - `agenda-convite` (token inválido, rate limits, rotas, mapeamento de erros);
  - `hub-agenda` com `de`/`ate` (validação, exclusividade, teto de 45 dias);
  - template do convidado (saudação, organizador, Reply-To, botão, descadastro `{g}`, `.ics`);
  - `client-email-unsub` com `{g}`;
  - `agenda-cliente-email` com item de convidado.
- **psql (entitlements):** `99_agenda_convidados.sql`:
  - grants;
  - validação (privado, membro, duplicado, 20, teto diário);
  - enfileiramento (convite, alteração, cancelamento por remoção e por exclusão, split com tokens novos, aceite de remarcação gera `alteracao` ao convidado);
  - portões do claim (bloqueio, removido, flag);
  - resposta efetiva;
  - `agenda_hub_periodo` (janela, teto, filtros);
  - `agenda_listar.convidados` mascarado.

## Rollout

0. `supabase/config.toml`: `[functions.agenda-convite]` com `verify_jwt = false`. CLAUDE.md/README: flag de deploy e contagem de funções.
1. Migration (`db push`).
2. Deploy:
   - `agenda-convite` (nova);
   - `hub-agenda` (rota `de`/`ate`);
   - `agenda-cliente-email` (destinatário convidado);
   - `client-email-unsub` (`{g}`);
   - `notification-email-cron` (`resolveDigestItem`).
   Todas `--no-verify-jwt --use-api`.
3. Merge (publica CRM e Hub).
4. Piloto no workspace cbaf0da8: ligar camadas, conferir com a aba antiga (desligando o override num workspace de teste), convidar um e-mail externo próprio, responder pela página, descadastrar.

**Rollback (passo 4c do runbook manual `assets/2026-10-05-agenda-rollback.sql`, rodado à mão como os passos 4a e 4b, nunca por migration):** nesta ordem: (1) voltar o frontend; (2) `DELETE` dos itens de convidado da fila (`convidado_id IS NOT NULL`), porque a `agenda-cliente-email` anterior não sabe enviá-los; (3) reimplantar as versões anteriores das funções; (4) o SQL abaixo; recriar `agenda_validar_payload`, `agenda_evento_criar`, `agenda_evento_editar`, `agenda_evento_excluir`, `agenda_cliente_enfileirar`, `agenda_cliente_claim_emails`, `agenda_listar` e `claim_notification_emails` no formato do sub-projeto 3; apagar itens de convidado da fila e linhas do tipo novo; restaurar os CHECKs; dropar as tabelas novas, as colunas novas da fila e `agenda_hub_periodo`. As definições anteriores ficam copiadas no runbook.

## Fora do escopo

- Remover o código das abas antigas (quando o flag for para todos).
- Arrastar post ou prazo na grade para mudar a data.
- Filtrar camadas por pessoa.
- Convidado pedir remarcação; vários e-mails por convidado; convidado ver outros convidados.
- Resposta pelos botões nativos do Gmail/Outlook (`METHOD:REQUEST`).
- Feed iCal do cliente ou do convidado.
- Camadas no Hub além dos eventos (prazos, datas).
