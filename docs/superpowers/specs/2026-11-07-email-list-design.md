# Lista completa de e-mails no Admin

Data: 2026-11-07. Continua `docs/superpowers/specs/2026-11-06-email-metrics-design.md` (tabela `email_sends`, RPC `email_metrics`, página E-mails do Admin).

## Intenção

A página E-mails mostra números agregados por período. Quem administra a plataforma também precisa olhar e-mail por e-mail: o que saiu, de que tipo, com que status, e conferir um caso específico (um cliente diz que não recebeu um e-mail; um tipo novo está dando bounce).

A lista não pode pesar na página principal. A página E-mails continua fazendo só a chamada `email-metrics`. A lista mora numa página própria, aberta por um botão "Ver lista completa", e só essa página chama a nova ação.

## Decisões do usuário

- **Detalhe por linha:** data, categoria, tipo e status. Motivo do bounce, destinatário mascarado e assunto aparecem **só quando já estão guardados**, ou seja, nos estados com dado pessoal (bounce, reclamação, falha, supressão) com menos de 90 dias. Cada linha tem o link "Ver no Resend", que abre o e-mail no painel do Resend para ver o resto. Nenhum dado pessoal novo é guardado e a regra dos 90 dias não muda.
- **Onde abre:** página própria em `/admin/emails/lista` (rota filha `emails/lista` de `/admin`), com os filtros na URL, para poder compartilhar o link e usar o botão voltar. A página E-mails só tem um link para ela.

## Objetivos

1. Listar todos os e-mails de `email_sends` do período, do mais novo para o mais antigo, com paginação "Carregar mais" de 50 por vez.
2. Filtros:
   - período (7, 30, 90 dias ou personalizado, as mesmas regras da página E-mails: dia de São Paulo, até 365 dias de intervalo);
   - categoria (várias);
   - tipo (vários; a lista de tipos se limita às categorias escolhidas);
   - status (vários, agrupados como na página): Entregue = `delivered`, Atrasado = `delivery_delayed`, Pendente = `sent`, Bounce = `bounced`, Reclamação = `complained`, Não enviado = `failed`, `suppressed` e `canceled`. O Admin expande o grupo em `p_events`.
3. Interno e Externo aparecem na lista (ela é de conferência), com os rótulos que a página E-mails já usa. Por padrão nenhum filtro de categoria vem marcado, ou seja, todas as categorias aparecem.
4. O botão "Ver lista completa" na página E-mails leva o período que estava selecionado.

## Fora do escopo

- Busca por destinatário ou assunto: esses campos não existem para a maioria das linhas.
- Exportar CSV, contagem total exata, ordenar por outra coluna.
- Buscar detalhes no Resend pela API.

## Antiobjetivos

- A página E-mails passar a chamar a lista, inclusive por prefetch.
- Mostrar dado pessoal com mais de 90 dias ou de e-mail que não falhou.
- Um filtro que faça a consulta varrer a tabela inteira sem índice.

## Restrições

- Mesma arquitetura das métricas: RPC `SECURITY DEFINER` só `service_role` (REVOKE explícito de `public, anon, authenticated`), chamada pelo `platform-admin`, que já confere `platform_admins`. CORS por `buildCorsHeaders`, erro genérico para fora.
- Migration nova com prefixo acima do último de `main` (hoje `20261124000001`); conferir na hora de abrir o PR.
- Copy em português, sem travessão.
- Ordem de deploy: migration, depois `platform-admin`, depois merge (o merge publica o Admin na hora). Rollback na ordem inversa: Admin (revert do frontend), `platform-admin`, e só então a migration (drop da RPC e do índice novo; o índice antigo nunca sai).

## Desenho

### Banco

Migration nova:

