# Fotos de perfil da equipe

Data: 2026-10-21. Status: rascunho para aprovação.

## Por quê

Hoje toda pessoa da equipe aparece como um círculo de iniciais no CRM. Com o chat de
equipe (#436) isso ficou mais visível: numa DM, numa lista de responsáveis ou num filtro
de Entregas, as iniciais não ajudam a reconhecer quem é. O pedido é que cada membro possa
ter uma foto, e que essa foto apareça em todo lugar onde hoje aparecem as iniciais.

## Decisões do usuário

- **Quem define a foto:** cada pessoa define a própria (Configurações → Perfil), e
  owners/admins podem definir a de qualquer membro pela página Equipe, inclusive de
  membros sem login no CRM. ("Admins" aqui = quem tem a permissão `equipe:editar`, o
  mesmo limite que a Equipe já usa; ver Escrita.)
- **Onde aparece:** só no CRM. O Hub (portal do cliente) continua mostrando iniciais.

## Objetivos

1. Upload, troca e remoção de foto em dois lugares: Configurações → Perfil (a própria) e
   a página Equipe / detalhe do membro (owner/admin, de qualquer membro).
2. Uma pessoa tem **uma** foto: a mesma aparece na barra lateral, na Equipe, em Entregas,
   em Tarefas, nos filtros, nas menções, nos comentários, na Agenda, no chat de equipe e
   no feed de mensagens de clientes.
3. Onde não há foto, nada muda: iniciais com a cor de sempre.

## Não-objetivos

- Fotos no Hub. A única superfície de equipe no Hub (`apps/hub/src/pages/MensagensPage.tsx`)
  passa a receber `author_avatar_url = null` e segue com iniciais.
- Recorte manual (arrastar/zoom). O corte é automático, centralizado.
- Limpeza dos arquivos antigos no storage quando a foto é trocada ou removida (o upload de
  foto de cliente também não limpa; fica como follow-up único para os dois).
- Foto de clientes, logo de workspace: já existem e não mudam.

## Antiobjetivos (falharia mesmo "funcionando")

- A mesma pessoa com fotos diferentes em telas diferentes do CRM.
- Um agente conseguir trocar a foto de outro membro.
- Foto da equipe vazando para o Hub.
- Um upload no meio de um deploy silencioso sendo cortado (usar o mesmo
  `holdUnsavedWork()` do upload de foto de cliente).

## Estado atual (fatos levantados)

- Colunas: `profiles.avatar_url` (pessoa com login) e `membros.avatar_url` (registro da
  equipe; pode não ter login). `membros.crm_user_id` liga um membro a um login, no máximo
  um por conta (índice único parcial, `20260923000003`). Ambas as colunas existem e quase
  nunca são preenchidas; a criação de membro grava `avatar_url: ''`.
- `profiles.avatar_url` **não tem caminho de escrita pelo cliente**: o lockdown
  `20260729000002_profiles_write_lockdown.sql` re-concede UPDATE só em seis colunas e tem
  uma pós-condição que exige exatamente esse conjunto.
- `membros.avatar_url` tem GRANT UPDATE, mas a RLS de UPDATE em `membros` é só "mesma
  conta": hoje qualquer agente poderia escrever nela.
- Leitores que já mostram imagem se houver URL: Agenda (via `profiles`), menções e tabela
  de equipe de Analytics de fluxos (via `membros`), comentários de post (via `profiles`,
  fallback `membros`), chat de equipe (RPCs com `COALESCE(mb.avatar_url, p.avatar_url)`),
  feed de mensagens de clientes (`get_mensagens_feed`, só `membros.avatar_url`).
- Leitores só de iniciais (precisam passar a mostrar a foto): barra lateral e menu
  "mais" do celular, Configurações → Perfil e Membros (desktop e celular), Equipe e
  detalhe do membro (desktop e celular), Entregas (cards de fluxo/post, kanban, filtro de
  responsável, painel de responsáveis, menus de atribuir no celular), Tarefas (card,
  detalhe, lista, peças do celular) e Dashboard (Hoje / Início prazos, que hoje descartam
  o `avatar_url` antes de chegar no componente).
- Upload de foto de cliente (`ClienteAvatarUpload.tsx` + `clienteFoto.ts`): bucket público
  `avatars`, caminho `clientes/{id}/{uuid}.png`, URL pública gravada na coluna, policies
  de storage restritas a owner/admin por prefixo de caminho.

## Desenho

### Modelo: uma foto por pessoa

- **Pessoa com login** (há `profiles`): a foto dela é `profiles.avatar_url`.
- **Membro sem login:** a foto é `membros.avatar_url`.
- **Membro ligado a um login** (`crm_user_id` preenchido): `membros.avatar_url` é sempre
  uma **cópia** de `profiles.avatar_url` daquele login. Quem mantém a cópia é o banco
  (função de definição, abaixo), não o cliente.

Com isso, todo leitor que já lê `membros.avatar_url` ou `profiles.avatar_url` passa a
mostrar a mesma foto sem mudar a consulta, e os `COALESCE` existentes continuam certos.

### Escrita: uma RPC

`set_member_photo(p_membro_id bigint, p_user_id uuid, p_path text)` — SECURITY DEFINER,
exatamente um alvo preenchido; `p_path = null` remove. Com o par
`REVOKE ALL ... FROM PUBLIC, anon; GRANT EXECUTE ... TO authenticated` padronizado em
`20260925000001_lockdown_definer_function_grants.sql`.

**Quem pode** (minha decisão): o mesmo limite que a página Equipe já usa para editar
membros, `has_permission_for(conta, 'equipe', 'editar')`, e não `role IN ('owner','admin')`.
Owners e admins têm essa permissão por padrão; um cargo personalizado com "editar equipe"
também pode, como já pode editar nome, cargo e login do membro. O botão de câmera na UI
segue o mesmo `can('equipe','editar')`.

- **Alvo `p_user_id`** (a própria foto): permitido só se `p_user_id = auth.uid()`. Grava
  `profiles.avatar_url` e copia para os `membros` com `crm_user_id = p_user_id` **nas
  contas em que a pessoa ainda está** (`workspace_members`). Registros de contas que ela
  já deixou ficam com a cópia que tinham (minha decisão).
- **Alvo `p_membro_id`** (pela Equipe, com `equipe:editar` na conta do membro): se o
  membro tem `crm_user_id` **e esse login ainda é membro desta conta**, a escrita vai para
  o `profiles.avatar_url` desse login e para as cópias dele nas contas atuais (uma pessoa,
  uma foto). Se o membro não tem login, ou o login já saiu da conta, grava só
  `membros.avatar_url` deste registro: o admin de uma conta que a pessoa deixou não mexe
  mais na foto global dela.
- **Validação do arquivo, sem confiar em URL do cliente:** a RPC recebe o **caminho** no
  storage, não a URL. Exige que exista um objeto em `storage.objects` com
  `bucket_id = 'avatars'`, `name = p_path` e `owner = auth.uid()`, e que o caminho esteja
  sob o prefixo **do alvo da chamada**: alvo `p_user_id` aceita só
  `profiles/{uid}/`; alvo `p_membro_id` aceita só `membros/{id}/`, **inclusive quando o
  membro tem login** (o admin envia para `membros/{id}/...`, o prefixo que a policy dele
  permite, e a mesma URL vai para o perfil e as cópias). A URL gravada é montada pela
  própria RPC: `project_url` do Vault (o mesmo segredo que os crons já usam) +
  `/storage/v1/object/public/avatars/` + caminho. Assim nem host nem caminho vêm do
  cliente. A suíte de entitlements precisa semear `project_url` no Vault local.
- Grava `NULL`, nunca `''`, e normaliza `''` existentes para `NULL` na migration (o
  `COALESCE` do chat não cai no perfil quando o membro tem `''`). Os writers que hoje
  inserem `avatar_url: ''` passam a omitir a coluna: `MembroFormDialog.tsx`, a importação
  em `EquipePage.tsx` e `supabase/functions/mcp/queries.ts` (o teste
  `__tests__/mcp-import_test.ts` que fixa `""` muda junto, assim como os testes do CRM que
  fixam `''`: `store.crud-writes.test.ts`, `EquipePage.test.tsx`,
  `ResponsaveisPanel.test.tsx`). `Membro.avatar_url` em `store/team.ts` vira
  `string | null`.

**Fechar a escrita direta em `membros.avatar_url`:**

- Tirar a coluna do GRANT UPDATE de `membros` (o comentário de `20260430000001` lista esse
  GRANT; manter `MEMBRO_SAFE_COLUMNS` de leitura).
- O INSERT também é um buraco: `membros_insert` é só "mesma conta" e não restringe
  colunas, então um agente poderia criar um membro com `avatar_url` apontando para
  qualquer host (o mesmo buraco que `20260817000001` fechou para `clientes.foto_url`). Um
  trigger BEFORE INSERT em `membros` força `NEW.avatar_url := NULL` para qualquer papel
  que não seja `service_role`, e `NULLIF(NEW.avatar_url, '')` para o `service_role`. Isso
  também absorve qualquer writer de `''` que sobrar. Atenção: não copiar o formato de
  `enforce_cliente_foto_owner_admin` para UPDATE, porque dentro de uma função SECURITY
  DEFINER `auth.role()` continua `'authenticated'` e o trigger bloquearia a própria RPC.
- `profiles` não ganha GRANT: a pós-condição do lockdown continua valendo.

**Vínculo e desvínculo de login.** Há três caminhos que preenchem `membros.crm_user_id`:
`set_membro_crm_user`, o passo de vínculo de `accept_workspace_invite` e
`supabase/functions/_shared/invite-actions.ts` (≈ linha 454, com o client admin, quando um
login existente é adicionado à conta). Em vez de mexer nos três, um trigger em `membros`
(BEFORE UPDATE OF `crm_user_id`) cobre todos:

- Ligou (`OLD.crm_user_id IS NULL`, `NEW` preenchido): se o perfil tem foto, ela vai para
  o membro; se o perfil não tem e o membro tem, a foto do membro sobe para o perfil.
- **Religou para outra pessoa** (`OLD` e `NEW` preenchidos e diferentes): o membro recebe
  a foto do novo perfil, ou `NULL` se ele não tiver. A foto do membro **nunca** sobe nesse
  caso, senão o rosto da pessoa anterior iria para o perfil da nova.
- Desligou (`NEW` nulo): o membro fica com a cópia que tinha.

### Storage

Mesmo bucket público `avatars`. Novas policies de INSERT para `authenticated`:

- `profiles/{auth.uid()}/{arquivo}` — a própria pessoa.
- `membros/{membro_id}/{arquivo}` — quem tem `equipe:editar` na conta do membro.

Um login que não tem registro em `membros` na conta (ex.: o owner, ou um convidado ainda
não ligado a um membro) não aparece na página Equipe, então só ele mesmo define a foto,
pelo Perfil. Admin não ganha um alvo "login sem membro" (minha decisão). Configurações →
Membros passa a mostrar a foto, mas não ganha upload.

Nome do arquivo sempre novo (`{uuid}.jpg`), sem upsert, igual à foto de cliente.

### Processamento da imagem (cliente)

**Helper novo** (não reaproveitar `resizeClientePhoto`: ele desenha a imagem inteira num
canvas quadrado, esticando fotos não quadradas, e sai em PNG): **corte quadrado
centralizado**, lado máximo 512px, saída JPEG
qualidade ~0,85. Aceita JPEG, PNG, WebP e HEIC quando o navegador decodifica
(`createImageBitmap`); limite de entrada 10MB, já que a imagem é reduzida antes do envio
(fotos de celular passam fácil de 2MB). Mensagens de erro em português, sem travessão.

### UI

Um componente compartilhado **`PessoaAvatar`** (`apps/crm/src/components/PessoaAvatar.tsx`):
recebe `nome`, `fotoUrl`, `seed` da cor e tamanho; mostra a foto (`object-fit: cover`,
`onError` volta para iniciais) ou as iniciais com `avatarColorClass(seed)`. O estado de
erro é zerado quando `fotoUrl` muda, senão uma foto que falhou antes deixaria a nova
(recém-enviada) escondida atrás das iniciais até o componente desmontar.

**Todas** as superfícies de avatar de pessoa da equipe passam a usar `PessoaAvatar` nesta
entrega, tanto as "só iniciais" quanto as que já mostram imagem com implementação própria:
Agenda (`AgendaSidebar`, `AgendaFiltrosSheet`, `PessoasCombobox`, `EventoPopover`),
menções (`MentionList`), comentários de post (`PostCommentPopover`), tabela de equipe de
Analytics de fluxos (desktop e celular), chat de equipe (`EquipeConversaAvatar`, bolhas
de `EquipeThread`/`EquipeThreadPhone`, `NovaConversaDialog`, `EquipeDetalhesSheet`) e o
`AutorAvatar` do feed de mensagens de clientes (só o lado da equipe; o avatar do cliente
segue como está). Assim o fallback para iniciais é o mesmo em todo lugar. O Dashboard
precisa carregar o `avatar_url` até os componentes (`todayAgenda.ts` hoje tipa o
responsável só com `{id, nome}`).

Corrigir de carona o fallback de comentário de post: `PostCommentPopover.resolveAuthor`
procura o membro por `membros.user_id` (quem criou o registro), não por `crm_user_id`.

Pontos de edição (um componente de upload compartilhado, no espírito de
`ClienteAvatarUpload`: avatar grande com botão de câmera, "Alterar foto" / "Remover foto"
com confirmação):

- **Configurações → Perfil** (desktop e celular): a própria foto. Sempre visível.
- **Detalhe do membro e Equipe** (desktop e celular): visível só para owner/admin. No
  celular, pela ação "…" do membro, como a foto de cliente.
- O formulário de criar/editar membro (`MembroFormDialog`) **não** ganha upload; a foto é
  definida depois, no detalhe (mantém o diálogo simples).

Depois de salvar, invalidar as consultas que carregam fotos: `['membros']`,
`['workspace-users']`, o perfil do `AuthContext` (recarregar `profile`) e as do chat de
equipe (`['equipe-conversas']`, `['equipe-mensagens']`, `['equipe-chat-members']`).
Declarar `avatar_url` na interface `Profile` do `AuthContext`.

### Hub

Duas camadas, para a foto não voltar a vazar por um campo só:

- `supabase/functions/hub-mensagens/handler.ts` passa a devolver `author_avatar_url: null`
  para todo item (o RPC `get_mensagens_feed` continua igual, porque o CRM usa a foto), com
  um caso em `supabase/functions/__tests__/hub-mensagens_test.ts` afirmando o null.
- `apps/hub/src/pages/MensagensPage.tsx` para de renderizar `<img>` para autor da equipe
  mesmo que o campo venha preenchido; o teste `mensagensPage.test.tsx` que hoje afirma a
  imagem passa a afirmar as iniciais.

O Hub não tem outro ponto de foto de equipe (`hub-ideias` lê só `membros(nome)`;
`hub-agenda` e `hub-posts` não leem campos de avatar).

## Restrições

- Convenções do repo: `lucide-react`, `sonner`, `holdUnsavedWork`/`useUnsavedWork` no
  upload, nunca `useBlocker`; copy em português, sem travessão.
- Migration com versão acima do tail de main na hora de abrir o PR.
- Deploy: migration e a function `hub-mensagens` antes do merge (o frontend sobe no merge).
- Os testes de entitlements/RLS em `supabase/tests/entitlements/*.sql` rodam no CI
  (precedentes: `66_cliente_foto_owner_admin.sql`, `20_storage_rpcs.sql`). Casos: self ok;
  `equipe:editar` ok; agente sem a permissão negado; outra conta negada; caminho fora do
  prefixo negado; caminho sem objeto no storage negado; objeto de outro dono negado;
  sincronização perfil → membros só nas contas atuais; admin de conta que a pessoa deixou
  grava só no membro; INSERT de membro com `avatar_url` vira NULL; UPDATE direto da coluna
  negado; ligar copia/sobe a foto; religar não sobe a foto antiga.

## Deixado para quem constrói

- Nome exato da RPC e dos helpers; se o upload chama a RPC direto ou via `store/`.
- Tamanho do avatar em cada superfície (seguir o que cada uma usa hoje).
- Ordem de fatias do plano (sugestão: banco + RPC + storage, depois upload, depois as
  superfícies).
