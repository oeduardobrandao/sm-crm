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
- `_shared/ics.ts` só emite `METHOD:PUBLISH`, sem `SEQUENCE`. `sendViaResend` não aceita anexos.
- O digest "Pendências do Hub" é o `client-event-email-cron` (a cada 15 min, no máximo 1 e-mail a cada 4 h por cliente, só com o switch do workspace ligado, só com Hub).
- `resolveHubToken` não olha `clientes.status`: cliente arquivado com token ativo continua acessando o Hub hoje.
- PR #513 (piso de 72 h do digest) está mergeado; o `client-event-email-cron` da `main` pode ser redeployado.

## Escopo

1. **Compartilhar evento com o cliente (CRM).** No formulário completo, quando há cliente escolhido, a opção "Compartilhar com o cliente". O popover do evento mostra a resposta do cliente e a remarcação pendente, com Aceitar e Recusar.
2. **Agenda no Hub.** Página "Agenda" com os eventos compartilhados (próximos e últimos 30 dias); confirmar ou recusar cada ocorrência; pedir remarcação com nova data e hora e mensagem; cancelar o pedido pendente; baixar `.ics` e abrir no Google Agenda. Bloco "Próximos eventos" na home do Hub.
3. **E-mail ao cliente com `.ics`** em até ~2 min: convite, alteração, cancelamento, remarcação aceita, remarcação recusada.
4. **Notificações para a equipe:** resposta do cliente e pedido de remarcação, na Central de Notificações e no digest de e-mail da equipe.
5. **Lembrete no digest "Pendências do Hub"**: evento compartilhado ainda sem resposta, uma vez por horário, a partir de 48 h antes.

Tudo fica atrás de `feature_agenda` (nenhuma coluna de plano nova). O que é do Hub exige também `feature_hub_portal`, já checado por `resolveHubToken`.

## Decisões

1. **Compartilhar é opt-in explícito**, coluna de série `agenda_eventos.compartilhado_cliente boolean NOT NULL DEFAULT false`. Ter `cliente_id` não basta: muitos eventos são internos sobre o cliente ("planejamento de março da Clínica X"), e eventos já criados no piloto com cliente não podem aparecer no Hub nem disparar e-mail depois do deploy.
   - A opção só aparece com cliente escolhido. `privado` e `compartilhado_cliente` não convivem: `agenda_validar_payload` rejeita com "Evento privado não pode ser compartilhado com o cliente.", e o payload sem cliente grava `false`. No banco, o CHECK cobre só `NOT (compartilhado_cliente AND privado)`: excluir um cliente aciona o `ON DELETE SET NULL (cliente_id)` existente, e um CHECK que exigisse `cliente_id` faria a exclusão do cliente falhar. Por isso "compartilhado" é sempre lido como `compartilhado_cliente AND cliente_id IS NOT NULL`; as linhas das tabelas novas daquele cliente somem pelo cascade das FKs compostas, inclusive os itens da fila (cliente excluído não recebe e-mail).
   - Campo de série, como `cliente_id`: muda só com escopo `todas`/`seguintes`. O split de `seguintes` copia a coluna para a série nova (a lista de colunas do `INSERT` do split precisa dela, senão a cauda deixa de ser compartilhada).
   - Trocar o cliente ou desligar a opção: cancelamento ao cliente anterior; as respostas e os pedidos pendentes do cliente anterior são apagados e marcados `substituida`, respectivamente, na mesma transação.

2. **O que o cliente vê:** título, data e hora (no fuso do evento, com o nome do fuso quando diferente de America/Sao_Paulo), local, link da reunião, descrição, nome do workspace. Nunca participantes, organizador, tipo, cor, lembretes nem as respostas internas da equipe. Ocorrências canceladas somem do Hub (o e-mail de cancelamento é o aviso).

