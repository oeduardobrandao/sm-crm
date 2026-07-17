# Enriquecer artigos de suporte com screenshots

**Data:** 2026-07-16
**Branch:** `claude/support-articles-screenshots-8b4dab`
**Status:** Design aprovado — pronto para plano de implementação

## Problema

Os 28 artigos da base de conhecimento são 100% texto. Nenhum contém imagem; nenhum tem `cover_image_url`. Artigos como `como-usar-o-post-express` pedem "Confira o preview e publique" sobre algo que o leitor não consegue ver, e `como-conectar-o-claude-mcp` atravessa dois produtos diferentes instruindo "deixe os campos de OAuth em branco" — uma instrução contraintuitiva que, só em texto, o usuário não confia.

Objetivo: adicionar screenshots reais aos artigos procedurais, de forma que rendam permanentemente para qualquer leitor.

## Descobertas que moldam o design

### 1. O leitor já suporta imagens — nenhuma mudança de schema ou renderer é necessária

`ArtigoPage.tsx:53-68` monta um TipTap read-only que já registra `createInlineImageExtension`. O nó `inlineImage` existe com os atributos `{ r2Key, src, blurSrc, alt, width, height, displayWidth, loading }` (`InlineImageExtension.tsx:234-245`).

O corpo do artigo é **TipTap/ProseMirror JSON numa coluna `jsonb`** (`kb_articles.content`) — não é markdown, não é HTML. Não existe parser de markdown nem `dangerouslySetInnerHTML` em nenhum ponto do caminho. Sintaxe `![]()` renderizaria como texto literal.

### 2. Bug crítico: imagens no corpo expiram em ~1 hora

Este é o motivo pelo qual o design abaixo não usa o caminho de upload existente.

Uploads são escopados por tenant (`file-upload-url/handler.ts`):

```ts
const r2_key = `contas/${profile.conta_id}/files/${fileId}.${ext}`;
```

Mas `sign-r2-urls` só assina duas classes de chave (`sign-r2-urls/handler.ts:99-113`):

```ts
const prefix = `contas/${resolved.contaId}/`;
const ownKeys = body.keys.filter((k) => k.startsWith(prefix));
const otherKeys = body.keys.filter((k) => !k.startsWith(prefix));

let kbKeys: string[] = [];
if (otherKeys.length > 0) {
  const { data: kbRows } = await svc
    .from("kb_articles")
    .select("cover_image_url")          // ← SÓ CAPA. Imagens do corpo nunca consultadas.
    .eq("status", "published")
    .in("cover_image_url", otherKeys);
  if (kbRows) kbKeys = kbRows.map((r) => r.cover_image_url);
}
const validKeys = [...ownKeys, ...kbKeys];
```

Uma imagem de corpo enviada por um admin cai em `contas/<ADMIN_CONTA>/files/<uuid>.png`. Para um leitor de outra conta, essa chave (a) não bate com o prefixo da própria conta e (b) não está em `cover_image_url` — está enterrada dentro do JSONB `content`. É silenciosamente filtrada de `validKeys`.

`injectSignedUrls` então deixa o nó intacto (`inlineImage.ts:118-131` — a guarda `urlMap[node.attrs.r2Key]` falha), e o `src` permanece o URL pré-assinado gravado na autoria, que expira em `expiresSeconds = 3600` (`_shared/r2.ts:46`).

**Efeito:** a imagem renderiza por ~1 hora depois de salvar e depois dá 403 para sempre. Passa no smoke test da autoria e só quebra no dia seguinte.

A exclusão é **deliberada**, não acidental — o comentário de design em `sign-r2-urls/handler.ts:59-60` afirma a premissa: *"Own-conta keys only: kb covers are for public `<img>` display and never need byte-level access."* A extensão de imagem inline foi herdada inteira de `entregas`, onde funciona porque autor e leitor compartilham a conta.

### 3. `r2Key: null` contorna tudo isso — verificado

- O node view desestrutura apenas `{ src, blurSrc, loading, width, height, displayWidth }` — **nunca lê `r2Key`**.
- `extractR2Keys` só coleta quando `node.attrs?.r2Key` é truthy — com `null`, nenhuma chamada de assinatura acontece.
- `injectSignedUrls` tem a mesma guarda — deixa `src` intacto.

Logo, um nó `inlineImage` com `r2Key: null` e um `src` público permanente renderiza **sem nenhuma mudança de código no leitor**.

### 4. Precedente forte para bucket público

`avatars`, `post-media` e `instagram-posts` são todos buckets públicos do Supabase Storage. `20260319_avatars_bucket.sql` é o análogo exato: assets cacheados, não escopados por tenant, escritos por service role, lidos por qualquer um.

### 5. A migration que vence é a `20260520000001`

`20260520000001_expand_kb_help_center.sql` faz upsert (`ON CONFLICT (slug) DO UPDATE`) dos 12 artigos do seed `20260519000002`, que usa `DO NOTHING`. O seed original só vence num banco novo e é imediatamente sobrescrito. **Todo conteúdo deve ser autorado contra a `expand`**, não contra o primeiro seed. Idem: `20260625000002` substitui integralmente `o-que-o-agente-pode-fazer`.