- Índice `email_sends (sent_at desc, email_id desc)` para a paginação por cursor. Filtro de categoria ou tipo vira varredura da janela de datas pelo índice com filtro; no volume atual (milhares de linhas por mês) isso é aceito, e o antiobjetivo é só nunca varrer fora da janela. `email_sends_sent_at_idx` fica como está (a migration só cria o índice novo, nada é removido), então reverter nunca tira o índice que `email_metrics` usa no filtro de data.
- RPC `email_sends_list(p_start date, p_end date, p_categories text[], p_types text[], p_events text[], p_cursor_sent_at timestamptz, p_cursor_id text, p_limit int) returns jsonb`:
  - O período usa as mesmas regras de `email_metrics`: dia de São Paulo, erro se `p_end < p_start` ou se o intervalo passar de 365 dias, filtro direto em `sent_at` para usar o índice.
  - Arrays nulos ou vazios não filtram. `p_events` recebe os valores de `last_event`; o agrupamento por status é feito no frontend.
  - Cursor por chave: `(sent_at, email_id) < (p_cursor_sent_at, p_cursor_id)`, ordem `sent_at desc, email_id desc`. `p_limit` fica entre 1 e 100, padrão 50. A função busca `limit + 1` linhas para saber se há próxima página.
  - Devolve `{ items: [...], next_cursor: { sent_at, email_id } | null, types: [...] | null }`. O cursor é opaco: `sent_at` sai como o texto do jsonb (com microssegundos) e volta igual, sem passar por `Date` no Admin nem no edge, senão linhas empatadas se repetem ou somem.
  - `types` vem só na primeira página (sem cursor): a lista distinta de `{category, type}` do período, ignorando os filtros de tipo e status. É ela que alimenta o filtro de tipo no Admin, então o Admin não precisa duplicar o catálogo de `EMAIL_TYPES` (que também não cobre `desconhecido`, `alerta_interno` e `notificacao`, gravados pelo classificador por remetente). Cada item tem `email_id`, `sent_at`, `category`, `type`, `last_event`, `source`, `bounce_type`, `bounce_message`, `recipient_masked` e `subject`. `bounce_message`, `recipient_masked` e `subject` seguem as regras de `recent` em `email_metrics`: nulos com mais de 90 dias, destinatário mascarado como `a***@dominio`. `bounce_type` (Permanent, Transient, etc.) não é dado pessoal: o `email_sends_cleanup` também o mantém, então ele aparece sempre, como em `recent`.
- Testes psql no padrão de `supabase/tests/email_sends_rpcs.sql`: filtros, cursor sem repetir nem pular linha com `sent_at` empatado, limite, PII com mais de 90 dias nula, `authenticated` sem EXECUTE.

### Edge (`platform-admin`)

Ação nova `email-list`, ao lado de `email-metrics`. Ela valida e normaliza a entrada:
- datas `YYYY-MM-DD` reais, no máximo 365 dias de intervalo (pode reaproveitar `parseEmailMetricsRange`);
- categorias só das nove de `EMAIL_CATEGORY_LABELS` (lista em runtime no edge); status só dos valores de `last_event`; tipos pelo formato `^[a-z0-9_]{1,64}$`, sem catálogo, porque o classificador grava tipos fora de `EMAIL_TYPES`. Valor fora disso dá 400. No máximo 50 itens por array;
- cursor: `sent_at` passa por um regex de timestamp e segue como texto, sem normalizar;
- cursor com os dois campos ou nenhum;
- `limit` entre 1 e 100.

Depois chama a RPC. Testes Deno no padrão de `platform-admin-email-metrics_test.ts`.

### Admin

- `apps/admin/src/lib/api.ts`: `getEmailList(params)` e os tipos.
- Rota `emails/lista` no `router.tsx`, página `EmailsListPage`.
  - Os filtros vivem em `useSearchParams`: `preset`, `start`, `end`, `cat`, `type`, `status`.
  - `useInfiniteQuery` com chave própria, separada de `EMAIL_METRICS_KEY`. Sem prefetch.
- Filtros no topo:
  - o mesmo `SegmentedControl` de período e os campos de data do personalizado;
  - seleção múltipla para categoria, tipo e status, com os rótulos de `email-metrics-view.ts`;
  - "Limpar filtros".
- Desktop: tabela com Data e hora (São Paulo, `DD/MM/AAAA HH:mm`), Categoria, Tipo, Status (`Badge` do Admin, `tone` padrão: Entregue `success`, Atrasado `warning`, Pendente `neutral`, Bounce `danger`, Reclamação `danger`, Não enviado `neutral`; o rótulo do badge é o do grupo, e nas linhas de Não enviado o Detalhe diz se foi falha, supressão ou cancelamento), Detalhe e o link "Ver no Resend". O Detalhe mostra motivo, destinatário mascarado e assunto, só quando existem; o assunto vai truncado numa linha.
- O link "Ver no Resend" aponta para `https://resend.com/emails/<email_id>`, com o id em `encodeURIComponent`, `target="_blank"` e `rel="noopener noreferrer"`. Linhas importadas pelo backfill também têm id real do Resend.
- Phone: lista compacta, como `EmailsPhoneList`.
- Estados:
  - carregando: skeleton;
  - erro: `ErrorState` com tentar de novo;
  - sem resultado: "Nenhum e-mail com esses filtros" e o botão de limpar;
  - "Carregar mais" no fim, com "N e-mails carregados".
- Página E-mails: botão secundário "Ver lista completa" no cabeçalho, que é um `Link` para `/admin/emails/lista?preset=…` (caminho absoluto: `/emails/lista` cai no wildcard fora do Admin) (com `start`/`end` no personalizado), montado do estado local da página. Fica desabilitado enquanto o período personalizado for inválido. Nenhuma outra mudança.

## Deixado para o builder

- Componente exato da seleção múltipla: reaproveitar o que o Admin já tem, ou um `DropdownMenu` com checkboxes.
- Layout fino dos filtros no phone.