3. **Resposta do cliente por ocorrência**, tabela `agenda_respostas_cliente`:
   - Colunas: `ocorrencia_id` (PK), `conta_id`, `cliente_id`, `resposta` (NULL, `sim` ou `nao`; NULL = só existe pelo lembrete), `respondido_em`, `inicio_respondido timestamptz`, `lembrado_inicio timestamptz`.
   - FKs compostas: `(ocorrencia_id, conta_id) → agenda_ocorrencias(id, conta_id) ON DELETE CASCADE` e `(cliente_id, conta_id) → clientes(id, conta_id) ON DELETE CASCADE`. Vale para todas as tabelas novas: nenhum vínculo só por `id`, já que os RPCs do Hub rodam como service role.
   - Sem "talvez": o cliente confirma ou recusa.
   - **Resposta efetiva** = `resposta` quando `resposta IS NOT NULL`, `inicio_respondido = ocorrencia.inicio` (comparação `timestamptz`, nunca texto) e `cliente_id = agenda_eventos.cliente_id` com o evento ainda compartilhado; senão "aguardando". Mover o início reabre a pergunta; mudar só o fim não reabre.
   - Sem resposta de série: cada gravação é confirmada à parte. Responder é permitido até o fim da ocorrência e pode mudar quantas vezes quiser.

4. **Remarcação**, tabela `agenda_remarcacoes(id, conta_id, cliente_id, ocorrencia_id, inicio_sugerido timestamptz, fim_sugerido timestamptz, mensagem text <= 1000, status IN ('pendente','aceita','recusada','cancelada','substituida'), criado_em, resolvido_em, resolvido_por uuid, resposta_equipe text <= 1000)`, com as mesmas FKs compostas.
   - **Contrato da sugestão:** o Hub manda horário local (`data` `YYYY-MM-DD` e, para evento com hora, `hora` `HH:MM`). O RPC converte no `tz` da série e mantém a duração da ocorrência. Dia inteiro: `inicio` = meia-noite local da data, `fim` exclusivo pela mesma quantidade de dias. A sugestão precisa ser no futuro e a ocorrência ainda não pode ter começado.
   - No máximo um pedido `pendente` por ocorrência (índice único parcial). O cliente pode cancelar o próprio pedido pendente.
   - **Aceitar** (`agenda_remarcacao_resolver`, chamado pela equipe com JWT; exige poder editar o evento): reutiliza `agenda_evento_editar` com escopo `esta` e o novo horário, então vale a mesma semântica que a edição já aplica a cada tipo de série (evento único move `dtstart`; ocorrência de série recebe `horario_alterado` calculado), com as mesmas notificações `event_updated` aos participantes. Depois grava resposta `sim` do cliente para o novo início (foi ele quem sugeriu). Uma variável de transação faz a fila registrar o e-mail como "Remarcação aceita" em vez de "Alteração". Horário sugerido já passado: "Esse horário já passou. Combine outro com o cliente.".
   - **Recusar:** mensagem opcional da equipe; e-mail "Remarcação não aceita" com a mensagem e o horário que continua valendo.
   - **Concorrência:** ordem de travas igual à da edição (série → ocorrência → pedido). Toda transição é `UPDATE ... WHERE id = $1 AND status = 'pendente'`; zero linhas = 409 "Este pedido já foi resolvido.". Criar pedido trava a ocorrência antes de checar o índice.
   - Equipe move, cancela, apaga ou deixa de compartilhar a ocorrência por outro caminho: o pedido pendente vira `substituida` **antes** de qualquer `DELETE` das ocorrências (o regenerar e o split apagam linhas, e o cascade apagaria o pedido sem rastro).

