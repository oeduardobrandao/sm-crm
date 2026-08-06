# Link de conexão do Instagram para o cliente final

**Data:** 2026-08-06
**Status:** aprovado, pronto para plano de implementação

## Problema

Hoje a única forma de conectar o Instagram de um cliente é o botão "Conectar Instagram"
na página do cliente, que leva o membro da agência ao fluxo OAuth do Instagram.

Esse fluxo é o **Instagram Business Login** (`instagram.com/oauth/authorize` →
`api.instagram.com/oauth/access_token` → `graph.instagram.com`). Ele autentica a
própria conta do Instagram: quem clica precisa estar logado no instagram.com como
aquela conta.

Boa parte das agências não tem o login do Instagram do cliente. Muitas têm apenas
acesso de administrador ao Meta Business do cliente, o que **não** concede sessão no
Instagram. Para essas agências o botão atual é intransponível, e a conta nunca é
conectada.

## Escopo

Gerar um link que a agência envia ao cliente. O cliente abre o link, sem login no
Mesaas, autoriza com o próprio Instagram, e a conta é vinculada ao `cliente` correto.

### Fora de escopo (explicitamente)

**Facebook Login for Business.** Existe um segundo caminho, via
`facebook.com/dialog/oauth`, em que um administrador do Meta Business conecta com o
próprio login do Facebook, sem envolver o cliente. Ele resolveria o mesmo problema por
outro ângulo, mas exige: superfície de API diferente (Graph API com `ig-user-id`
derivado de uma Página vinculada, e não `graph.instagram.com/me`), novas permissões
sujeitas a App Review da Meta, e tratamento de dois formatos de token em todas as
chamadas de sync, publish e insights do código. É uma iniciativa própria, com spec
própria. Decisão tomada em 2026-08-06: fazer o link agora, avaliar o caminho do
Facebook depois.

## Decisões de produto

| Decisão | Escolha |
|---|---|
| Onde o cliente cai | Rota pública no app CRM, identidade visual Mesaas (sem whitelabel) |
| Validade do link | 30 dias, reutilizável até ser revogado |
| Entrega | Botão de copiar link + envio por e-mail pelo Mesaas |
| Aviso à agência | Notificação in-app + e-mail para quem gerou o link |
| Revogação | Botão "Revogar" visível na página do cliente sempre que houver link ativo |

Sobre a validade: um link reutilizável de 30 dias é uma credencial de vida longa que
pode ficar parada num grupo de WhatsApp mesmo depois de o cliente já ter conectado.
A mitigação é tornar o link pendente **visível**: a página do cliente mostra
permanentemente que existe um link ativo, até quando ele vale, e o botão de revogar
ao lado. A agência não pode revogar o que não sabe que existe.

## Fluxo

### Lado da agência

Na seção de Instagram da página do cliente, ao lado de "Conectar Instagram", uma ação
secundária "Gerar link para o cliente". Abre um diálogo com a URL gerada, botão de
copiar, campo "Enviar por e-mail" pré-preenchido com o e-mail do cliente, a data de
validade e "Revogar".

Havendo link ativo, a seção de Instagram exibe uma linha compacta
("Link de conexão ativo até 05/09/2026") com a ação de revogar ali mesmo, sem precisar
abrir o diálogo.

### Lado do cliente

