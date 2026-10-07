# Agenda: Google Agenda, arquivo .ics e feed pessoal (sub-projeto 2) - design

## Contexto

Sub-projeto 2 de 4 da iniciativa Agenda (ver `2026-10-05-agenda-eventos-core-design.md`, tabela de sub-projetos). O sub-projeto 1 está em produção, escuro atrás de `plans.feature_agenda` e ligado por override no workspace piloto (1 evento, 2 lembretes enviados, cron sem falhas em 2026-10-06).

Decisão do usuário para a iniciativa: "Google = botão + `.ics` + feed". Nada aqui é sync bidirecional: o Mesaas continua a fonte da verdade.

## Escopo

1. **Botão "Adicionar ao Google Agenda"** no popover de detalhe de um evento: abre `calendar.google.com` com o evento pré-preenchido.
2. **"Baixar .ics"** no mesmo popover: baixa um arquivo `.ics` com a ocorrência.
3. **Feed pessoal (URL iCal secreta):** cada usuário gera, copia, troca e desativa uma URL que Google Agenda, Apple Calendar e Outlook assinam. O feed traz os eventos do usuário naquele workspace.

Fora do escopo: importar eventos de fora, sync bidirecional, `ATTENDEE`/convites por e-mail via `.ics` (sub-projeto 3 envia `.ics` ao cliente e vai reaproveitar o gerador daqui), escolha de fuso na UI, feed da equipe inteira.

Tudo fica atrás de `feature_agenda` (já existe; nenhuma coluna de plano nova, nenhuma mudança em `FEATURE_COLUMNS`).

## Decisões

1. **Uma ocorrência = um `VEVENT`, sem `RRULE`.** As ocorrências já estão materializadas (24 meses) com exceções por ocorrência (`campos_sobrescritos`), cancelamentos e splits (`serie_origem_id`). Emitir `RRULE` + `EXDATE` + `RECURRENCE-ID` exigiria reproduzir em ICS a mesma semântica que o gerador SQL aplica, e qualquer divergência vira evento fantasma ou sumido no Google. Com um `VEVENT` por ocorrência o feed é um snapshot fiel do que o app mostra. `UID` = `agenda-oc-<ocorrencia_id>@mesaas.com.br`. O id da linha é estável quando "este e os seguintes" divide a série (o RPC move as linhas para a série nova com `UPDATE agenda_ocorrencias SET evento_id = v_alvo`, então `evento_id` muda e `id` não). Só o ticket adiado "editar a data da série re-chaveia as ocorrências" troca o id; aí o assinante vê a ocorrência antiga sumir e a nova aparecer, como já acontece com RSVPs por ocorrência no app. Sem `SEQUENCE` e sem `LAST-MODIFIED`: feeds assinados são substituídos por inteiro a cada atualização, e `agenda_ocorrencias` não tem `updated_at` (edições "somente este" e cancelamentos não movem `agenda_eventos.updated_at`), então um `LAST-MODIFIED` seria enganoso.
2. **Conteúdo do feed = "meus eventos":** ocorrências não canceladas de eventos em que o usuário é organizador ou participante, exceto as que ele recusou (resposta efetiva `nao`, igual ao Google, que esconde recusados). Não é a agenda da equipe inteira. Motivos: (a) é o que alguém espera ver no calendário do celular; (b) a URL é uma credencial portátil: se vazar, expõe só a agenda de uma pessoa, não a da equipe; (c) como o usuário é organizador ou participante de tudo que sai no feed, o mascaramento de evento privado nunca se aplica (ele sempre pode ver os detalhes), e o feed não precisa reimplementar a regra de `mascarado`. A alternativa (feed da equipe, com mascaramento) fica para depois se alguém pedir.
3. **Janela do feed:** de hoje - 30 dias até hoje + 12 meses (no fuso do evento não importa; o filtro é por `inicio` em UTC), limite 2000 `VEVENT`s ordenados por `inicio`. Assinantes não precisam de histórico longo, e o limite protege o tamanho da resposta.
4. **`.ics` por evento = só a ocorrência clicada**, mesmo em série. A série inteira é o papel do feed. Mesmo `UID` do feed (`agenda-oc-<ocorrencia_id>`), então baixar e também assinar não duplica no Apple Calendar (no Google a importação ganha id próprio de qualquer forma).
5. **Botão do Google = só a ocorrência**, pelo mesmo motivo (o link `action=TEMPLATE` aceita `recur=`, mas a regra do Google divergiria das exceções do Mesaas).
6. **Um único gerador de ICS, em Deno (`supabase/functions/_shared/ics.ts`).** O CRM não gera ICS: o download chama a edge function, que gera com o mesmo código do feed. O repositório não importa código através da fronteira Deno/Vite (precedente: `apps/crm/src/lib/mcp-scopes.ts`), e o sub-projeto 3 precisa do gerador em Deno para anexar `.ics` aos e-mails do cliente. O link do Google é só uma URL e fica no CRM.
7. **Token do feed em texto puro**, como `client_hub_tokens`: o usuário pode copiar a URL de novo a qualquer momento (o Google também reexibe o "endereço secreto"). Linha visível só por RPC `SECURITY DEFINER` do próprio usuário; nenhum grant de tabela para `authenticated`. Gerado com `replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')`: 64 caracteres hex, ~244 bits aleatórios, só Postgres core (o repo não tem precedente de `pgcrypto`/`gen_random_bytes` em migration). Um token por `(user_id, conta_id)`.
8. **Feed não exige criar link ao abrir o diálogo:** o usuário clica "Gerar link". Trocar o link invalida o anterior na hora. Desativar apaga a linha.
9. **Respostas do feed:** token desconhecido, usuário que saiu do workspace ou perdeu `calendario: ver` → `404` com corpo genérico. Flag desligada no workspace → `200` com `VCALENDAR` válido e vazio (assinantes não mostram erro; quando o flag volta, os eventos voltam). Rate limit no padrão de `hub-reports/index.ts`: resolve o token primeiro; token válido → `agenda-feed:<sha256(token)>` 60/3600; token desconhecido → `agenda-feed-badtoken:<ip>` 30/600 antes do 404 (limitar antes de resolver deixaria qualquer string aleatória gravar uma linha em `rate_limit_log`). Nunca logar o token no código (só os 6 primeiros caracteres do hash). Aceito: o log da plataforma Supabase registra o path com o token, a mesma exposição dos tokens do Hub.