## Decisões

| Decisão | Escolha |
|---|---|
| Origem das imagens | Capturas reais do workspace **DK TESTE em prod** |
| Escopo | 16 artigos procedurais (ver lista abaixo) |
| Hospedagem | Bucket público `kb-images` (Supabase Storage) |
| Estilo | Captura crua, uma por passo — sem anotação |
| Telas externas | Usuário captura manualmente a partir de shot list minha |
| Fronteira de segurança | Escritas reversíveis in-app permitidas; ações para fora bloqueadas |

## Arquitetura

Três peças independentes.

### Peça 1 — Bucket `kb-images`

Uma migration, espelhando `avatars` com **uma correção deliberada**:

```sql
insert into storage.buckets (id, name, public)
values ('kb-images', 'kb-images', true)
on conflict (id) do nothing;

create policy "kb_images_public_read"
  on storage.objects for select
  using (bucket_id = 'kb-images');
```

**Não copiar o bug do `avatars`.** A policy `avatars_service_write` é `for insert with check (bucket_id = 'avatars')` sem restrição de role — o comentário diz "Allow service role to write" mas, como escrita, qualquer usuário autenticado pode inserir. Service role já faz bypass de RLS, então a policy é ao mesmo tempo desnecessária e permissiva demais. `kb-images` recebe **somente a policy de leitura pública**.

Layout de chaves: `kb-images/<article-slug>/<NN>-<nome-do-passo>.png`.

### Peça 2 — Script de captura

Novo projeto Playwright `screenshots`, reutilizando a dependência `crm-auth` que já existe:

- Excluído de `test:e2e` e de CI (bate em prod e exige credenciais).
- Acionado por um script npm dedicado.
- Viewport fixo 1440×900, `deviceScaleFactor: 2` (nítido em retina).
- Tema claro forçado, para consistência entre artigos.
- Espera por seletor específico (não `networkidle`) antes de cada captura.
- Escreve PNGs num diretório de staging gitignorado.

**Credenciais:** o usuário preenche `.env.e2e.local` (gitignorado via `.env.*.local`, `.gitignore:11`) com o login do DK TESTE. `auth.setup.ts` já faz o login e salva `storageState` em `e2e/.auth/crm-user.json` (gitignorado, `.gitignore:50`). O agente nunca vê, digita nem passa a senha por linha de comando.

Upload usa `SUPABASE_SERVICE_ROLE_KEY` pela mesma rota baseada em arquivo — nunca como argumento literal de CLI.

### Peça 3 — Autoria do conteúdo

Migration que insere nós `inlineImage` no JSON TipTap existente, seguindo o padrão de funções auxiliares `_kb_*` já estabelecido (`20260519000002_seed_kb_articles.sql:7-40`). Um novo helper:

```
_kb_img(src text, alt text, width int, height int) -> jsonb
```

produzindo `{"type":"inlineImage","attrs":{"r2Key":null,"src":...,"alt":...,"width":...,"height":...}}`.

Todo `alt` é escrito em pt-BR, descrevendo a tela — é o que o leitor com screen reader recebe, e o que aparece se o bucket cair.

## Fronteira de segurança

Prod é um alvo real. A classificação é por **reversibilidade e alcance**, não por conveniência.

**Permitido (reversível, in-app, limpo depois):**
- Criar cliente/lead rascunho
- Criar transação no financeiro
- Criar fluxo/entrega e post rascunho
- Upload de arquivo em Arquivos
- Criar ideia

**Bloqueado (sai do sistema):**
- Enviar convite por e-mail (`Convidar` em Configuração/Equipe) — dispara e-mail real
- Publicar no Instagram (`Publicar agora`) — publica de verdade
- **Agendar post** — ação para fora *com atraso*: o cron dispara depois e publica de verdade. Bloqueado junto com publicar, apesar de o botão parecer inofensivo no momento do clique.
- OAuth do Instagram/Facebook (externo)
- Enviar link do Hub ao cliente
- Qualquer ação de billing/Stripe

Passos cujo *resultado* é bloqueado são capturados no **estado pré-clique** — formulário preenchido, botão visível, sem submeter.

**Limpeza:** entidades criadas recebem um marcador de fixture reconhecível. A limpeza roda **antes e depois** de cada execução, para que um run que quebrou no meio não deixe lixo acumulado em prod.

## Escopo — 16 artigos

Nota: a lista original de ranking dizia "15"; o item 9 daquele ranking cobria dois artigos (`clientes` e `leads`). O número exato é 16.

**Tier 1 — o texto falha sozinho (5)**

| slug | rota | observação |
|---|---|---|
| `como-conectar-o-claude-mcp` | `/configuracao/mcp` | + tela do Claude (**manual**) |
| `como-conectar-o-instagram` | `/clientes/:id` | + consentimento do Facebook (**manual**) |
| `como-usar-o-post-express` | `/post-express` | publicar bloqueado |
| `como-configurar-o-hub-do-cliente` | `/clientes/:id` | envio de link bloqueado |
| `como-criar-e-gerenciar-fluxos` | `/entregas` | 5 modos de visualização |