5. **E-mail ao cliente por fila com payload imutável**, tabela `agenda_emails_cliente`, no molde do ledger de lembretes (claim com lease de 2 min, 3 tentativas), drenada pela função nova `agenda-cliente-email`.
   - **Snapshot na hora de enfileirar:** cada item guarda `conta_id`, `cliente_id`, `evento_id` (sem FK: a série pode sumir), `tipo` e `ocorrencias jsonb`, uma lista de até 50 entradas `{ocorrencia_id, estado: 'ativa'|'cancelada', sequencia, inicio, fim, dia_inteiro, data_inicio_local, data_fim_local, tz, titulo, descricao, local, link_reuniao}`. O envio só lê o snapshot. Não depende de linhas que o regenerar, o split ou a exclusão apagam.
   - **Quem enfileira:** os RPCs de escrita, por um helper `agenda_cliente_enfileirar(...)`, chamado **antes** de apagar ou regenerar ocorrências, que calcula as ocorrências futuras afetadas (próximos 90 dias, até 50). Não é trigger: o gerador noturno de horizonte e o `agenda_regenerar` inserem e apagam ocorrências sem que nada mude para o cliente.
     - `agenda_evento_criar` com compartilhamento: `convite` com as próximas ocorrências.
     - `agenda_evento_editar`:
       - ligar o compartilhamento ou trocar para este cliente: `convite`;
       - desligar ou trocar de cliente: `cancelamento` ao anterior;
       - mudança de início, fim, título, local, link ou descrição em ocorrências futuras (`esta`, `seguintes` ou `todas`, incluindo as apagadas por regenerar ou split, que entram como `cancelada`): `alteracao`.
     - `agenda_evento_excluir` (`esta`, `seguintes`, `todas`): `cancelamento` das ocorrências futuras afetadas.
     - `agenda_remarcacao_resolver`: `remarcacao_aceita` ou `remarcacao_recusada`.
   - **Coalescência só em item ainda não pego:** uma escrita no mesmo `(cliente_id, evento_id)` enquanto existe item `pendente` sem lease e com `enviar_apos` no futuro mescla nele por `ocorrencia_id` (estado mais recente vence; ocorrência que entrou como nova e foi cancelada antes do envio sai da lista) e incrementa `versao`. Item com lease nunca é alterado: a escrita cria um item novo. Item que fica sem ocorrências é `descartado`. `enviar_apos = now() + 60 s`. Remarcações têm item próprio, sem mescla.
   - **Tipo do e-mail na hora do envio** (a partir do snapshot): `remarcacao_*` como gravado. Senão: todas canceladas = "Evento cancelado"; tipo `convite` = "Novo evento"; resto = "Evento atualizado".
   - **Idempotência:** chave `agenda-cliente:<item_id>:<versao>`. Como item em lease não muda, a chave sempre corresponde a um conteúdo só.
   - **Entrega:** um cron de 1 min roda `agenda_cliente_tick()`, que só chama a função por pg_net quando há item vencido (padrão do `agenda_tick_lembretes`, com `BEGIN/EXCEPTION` em volta do `net.http_post`), mandando o `x-cron-secret` do vault. A função recusa com 401 qualquer chamada sem o segredo certo antes de qualquer trabalho. Sem chamada imediata a cada escrita: com `enviar_apos` de 60 s ela não acharia nada.
   - **Portões no envio:** `feature_agenda` ligado, cliente `ativo`, `clientes.email` não vazio, `send_event_email = true`, `event_email_unsub_at IS NULL`, e (exceto cancelamento) o evento ainda compartilhado com esse cliente. Portão fechado = item `descartado`, sem retry.
   - **Remetente e descadastro** iguais ao digest: `"<Workspace> <notificacoes@mesaas.com.br>"`, `List-Unsubscribe` RFC 8058 com o mesmo token assinado de `client-email-unsub` (descadastrar vale para os dois tipos de e-mail, como hoje).
   - **Assunto** estático por tipo mais o título passado por `sanitizeSubjectValue` (ex.: "Novo evento: Gravação de reels"). Texto livre (`titulo`, `descricao`, `mensagem`, `resposta_equipe`) passa por `escapeHtml` no HTML e por `escaparTexto` no ICS.
   - **Botão de ação** ("Confirmar presença" / "Ver no portal") só quando `hubUrlFor` devolve URL. Link direto para `/:workspace/hub/:token/agenda?ocorrencia=<id>`.