## Banco (migration `20261006000001_agenda_feed.sql`)

Acima do tail de main (`20261005000002`).

```sql
CREATE TABLE public.agenda_feed_tokens (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  conta_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE,
  criado_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, conta_id)
);
-- service_role e as RPCs abaixo; nenhum tenant lê a tabela (padrão de agenda_lembretes)
ALTER TABLE public.agenda_feed_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY agenda_feed_tokens_service_role_bypass ON public.agenda_feed_tokens
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON TABLE public.agenda_feed_tokens FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.agenda_feed_tokens TO service_role;
```

Sem limpeza ao remover membro: a linha fica, mas o feed responde 404 porque `has_permission_for` falha para quem não é membro. Se a pessoa voltar ao workspace o link antigo volta a funcionar; aceito (ela pode gerar um novo).

RPCs do CRM (`SECURITY DEFINER`, `SET search_path = public`, `authenticated` + `service_role`, revogadas de `PUBLIC, anon`), todas com o mesmo preâmbulo de `agenda_listar`: `get_my_conta_id()` e `auth.uid()` não nulos; `effective_plan_feature(v_conta, 'feature_agenda')` senão `RAISE 'feature_disabled:feature_agenda' USING ERRCODE = 'P0001'`; `has_permission('calendario','ver')` senão raise.

- `agenda_feed_obter() RETURNS text`: o token atual do usuário no workspace ativo, ou `NULL`.
- `agenda_feed_gerar() RETURNS text`: cria ou substitui (`INSERT ... ON CONFLICT (user_id, conta_id) DO UPDATE SET token = EXCLUDED.token, criado_em = now()`) e devolve o novo token.
- `agenda_feed_desativar() RETURNS void`: apaga a linha.

Função do feed (só `service_role`; revogada de `PUBLIC, anon, authenticated`):

```sql
agenda_feed_eventos(p_token text) RETURNS jsonb
```