**Tier 2 — um por passo (7)**

`como-configurar-seu-workspace` (`/configuracao`, convite bloqueado) · `criando-posts-dentro-de-uma-entrega` (`/entregas`, gaveta) · `gestao-financeira` (`/financeiro`) · `como-adicionar-e-gerenciar-clientes` (`/clientes`) · `como-converter-leads-em-clientes` (`/leads`) · `como-organizar-e-reutilizar-arquivos` (`/arquivos`) · `como-gerenciar-sua-equipe` (`/equipe`, convite bloqueado)

**Tier 3 — "leia esta tela" (4)**

`entendendo-o-painel-de-analytics` · `analytics-por-conta-melhores-horarios-tags-e-relatorios` · `analytics-de-fluxos-gargalos-prazos` · `usando-o-calendario-para-financas-prazos-e-datas-importantes`

Estes não têm passos numerados. Recebem **uma captura de tela cheia cada**, não capturas por passo.

**Explicitamente fora — screenshot adicionaria ruído:** `limites-e-seguranca-do-agente` (9 títulos de prosa sobre política) · `permissoes-e-papeis-no-workspace` (taxonomia de papéis) · `primeiros-30-minutos-no-mesaas` (narrativa sem listas, que aponta para os 5 procedimentos reais) · `importacoes-via-csv-no-mesaas` (nomes de coluna — um bloco de código serve melhor) · `o-que-o-agente-pode-fazer` · `bem-vindo-ao-mesaas` · `templates-prazos-e-propriedades-de-fluxos` · demais.

## Telas externas — shot list para captura manual

O usuário captura; o agente entrega a lista precisa (tela, estado, o que redigir) e cuida de upload + autoria.

- **`como-conectar-o-claude-mcp`**: Claude → Configurações → Conectores; diálogo "Adicionar conector personalizado" com campos de OAuth vazios; tela de autorização do Mesaas com seletor de workspace e permissões.
- **`como-conectar-o-instagram`**: consentimento do Facebook; seletor de página vinculada.

Redigir em todas: e-mail da conta, nomes de workspace não relacionados, qualquer chave `mesaas_sk_…`.

## Verificação

O teste que importa é exatamente o que o bug atual reprova:

1. Carregar um artigo **como leitor de outra conta** (não a conta que fez upload) e confirmar que as imagens renderizam.
2. Confirmar que ainda renderizam **depois de 1 hora** — a janela em que o caminho atual falha. Como os URLs são públicos e permanentes, isso deve ser verdadeiro por construção, mas é a asserção que prova o design.
3. Revisar cada captura quanto a dados reais antes do upload (ver risco abaixo).
4. `npm run build` (tsc + vite) e `npm run test`; `npm run test:functions` se alguma edge function for tocada.
5. `npm run format` + `npm run lint` — CI aplica ambos, apesar do CLAUDE.md dizer "no linter".

## Riscos

**Vazamento de dados reais.** DK TESTE está em prod, e a agência real é DK Marketing Médico. O switcher de workspace, listas de clientes e a sidebar podem expor nomes reais de médicos. **Ação:** auditar o conteúdo do DK TESTE antes de capturar, e revisar cada PNG antes do upload. Uma vez publicado para todos os clientes, um vazamento é permanente.

**Screenshots apodrecem.** ~55-60 imagens cruas viram um passivo assim que a UI muda. Sem anotação elas são baratas de recapturar — o script de captura é a mitigação, e é por isso que ele é uma peça versionada e não um esforço manual único.

**Deriva entre passo e imagem.** Se alguém reordenar os passos de um artigo e não reordenar as imagens, o artigo fica ativamente enganoso — pior que sem imagem. `alt` descritivo em pt-BR reduz o dano.

## Fora de escopo (mas registrado)

**Os links de contexto de `/configuracao/mcp` estão mortos.** `ContextHelpLinks.tsx:9` colapsa o pathname ao primeiro segmento:

```ts
const baseRoute = '/' + pathname.split('/').filter(Boolean)[0];
```

e `getContextLinksForRoute` (`store/kb.ts:53`) faz `.eq('route_pattern', route)` exato. Em `/configuracao/mcp`, o componente consulta `route_pattern = '/configuracao'` e renderiza os artigos de *workspace* — os três artigos de Claude/MCP semeados em `20260624000002:244-246` nunca aparecem. Vale corrigir, já que `como-conectar-o-claude-mcp` é o artigo de maior valor deste trabalho.

**`platform_admins` não tem vínculo com `conta_id`.** `20260501000002_platform_admin_tables.sql:2-8` referencia `auth.users` direto, mas `file-upload-url` e `sign-r2-urls` exigem `profiles.conta_id`. Um platform admin que não seja também usuário de CRM com conta levaria 403 em todo upload de imagem, capa inclusive. Este design contorna o problema (upload por service role, fora do caminho do admin), mas a armadilha continua armada para quem editar artigos pelo admin.

**O editor admin não tem botão de imagem.** Inserção é só paste/drop (`InlineImageExtension.tsx:281-307`) — funcional, mas não descobrível.