6. **`.ics` do e-mail:** `METHOD:PUBLISH`, sem `ORGANIZER`/`ATTENDEE`, uma `VEVENT` por ocorrência ativa do snapshot.
   - **Por que não `REQUEST`/`CANCEL`:** com `METHOD:REQUEST` o Gmail desenha o próprio cartão de RSVP e manda a resposta para a caixa do organizador, contornando o Hub, que é o canal de resposta. `METHOD:CANCEL` exige `ORGANIZER` e `ATTENDEE` (RFC 5546) e os clientes ignoram cancelamento de evento que entrou por `PUBLISH`.
   - **Consequência aceita:** um `.ics` importado é uma cópia. Alterações chegam como novo anexo com o mesmo `UID` (`agenda-oc-<ocorrencia_id>@mesaas.com.br`) e `SEQUENCE` maior, que o Apple Calendar aplica sobre o evento existente e o Google importa como evento separado. O e-mail de cancelamento não leva anexo e diz "Se você adicionou este evento ao seu calendário, remova-o.". O e-mail de alteração diz "Se você adicionou este evento ao seu calendário, abra o arquivo anexo para atualizá-lo.".
   - `ics.ts` ganha `sequencia?` por evento (sem campo, nada muda na saída atual). `SEQUENCE` = `agenda_ocorrencias.sequencia int NOT NULL DEFAULT 0`, incrementada pelo helper de enfileiramento a cada alteração relevante. O feed pessoal e os downloads (CRM e Hub) também passam a emitir a `sequencia` atual, senão um download com `SEQUENCE:0` depois de um e-mail com `SEQUENCE:2` seria ignorado.
   - Série com várias ocorrências no snapshot: o corpo lista as datas, e o anexo leva todas as do snapshot (até 50, próximos 90 dias). Sem `RRULE`, pela mesma razão do sub-projeto 2 (exceções e splits).
   - `sendViaResend` ganha o parâmetro opcional `attachments?: { filename, content (base64), content_type }[]`, o formato da API do Resend, sem mudar as chamadas existentes.

7. **Hub:** função nova `hub-agenda` no padrão das `hub-*` (token, `hub-badtoken`, `hub-read` compartilhado, `hub-write:hub-agenda:<conta>:<cliente>` 60/h para escritas, erros pt-BR genéricos, 404 para ocorrência de outro cliente ou workspace).
   - **Rotas:**
     - `GET ?token=[&apos=<ocorrencia_id>]` lista de hoje - 30 dias em diante, ordenada por `inicio`, páginas de 100 ocorrências, com `proximo` (cursor) quando há mais. O Hub carrega a próxima página com "Carregar mais".
     - `GET /ocorrencia/<id>.ics?token=` baixa a ocorrência (o download do `agenda-feed` exige JWT de usuário).
     - `POST {acao:'responder', ocorrencia_id, resposta, inicio_visto}`.
     - `POST {acao:'remarcar', ocorrencia_id, data, hora?, mensagem}`.
     - `POST {acao:'cancelar_remarcacao', remarcacao_id}`.
   - **RPCs:** tudo por RPCs só de `service_role` (`agenda_hub_listar`, `agenda_hub_responder`, `agenda_hub_remarcar`, `agenda_hub_cancelar_remarcacao`). Recebem `conta_id` e `cliente_id` já resolvidos pelo token e checam `feature_agenda`, cliente `ativo`, ocorrência daquele cliente e workspace, evento compartilhado, não privado e não cancelada.
   - **Cliente arquivado:** os RPCs de Hub da Agenda recusam. Fazer o arquivamento cortar o Hub inteiro (mudar `resolveHubToken`) é mudança de comportamento de todas as `hub-*` e fica fora deste sub-projeto.
   - **Menu:** `hub-bootstrap` passa a devolver `feature_agenda` (campo opcional, seguro com bundle antigo); o item "Agenda" só aparece com ele ligado.
   - **Auditoria:** as escritas gravam `audit_log` via `insertAuditLog` (padrão de `client-email-unsub/index.ts`; nenhuma `hub-*` grava hoje).

8. **Notificações da equipe:** dois tipos novos, `event_client_rsvp` e `event_reschedule_requested`.
   - **Destinatário:** o organizador. Se ele não for mais membro, owner e admins. O RPC calcula a lista antes de chamar `agenda_notificar`, que filtra membros atuais e não notifica ninguém se a lista ficar vazia.
   - **Ator:** não há (o cliente não é usuário). A metadata leva `cliente_nome`, e os textos (`notification-config.ts`, `resolveDigestItem`) não dependem de `ator_nome`.
   - `event_client_rsvp` só notifica quando a resposta efetiva muda. Link `/calendario?evento=<ocorrencia_id>`. Os dois tipos entram no digest de e-mail da equipe.
   - **Onde cadastrar (11 pontos):**
     - os 3 CHECKs de tipo;
     - o array de `claim_notification_emails`;
     - a union TS, o catálogo, o `notification-config.ts` e o `resolveDigestItem`;
     - os testes de contagem (`notification-catalog.test.ts`, incluindo a frase "os outros quatro são" e o texto do `event_rsvp`) e `99_agenda_edicao.sql`;
     - o regex de tipos `event_*` no runbook de rollback.

