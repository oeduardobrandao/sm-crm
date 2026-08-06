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

A página não expõe nenhum outro dado do Mesaas além desses dois nomes, mais o
`@username` já conectado quando existe um. Esse terceiro campo é necessário para a tela
"já está conectado" e para a tela de sucesso, ambas descritas acima. Consequência a
registrar: quem tiver um link vazado descobre o handle do Instagram conectado. O handle
é público no próprio perfil do Instagram, então a exposição é baixa, mas é mais do que
"apenas os dois nomes".

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
  created_by  uuid NOT NULL,          -- auth.users.id, NÃO membros.id
  expires_at  timestamptz NOT NULL,   -- now() + 30 dias
  revoked_at  timestamptz,
  used_at     timestamptz,            -- última tentativa que passou o portão; não queima o link
  created_at  timestamptz NOT NULL DEFAULT now()
);
```

RLS espelhando `client_hub_tokens`: política de workspace sobre `conta_id` mais uma
política `service_role`.

`created_by` é o `auth.users.id` de quem gerou o link, e não o `membros.id`
(`membros.id` é `bigserial`; `membros.user_id` é que é o uuid). É esse identificador
que `oauth_states.initiated_by`, `audit_logs.actor_user_id` e `notifications.user_id`
esperam. **Sem FK para `auth.users`**: `notifications.user_id` tem
`ON DELETE CASCADE`, e não queremos que remover um membro apague links de conexão
pendentes de clientes. Se esse usuário tiver sido removido entre a geração e o
callback, a conexão é concluída normalmente e a notificação e o e-mail são pulados,
com um log. O upsert do `instagram_accounts` nunca depende de quem gerou o link.

### Unicidade do link vivo

Índice único parcial em `(cliente_id) WHERE revoked_at IS NULL`.

O predicado **não pode** incluir `expires_at > now()`: predicado de índice parcial no
PostgreSQL exige funções `IMMUTABLE`, e `now()` é `STABLE`, então a criação do índice
falha. Além disso um índice não reavalia o predicado com a passagem do tempo, de modo
que "expirado" nunca sairia dele sozinho.

Logo, "vivo" tem duas metades e cada uma é enforçada num lugar:

- **Persistido:** `revoked_at IS NULL`, garantido pelo índice único.
- **Em tempo de leitura:** `expires_at > now()`, avaliado por `connectLinkLive(row, now)`
  em toda leitura e no portão do callback.

Uma linha expirada mas não revogada continua ocupando o slot único. Por isso o caminho
de criação revoga antes de inserir.

### Geração concorrente

`POST /` faz revogar-e-inserir em uma **RPC `SECURITY DEFINER`** em vez de duas
chamadas do edge function, seguindo o padrão de operações atômicas já usado no
repositório (`hub_atomic_post_schedule_reorder`, migration `20260701000001`):

A RPC faz, nesta ordem: valida a posse do cliente, toma um **advisory lock de
transação** com namespace, chaveado no `cliente_id`, e só então decide o que fazer.

Confiar apenas no índice único não bastava. Duas abas clicando em "Gerar" ao mesmo
tempo produziam um resultado **não determinístico**: a segunda transação espera o
UPDATE da primeira, e se ela enxerga ou não a linha recém-inserida depende do snapshot
do statement e da ordem física da varredura. Às vezes colide em `23505` e o handler
relê o link vivo, o que é correto. Às vezes revoga a linha nova da primeira e insere a
sua, e aí a resposta da PRIMEIRA aba carrega um token já revogado: a agência copia e
envia um link morto.

Com o lock, as chamadas concorrentes para o mesmo cliente serializam de verdade. E,
já com o lock na mão, a RPC **devolve o link vivo existente** em vez de rodá-lo:

- existe link vivo (`revoked_at IS NULL AND expires_at > now()`) → devolve esse mesmo,
  sem revogar e sem inserir;
- não existe → revoga as linhas não revogadas mas expiradas, que ainda ocupam o slot
  do índice único, e insere uma nova.

Convergir num único token é o comportamento certo para esta interface, não uma
mudança de semântica: o botão "Gerar" só aparece quando NÃO há link vivo
(`ConnectLinkDialog.tsx`), então nenhum caminho de produto pede para rodar um link
que está vivo. Rodar continua disponível como "Revogar" seguido de "Gerar".

Não se usa `SELECT ... FOR UPDATE` em `clientes`: é uma tabela muito escrita e travar
linha nela arrisca deadlock contra transações que tocam `clientes` em outra ordem. O
advisory lock não interage com o grafo de locks de ninguém.

O tratamento de `23505` no handler continua no lugar, agora como defesa em
profundidade, não como o caminho concorrente esperado.

A RPC valida `p_conta_id` contra o `conta_id` do cliente internamente, para não
depender só do handler.

Segunda mudança na mesma migration: estender `notifications_type_check` com
`instagram_connected_by_client`, copiando adiante a lista da definição mais recente,
`20260805000002_post_status_automations.sql`, que tem **18** valores (conferido:
`sed -n '104,118p' ... | grep -o "'[a-z_]*'" | wc -l` → 18, e o
`NotificationType` em `apps/crm/src/store/notifications.ts` tem os mesmos 18). O total
passa a 19. Copiar uma lista antiga quebra inserts dos tipos mais novos, então
recontar no momento de escrever a migration em vez de confiar neste número.

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
- **Revogação é real, e o portão é atômico.** Uma simples releitura de `revoked_at`
  antes do upsert não basta: a revogação pode cair entre a leitura e o
  `upsert(instagram_accounts)`, que substitui a conta por `client_id`. O portão é um
  UPDATE condicional com `RETURNING`, exatamente o padrão que o próprio callback já usa
  para consumir o nonce do `oauth_states` ([index.ts:171](supabase/functions/instagram-integration/index.ts#L171)):

  ```sql
  UPDATE instagram_connect_links
     SET used_at = now()
   WHERE token = $1 AND revoked_at IS NULL AND expires_at > now()
  RETURNING cliente_id, conta_id, created_by;
  ```

  Zero linhas retornadas aborta antes de tocar `instagram_accounts`. Isso é uma única
  operação atômica no banco, não uma leitura seguida de escrita. A janela restante
  ("revogação commitada depois deste UPDATE") é inevitável em qualquer desenho que não
  segure um lock durante o ida-e-volta com a Meta, e nesse ponto a conexão é
  genuinamente concorrente com a revogação, não um bypass.

  Consequência de semântica: `used_at` passa a significar "última tentativa que passou
  o portão", não "última conexão bem-sucedida". Se o upsert seguinte falhar, `used_at`
  fica marcado mesmo assim. É a troca certa: o portão precisa vir antes da escrita.
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
- `instagram-integration/index.ts`, no callback: rodar o UPDATE condicional do portão
  (ver Segurança) imediatamente **antes** do `upsert(instagram_accounts)`, abortando se
  não retornar linha; gravar a notificação, enviar o e-mail ao membro, e redirecionar
  para `/conectar/:token?ig_connected=1` em vez de `/clientes/:id`. O ramo de erro
  redireciona para `/conectar/:token?ig_error=CODE`, incluindo o caso "link revogado
  durante o fluxo", que ganha seu próprio código. `metadata.via = 'connect_link'` na
  auditoria. Notificação e e-mail são melhor-esforço: falha neles não pode desfazer
  nem bloquear uma conexão já persistida.

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
- `store/notifications.ts`: `NotificationType` é uma união fechada de 18 literais.
  Acrescentar o valor **ali primeiro**, senão a entrada nova em `notification-config.ts`
  não compila e o dado que vem do backend fica fora do contrato tipado.
- `lib/notification-config.ts`: cópia, ícone e link de destino para
  `instagram_connected_by_client`.

Os três lugares que precisam concordar sobre o tipo novo, e falham de formas
diferentes se não concordarem: o `notifications_type_check` no banco (insert falha), o
`NotificationType` no store (não compila), e o `notification-config.ts` (renderiza em
branco).
- Strings de i18n para tudo acima.

**Convenção de cópia:** nada de travessão (—) em texto visível ao usuário, nem na
interface nem nos dois e-mails. Usar ponto, dois-pontos ou "·".

## E-mails

**Ao cliente.** Enviado pelo Mesaas via Resend, com `reply-to` no endereço do membro
que gerou o link, para que um cliente confuso responda à agência e não ao vazio. O
endereço vem de `auth.users` via a Auth admin API (`getUserById`), não de `profiles`:
a tabela `profiles` não tem coluna de e-mail.

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
- **link revogado entre o `/start` e a persistência do callback**: o UPDATE condicional
  não retorna linha e o `upsert(instagram_accounts)` não acontece. É o teste que
  sustenta a afirmação "revogação é real"
- link expirado mas não revogado é rejeitado, cobrindo a metade da liveness que o
  índice único não enforça
- **`feature_instagram` perdido entre o `/start` e o callback**: a entitlement é
  reconferida no callback, contra o `conta_id` do link consumido, e não só ao iniciar.
  O state vive 10 minutos, e um downgrade dentro dessa janela não pode terminar em
  conta ativa gravada para um workspace sem o feature
- `POST /` concorrente: o segundo colide no índice único e o handler devolve o link
  vivo em vez de propagar erro
- geração quando já existe link vivo DEVOLVE o mesmo link, sem rodá-lo (ver "Geração
  concorrente"). Só revoga quando a linha existente está expirada. Duas abas clicando
  em "Gerar" convergem num único token, em vez de uma delas ficar com um token morto
- callback cujo `created_by` não existe mais conclui a conexão e pula a notificação
- rate limit dispara, no `/start` e no `/email`
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

- Acrescentar `[functions.instagram-connect-link] verify_jwt = false` em
  `supabase/config.toml`. É ali que o repositório versiona esse padrão para as 20+
  functions equivalentes; a flag no comando de deploy sozinha não fica registrada.
- `npx supabase db push --linked` (staging e prod), conferindo antes o prefixo da
  migration
- `npx supabase functions deploy instagram-connect-link --no-verify-jwt --use-api`
- `npx supabase functions deploy instagram-integration --no-verify-jwt --use-api`
- CRM via merge (Vercel)

### Qual base de URL usar

Duas variáveis, e trocá-las tem consequência real:

| Uso | Variável |
|---|---|
| Link gerado (copiar, e-mail ao cliente) | `appBaseUrl()`, isto é `APP_BASE_URL` |
| Redirect do callback OAuth de volta ao `/conectar/:token` | `OAUTH_REDIRECT_BASE` |

`appBaseUrl()` existe exatamente para isso e o comentário dela é explícito:
`OAUTH_REDIRECT_BASE` significa "para onde a Meta manda o callback", e acoplar as duas
faria uma mudança de OAuth reescrever em silêncio links já enviados a clientes. O link
público é conteúdo de e-mail para cliente final, então é `APP_BASE_URL`.

Nenhuma variável nova, mas **`APP_BASE_URL` passa a ser obrigatória de fato** para esta
feature em ambos os ambientes. Ela já é usada por `resolveHubUrl` e por
`notifyOwnerOfFailure`, ambos embrulhados em try/catch que degradam em silêncio. Aqui
não: se faltar, a geração de link falha alto, com erro visível à agência, em vez de
produzir uma URL de localhost e mandá-la ao cliente. Conferir que as duas apontam para
a mesma origem em produção, senão o cliente sai de um host e volta em outro.

O envio de e-mail usa a infraestrutura Resend já existente.