- Resolve `p_token` → `(user_id, conta_id)`. Não achou → `NULL` (a function responde 404).
- `has_permission_for(user_id, conta_id, 'calendario', 'ver')` falso (inclui "não é mais membro") → `NULL`.
- Flag off → `{"estado": "desligado", "workspace_nome": "<nome>", "eventos": []}`. `workspace_nome` vem de `workspaces.name`.
- Senão `{"estado": "ok", "workspace_nome": "<nome>", "eventos": [...]}`, com as ocorrências da decisão 2 na janela da decisão 3. Cada item: `evento_id`, `data_original`, `inicio`, `fim`, `dia_inteiro`, `data_inicio_local`, `data_fim_local` (fim exclusivo, mesma expressão de `agenda_listar`), `titulo`, `descricao`, `local`, `link_reuniao` (campos sobrescritos por ocorrência resolvidos como em `agenda_listar`: `CASE WHEN 'titulo' = ANY (o.campos_sobrescritos) THEN o.titulo ELSE e.titulo END`), `tz`, `ocorrencia_id`.

Teste SQL `supabase/tests/entitlements/99_agenda_feed.sql` (padrão dos `99_agenda_*`: `update plans set feature_agenda = true;` depois do `begin;`): gerar/obter/trocar/desativar; outro usuário não lê o token alheio (sem SELECT direto, `agenda_feed_obter` só vê o próprio); flag off → RPCs levantam `feature_disabled:feature_agenda` e o feed devolve `desligado`; feed traz organizador e participante, não traz evento de colega em que não participa, não traz ocorrência recusada nem cancelada, respeita a janela; traz com detalhes completos um evento privado em que o usuário é participante; membro removido → `NULL`; `anon` e `authenticated` não executam `agenda_feed_eventos` (`has_function_privilege`); `authenticated` não tem SELECT em `agenda_feed_tokens` (incluir a tabela no `et_grant_hosted_parity([...])` do teste).

## Edge function `agenda-feed` (`--no-verify-jwt`)

Duas rotas em `supabase/functions/agenda-feed/index.ts` + `handler.ts` (handler puro com dependências injetadas, padrão `hub-approve`). Sub-path como `hub-reports`: `url.pathname.replace('/agenda-feed', '')`. Entrada `[functions.agenda-feed] verify_jwt = false` em `supabase/config.toml` (como `agenda-lembretes-email`), além do `--no-verify-jwt` no deploy.

1. `GET /agenda-feed/<token>.ics` (sem JWT; o token é a credencial). Valida o formato (`^[0-9a-f]{64}$`, senão 404 sem tocar no banco), chama `agenda_feed_eventos` com o client service role; `NULL` → rate limit de token ruim por IP e 404; senão rate limit por hash do token (`hashToken()` de `_shared/mcp-token.ts`) e monta o calendário (`desligado` → calendário vazio). Headers: `Content-Type: text/calendar; charset=utf-8`, `Cache-Control: private, max-age=300`, `Content-Disposition: inline; filename="mesaas-agenda.ics"`. `HEAD` responde igual sem corpo (alguns clientes testam a URL assim).
2. `GET /agenda-feed/ocorrencia/<id>.ics` com `Authorization: Bearer <jwt>`. `OPTIONS` nesta rota responde `204` com `buildCorsHeaders(req)` (o `fetch` com `Authorization` dispara preflight); toda resposta da rota leva os mesmos headers de CORS. `id` precisa ser inteiro positivo (`parseInt` + `isNaN`), senão 404. Valida o usuário (service-role client + `auth.getUser(jwt)`), depois chama `agenda_listar(p_ocorrencia_id => id)` com um client **anon key + `global.headers.Authorization: Bearer <jwt>`** (padrão `instagram-publish/index.ts`; nunca o service role com o header, que pularia RLS e `auth.uid()`). Mapeamento:
   - sem header, `getUser` falha, ou o RPC devolve erro de JWT (PostgREST 401) → `401`;
   - zero linhas (ocorrência apagada, cancelada, de outro workspace, flag off) → `404`;
   - `mascarado = true` → `404`;
   - RPC levanta erro de permissão ou de sessão sem workspace → `404` (mesmo corpo genérico, sem vazar a diferença);
   - outro erro → `500` genérico, detalhe no log;
   - ok → `200`, `Content-Type: text/calendar; charset=utf-8`, `Content-Disposition: attachment; filename="<slug-ascii>.ics"; filename*=UTF-8''<titulo-codificado>.ics`.

Erros: corpo genérico (`Não encontrado`, `Muitas requisições`, `Erro interno`), detalhe só no log.

### `_shared/ics.ts`

API pura, sem I/O:

```ts
export interface IcsEvento {
  uid: string;
  inicio: Date; fim: Date;              // usados quando !diaInteiro (UTC 'Z')
  diaInteiro: boolean;
  dataInicio?: string; dataFim?: string; // 'YYYY-MM-DD', fim exclusivo, quando diaInteiro
  titulo: string;
  descricao?: string | null;
  local?: string | null;
  url?: string | null;                   // link_reuniao; só http(s)
}
export function gerarCalendario(opts: { nome: string; eventos: IcsEvento[]; agora: Date }): string;
```

Regras (RFC 5545):
- `CRLF` em todas as linhas; dobra a 75 octetos UTF-8 sem partir um caractere multibyte (continuação começa com um espaço).
- Texto (`SUMMARY`, `DESCRIPTION`, `LOCATION`, `X-WR-CALNAME`): escapa `\` → `\\`, `;` → `\;`, `,` → `\,`, quebra de linha → `\n`; remove `\r` e caracteres de controle.
- Horário: `DTSTART:YYYYMMDDTHHMMSSZ` / `DTEND` em UTC (sem `VTIMEZONE`). Dia inteiro: `DTSTART;VALUE=DATE:YYYYMMDD`, `DTEND;VALUE=DATE` exclusivo.
- `DESCRIPTION` = descrição + (se houver) linha em branco + `Link da reunião: <url>`; `URL:` só se `url` começa com `http://` ou `https://`.
- Cabeçalho: `VERSION:2.0`, `PRODID:-//Mesaas//Agenda//PT-BR`, `CALSCALE:GREGORIAN`, `METHOD:PUBLISH`, `X-WR-CALNAME:Mesaas: <workspace>`, `REFRESH-INTERVAL;VALUE=DURATION:PT1H`, `X-PUBLISHED-TTL:PT1H`.
- Cada `VEVENT`: `UID`, `DTSTAMP` (= `agora`), `DTSTART`, `DTEND`, `SUMMARY`, opcionais, `TRANSP:OPAQUE`.

Testes Deno: escape, dobra com acentos e emoji no limite de 75 octetos, dia inteiro com fim exclusivo, horário em UTC, URL `javascript:` descartada, calendário vazio válido, handler (404 por formato sem chamar o banco; token desconhecido → rate limit por IP + 404; 429 nos dois limites; `desligado` → calendário vazio 200; HEAD sem corpo; rota de ocorrência: OPTIONS 204 com CORS, sem JWT → 401, JWT expirado (erro 401 do RPC) → 401, zero linhas → 404, mascarado → 404, erro de permissão → 404, id inválido → 404).

## CRM

Arquivos novos em `apps/crm/src/pages/calendario/agenda/`:

- `googleAgenda.ts`: `linkGoogleAgenda(o: AgendaOcorrencia): string` → `https://calendar.google.com/calendar/render?action=TEMPLATE&text=…&dates=…&details=…&location=…&ctz=<tz>`. `dates`: horário `YYYYMMDDTHHMMSSZ/YYYYMMDDTHHMMSSZ` (UTC); dia inteiro `YYYYMMDD/YYYYMMDD` com fim exclusivo (de `data_inicio_local`/`data_fim_local`). `details` = descrição + link da reunião. Tudo por `URLSearchParams`.
- `baixarIcs.ts`: `baixarIcsDaOcorrencia(o)` → `fetch` da rota 2 com o JWT da sessão, `Blob` → link temporário com `a.download = '<slug do título>.ics'` (o `Content-Disposition` não vale para download via Blob) → `click()` → `revokeObjectURL`. Erro → `toast.error('Não foi possível baixar o arquivo.')`.
- `FeedAgendaDialog.tsx`: diálogo "Sincronizar com seu calendário".
  - Sem link: texto curto ("Gere um link secreto para ver seus eventos do Mesaas no Google Agenda, Apple ou Outlook.") e botão "Gerar link".
  - Com link: campo só-leitura com a URL + "Copiar"; "Abrir no Google Agenda" (`https://calendar.google.com/calendar/r?cid=<webcal://…>`); "Abrir no Apple Calendar" (`webcal://…`); instrução para Outlook ("Adicionar calendário > Da Internet"); aviso "O Google Agenda pode levar algumas horas para mostrar mudanças." e "Quem tiver este link vê seus eventos. Se ele vazar, gere um novo."; botões "Gerar novo link" (confirma: "O link atual para de funcionar.") e "Desativar link" (confirma).
  - Dados via TanStack Query com a chave `['agenda-feed-token', workspaceId]` (`workspaceId = profile.conta_id`, como `useWorkspaceLimits`, para trocar de workspace nunca mostrar o link de outro), mutações `agenda_feed_gerar` / `agenda_feed_desativar` no `store/agenda.ts` com `formatAgendaError`.
  - URL do feed: `${VITE_SUPABASE_URL}/functions/v1/agenda-feed/<token>.ics`.