9. **Lembrete no digest "Pendências do Hub":** o `client-event-email-cron` ganha a seção "Eventos aguardando sua confirmação".
   - **Quais ocorrências:** compartilhadas, não canceladas, sem resposta efetiva, que começam entre agora + 1 h e agora + 48 h, com `lembrado_inicio IS DISTINCT FROM inicio`. Assim, cada horário é lembrado uma vez, e mover o evento permite um novo lembrete.
   - **Contam como conteúdo:** um digest só com lembretes é enviado. O handler deixa de tratar "zero posts e zero mensagens" como sem conteúdo quando há lembretes, e o template ganha a variante só com eventos (título e chamada próprios).
   - **Idempotência:** a chave do digest passa a incluir `oc:<ocorrencia_id>:<inicio>` de cada lembrete. Sem isso, dois digests só de lembretes no mesmo dia teriam a mesma chave e o Resend descartaria o segundo como duplicado (devolve 409, que o código trata como sucesso).
   - **Depois do envio:** grava `lembrado_inicio = inicio` (cria a linha com `resposta` NULL se não existir). Avançar `event_cursor_at` num digest só de lembretes é seguro: não havia aprovações na janela.
   - **Limites aceitos:**
     - segue o switch do workspace e o Hub (`feature_hub_portal` e URL do Hub), como o resto do digest, então workspace sem Hub recebe convites mas nunca lembretes;
     - pelo teto de 1 e-mail a cada 4 h, um evento compartilhado a menos de ~5 h do início pode não ser lembrado.

10. **CRM, leitura:** `agenda_listar` ganha `compartilhado_cliente`, `cliente_resposta` (`sim`/`nao`/`aguardando`, NULL quando não compartilhado) e `remarcacao_pendente jsonb` (`{id, inicio_sugerido, fim_sugerido, mensagem, criado_em}`). Muda o `RETURNS TABLE`, então é `DROP FUNCTION` + `CREATE`, com os mesmos grants. Mascarado (privado de outro) devolve esses campos NULL. Colunas novas no fim: bundles antigos e o download do `agenda-feed` seguem funcionando.

## Interface

**Formulário completo (`EventoFormDialog`):**
- Abaixo do seletor de cliente, um switch "Compartilhar com o cliente", com a ajuda "Aparece no portal do cliente e ele recebe o convite por e-mail."
- Avisos conforme o caso:
  - cliente sem e-mail: "Este cliente não tem e-mail cadastrado. O evento aparece só no portal.";
  - workspace sem Hub: "O cliente recebe o convite por e-mail.".
- Escondido quando "Privado" está marcado.
- O card rápido não ganha o switch (cliente já não está nele).

**Popover (`EventoPopover`):**
- Linha "Cliente: Clínica X · Confirmou" (ou "Recusou", "Aguardando resposta").
- Pedido pendente em destaque: "Clínica X pediu para remarcar para qui., 9 de out., 14:00", com a mensagem e os botões "Aceitar" e "Recusar". Recusar abre um campo de mensagem opcional.
- Não há pergunta de escopo: a remarcação vale só para aquela ocorrência.

**Hub, página Agenda (`/:workspace/hub/:token/agenda`):**
- Lista agrupada por dia, "Próximos" e "Anteriores" (últimos 30 dias, recolhido), com "Carregar mais".
- Cartão:
  - título, data e hora, local;
  - botão "Entrar na reunião" quando há link;
  - descrição recolhível;
  - selo "Confirmado" / "Você recusou" / "Aguardando sua resposta";
  - botões "Confirmar" e "Não vou";
  - menu com "Pedir para remarcar", "Adicionar ao Google Agenda" e "Baixar .ics".
- Pedido pendente: "Você pediu para remarcar para … Aguardando a equipe.", com "Cancelar pedido".
- Remarcar abre um sheet (mobile) ou dialog (desktop) com data, hora (sem hora em evento de dia inteiro) e mensagem, no fuso do evento.
- `?ocorrencia=<id>` rola até o cartão e o destaca.
- Estado vazio: "Nenhum evento por aqui ainda."