O cliente abre `https://app.mesaas.com.br/conectar/<token>`. Página com identidade
Mesaas, sem login. Ela diz de forma direta para qual conta serve ("Conectar o
Instagram de *Clínica X*, a pedido de *Agência Y*"), para que o cliente reconheça a
legitimidade do pedido, e traz um botão. O clique leva à tela normal de autorização do
Instagram. Na volta, uma tela de sucesso nomeando o `@username` conectado.

A página não expõe nenhum outro dado do Mesaas além desses dois nomes.

### Aviso de volta

Concluída a conexão, o membro que gerou o link recebe notificação in-app e e-mail.

## Modelo de dados

Tabela nova. Não é coluna em `clientes`: qualquer coluna nova naquela tabela fica
invisível ao CRM até ser adicionada ao `GRANT SELECT`, à view `clientes_v` e ao
`CLIENTS_SAFE_COLUMNS` (migration `20260728000002`), e este dado não pertence ao
registro do cliente de qualquer forma.

```sql
CREATE TABLE instagram_connect_links (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id  bigint NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  conta_id    uuid NOT NULL,
  token       uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  created_by  uuid NOT NULL,          -- membro; alimenta auditoria e notificação
  expires_at  timestamptz NOT NULL,   -- now() + 30 dias
  revoked_at  timestamptz,
  used_at     timestamptz,            -- última conexão bem-sucedida; não queima o link
  created_at  timestamptz NOT NULL DEFAULT now()
);
```

RLS espelhando `client_hub_tokens`: política de workspace sobre `conta_id` mais uma
política `service_role`.

Índice único parcial em `(cliente_id) WHERE revoked_at IS NULL AND expires_at > now()`
para que cada cliente tenha no máximo um link vivo, e "gerar" substitua em vez de
acumular linhas mortas.

Segunda mudança na mesma migration: estender `notifications_type_check` com
`instagram_connected_by_client`, copiando adiante a lista de 18 valores da definição
mais recente (`20260805000002_post_status_automations.sql`). Copiar uma lista antiga
quebra inserts mais novos.

**Versão da migration:** `20260806000002`. `20260806000001_atomic_rate_limit.sql` já
existe em `origin/main`. Reverificar o prefixo contra
`git ls-tree origin/main supabase/migrations | tail` no momento de abrir o PR: dois
arquivos com o mesmo prefixo de versão colidem em `schema_migrations` e o segundo é
silenciosamente ignorado. O job `migration-version-guard` do CI barra duplicatas.

## Segurança

Um link reutilizável de 30 dias é uma credencial real. O desenho abaixo é o que limita
o estrago.

- **O que o token concede, exatamente:** vincular uma conta do Instagram a um
  `cliente_id` específico. Nada mais. Não lê posts, briefing nem financeiro. O pior
  caso de um link vazado é um terceiro conectar o *próprio* Instagram ao registro
  daquele cliente, o que a agência vê de imediato e desfaz com "Desconectar".
- **`feature_instagram` é verificado no endpoint público** contra o `conta_id` do
  cliente, como `/auth/:clientId` já faz hoje. Workspace que faz downgrade para de
  emitir links que funcionam.
- **Revogação é real:** `revoked_at` é conferido em toda requisição pública e de novo
  no callback do OAuth, de modo que um link revogado no meio do fluxo não conclui.
- **Rate limit** no endpoint público de início, com chave por token, via o
  `checkRateLimit` existente. Cada início insere uma linha em `oauth_states`; sem
  limite o endpoint público vira amplificador de escrita.
- **O `state` do OAuth continua sendo a âncora de confiança.** O endpoint público
  chama o `createSignedState` existente, estendido com o token do link, assinado com a
  mesma chave HMAC. O callback verifica a assinatura, consome o nonce exatamente como
  hoje, e adicionalmente reconfere que a linha do link segue viva. O navegador do
  cliente nunca escolhe o `cliente_id`.
- **Auditoria:** a linha `instagram-link` já carrega `conta_id` e `actor_user_id`.
  Neste fluxo `actor_user_id` é o `created_by`, com `metadata.via = 'connect_link'`,
  para que a trilha distinga conexão feita pelo cliente de conexão feita pela agência.
- **CORS** por `buildCorsHeaders(req)`, nunca `*`. Erros nunca retornam detalhe cru ao
  cliente: mensagem genérica para fora, detalhe no log.

## Backend

### Edge function nova: `instagram-connect-link/`

Deploy com `--no-verify-jwt`, verificando a própria auth. Segue a divisão de
`hub-bootstrap`: `index.ts` só faz a fiação, `handler.ts` concentra as rotas com
dependências injetadas e é testável.

| Rota | Auth | Faz |
|---|---|---|
| `GET /?cliente_id=` | JWT | Link vivo atual, ou null |
| `POST /` | JWT | Revoga link vivo, cria outro, retorna `{ url, expires_at }` |
| `DELETE /` | JWT | Revoga |
| `POST /email` | JWT | Envia o link ao cliente por e-mail |

`POST /email` recebe o endereço no corpo da requisição (o diálogo pré-preenche com o
e-mail do cliente, mas o membro pode trocar, porque o contato do Instagram nem sempre
é o mesmo do cadastro). Validar o formato do endereço e aplicar `checkRateLimit` com
chave por `cliente_id`, teto de 5 envios por hora: sem isso o endpoint vira um relay
de e-mail apontável para qualquer destinatário por qualquer membro autenticado.
| `GET /public/:token` | nenhuma | `{ workspace_name, cliente_name, status }` e nada além |
| `POST /public/:token/start` | nenhuma | Gera o state assinado, retorna a URL de autorização |

Todas as rotas com JWT verificam a posse do workspace sobre o `cliente_id` antes de
qualquer coisa, no mesmo padrão de `verifyClientOwnership`.

**Por que uma função separada** e não mais seis ramos em `instagram-integration` (que
já tem 916 linhas): o contrato daquela função é "tudo aqui verifica JWT, exceto o
callback do OAuth". Acrescentar mais duas rotas não autenticadas ali é como um bypass
de autenticação acaba sendo escrito sem querer. Com a superfície pública em arquivo
próprio, as rotas sem auth são a primeira coisa que se vê ao abrir o arquivo.

### `_shared/instagram-connect-link.ts`

As partes puras, testáveis com `deno test` sem rede nem banco:

- `buildConnectUrl(baseUrl, token)`
- `connectLinkLive(row, now)` — o portão vivo/expirado/revogado
- `buildConnectLinkEmail(...)` — e-mail ao cliente
- `buildConnectedNoticeEmail(...)` — e-mail ao membro

### Mudanças no código existente (pequenas de propósito)

- `instagram-integration/oauth-state.ts`: `createSignedState` recebe um `linkToken`
  opcional; `verifySignedState` passa a devolvê-lo. Ausente significa o fluxo da
  agência, então states antigos em voo seguem verificando.
- `instagram-integration/index.ts`, no callback: reconferir que a linha do link segue
  viva antes do upsert, marcar `used_at`, gravar a notificação, enviar o e-mail ao
  membro, e redirecionar para `/conectar/:token?ig_connected=1` em vez de
  `/clientes/:id`. O ramo de erro redireciona para `/conectar/:token?ig_error=CODE`.
  `metadata.via = 'connect_link'` na auditoria.

## Frontend

### Página pública

`apps/crm/src/pages/conectar/ConectarPage.tsx`, com quatro estados: pronta para
conectar, já conectada, inválida ou expirada ou revogada, e pós-callback (sucesso ou
erro).

O mapeamento de código `ig_error` para orientação já existe dentro de
`ClienteDetalhePage.tsx`. Ele é extraído para um módulo compartilhado, para que as
duas páginas deem a mesma orientação em vez de a página pública ganhar uma segunda
cópia que diverge em silêncio.

### Rota pública: três arquivos que precisam concordar

Sem os três a rota funciona em dev e dá 404 em produção.

- `App.tsx`: `/conectar/:token` **fora** do `ProtectedRoute`
- `apps/crm/src/content/site-meta.ts`: `conectar` em `APP_ROUTE_PREFIXES`
- `vercel.json`: `conectar` no padrão nomeado de rotas

`vercel-routing.test.ts` já garante a coerência entre os dois últimos.

### Lado da agência

- `components/instagram/ConnectLinkDialog.tsx`, componente próprio em vez de mais
  linhas em `ClienteDetalhePage.tsx`, que já passa de 2.600. O diálogo contém o campo
  da URL, copiar, "Enviar por e-mail", a validade e "Revogar".
- Linha compacta na seção de Instagram quando existe link ativo, com validade e
  revogar.
- `services/instagram.ts`: `getConnectLink`, `createConnectLink`, `revokeConnectLink`,
  `emailConnectLink`.
- `lib/notification-config.ts`: cópia, ícone e link de destino para
  `instagram_connected_by_client`.
- Strings de i18n para tudo acima.

**Convenção de cópia:** nada de travessão (—) em texto visível ao usuário, nem na
interface nem nos dois e-mails. Usar ponto, dois-pontos ou "·".

## E-mails

**Ao cliente.** Enviado pelo Mesaas via Resend, com `reply-to` no endereço do membro
que gerou o link, para que um cliente confuso responda à agência e não ao vazio.

Vale nomear o risco: o cliente recebe e-mail de um domínio com o qual não tem relação
nenhuma, exatamente no momento em que está sendo convidado a autorizar uma conta. Isso
tem formato de phishing. A cópia precisa liderar com o nome da agência e o nome do
próprio cliente, e o `reply-to` importa mais do que o normal aqui. Se a entregabilidade
se mostrar ruim, o link copiado continua sendo o caminho principal e nada quebra.

**Ao membro.** "Cliente X conectou o Instagram (@username)."

## Testes

**Deno, puros**

- portão vivo / expirado / revogado
- construção da URL
- os dois templates de e-mail

**Deno, handler com fakes**

- workspace errado é rejeitado
- `feature_instagram` desligado é rejeitado
- link revogado é rejeitado no `/start`
- rate limit dispara
- `GET /public/:token` não devolve nada além dos dois nomes

**Deno, round-trip do state**

- o campo novo sobrevive a assinar e verificar
- um state sem o campo continua verificando (compatibilidade)

**Vitest**

- `ConectarPage` renderiza os quatro estados
- as quatro funções de serviço
- a entrada nova em `notification-config`

**Navegador, em staging**

- o caminho completo numa janela anônima, único lugar onde a afirmação "não precisa de
  login" fica de fato provada

## Deploy

- `npx supabase db push --linked` (staging e prod), conferindo antes o prefixo da
  migration
- `npx supabase functions deploy instagram-connect-link --no-verify-jwt --use-api`
- `npx supabase functions deploy instagram-integration --no-verify-jwt --use-api`
- CRM via merge (Vercel)

Sem variáveis de ambiente novas. O envio de e-mail usa a infraestrutura Resend já
existente; a base da URL vem de `OAUTH_REDIRECT_BASE` / `appBaseUrl()`.