Mudanças:
- `EventoPopover.tsx`: botão `⋮` (`MoreVertical`, `aria-label="Mais ações"`) no cabeçalho, antes do Fechar, com `DropdownMenu`: "Adicionar ao Google Agenda" (abre em nova aba, `rel="noopener noreferrer"`) e "Baixar .ics". Escondido quando `o.mascarado`. O `DropdownMenu` é portalizado dentro de um `Popover` controlado (`onOpenChange={(aberto) => !aberto && onClose()}`): verificar no browser que clicar num item não fecha o popover antes do clique valer; se fechar, usar o padrão `sub` que o popover já tem.
- `AgendaSidebar.tsx`: item "Sincronizar com seu calendário" (ícone `CalendarSync` ou `Link`) no rodapé, abre o `FeedAgendaDialog`. Visível para quem vê a agenda (o feed é leitura).
- `store/agenda.ts`: `obterFeedToken`, `gerarFeedToken`, `desativarFeedToken`.

Testes Vitest: `linkGoogleAgenda` (horário UTC, dia inteiro exclusivo, caracteres especiais, sem descrição); popover mostra/esconde o menu (mascarado); diálogo nos três estados e confirmações; chave da query inclui o workspace; item da sidebar aparece e abre o diálogo; `baixarIcs` com `fetch` mockado (nome do arquivo, erro → toast).

Cópia em português, sem travessão.

## Rollout

1. `db push --linked` (migration nova; verificar a tabela, os grants da tabela (sem `anon`/`authenticated`), as 4 funções, e `proacl` de `agenda_feed_eventos` sem `anon`/`authenticated`).
2. Deploy `agenda-feed` (`--no-verify-jwt --use-api --project-ref skjzpekeqefvlojenfsw`).
3. Merge (deploya o frontend). Nada muda para workspaces sem o flag.
4. Piloto: gerar o link no workspace piloto, assinar no Google Agenda e no Apple Calendar, conferir um evento horário, um dia inteiro e uma série; baixar `.ics` de uma ocorrência.

Nunca redeployar `client-event-email-cron` deste branch.

## Riscos

- O Google Agenda atualiza feeds assinados em intervalos próprios (horas); não há como forçar. Está no texto do diálogo.
- URL longa da Supabase (`*.supabase.co/functions/v1/...`) aparece para o usuário. Aceito no piloto; um rewrite `mesaas.com.br/agenda/feed/...` no `vercel.json` pode vir depois.
- Feed sem `VTIMEZONE`: horários em UTC são exibidos no fuso do assinante, que é o comportamento correto para eventos com horário.

## Revisões aplicadas (Fable + Codex, 2026-10-06)

Aceitas: `LAST-MODIFIED` removido (`agenda_ocorrencias` não tem `updated_at`); `UID` por `ocorrencia_id` (splits mudam `evento_id`); token por dois `gen_random_uuid()` (sem `pgcrypto`); rate limit depois de resolver o token, token ruim limitado por IP; `REVOKE`/`GRANT` na tabela; `verify_jwt = false` no `config.toml`; `OPTIONS` e client anon + JWT na rota de download, com mapeamento de status; nome do arquivo pelo `a.download`; chave da query por workspace; testes extras; `workspaces.name`; reuso de `hashToken()`; checagem do dropdown dentro do popover no browser.

Rejeitada: adicionar `updated_at`/revisão em `agenda_ocorrencias` para manter `LAST-MODIFIED` (Codex P2, alternativa). Feeds assinados são relidos por inteiro e nenhum cliente depende de `LAST-MODIFIED` para atualizar; manter o timestamp exigiria tocar todas as mutações de ocorrência do sub-projeto 1 por um campo informativo.

Aceito como risco: token no log de requisições da plataforma (igual ao Hub); linha do token sobrevive à remoção do membro (feed 404).