**Hub, home:** bloco "Próximos eventos" com até 3 ocorrências e o link "Ver agenda", e um aviso quando há eventos aguardando resposta. Só com `feature_agenda`.

**i18n:** namespace novo `hubAgenda` em pt e en, registrado em `apps/hub/src/main.tsx`; rótulo de menu em `common`.

## Erros e casos limite

- **Cliente responde a uma ocorrência que a equipe acabou de mover.** O Hub manda o `inicio_visto`. Se for diferente do atual (comparação `timestamptz` no RPC), retorna 409 "Este evento mudou de horário. Atualize a página.".
- **Ocorrência que já terminou:** responder e remarcar retornam 409 "Este evento já aconteceu.".
- **Evento deixa de ser compartilhado, fica privado ou é apagado:** some do Hub, os pedidos pendentes viram `substituida` e as ações retornam 404.
- **Flag `feature_agenda` desligado:**
  - o Hub esconde o menu e o bloco;
  - `hub-agenda` responde 404;
  - a fila descarta os itens;
  - o digest omite a seção.
- **Cliente arquivado** (`status <> 'ativo'`): e-mails descartados e RPCs de Hub da Agenda recusam com 404.
- **E-mail do cliente vazio:** o evento aparece no Hub e nada é enviado.
- **Falha do Resend:** retry pelo ledger (3 tentativas), depois `falhou`. A equipe não vê nada.

## Testes

- **Entitlements (`99_agenda_hub.sql`, datas relativas a `current_date`):**
  - visibilidade: compartilhado, privado, outro cliente, outro workspace, cancelado, cliente arquivado;
  - resposta efetiva: expira ao mover o início, não ao mover o fim, invalida ao trocar de cliente;
  - remarcação:
    - um pedido pendente por ocorrência;
    - aceitar move como a edição e grava `sim`;
    - transição condicional (409 no segundo resolver);
    - `substituida` antes de regenerar, split e exclusão;
  - fila:
    - snapshot sobrevive ao `DELETE` da série;
    - mescla só sem lease;
    - `versao` incrementa;
    - convite + cancelamento antes do envio = descartado;
    - split re-enfileira com a série nova;
  - FKs compostas rejeitam vínculo entre workspaces;
  - grants: `anon` e `authenticated` sem acesso aos RPCs de Hub e à fila.
- **Deno:**
  - `ics.ts`: `SEQUENCE`, saída do feed sem o campo inalterada;
  - `hub-agenda`: token, flags, 404 de outro cliente, 409s, rate limit, `.ics`, paginação;
  - `agenda-cliente-email`: portões, tipos, anexo, botão com e sem Hub, descarte, chave com `versao`, assunto sanitizado e escape de HTML;
  - `client-event-email-cron`: digest só de lembretes é enviado, chave inclui as ocorrências, lembra uma vez por horário;
  - `sendViaResend` com anexo.
- **Vitest:**
  - CRM: popover (estado do cliente, aceitar e recusar), formulário (switch, avisos), contagens de tipos de notificação;
  - Hub: página Agenda (responder, 409, remarcar com data local, cancelar pedido, deep link, carregar mais) e home.

## Rollout

Ordem:

0. `supabase/config.toml` ganha `[functions.hub-agenda]` e `[functions.agenda-cliente-email]` com `verify_jwt = false`, como as demais funções de token e de cron.
1. Migration (`db push`), que cria o cron `agenda-cliente-email` de 1 min. Até o deploy do passo 2 as chamadas falham e os itens ficam pendentes, sem perda.
2. Logo em seguida, deploy de:
   - `agenda-cliente-email` e `hub-agenda` (novas, `--no-verify-jwt`);
   - `hub-bootstrap`;
   - `client-event-email-cron` (lê a tabela nova, então só depois da migration);
   - `agenda-feed` (o `ics.ts` compartilhado mudou);
   - `notification-email-cron` (`resolveDigestItem`).
3. Merge.

**Rollback (passo 4b do runbook, completo):**
1. Remover o cron.
2. Recriar as versões anteriores de todas as funções SQL substituídas:
   - `agenda_validar_payload`, `agenda_evento_criar`, `agenda_evento_editar`, `agenda_evento_excluir`;
   - `agenda_listar`, com `DROP` e recriação no formato antigo;
   - `claim_notification_emails`.
