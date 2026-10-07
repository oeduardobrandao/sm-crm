# Agenda no Hub: eventos do cliente, confirmação, remarcação e e-mail com .ics (sub-projeto 3) - design

## Contexto

Sub-projeto 3 de 4 da iniciativa Agenda (ver `2026-10-05-agenda-eventos-core-design.md`, tabela de sub-projetos). Os sub-projetos 1 (#638) e 2 (#639, #640) estão na `main` e em produção, escuros atrás de `plans.feature_agenda`, ligados por override só no workspace piloto.

Decisões do usuário que valem aqui (spec do sub-projeto 1, linhas 17 e 20):

- O cliente vê os eventos no Hub, confirma ou recusa e pede remarcação, que a equipe aprova.
- O cliente recebe e-mail imediato com `.ics`, e há um lembrete no digest "Pendências do Hub".
- As partes de Hub só aparecem onde o workspace tem `feature_hub_portal`. Workspace sem Hub manda o e-mail com `.ics` e sem botão de ação.
- E-mails de convite, alteração e cancelamento ao cliente são transacionais: respeitam só `clientes.send_event_email` e o descadastro do cliente (`clientes.event_email_unsub_at`), não o switch `workspaces.send_client_event_emails`.

O que a exploração do código mostrou e molda o desenho:

- `agenda_participantes` e `agenda_respostas` usam `user_id uuid REFERENCES auth.users`. O cliente do Hub não tem usuário: a resposta dele precisa de tabela própria e caminho de escrita por service role.
- O token do Hub é por cliente (`client_hub_tokens`), não por pessoa, e o único e-mail é `clientes.email`. Toda ação do Hub é atribuível ao cliente, nunca a uma pessoa.
- `_shared/ics.ts` só emite `METHOD:PUBLISH`, sem `SEQUENCE` nem `STATUS`. `sendViaResend` não aceita anexos.
- O digest "Pendências do Hub" é o `client-event-email-cron` (a cada 15 min, no máximo 1 e-mail a cada 4 h por cliente, só com o switch do workspace ligado).
- PR #513 (piso de 72 h do digest) está mergeado; o `client-event-email-cron` da `main` pode ser redeployado.

## Escopo

1. **Compartilhar evento com o cliente (CRM).** No formulário completo, quando há cliente escolhido, a opção "Compartilhar com o cliente". O popover do evento mostra a resposta do cliente e a remarcação pendente, com Aceitar e Recusar.
2. **Agenda no Hub.** Página "Agenda" com os eventos compartilhados (próximos e últimos 30 dias); confirmar ou recusar cada ocorrência; pedir remarcação com nova data e hora sugeridas e mensagem; cancelar o pedido pendente; baixar `.ics` e abrir no Google Agenda. Bloco "Próximos eventos" na home do Hub.
3. **E-mail ao cliente com `.ics`**, quase imediato (fila drenada em até ~1 min): convite, alteração, cancelamento, remarcação aceita, remarcação recusada.
4. **Notificações para a equipe:** resposta do cliente e pedido de remarcação, na Central de Notificações e no digest de e-mail da equipe.
5. **Lembrete no digest "Pendências do Hub"**: evento compartilhado ainda sem resposta, uma única vez por ocorrência, a partir de 48 h antes.

Tudo fica atrás de `feature_agenda` (nenhuma coluna de plano nova). O que é do Hub exige também `feature_hub_portal`, já checado por `resolveHubToken`.

## Decisões

1. **Compartilhar é opt-in explícito**, coluna de série `agenda_eventos.compartilhado_cliente boolean NOT NULL DEFAULT false`. Ter `cliente_id` não basta: muitos eventos são internos sobre o cliente ("planejamento de março da Clínica X"), e eventos já criados no piloto com cliente não podem aparecer no Hub nem disparar e-mail depois do deploy. A opção só aparece com cliente escolhido e é desligada (e escondida) quando o evento é privado: `privado` e `compartilhado_cliente` não convivem (validação no `agenda_validar_payload`, erro "Evento privado não pode ser compartilhado com o cliente"). Trocar o cliente ou desligar a opção manda cancelamento ao cliente anterior. Campo de série, como `cliente_id`: muda só com escopo `todas`/`seguintes`.

2. **O que o cliente vê:** título, data e hora (no fuso do evento, com o nome do fuso quando diferente de America/Sao_Paulo), local, link da reunião, descrição, nome do workspace. Nunca participantes, organizador, tipo, cor, lembretes nem as respostas internas da equipe. Ocorrências canceladas somem do Hub (o e-mail de cancelamento é o aviso).

3. **Resposta do cliente por ocorrência**, tabela `agenda_respostas_cliente(ocorrencia_id PK FK cascade, conta_id, cliente_id, resposta IN ('sim','nao'), respondido_em, inicio_respondido timestamptz, lembrado_em timestamptz)`. Sem "talvez": o cliente confirma ou recusa. **A resposta vale só para o horário em que foi dada**: resposta efetiva = `resposta` quando `inicio_respondido = ocorrencia.inicio`, senão "aguardando". Mover o evento reabre a pergunta sem trigger nem limpeza. Sem resposta de série: cada gravação é confirmada à parte (por isso o RSVP por ocorrência existe desde o sub-projeto 1). Responder é permitido até o fim da ocorrência e pode mudar quantas vezes quiser.

4. **Remarcação**, tabela `agenda_remarcacoes(id, conta_id, cliente_id, ocorrencia_id FK cascade, inicio_sugerido timestamptz, fim_sugerido timestamptz, mensagem text <= 1000, status IN ('pendente','aceita','recusada','cancelada','substituida'), criado_em, resolvido_em, resolvido_por uuid, resposta_equipe text <= 1000)`.
   - O cliente sugere um novo início; o fim mantém a duração da ocorrência. Evento de dia inteiro: sugere uma data. A sugestão precisa ser no futuro e a ocorrência ainda não pode ter começado.
   - No máximo um pedido `pendente` por ocorrência (índice único parcial). O cliente pode cancelar o próprio pedido pendente.
   - **Aceitar** (`agenda_remarcacao_resolver`, quem pode editar o evento): move só aquela ocorrência com a mesma semântica do escopo `esta` (`inicio`, `fim`, `horario_alterado = true`), grava resposta `sim` do cliente para o novo horário (foi ele quem sugeriu), notifica os participantes com `event_updated` e enfileira o e-mail "Remarcação aceita" com o `.ics` novo. Se o horário sugerido já passou, erro "Esse horário já passou. Combine outro com o cliente.".
   - **Recusar**: mensagem opcional da equipe, e-mail "Remarcação não aceita" com a mensagem e o horário que continua valendo.
   - Se a equipe mover ou cancelar a ocorrência por outro caminho, o pedido pendente vira `substituida` (o e-mail de alteração ou cancelamento já informa o cliente).

5. **E-mail ao cliente por fila**, tabela `agenda_emails_cliente` no molde do ledger de lembretes (claim com lease de 2 min, 3 tentativas, chave de idempotência determinística), drenada pela função nova `agenda-cliente-email`, chamada por pg_net no fim de cada escrita que enfileira e por um cron de 1 min como rede de segurança.
   - **Quem enfileira:** os RPCs de escrita (`agenda_evento_criar`, `agenda_evento_editar`, `agenda_evento_excluir`, `agenda_remarcacao_resolver`) chamam um helper `agenda_cliente_enfileirar(...)`. Não por trigger: o gerador noturno de horizonte e o `agenda_regenerar` inserem e apagam ocorrências sem que nada mude para o cliente, e um trigger não distingue esses casos.
   - **Tipos:** `convite` (evento compartilhado criado, ou opção ligada, ou cliente trocado para este), `alteracao` (mudou início, fim, título, local, link ou descrição de ocorrência futura), `cancelamento`, `remarcacao_aceita`, `remarcacao_recusada`.
   - **Coalescência:** uma linha pendente por `(cliente_id, evento_id)` com `enviar_apos = now() + 60 s`; nova escrita no mesmo evento antes do envio atualiza a linha em vez de criar outra. Precedência: `cancelamento` vence tudo; `convite` + `alteracao` = `convite`; `convite` + `cancelamento` antes do envio = descarta (o cliente nunca soube). Remarcações têm linha própria por pedido.
   - **Conteúdo montado na hora do envio** a partir do estado atual. Exceção: `cancelamento` guarda um snapshot (`titulo`, datas, fuso) na linha, porque a série pode já ter sido apagada.
   - **Portões no envio:** `feature_agenda` ligado, cliente `ativo`, `clientes.email` não vazio, `send_event_email = true`, `event_email_unsub_at IS NULL`, e (exceto `cancelamento`) evento ainda compartilhado com esse cliente. Portão fechado = linha `descartado`, sem retry.
   - **Remetente e descadastro** iguais ao digest: `"<Workspace> <notificacoes@mesaas.com.br>"`, `List-Unsubscribe` RFC 8058 com o mesmo token assinado de `client-email-unsub` (descadastrar vale para os dois tipos de e-mail, como hoje).
   - **Botão de ação** ("Confirmar presença" / "Ver no portal") só quando `hubUrlFor` devolve URL (workspace com Hub ligado e token ativo). Link direto para `/:workspace/hub/:token/agenda?ocorrencia=<id>`.

6. **`.ics` do e-mail:** `METHOD:PUBLISH`, sem `ORGANIZER`/`ATTENDEE`. Com `METHOD:REQUEST` o Gmail desenha o próprio cartão de RSVP e manda a resposta para a caixa do organizador, contornando o Hub, que é o canal de resposta. Mesmo `UID` do feed e do download (`agenda-oc-<ocorrencia_id>@mesaas.com.br`), com `SEQUENCE` crescente para que reimportar substitua o evento. Cancelamento manda `METHOD:CANCEL` com `STATUS:CANCELLED`. `ics.ts` ganha `sequencia?`, `status?` e `metodo?` (padrão `PUBLISH`), sem mudar a saída atual do feed. `SEQUENCE` = `agenda_ocorrencias.sequencia int NOT NULL DEFAULT 0`, incrementada pelo helper de enfileiramento a cada alteração relevante para o cliente.
   - Evento recorrente: o convite lista as próximas datas no corpo e anexa um `.ics` com as ocorrências dos próximos 90 dias (no máximo 50 `VEVENT`s), cada uma com seu `UID`. Alteração de uma ocorrência anexa só ela.
   - `sendViaResend` ganha `attachments?: { filename, content (base64), content_type }[]` (campo `attachments` da API do Resend), sem mudar as chamadas existentes.

7. **Hub:** função nova `hub-agenda` no padrão das `hub-*` (token, `hub-badtoken`, `hub-read` compartilhado, `hub-write:hub-agenda:<conta>:<cliente>` 60/h para escritas, erros pt-BR genéricos, 404 para ocorrência de outro cliente):
   - `GET ?token=` lista (de hoje - 30 dias até hoje + 180 dias, no máximo 300 ocorrências).
   - `GET /ocorrencia/<id>.ics?token=` baixa a ocorrência (o download do `agenda-feed` exige JWT de usuário).
   - `POST {acao:'responder', ocorrencia_id, resposta}`, `POST {acao:'remarcar', ocorrencia_id, inicio, mensagem}`, `POST {acao:'cancelar_remarcacao', remarcacao_id}`.
   - Tudo por RPCs `service_role` (`agenda_hub_listar`, `agenda_hub_responder`, `agenda_hub_remarcar`, `agenda_hub_cancelar_remarcacao`) que recebem `conta_id` e `cliente_id` já resolvidos pelo token e checam: `feature_agenda`, ocorrência do cliente, evento compartilhado, não privado, não cancelada.
   - `hub-bootstrap` passa a devolver `feature_agenda`; o item "Agenda" do menu só aparece com ele ligado.
   - Audit log das escritas como em `hub-approve`.

8. **Notificações da equipe:** dois tipos novos, `event_client_rsvp` e `event_reschedule_requested`, para o organizador (se não for mais membro, owner e admins). Os dois entram no digest de e-mail da equipe. `event_client_rsvp` só notifica quando a resposta muda (confirmar duas vezes não notifica de novo). Link `/calendario?evento=<ocorrencia_id>`. Os 10 pontos de cadastro de tipo listados no sub-projeto 1 (3 CHECKs, `claim_notification_emails`, union TS, catálogo, config, `resolveDigestItem`, testes de contagem, runbook de rollback).

9. **Lembrete no digest "Pendências do Hub":** o `client-event-email-cron` ganha a seção "Eventos aguardando sua confirmação" com ocorrências compartilhadas, sem resposta efetiva, que começam entre agora + 1 h e agora + 48 h e ainda não foram lembradas (`lembrado_em IS NULL`). Essas ocorrências contam como conteúdo novo para disparar o digest. Depois do envio bem-sucedido, `lembrado_em = now()`: cada ocorrência é lembrada no máximo uma vez, independentemente do cursor (o cursor compartilhado foi a causa do bug do #513). Respeita o switch do workspace, como o resto do digest, e só roda com `feature_agenda` ligado.

10. **CRM, leitura:** `agenda_listar` ganha `compartilhado_cliente`, `cliente_resposta` (`sim`/`nao`/`aguardando`/NULL quando não compartilhado) e `remarcacao_pendente jsonb` (`{id, inicio_sugerido, fim_sugerido, mensagem, criado_em}`). Muda o `RETURNS TABLE`, então é `DROP FUNCTION` + `CREATE`, com os mesmos grants. Mascarado (privado de outro) devolve tudo NULL.

## Interface

**Formulário completo (`EventoFormDialog`):** abaixo do seletor de cliente, um switch "Compartilhar com o cliente", com a ajuda "Aparece no portal do cliente e ele recebe o convite por e-mail." Se o cliente não tem e-mail: "Este cliente não tem e-mail cadastrado. O evento aparece só no portal." Se o workspace não tem Hub: "O cliente recebe o convite por e-mail." Escondido quando "Privado" está marcado. O card rápido não ganha o switch (cliente já não está nele).

**Popover (`EventoPopover`):** linha "Cliente: Clínica X · Confirmou" (ou "Recusou", "Aguardando resposta"). Pedido pendente em destaque: "A Clínica X pediu para remarcar para qui., 9 de out., 14:00" + mensagem + botões "Aceitar" e "Recusar" (recusar abre campo de mensagem opcional). Não há pergunta de escopo: remarcação vale só para aquela ocorrência.

**Hub, página Agenda (`/:workspace/hub/:token/agenda`):** lista agrupada por dia, "Próximos" e "Anteriores" (últimos 30 dias, recolhido). Cartão: título, data e hora, local, botão "Entrar na reunião" quando há link, descrição recolhível, selo "Confirmado" / "Você recusou" / "Aguardando sua resposta", botões "Confirmar" e "Não vou", menu com "Pedir para remarcar", "Adicionar ao Google Agenda" e "Baixar .ics". Pedido pendente: "Você pediu para remarcar para … Aguardando a equipe." com "Cancelar pedido". Remarcar abre um sheet (mobile) ou dialog (desktop) com data, hora e mensagem. `?ocorrencia=<id>` rola até o cartão e o destaca. Estado vazio: "Nenhum evento por aqui ainda."

**Hub, home:** bloco "Próximos eventos" com até 3 ocorrências e o link "Ver agenda", e um aviso quando há eventos aguardando resposta. Só com `feature_agenda`.

**i18n:** namespace novo `hubAgenda` em pt e en, registrado em `apps/hub/src/main.tsx`; rótulo de menu em `common`.

## Erros e casos limite

- Cliente responde a ocorrência que a equipe acabou de mover: a resposta grava `inicio_respondido` do horário atual no momento da escrita (lido dentro do RPC), então vale para o novo horário só se o cliente já via o novo. O Hub manda o `inicio` que exibia; diferente do atual = 409 "Este evento mudou de horário. Atualize a página.".
- Ocorrência que já terminou: responder e remarcar = 409 "Este evento já aconteceu.".
- Evento deixa de ser compartilhado, fica privado ou é apagado: some do Hub; pedidos pendentes viram `substituida`; ações retornam 404.
- Flag `feature_agenda` desligado: o Hub esconde o menu e o bloco, `hub-agenda` responde 404, a fila descarta, o digest omite a seção.
- Cliente arquivado (`status <> 'ativo'`): e-mails descartados; o Hub já depende do token ativo.
- E-mail do cliente vazio: o evento aparece no Hub e nada é enviado.
- Falha do Resend: retry pelo ledger (3 tentativas), depois `falhou`; nada aparece ao usuário da equipe.

## Testes

- **Entitlements (`99_agenda_hub.sql`, datas relativas a `current_date`):** visibilidade (compartilhado, privado, outro cliente, cancelado), resposta efetiva que expira ao mover, remarcação (um pendente por ocorrência, aceitar move só a ocorrência e grava `sim`, `substituida` ao mover por outro caminho), enfileiramento e coalescência, grants (`anon` e `authenticated` sem acesso aos RPCs de Hub e à fila).
- **Deno:** `ics.ts` (`SEQUENCE`, `METHOD:CANCEL`, saída do feed inalterada), `hub-agenda` (token, flags, 404 de outro cliente, 409s, rate limit, `.ics`), `agenda-cliente-email` (portões, tipos, anexo, botão com e sem Hub, descarte), `client-event-email-cron` (seção nova, lembrado uma vez só), `sendViaResend` com anexo.
- **Vitest:** popover (estado do cliente, aceitar e recusar), formulário (switch, avisos), página Agenda do Hub (responder, remarcar, cancelar pedido, deep link), home, contagens de tipos de notificação.

## Rollout

Ordem: migration (`db push`) → deploy de `hub-bootstrap`, `hub-agenda`, `agenda-cliente-email`, `client-event-email-cron`, `agenda-feed` (o `ics.ts` compartilhado mudou) e `notification-email-cron` (`resolveDigestItem`) → merge. Funções novas com `--no-verify-jwt`. O runbook de rollback ganha o passo 4b (dropar tabelas, colunas e RPCs do Hub; restaurar o `agenda_listar` anterior).

## Fora do escopo

- **Convidado externo por e-mail** (pessoa que não é membro nem o e-mail do cliente). A linha 29 do sub-projeto 1 o mandou para cá, mas as decisões do usuário (linhas 17 e 20) falam só do cliente, e ele precisaria de uma superfície pública de resposta própria. Fica para depois.
- Vários contatos por cliente; saber qual pessoa respondeu.
- Cliente criar evento ou propor horário sem evento existente (links de agendamento).
- Remarcar a série inteira pelo Hub.
- Responder pelo próprio Gmail/Outlook (`METHOD:REQUEST`).
- Camadas antigas na grade e posts agendados (sub-projeto 4).