3. Apagar as linhas dos dois tipos novos em `notifications`, `notification_inapp_prefs` e `notification_email_prefs`, e só então restaurar os 3 CHECKs.
4. Dropar as tabelas novas, `agenda_ocorrencias.sequencia` e `agenda_eventos.compartilhado_cliente`.
5. Redeployar as funções da versão anterior.

As definições anteriores ficam copiadas no runbook (não referenciadas), para não depender de reaplicar migrations.

## Fora do escopo

- **Convidado externo por e-mail** (pessoa que não é membro nem o e-mail do cliente). A linha 29 do sub-projeto 1 o mandou para cá, mas as decisões do usuário (linhas 17 e 20) falam só do cliente, e ele precisaria de uma superfície pública de resposta própria. Fica para depois.
- **Feed iCal do cliente** (URL assinável a partir do token do Hub), que resolveria atualizações e cancelamentos automáticos no calendário do cliente. Candidato natural depois deste sub-projeto.
- Arquivar cliente cortar o acesso ao Hub inteiro.
- Vários contatos por cliente; saber qual pessoa respondeu.
- Cliente criar evento ou propor horário sem evento existente (links de agendamento).
- Remarcar a série inteira pelo Hub.
- Responder pelo próprio Gmail/Outlook (`METHOD:REQUEST`).
- Camadas antigas na grade e posts agendados (sub-projeto 4).

## Revisões aplicadas

Revisão do Fable e revisão externa (Codex) sobre a primeira versão:

- **Aceitas:**
  - fila com snapshot imutável por item, sem FK de evento, enfileirada antes dos `DELETE`s, mescla só sem lease e chave com `versao` (Fable 1, 2; Codex P1 fila, P1 idempotência);
  - chave do digest com as ocorrências lembradas (Fable 1);
  - sem `METHOD:CANCEL`, com o texto do e-mail explicando a remoção manual (Fable 3);
  - FKs compostas em todas as tabelas novas (Codex P0);
  - resposta efetiva exige o mesmo cliente, e trocar de cliente limpa respostas e pedidos (Codex P0);
  - cliente arquivado recusado nos RPCs da Agenda, sem a afirmação falsa sobre o token (Fable 6, Codex P1);
  - transições condicionais e ordem de travas (Codex P1);
  - rollback completo com as definições anteriores (Codex P1);
  - sugestão em data e hora locais convertidas no `tz` da série (Codex P2);
  - paginação em vez de teto de 300 (Codex P2);
  - o que cada tipo de alteração de série anexa (Fable 8, Codex P2);
  - destinatários calculados antes de `agenda_notificar` e textos sem ator (Fable 4);
  - 11 pontos de cadastro de tipo (Fable 5);
  - lembrete como conteúdo, variante do template, `resposta` nula, `lembrado_inicio` (Fable 7);
  - aceite reutiliza `agenda_evento_editar` (Fable 9);
  - comparação `timestamptz` e fim que não reabre (Fable 10);
  - sem chamada pg_net imediata (Fable 11);
  - precedente de auditoria corrigido, `NOT cancelada` no lembrete, enfileirar antes do `DELETE` em `excluir todas` (Fable 12);
  - assunto sanitizado e escape (Fable 13).
- **Aceitas na segunda rodada do Codex:** `x-cron-secret` obrigatório em `agenda-cliente-email` (P0); CHECK sem `cliente_id` para não quebrar a exclusão de cliente, com "compartilhado" lido como `compartilhado_cliente AND cliente_id IS NOT NULL` (P1); rollback apaga as preferências dos tipos novos antes de restaurar os CHECKs (P1); entradas no `config.toml` (P2).
- **Rejeitadas:**
  - **`RRULE` no convite de série (Fable 3):** reproduzir exceções e splits em `RRULE`/`EXDATE` é o risco que o sub-projeto 2 já recusou.
  - **Cortar o cancelamento de pedido pelo cliente (Fable 14):** é barato e é o único jeito de o cliente desfazer um pedido errado.
  - **Mudar `resolveHubToken` para barrar cliente arquivado em todo o Hub (Codex P1):** muda o comportamento das 14 `hub-*` e merece decisão própria.
