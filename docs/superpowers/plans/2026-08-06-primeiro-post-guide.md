# Guia "Como agendar seu primeiro post" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publicar na Central de Ajuda um guia visual único que leva uma conta recém-criada do workspace vazio até um post agendado, com screenshot em cada passo.

**Architecture:** Três camadas independentes. (1) Correções de segurança e ergonomia no harness de captura existente, que valem por si. (2) Uma spec Playwright que captura ~30 telas de produção sem gravar nada. (3) Uma migration SQL que autora o artigo como TipTap JSON, referenciando URLs públicas permanentes do bucket `kb-images`.

**Tech Stack:** Playwright (projeto `screenshots`, opt-in), Vitest, Supabase Storage (bucket público `kb-images`), Postgres/SQL migrations, TipTap JSON.

**Spec:** `docs/superpowers/specs/2026-08-06-primeiro-post-guide-design.md`

## Global Constraints

- **Sem travessão (`—`) em qualquer copy voltada ao usuário.** Use ponto, dois-pontos ou `·`. Regra de estilo da casa, aplicada ao texto do artigo.
- **Todo nó `inlineImage` do artigo usa `r2Key: NULL`.** Um valor não nulo renderiza por uma hora e depois dá 403 para sempre.
- **Zero escrita em produção durante a captura.** Formulários são capturados preenchidos, antes do submit. Passos de resultado usam entidades que já existem.
- **Idioma do artigo: português do Brasil.** Todo `alt` de imagem descreve a tela em pt-BR.
- **Prefixo de versão da migration:** confirmar contra `origin/main` **na hora de abrir o PR**, não na hora de criar o arquivo.
- **Nunca clicar em `Publicar`, `Agendar`, `Convidar` ou atravessar o OAuth do Facebook** durante uma execução de captura.
- Antes de push: `npm run format`, `npm run lint`, os quatro `tsc` (crm, hub, admin, scripts), `npm run test`, `npm run test:functions`.
- `npm run test:functions` suja `deno.lock` na raiz. Sempre `git checkout -- deno.lock` depois.

## File Structure

| Arquivo | Responsabilidade | Ação |
|---|---|---|
| `e2e/screenshots/safety.ts` | Blocklist de ações para fora | Modificar: adicionar `tiktok-publish` |
| `e2e/screenshots/__tests__/safety.test.ts` | Testes unitários da blocklist | Modificar: casos do TikTok |
| `scripts/upload-kb-images.mjs` | Upload de PNGs para o bucket público | Modificar: exigir filtro de slug |
| `scripts/__tests__/uploadKbImages.test.mjs` | Teste do resolvedor de argumento | Criar |
| `e2e/screenshots/primeiro-post.spec.ts` | Captura das 30 telas do guia | Criar |
| `supabase/migrations/20260806000002_kb_primeiro_post_guide.sql` | Artigo, renumeração, links de contexto | Criar |
| `apps/crm/src/pages/ajuda/__tests__/primeiroPostArticle.test.ts` | Guarda de `r2Key` e travessão | Criar |
| `docs/superpowers/plans/2026-08-06-primeiro-post-external-shots.md` | Lista de capturas manuais | Criar |

## Convenção de nomes das capturas

Determinística, porque a URL pública deriva dela. Diretório: `e2e/.shots/como-agendar-seu-primeiro-post/`.

| # | Arquivo | Seção |
|---|---|---|
| 01 | `01-abrir-clientes.png` | 1 |
| 02 | `02-novo-cliente.png` | 1 |
| 03 | `03-preencher-dados.png` | 1 |
| 04 | `04-plano-e-valores.png` | 1 |
| 05 | `05-abrir-equipe.png` | 2 |
| 06 | `06-adicionar-membro.png` | 2 |
| 07 | `07-dados-do-membro.png` | 2 |
| 08 | `08-tipo-de-vinculo.png` | 2 |
| 09 | `09-convidar-usuario.png` | 2 |
| 10 | `10-abrir-cliente.png` | 3 |
| 11 | `11-secao-instagram.png` | 3 |
| 12 | `12-conectar-instagram.png` | 3 |
| 13 | `ext-13-facebook-autorizar.png` | 3, **manual** |
| 14 | `ext-14-selecionar-pagina.png` | 3, **manual** |
| 15 | `ext-15-confirmar-permissoes.png` | 3, **manual** |
| 16 | `16-abrir-entregas.png` | 4 |
| 17 | `17-novo-fluxo.png` | 4 |
| 18 | `18-escolher-template.png` | 4 |
| 19 | `19-etapas-do-fluxo.png` | 4 |
| 20 | `20-responsavel-e-prazo.png` | 4 |
| 21 | `21-abrir-gaveta.png` | 5 |
| 22 | `22-novo-post.png` | 5 |
| 23 | `23-tipo-e-titulo.png` | 5 |
| 24 | `24-enviar-midia.png` | 5 |
| 25 | `25-escrever-legenda.png` | 5 |
| 26 | `26-avancar-etapa.png` | 6 |
| 27 | `27-dialogo-de-aprovacao.png` | 6 |
| 28 | `28-post-aprovado.png` | 6 |
| 29 | `29-definir-data-e-horario.png` | 7 |
| 30 | `30-botao-agendar-habilitado.png` | 7 |
| 31 | `31-post-agendado.png` | 7 |
| 32 | `32-cancelar-agendamento.png` | 7 |
| 33 | `33-acompanhar-no-calendario.png` | 8 |

URL pública de cada uma:

```
https://skjzpekeqefvlojenfsw.supabase.co/storage/v1/object/public/kb-images/como-agendar-seu-primeiro-post/<arquivo>
```

O ref `skjzpekeqefvlojenfsw` é o projeto Supabase de **produção**, o mesmo usado em `20260717000002_kb_article_screenshots.sql`.

---

### Task 1: Fechar a lacuna do TikTok na rede de segurança

Agendar um post de TikTok chama `POST /functions/v1/tiktok-publish/schedule/:id` (`apps/crm/src/services/tiktok.ts:14,261`). `tiktok-publish` não está em `BLOCKED_FUNCTIONS`, e `isSchedulingWrite()` só olha writes PostgREST em `workflow_posts`. Nenhum dos dois pega esse caminho.

Esta task vale por si: a lacuna existe hoje para qualquer execução de captura, independente deste artigo.

**Files:**
- Modify: `e2e/screenshots/safety.ts:12-21` (array `BLOCKED_FUNCTIONS`)
- Test: `e2e/screenshots/__tests__/safety.test.ts`

**Interfaces:**
- Consumes: nada
- Produces: `BLOCKED_FUNCTIONS` passa a conter `'tiktok-publish'`. `isBlockedUrl('<...>/functions/v1/tiktok-publish/schedule/42')` retorna `true`.

- [ ] **Step 1: Escrever o teste que falha**

Adicione ao final do bloco `describe('capture safety net', ...)` em `e2e/screenshots/__tests__/safety.test.ts`:

```ts
  it('blocks TikTok scheduling, which is an edge function and not a PostgREST write', () => {
    // ScheduleButton's handleSchedule calls scheduleTikTokPost for a post
    // whose platform is 'tiktok' or 'both' (ScheduleButton.tsx:319), and that
    // hits tiktok-publish/schedule/:id (services/tiktok.ts:14,261) -- an edge
    // function, so isSchedulingWrite() never sees it.
    expect(isBlockedUrl(`${FN}/tiktok-publish/schedule/42`)).toBe(true);
    expect(isBlockedUrl(`${FN}/tiktok-publish`)).toBe(true);
  });
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

```bash
npx vitest run e2e/screenshots/__tests__/safety.test.ts
```

Esperado: FAIL, com `expected false to be true` nas duas asserções novas.

- [ ] **Step 3: Adicionar a função à blocklist**

Em `e2e/screenshots/safety.ts`, dentro do array `BLOCKED_FUNCTIONS`, logo abaixo da entrada `'instagram-publish'`:

```ts
  'tiktok-publish', // schedules/publishes to a real TikTok account. The
  // schedule path (tiktok-publish/schedule/:id, services/tiktok.ts:261) is an
  // edge function, so isSchedulingWrite() -- which only inspects PostgREST
  // writes to workflow_posts -- structurally cannot see it. This function also
  // serves reads (creator-info/:clientId, tiktok.ts:248); no current capture
  // spec needs them, so the whole function is blocked. If a future spec does,
  // narrow this to BLOCKED_FUNCTION_SUBPATHS with prefix 'schedule' instead.
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

```bash
npx vitest run e2e/screenshots/__tests__/safety.test.ts
```

Esperado: PASS, todos os casos.

- [ ] **Step 5: Commit**

```bash
git add e2e/screenshots/safety.ts e2e/screenshots/__tests__/safety.test.ts
git commit -m "fix(screenshots): bloquear tiktok-publish na rede de segurança de captura"
```

---

### Task 2: Exigir filtro de slug no upload de imagens

`scripts/upload-kb-images.mjs` itera todo `e2e/.shots` e sobe cada slug que encontra. O diretório é gitignorado e persiste entre execuções, então carrega capturas de esforços anteriores e PNGs parciais de execuções que quebraram. A revisão humana cobre as capturas de um artigo; o script publicaria tudo, revisado ou não, num bucket público.

**Files:**
- Modify: `scripts/upload-kb-images.mjs`
- Test: `scripts/__tests__/uploadKbImages.test.mjs` (criar)

**Interfaces:**
- Consumes: nada
- Produces: `resolveTargetSlugs(argv, availableSlugs)` exportada de `scripts/upload-kb-images.mjs`. Recebe `string[]` de argumentos posicionais e `string[]` de slugs presentes no disco. Devolve `string[]` de slugs a subir. Lança `Error` se o argumento estiver ausente ou não existir no disco.

- [ ] **Step 1: Escrever o teste que falha**

Crie `scripts/__tests__/uploadKbImages.test.mjs`:

```js
import { describe, it, expect } from 'vitest';
import { resolveTargetSlugs } from '../upload-kb-images.mjs';

const AVAILABLE = ['como-usar-o-post-express', 'como-agendar-seu-primeiro-post'];

describe('resolveTargetSlugs', () => {
  it('returns only the requested slug', () => {
    expect(resolveTargetSlugs(['como-agendar-seu-primeiro-post'], AVAILABLE)).toEqual([
      'como-agendar-seu-primeiro-post',
    ]);
  });

  it('refuses to run with no slug, rather than defaulting to every slug on disk', () => {
    // The dangerous behavior must not be the default: e2e/.shots is gitignored
    // and persists across runs, so "all" means "publish whatever is lying
    // around", including unreviewed PNGs, to a public bucket.
    expect(() => resolveTargetSlugs([], AVAILABLE)).toThrow(/slug/i);
  });

  it('refuses a slug that has no directory on disk', () => {
    expect(() => resolveTargetSlugs(['nao-existe'], AVAILABLE)).toThrow(/nao-existe/);
  });

  it('accepts more than one slug', () => {
    expect(resolveTargetSlugs(AVAILABLE, AVAILABLE)).toEqual(AVAILABLE);
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

```bash
npx vitest run scripts/__tests__/uploadKbImages.test.mjs
```

Esperado: FAIL, com erro de import (`resolveTargetSlugs` não é exportada).

- [ ] **Step 3: Implementar**

Em `scripts/upload-kb-images.mjs`, adicione a função exportada logo abaixo das constantes `BUCKET` e `SHOT_DIR`:

```js
/**
 * Which slug directories this invocation may upload.
 *
 * Requires an explicit slug. Uploading "everything in e2e/.shots" was the old
 * behavior and it is unsafe: the directory is gitignored, persists between
 * runs, and accumulates PNGs from earlier capture efforts plus partial output
 * from runs that crashed. Every file it holds would go to a PUBLIC bucket, and
 * the human review gate only ever covers the article being worked on.
 */
export function resolveTargetSlugs(argv, availableSlugs) {
  if (argv.length === 0) {
    throw new Error(
      'Informe ao menos um slug. Uso: node --env-file=.env.kb-upload.local ' +
        'scripts/upload-kb-images.mjs <slug> [slug...]\n' +
        `Slugs disponíveis em e2e/.shots: ${availableSlugs.join(', ') || '(nenhum)'}`,
    );
  }
  const missing = argv.filter((s) => !availableSlugs.includes(s));
  if (missing.length > 0) {
    throw new Error(`Slug sem diretório em e2e/.shots: ${missing.join(', ')}`);
  }
  return argv;
}
```

Depois substitua o laço de upload. O trecho atual é:

```js
for (const slug of readdirSync(SHOT_DIR)) {
```

Passa a ser:

```js
const targetSlugs = resolveTargetSlugs(process.argv.slice(2), readdirSync(SHOT_DIR));

for (const slug of targetSlugs) {
```

Envolva a parte executável (a checagem de env, a criação do client e o laço) para que importar o módulo num teste não dispare upload. Logo após os imports, o arquivo deve ficar com esta guarda antes do bloco que lê `process.env`:

```js
const isDirectRun = process.argv[1] && process.argv[1].endsWith('upload-kb-images.mjs');
if (!isDirectRun) {
  // Imported by a test: export the pure helper only, run nothing.
} else {
  // ... existing env check, createClient, and the upload loop go here
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

```bash
npx vitest run scripts/__tests__/uploadKbImages.test.mjs
```

Esperado: PASS, quatro casos.

- [ ] **Step 5: Confirmar que a recusa sem argumento funciona de verdade**

```bash
node scripts/upload-kb-images.mjs
```

Esperado: sai com erro citando "Informe ao menos um slug", **sem** subir nada e sem exigir credenciais.

- [ ] **Step 6: Commit**

```bash
git add scripts/upload-kb-images.mjs scripts/__tests__/uploadKbImages.test.mjs
git commit -m "fix(scripts): exigir slug explícito no upload de imagens da base de conhecimento"
```

---

### Task 3: Descobrir o estado de produção necessário para a captura final

A captura `30-botao-agendar-habilitado.png` precisa do botão `Agendar` **habilitado**. A condição é `canSchedule` (`apps/crm/src/pages/entregas/components/ScheduleButton.tsx:504`), que exige bem mais do que data e legenda.

Esta task é **somente leitura**. Não escreve nada em produção.

**Files:**
- Nenhum arquivo de código. Produz um registro escrito no corpo do PR e um comentário na spec da Task 4.

**Interfaces:**
- Consumes: nada
- Produces: um `post_id` e o `workflow_id` correspondente, ou a constatação de que não existe. A Task 4 referencia esse id por constante nomeada.

- [ ] **Step 1: Copiar os arquivos de ambiente para a worktree**

Worktrees não herdam arquivos gitignorados. Sem isso, os scripts apontam para o lugar errado ou falham.

```bash
cp /Users/eduardosouza/Projects/sm-crm/.env.e2e.local /Users/eduardosouza/Projects/sm-crm/.claude/worktrees/first-post-scheduling-guide-ec47b9/.env.e2e.local
cp /Users/eduardosouza/Projects/sm-crm/.env.kb-upload.local /Users/eduardosouza/Projects/sm-crm/.claude/worktrees/first-post-scheduling-guide-ec47b9/.env.kb-upload.local
```

- [ ] **Step 2: Confirmar contra qual projeto o Supabase CLI está apontando**

O estado de link **alterna** entre worktrees e sessões. Confirme antes de qualquer consulta.

```bash
cat supabase/.temp/project-ref 2>/dev/null || echo "NAO LINKADO"
```

Esperado: `skjzpekeqefvlojenfsw` (produção). Se vier `wlyzhyfondykzpsiqsce`, é staging e a consulta não serve. Se vier `NAO LINKADO`, rode `npx supabase link --project-ref skjzpekeqefvlojenfsw`.

- [ ] **Step 3: Rodar a consulta somente leitura**

> **`supabase db query --linked` abre conexão direta ao Postgres e ignora RLS.** Produção
> hospeda dezenas de agências reais além do DK TESTE. Sem o filtro de `conta_id` desta
> consulta, ela devolve posts de clientes reais, e os passos seguintes gravam esses ids e
> nomes num arquivo de spec versionado e em capturas que vão para um bucket público. O
> filtro **não é opcional**.

```bash
npx supabase db query --linked "
SELECT wp.id AS post_id, wp.workflow_id, wp.tipo, wp.scheduled_at,
       coalesce(wp.platform, 'instagram') AS platform
FROM workflow_posts wp
JOIN workflows w ON w.id = wp.workflow_id
JOIN clientes c ON c.id = w.cliente_id
JOIN instagram_accounts ia ON ia.client_id = c.id
WHERE c.conta_id = 'e68bdbc3-baf0-4807-b905-0807ac4e0253'
  AND wp.status = 'aprovado_cliente'
  AND wp.scheduled_at IS NOT NULL
  AND (wp.tipo = 'stories' OR coalesce(btrim(wp.ig_caption), '') <> '')
  AND ia.authorization_status NOT IN ('revoked', 'expired')
  AND (ia.token_expires_at IS NULL OR ia.token_expires_at >= now())
  AND coalesce(ia.permissions, '{}') @> ARRAY['instagram_business_content_publish']
  AND coalesce(wp.platform, 'instagram') = 'instagram'
ORDER BY wp.scheduled_at DESC
LIMIT 5;
"
```

Cada condição espelha uma parte de `canSchedule`:

| Condição da consulta | Origem |
|---|---|
| `c.conta_id = '<DK TESTE>'` | **não** vem da UI. É o escopo de tenant, ver o aviso acima |
| `status = 'aprovado_cliente'` | `ScheduleButton.tsx:495`, senão o bloco nem renderiza |
| `scheduled_at IS NOT NULL` | `ScheduleButton.tsx:504` |
| legenda preenchida ou tipo `stories` | `hasRequiredCaption`, `:498` |
| `authorization_status NOT IN (revoked, expired)` | `revoked`/`expired`, `WorkflowDrawer.tsx:266-274` |
| `token_expires_at IS NULL OR >= now()` | a outra metade de `expired`, mesma origem |
| `permissions @> {instagram_business_content_publish}` | `canPublish`, mesma origem |
| `platform = 'instagram'` | evita o ramo `tiktokReady`, `ScheduleButton.tsx:231` |

Três armadilhas, todas encontradas na execução real deste plano:

1. **A coluna é `platform`, não `plataforma`.** `coalesce(wp.plataforma, ...)` estoura com
   `column wp.plataforma does not exist` antes de devolver qualquer coisa.
2. **`authorization_status = 'active'` não basta.** A UI deriva `expired` também de
   `token_expires_at`, e exige `canPublish` do array `permissions`. As quatro contas do DK
   TESTE estão `active` com o token vencido em 2026-06-12: uma consulta que olha só o
   status devolve um `post_id` cujo botão Agendar renderiza **desabilitado**.
   `scripts/seed-kb-capture-fixtures.mjs` documenta esse mesmo erro sendo corrigido no
   próprio preflight.
3. **Sem `conta_id`, a consulta atravessa tenants.** Rodada sem o filtro, ela devolveu
   posts de três clientes reais da agência. Nenhum deles é do DK TESTE.

- [ ] **Step 4: Registrar o resultado e decidir**

**Se a consulta devolver ao menos uma linha:** anote `post_id`, `workflow_id` e o nome do cliente. A Task 4 usa esses valores. Siga para a Task 4.

**Se a consulta devolver zero linhas: PARE.** Não escreva em produção para fabricar o estado, e não altere `isSchedulingWrite()`. Relate ao usuário exatamente isto:

> A consulta não encontrou nenhum post do DK TESTE apto a exibir o botão Agendar habilitado. O spec prevê dois contornos e ambos são decisão sua, não de implementação: (1) provisionar à mão um post fixture com data futura, mantendo a política de zero escrita na captura, que é a opção recomendada; ou (2) estreitar `isSchedulingWrite()` para liberar `scheduled_at`, o que reescreve a política de zero escrita e exige alvo, responsável e reversão explícitos. Qual você prefere?

Aguarde a resposta antes de prosseguir.

- [ ] **Step 5: Verificar quais personas têm Instagram ativo**

Independente do resultado acima, esta leitura orienta os passos da seção 3 do artigo:

```bash
npx supabase db query --linked "
SELECT c.id, c.nome, ia.authorization_status, ia.instagram_user_id IS NOT NULL AS tem_conta
FROM clientes c
LEFT JOIN instagram_accounts ia ON ia.client_id = c.id
WHERE c.conta_id = 'e68bdbc3-baf0-4807-b905-0807ac4e0253'
ORDER BY c.id;
"
```

O `WHERE conta_id` vale aqui pelo mesmo motivo do Step 3: sem ele a consulta lista os
clientes de todas as agências reais da produção.

Anote qual cliente tem `authorization_status = 'active'`. As capturas `11-secao-instagram.png` e `12-conectar-instagram.png` precisam de estados diferentes: uma conta conectada mostra o painel de conta, uma não conectada mostra o botão `Conectar Instagram`. Escolha um cliente para cada.

- [ ] **Step 6: Commit do registro**

Não há código a commitar. Registre os achados como comentário no PR ou no corpo da Task 4. Nenhum commit nesta task.

---

### Task 4: Escrever a spec de captura

**Files:**
- Create: `e2e/screenshots/primeiro-post.spec.ts`

**Interfaces:**
- Consumes: `installSafetyNet(page)` e `assertNoViolations(violations)` de `./safety`; `shoot(page, slug, index, name)` de `./capture`. `shoot` grava em `e2e/.shots/<slug>/<NN>-<name>.png` com o índice zero-padded a 2 dígitos.
- Produces: 30 PNGs em `e2e/.shots/como-agendar-seu-primeiro-post/`.

- [ ] **Step 1: Subir o dev server e descobrir os seletores reais**

Os seletores precisam ser verificados contra o DOM vivo antes de virar código. É a prática das specs existentes, e `entregas.spec.ts` documenta por escrito o que foi verificado e quando.

```bash
npm run dev
```

Com o servidor no ar, abra cada tela e confirme os textos abaixo. Estes três foram verificados na leitura do código e devem bater:

| Tela | Âncora | Origem |
|---|---|---|
| `/clientes` | botão com nome `Novo Cliente` | `packages/i18n/locales/pt/clients.json`, chave `newClient` |
| `/equipe` | botão com nome `Adicionar Membro` | `apps/crm/src/pages/equipe/EquipePage.tsx:365` |
| `/equipe` | `Convidar para o workspace` | `apps/crm/src/pages/equipe/InviteSection.tsx:139` |
| `/entregas` | botão com nome `Novo Fluxo` | `apps/crm/src/pages/entregas/EntregasPage.tsx:414` |

Os demais (diálogo de etapa, gaveta da entrega, bloco de publicação) precisam ser confirmados na tela. Anote cada seletor num comentário na spec, no formato usado por `entregas.spec.ts`: o que foi verificado, contra o quê, e em que data.

- [ ] **Step 2: Escrever o esqueleto com a rede de segurança**

Crie `e2e/screenshots/primeiro-post.spec.ts`:

```ts
import { test } from '@playwright/test';
import { installSafetyNet, assertNoViolations } from './safety';
import { shoot } from './capture';

const SLUG = 'como-agendar-seu-primeiro-post';

// Preenchido pela Task 3. O post precisa satisfazer canSchedule
// (ScheduleButton.tsx:504) inteiro, senão a captura 30 sai com o botão
// desabilitado e não serve para o artigo.
const SCHEDULABLE_POST_ID = 0; // <- substituir pelo id da Task 3
const SCHEDULABLE_WORKFLOW_ID = 0; // <- substituir pelo id da Task 3

// Cliente SEM Instagram conectado, para a captura 12 (botão Conectar).
const CLIENT_WITHOUT_IG = 0; // <- substituir pelo id da Task 3 Step 5
// Cliente COM Instagram ativo, para a captura 11 (painel da conta).
const CLIENT_WITH_IG = 0; // <- substituir pelo id da Task 3 Step 5

test.describe.configure({ mode: 'serial' });

test('primeiro post walkthrough', async ({ page }) => {
  const violations = await installSafetyNet(page);

  // ... passos entram aqui, seções 1 a 8

  // Falha a execução se qualquer chamada para fora foi tentada. Deve ser a
  // última linha: lançar de dentro de um route handler não reprova o teste.
  assertNoViolations(violations);
});
```

- [ ] **Step 3: Implementar a seção 1, cadastro do cliente**

Acrescente dentro do `test`, antes de `assertNoViolations`:

```ts
  // --- Seção 1: cadastre o cliente ---------------------------------------
  // Capturas 2 a 4 são o FORMULÁRIO PREENCHIDO, nunca submetido. Nenhum
  // cliente é criado por esta spec.
  await page.goto('/clientes');
  await page.getByRole('button', { name: /novo cliente/i }).waitFor();
  await shoot(page, SLUG, 1, 'abrir-clientes');

  await page.getByRole('button', { name: /novo cliente/i }).click();
  const nomeInput = page.getByLabel(/nome/i).first();
  await nomeInput.waitFor();
  await shoot(page, SLUG, 2, 'novo-cliente');

  await nomeInput.fill('Clínica Exemplo');
  await page.getByLabel(/e-?mail/i).first().fill('contato@clinicaexemplo.com.br');
  await page.getByLabel(/telefone/i).first().fill('71999990000');
  await shoot(page, SLUG, 3, 'preencher-dados');

  // Rolar até o bloco de plano e valores dentro do mesmo formulário.
  await page.getByLabel(/valor mensal/i).first().scrollIntoViewIfNeeded();
  await page.getByLabel(/valor mensal/i).first().fill('1500');
  await shoot(page, SLUG, 4, 'plano-e-valores');

  // Fechar sem salvar. Escape descarta o formulário.
  await page.keyboard.press('Escape');
```

Se algum `getByLabel` não bater, ajuste para o seletor confirmado no Step 1 e registre a correção num comentário.

- [ ] **Step 4: Implementar a seção 2, equipe**

```ts
  // --- Seção 2: monte sua equipe -----------------------------------------
  await page.goto('/equipe');
  await page.getByRole('button', { name: /adicionar membro/i }).first().waitFor();
  await shoot(page, SLUG, 5, 'abrir-equipe');

  await page.getByRole('button', { name: /adicionar membro/i }).first().click();
  const membroNome = page.getByLabel(/nome/i).first();
  await membroNome.waitFor();
  await shoot(page, SLUG, 6, 'adicionar-membro');

  await membroNome.fill('Ana Souza');
  await page.getByLabel(/cargo/i).first().fill('Social Media');
  await shoot(page, SLUG, 7, 'dados-do-membro');

  await page.getByLabel(/tipo|vínculo/i).first().scrollIntoViewIfNeeded();
  await shoot(page, SLUG, 8, 'tipo-de-vinculo');

  await page.keyboard.press('Escape');

  // Convite. PRÉ-CLIQUE: 'Convidar' dispara invite-user, que manda e-mail
  // real. A rede de segurança bloqueia a função, mas a spec nunca clica.
  const convite = page.getByText('Convidar para o workspace').first();
  await convite.scrollIntoViewIfNeeded();
  await shoot(page, SLUG, 9, 'convidar-usuario');
```

- [ ] **Step 5: Implementar a seção 3, Instagram**

```ts
  // --- Seção 3: conecte o Instagram do cliente ---------------------------
  await page.goto(`/clientes/${CLIENT_WITH_IG}`);
  await page.getByRole('heading', { level: 2 }).first().waitFor();
  await shoot(page, SLUG, 10, 'abrir-cliente');

  await page.getByText(/instagram/i).first().scrollIntoViewIfNeeded();
  await shoot(page, SLUG, 11, 'secao-instagram');

  // Cliente SEM conta conectada, para mostrar o botão de conectar.
  // PRÉ-CLIQUE E DE ALTO RISCO: a rede de segurança roteia apenas
  // functions/v1 e rest/v1, então NÃO vê uma navegação para facebook.com.
  // Clicar aqui atravessa o OAuth real e altera uma integração de verdade.
  // Capture o botão e siga. Nunca clique.
  await page.goto(`/clientes/${CLIENT_WITHOUT_IG}`);
  const conectar = page.getByRole('button', { name: /conectar instagram/i });
  await conectar.waitFor();
  await conectar.scrollIntoViewIfNeeded();
  await shoot(page, SLUG, 12, 'conectar-instagram');

  // 13 a 15 são telas do Facebook, capturadas à mão. Ver o documento de
  // capturas externas.
```

- [ ] **Step 6: Implementar a seção 4, fluxo**

```ts
  // --- Seção 4: crie o fluxo de entrega ----------------------------------
  await page.goto('/entregas');
  await page.getByRole('button', { name: /novo fluxo/i }).waitFor();
  await shoot(page, SLUG, 16, 'abrir-entregas');

  await page.getByRole('button', { name: /novo fluxo/i }).click();
  await page.getByRole('dialog').waitFor();
  await shoot(page, SLUG, 17, 'novo-fluxo');

  // Escolher template, ainda sem salvar.
  await shoot(page, SLUG, 18, 'escolher-template');
  await shoot(page, SLUG, 19, 'etapas-do-fluxo');
  await shoot(page, SLUG, 20, 'responsavel-e-prazo');

  await page.keyboard.press('Escape');
```

Confirme no Step 1 como o diálogo de novo fluxo apresenta template, etapas e responsável. Se forem abas ou passos, navegue entre eles antes de cada `shoot` e registre num comentário. Se estiverem todos na mesma tela, use `scrollIntoViewIfNeeded` no bloco correspondente antes de cada captura, para que as três não saiam pixel-idênticas.

- [ ] **Step 7: Implementar as seções 5 a 8**

```ts
  // --- Seção 5: crie o post dentro do fluxo ------------------------------
  // Gaveta de um fluxo que já existe, via deep link. Somente leitura.
  await page.goto(`/entregas?drawer=${SCHEDULABLE_WORKFLOW_ID}`);
  await page.getByRole('dialog').waitFor();
  await shoot(page, SLUG, 21, 'abrir-gaveta');
  await shoot(page, SLUG, 22, 'novo-post');
  await shoot(page, SLUG, 23, 'tipo-e-titulo');
  await shoot(page, SLUG, 24, 'enviar-midia');
  await shoot(page, SLUG, 25, 'escrever-legenda');

  // --- Seção 6: aprove o post -------------------------------------------
  // PRÉ-CLIQUE no diálogo: 'Aprovar internamente' grava
  // status = 'aprovado_cliente' em posts reais. Capture o diálogo aberto e
  // feche com Escape.
  await page.goto('/entregas');
  await shoot(page, SLUG, 26, 'avancar-etapa');
  await shoot(page, SLUG, 27, 'dialogo-de-aprovacao');
  await page.keyboard.press('Escape');
  await shoot(page, SLUG, 28, 'post-aprovado');

  // --- Seção 7: agende a publicação -------------------------------------
  await page.goto(`/entregas?drawer=${SCHEDULABLE_WORKFLOW_ID}`);
  await page.getByRole('dialog').waitFor();
  await shoot(page, SLUG, 29, 'definir-data-e-horario');

  // PRÉ-CLIQUE: 'Agendar' chama instagram-publish/schedule/:id, bloqueado
  // pela rede de segurança. Ainda assim, nunca clique.
  const agendar = page.getByRole('button', { name: /^agendar$/i });
  await agendar.waitFor();
  await agendar.scrollIntoViewIfNeeded();
  await shoot(page, SLUG, 30, 'botao-agendar-habilitado');

  await shoot(page, SLUG, 31, 'post-agendado');
  await shoot(page, SLUG, 32, 'cancelar-agendamento');

  // --- Seção 8: e agora? -------------------------------------------------
  await page.goto('/calendario');
  await shoot(page, SLUG, 33, 'acompanhar-no-calendario');
```

Para as capturas 31 e 32, encontre um post que **já** esteja em `agendado` e abra a gaveta dele. Esse estado renderiza o chip `Agendado` e o botão `Cancelar` (`ScheduleButton.tsx:420-460`). Se a Task 3 não achou nenhum post agendado, deixe 31 e 32 de fora e registre no documento de capturas externas que esses dois slots ficam vazios.

- [ ] **Step 8: Rodar a captura**

```bash
CAPTURE_SCREENSHOTS=1 npx playwright test --project=screenshots --grep "primeiro post"
```

Esperado: PASS, e 30 arquivos em `e2e/.shots/como-agendar-seu-primeiro-post/`. Confira a contagem:

```bash
ls e2e/.shots/como-agendar-seu-primeiro-post/ | wc -l
```

Se o teste falhar com `Capture attempted N blocked outward-facing call(s)`, a spec clicou em algo que não devia. Corrija a spec. Não relaxe a rede de segurança.

- [ ] **Step 9: Commit**

```bash
git add e2e/screenshots/primeiro-post.spec.ts
git commit -m "test(screenshots): spec de captura do guia de primeiro post"
```

---

### Task 5: Barreira de revisão humana e upload

**Files:**
- Nenhum arquivo versionado. Move bytes para um bucket público.

**Interfaces:**
- Consumes: os 30 PNGs da Task 4, `resolveTargetSlugs` da Task 2
- Produces: 30 objetos públicos em `kb-images/como-agendar-seu-primeiro-post/`

- [ ] **Step 1: Abrir os PNGs para revisão do usuário**

**Barreira dura.** Não suba nada antes de o usuário responder.

```bash
open e2e/.shots/como-agendar-seu-primeiro-post/
```

Peça ao usuário exatamente isto:

> As 30 capturas estão em `e2e/.shots/como-agendar-seu-primeiro-post/`. Antes de qualquer upload, preciso que você as revise procurando dados reais: nomes de médicos ou clientes reais, seu e-mail, nomes de workspace não relacionados, qualquer chave `mesaas_sk_…`. O DK TESTE convive com a agência real em produção, e uma vez publicado no bucket público isso é permanente. Alguma precisa ser refeita ou redigida?

Aguarde a resposta.

- [ ] **Step 2: Subir**

Só depois do aval explícito:

```bash
node --env-file=.env.kb-upload.local scripts/upload-kb-images.mjs como-agendar-seu-primeiro-post
```

Esperado: uma linha por arquivo, no formato `01-abrir-clientes.png -> https://...`.

- [ ] **Step 3: Conferir que uma URL responde**

```bash
curl -s -o /dev/null -w "%{http_code}\n" "https://skjzpekeqefvlojenfsw.supabase.co/storage/v1/object/public/kb-images/como-agendar-seu-primeiro-post/01-abrir-clientes.png"
```

Esperado: `200`.

---

### Task 6: Teste de guarda do artigo

Escrito **antes** da migration, e falha até ela existir. As duas asserções cobrem os dois modos de falha que passam despercebidos: `r2Key` não nulo renderiza por uma hora e depois quebra para sempre, e travessão é a marca que o usuário chamou de "cara de AI slop".

**Files:**
- Create: `apps/crm/src/pages/ajuda/__tests__/primeiroPostArticle.test.ts`

**Interfaces:**
- Consumes: `supabase/migrations/20260806000002_kb_primeiro_post_guide.sql`, lido como texto
- Produces: nada consumido por outra task

- [ ] **Step 1: Escrever o teste que falha**

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const MIGRATION = path.join(
  process.cwd(),
  'supabase/migrations/20260806000002_kb_primeiro_post_guide.sql',
);

function migrationSource(): string {
  return readFileSync(MIGRATION, 'utf-8');
}

describe('artigo "Como agendar seu primeiro post"', () => {
  it('nunca preenche r2Key numa imagem do corpo', () => {
    // Um r2Key não nulo faz ArtigoPage pedir assinatura a sign-r2-urls, que
    // só assina chaves da própria conta do leitor ou capas de artigo. Uma
    // imagem de corpo não é nenhum dos dois: a assinatura falha em silêncio e
    // o src pré-assinado da autoria expira em 3600s. Passa no smoke test da
    // autoria e quebra no dia seguinte.
    // Capture the value that follows every 'r2Key', and assert each is NULL.
    // Do NOT write this as /'r2Key',\s*(?!NULL)/ -- `\s*` backtracks to zero
    // width, the lookahead then tests the position right after the comma
    // (where a space, not "NULL", sits), succeeds, and the test fails against
    // correct code.
    const src = migrationSource();
    const r2KeyValues = [...src.matchAll(/'r2Key',\s*([A-Za-z0-9_']+)/g)].map((m) => m[1]);
    expect(r2KeyValues.length).toBeGreaterThan(0);
    for (const value of r2KeyValues) {
      expect(value).toBe('NULL');
    }
  });

  it('aponta as imagens para o bucket público permanente', () => {
    const src = migrationSource();
    const urls = src.match(/https:\/\/[^']*kb-images[^']*/g) ?? [];
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) {
      expect(url).toContain('/storage/v1/object/public/kb-images/');
      expect(url).toContain('como-agendar-seu-primeiro-post/');
    }
  });

  it('não usa travessão na copy do artigo', () => {
    // Regra de estilo da casa para texto voltado ao usuário. Este artigo é o
    // texto mais visível do repositório: vai para a Central de Ajuda de todos
    // os clientes.
    expect(migrationSource()).not.toContain('—');
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
npx vitest run apps/crm/src/pages/ajuda/__tests__/primeiroPostArticle.test.ts
```

Esperado: FAIL, com `ENOENT` na leitura da migration, que ainda não existe.

- [ ] **Step 3: Commit do teste**

```bash
git add apps/crm/src/pages/ajuda/__tests__/primeiroPostArticle.test.ts
git commit -m "test(ajuda): guarda de r2Key e travessão para o guia de primeiro post"
```

---

### Task 7: A migration do artigo

**Files:**
- Create: `supabase/migrations/20260806000002_kb_primeiro_post_guide.sql`

**Interfaces:**
- Consumes: as URLs públicas confirmadas na Task 5
- Produces: o artigo `como-agendar-seu-primeiro-post` publicado, a categoria `primeiros-passos` renumerada e os links de contexto de `/dashboard` reordenados

- [ ] **Step 1: Criar a migration com os helpers e o artigo**

Crie `supabase/migrations/20260806000002_kb_primeiro_post_guide.sql`. Os helpers `_kb_pp_*` espelham `20260717000002`, inclusive o motivo de `r2Key` ser NULL.

```sql
-- Guia visual "Como agendar seu primeiro post".
--
-- Imagens sao nos inlineImage com r2Key = NULL e URL publica permanente do
-- bucket kb-images. r2Key TEM que continuar NULL: se fosse preenchido, o
-- leitor (ArtigoPage.tsx -> extractR2Keys) mandaria a chave para
-- sign-r2-urls, que so assina chaves sob o prefixo da propria conta do
-- chamador ou que batam exatamente com um cover_image_url publicado. Uma
-- imagem de corpo nao e nenhum dos dois, entao a assinatura falharia em
-- silencio e o src pre-assinado da autoria daria 403 uma hora depois.
--
-- Este arquivo tambem renumera a categoria primeiros-passos inteira. O
-- leitor ordena so por display_order (store/kb.ts:34), sem desempate, entao
-- empate significa ordem nao deterministica.

CREATE OR REPLACE FUNCTION _kb_pp_text(t text) RETURNS jsonb AS $$
  SELECT jsonb_build_object('type', 'text', 'text', t);
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION _kb_pp_p(t text) RETURNS jsonb AS $$
  SELECT jsonb_build_object('type', 'paragraph', 'content', jsonb_build_array(_kb_pp_text(t)));
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION _kb_pp_h(lvl int, t text) RETURNS jsonb AS $$
  SELECT jsonb_build_object('type', 'heading', 'attrs', jsonb_build_object('level', lvl), 'content', jsonb_build_array(_kb_pp_text(t)));
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION _kb_pp_callout(emoji text, color text, body text) RETURNS jsonb AS $$
  SELECT jsonb_build_object('type', 'callout', 'attrs', jsonb_build_object('emoji', emoji, 'color', color), 'content', jsonb_build_array(_kb_pp_p(body)));
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION _kb_pp_doc(VARIADIC nodes jsonb[]) RETURNS jsonb AS $$
  SELECT jsonb_build_object('type', 'doc', 'content', to_jsonb(nodes));
$$ LANGUAGE sql IMMUTABLE;

-- r2Key sempre NULL. Ver cabecalho.
CREATE OR REPLACE FUNCTION _kb_pp_img(src text, alt text) RETURNS jsonb AS $$
  SELECT jsonb_build_object('type', 'inlineImage', 'attrs', jsonb_build_object(
    'r2Key', NULL,
    'src', src,
    'alt', alt,
    'width', 1440,
    'height', 900,
    'blurSrc', NULL,
    'displayWidth', NULL,
    'loading', false
  ));
$$ LANGUAGE sql IMMUTABLE;

-- Atalho para a URL publica, que e deterministica a partir do nome do arquivo.
CREATE OR REPLACE FUNCTION _kb_pp_shot(file text, alt text) RETURNS jsonb AS $$
  SELECT _kb_pp_img(
    'https://skjzpekeqefvlojenfsw.supabase.co/storage/v1/object/public/kb-images/como-agendar-seu-primeiro-post/' || file,
    alt);
$$ LANGUAGE sql IMMUTABLE;

-- Lista ordenada onde cada passo carrega uma captura opcional embaixo do
-- texto. O content spec de listItem e "paragraph block*" e inlineImage e do
-- grupo 'block', entao [paragraph, inlineImage] e valido no schema.
-- images[i] pode ser NULL para passos sem captura.
CREATE OR REPLACE FUNCTION _kb_pp_ol(items text[], images jsonb[]) RETURNS jsonb AS $$
  SELECT jsonb_build_object('type', 'orderedList', 'attrs', jsonb_build_object('start', 1), 'content',
    (SELECT jsonb_agg(
      jsonb_build_object('type', 'listItem', 'content',
        CASE WHEN images[i] IS NULL
             THEN jsonb_build_array(_kb_pp_p(items[i]))
             ELSE jsonb_build_array(_kb_pp_p(items[i]), images[i])
        END)
      ORDER BY i
    ) FROM generate_subscripts(items, 1) AS i));
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION _kb_pp_plain(doc jsonb) RETURNS text AS $$
  WITH RECURSIVE nodes AS (
    SELECT doc AS node
    UNION ALL
    SELECT jsonb_array_elements(node->'content') AS node
    FROM nodes
    WHERE node->'content' IS NOT NULL AND jsonb_typeof(node->'content') = 'array'
  )
  SELECT coalesce(string_agg(node->>'text', ' '), '')
  FROM nodes
  WHERE node->>'type' = 'text';
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION _kb_pp_upsert(
  p_id uuid, p_title text, p_slug text, p_excerpt text, p_content jsonb,
  p_category text, p_tags text[], p_display_order integer
) RETURNS void AS $$
BEGIN
  INSERT INTO kb_articles (id, title, slug, excerpt, content, content_plain, category, tags, status, display_order)
  VALUES (p_id, p_title, p_slug, p_excerpt, p_content, _kb_pp_plain(p_content), p_category, p_tags, 'published', p_display_order)
  ON CONFLICT (slug) DO UPDATE SET
    title = EXCLUDED.title,
    excerpt = EXCLUDED.excerpt,
    content = EXCLUDED.content,
    content_plain = EXCLUDED.content_plain,
    category = EXCLUDED.category,
    tags = EXCLUDED.tags,
    status = EXCLUDED.status,
    display_order = EXCLUDED.display_order;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION _kb_pp_link(
  p_route_pattern text, p_slug text, p_label text, p_display_order integer
) RETURNS void AS $$
DECLARE
  v_article_id uuid;
BEGIN
  SELECT id INTO v_article_id FROM kb_articles WHERE slug = p_slug;
  IF v_article_id IS NULL THEN
    RAISE EXCEPTION 'KB article slug not found: %', p_slug;
  END IF;
  INSERT INTO kb_context_links (route_pattern, article_id, label, display_order)
  VALUES (p_route_pattern, v_article_id, p_label, p_display_order)
  ON CONFLICT (route_pattern, article_id) DO UPDATE SET
    label = EXCLUDED.label,
    display_order = EXCLUDED.display_order;
END;
$$ LANGUAGE plpgsql;
```

- [ ] **Step 2: Escrever o corpo do artigo**

Continua no mesmo arquivo. Toda a copy abaixo é final, e nenhuma linha usa travessão.

```sql
SELECT _kb_pp_upsert(
  'aaaaaaaa-001a-4000-a000-00000000001a',
  'Como agendar seu primeiro post',
  'como-agendar-seu-primeiro-post',
  'Do workspace vazio ao primeiro post agendado, com uma imagem em cada passo.',
  _kb_pp_doc(
    _kb_pp_h(2, 'O que você vai precisar'),
    _kb_pp_p('Este guia vai do workspace recém-criado até um post agendado no Instagram. São sete etapas e cada uma tem imagem. Se você já cumpriu alguma delas, use o índice ao lado para pular direto.'),
    _kb_pp_callout('⏱️', 'blue', 'Separe cerca de 20 minutos. A parte mais demorada é conectar o Instagram, porque depende da autorização pelo Facebook.'),

    _kb_pp_h(2, '1. Cadastre o cliente'),
    _kb_pp_p('Tudo no Mesaas se organiza por cliente: entregas, financeiro, calendário e analytics. Sem um cliente cadastrado, não há onde o post morar.'),
    _kb_pp_ol(
      ARRAY[
        'Abra Clientes no menu lateral',
        'Clique em Novo Cliente',
        'Preencha nome, e-mail e telefone de contato',
        'Informe plano, valor mensal, dia de pagamento e dia de entrega, e salve'
      ],
      ARRAY[
        _kb_pp_shot('01-abrir-clientes.png', 'Lista de clientes, com o botão Novo Cliente no topo.'),
        _kb_pp_shot('02-novo-cliente.png', 'Formulário de novo cliente recém-aberto, ainda vazio.'),
        _kb_pp_shot('03-preencher-dados.png', 'Formulário com nome, e-mail e telefone preenchidos.'),
        _kb_pp_shot('04-plano-e-valores.png', 'Bloco de plano e valores do formulário, com valor mensal preenchido.')
      ]
    ),

    _kb_pp_h(2, '2. Monte sua equipe'),
    _kb_pp_p('Existem duas coisas diferentes aqui, e confundi-las é comum. Um membro da Equipe é um registro de pessoa ou fornecedor: serve para custos e para ser escolhido como responsável por etapas e posts. Um usuário do workspace é alguém com login no CRM. A mesma pessoa pode ser os dois, e nesse caso você vincula um ao outro.'),
    _kb_pp_ol(
      ARRAY[
        'Abra Equipe no menu lateral',
        'Clique em Adicionar Membro',
        'Informe nome e cargo',
        'Escolha o tipo de vínculo: CLT, freelancer mensal ou freelancer por demanda, e salve',
        'Para dar acesso ao CRM, use Convidar para o workspace e escolha o papel da pessoa'
      ],
      ARRAY[
        _kb_pp_shot('05-abrir-equipe.png', 'Página de Equipe, com a lista de membros e o botão Adicionar Membro.'),
        _kb_pp_shot('06-adicionar-membro.png', 'Formulário de novo membro recém-aberto.'),
        _kb_pp_shot('07-dados-do-membro.png', 'Formulário com nome e cargo preenchidos.'),
        _kb_pp_shot('08-tipo-de-vinculo.png', 'Campo de tipo de vínculo do formulário de membro.'),
        _kb_pp_shot('09-convidar-usuario.png', 'Bloco Convidar para o workspace, com campo de e-mail e seletor de papel.')
      ]
    ),
    _kb_pp_callout('💡', 'blue', 'O convite vira acesso só depois que a pessoa aceita o e-mail. Enquanto isso, ela não aparece como responsável em etapas nem em posts. Para poder atribuir tarefas agora, cadastre o membro de Equipe, que é independente do convite.'),
    _kb_pp_p('Papéis e o que cada um enxerga estão detalhados no artigo Permissões e papéis no workspace.'),

    _kb_pp_h(2, '3. Conecte o Instagram do cliente'),
    _kb_pp_p('Sem conta conectada não existe agendamento, publicação nem analytics. A conta precisa ser profissional, comercial ou de criador, e estar vinculada a uma página do Facebook.'),
    _kb_pp_ol(
      ARRAY[
        'Abra o cliente na lista de Clientes',
        'Vá até a seção de Instagram na página do cliente',
        'Clique em Conectar Instagram',
        'Autorize o acesso na tela do Facebook',
        'Escolha a página vinculada à conta do cliente',
        'Confirme as permissões, incluindo a de publicação'
      ],
      ARRAY[
        _kb_pp_shot('10-abrir-cliente.png', 'Página de detalhe do cliente, com o cabeçalho e as seções disponíveis.'),
        _kb_pp_shot('11-secao-instagram.png', 'Seção de Instagram na página do cliente, com o painel da conta.'),
        _kb_pp_shot('12-conectar-instagram.png', 'Botão Conectar Instagram, para um cliente que ainda não tem conta vinculada.'),
        NULL,
        NULL,
        NULL
      ]
    ),
    _kb_pp_callout('⚠️', 'orange', 'Confirme a permissão de publicação nessa tela. Sem ela a conta conecta, os analytics funcionam, e o agendamento falha depois. É a causa mais comum de falha de publicação.'),
    _kb_pp_p('Se a conta não aparecer na lista de páginas, ou se a autorização falhar, o artigo Como conectar o Instagram cobre cada erro em detalhe.'),

    _kb_pp_h(2, '4. Crie o fluxo de entrega'),
    _kb_pp_p('Um fluxo é o pacote de trabalho de um mês, uma campanha ou um lote de conteúdo. Ele tem etapas, responsáveis e prazos, e é dentro dele que os posts vivem.'),
    _kb_pp_ol(
      ARRAY[
        'Abra Entregas no menu lateral',
        'Clique em Novo Fluxo',
        'Escolha um template ou comece do zero',
        'Revise as etapas: produção, revisão, aprovação e publicação',
        'Defina responsável e prazo de cada etapa, e salve'
      ],
      ARRAY[
        _kb_pp_shot('16-abrir-entregas.png', 'Página de Entregas no modo kanban, com o botão Novo Fluxo.'),
        _kb_pp_shot('17-novo-fluxo.png', 'Diálogo de novo fluxo recém-aberto.'),
        _kb_pp_shot('18-escolher-template.png', 'Seleção de template do fluxo.'),
        _kb_pp_shot('19-etapas-do-fluxo.png', 'Lista de etapas do fluxo sendo montada.'),
        _kb_pp_shot('20-responsavel-e-prazo.png', 'Campos de responsável e prazo de uma etapa.')
      ]
    ),
    _kb_pp_callout('💡', 'blue', 'Inclua uma etapa de aprovação do cliente. É ela que destrava o agendamento, como você vai ver na etapa 6.'),

    _kb_pp_h(2, '5. Crie o post dentro do fluxo'),
    _kb_pp_p('Abra o fluxo para ver a gaveta da entrega. É ali que o post ganha tipo, mídia e legenda.'),
    _kb_pp_ol(
      ARRAY[
        'Clique no card do fluxo para abrir a gaveta',
        'Adicione um post à lista',
        'Escolha o tipo, feed, reels, stories ou carrossel, e dê um título',
        'Envie a mídia do computador, ou escolha um arquivo já salvo em Arquivos',
        'Escreva a legenda do Instagram, com até 2.200 caracteres'
      ],
      ARRAY[
        _kb_pp_shot('21-abrir-gaveta.png', 'Gaveta da entrega aberta, mostrando etapas e posts.'),
        _kb_pp_shot('22-novo-post.png', 'Área de posts da gaveta, com a opção de adicionar um post.'),
        _kb_pp_shot('23-tipo-e-titulo.png', 'Campos de tipo e título do post preenchidos.'),
        _kb_pp_shot('24-enviar-midia.png', 'Área de mídia do post, com um arquivo enviado.'),
        _kb_pp_shot('25-escrever-legenda.png', 'Campo de legenda do Instagram preenchido, com o contador de caracteres.')
      ]
    ),
    _kb_pp_callout('⚠️', 'orange', 'Reels e vídeos podem exigir thumbnail antes de publicar. Se o campo aparecer, preencha agora, porque a falta dele só reaparece como erro na hora de agendar.'),

    _kb_pp_h(2, '6. Aprove o post'),
    _kb_pp_p('Se você chegou até aqui procurando o botão de agendar e não achou, o motivo é este: o agendamento só aparece depois que o post está aprovado. Em rascunho, em revisão ou aprovado apenas internamente, não existe botão de agendar na tela.'),
    _kb_pp_p('Ao avançar a etapa de aprovação do fluxo, o Mesaas pergunta como você quer resolver a aprovação. São dois caminhos e ambos levam ao mesmo lugar.'),
    _kb_pp_ol(
      ARRAY[
        'Na página de Entregas, avance a etapa de aprovação do fluxo',
        'Escolha Aprovar internamente para aprovar sem enviar ao cliente, ou Enviar ao portal para que o cliente aprove pelo Hub',
        'Confirme que o post ficou como Aprovado pelo cliente'
      ],
      ARRAY[
        _kb_pp_shot('26-avancar-etapa.png', 'Card do fluxo no kanban, na etapa de aprovação.'),
        _kb_pp_shot('27-dialogo-de-aprovacao.png', 'Diálogo de aprovação, com as opções de aprovar internamente e enviar ao portal.'),
        _kb_pp_shot('28-post-aprovado.png', 'Post com o status Aprovado pelo cliente.')
      ]
    ),
    _kb_pp_callout('💡', 'blue', 'Aprovar internamente serve para o primeiro post, para testes e para clientes que aprovam por fora do sistema. Quando quiser que o cliente aprove pelo portal, veja o artigo Como o cliente aprova posts pelo Hub.'),

    _kb_pp_h(2, '7. Agende a publicação'),
    _kb_pp_p('Com o post aprovado, o bloco de publicação aparece na gaveta.'),
    _kb_pp_ol(
      ARRAY[
        'Defina data e horário da publicação',
        'Clique em Agendar',
        'Confirme que o post mostra o selo Agendado',
        'Se precisar mudar algo, use Cancelar para liberar a edição e agende de novo'
      ],
      ARRAY[
        _kb_pp_shot('29-definir-data-e-horario.png', 'Campos de data e horário do post preenchidos.'),
        _kb_pp_shot('30-botao-agendar-habilitado.png', 'Botão Agendar habilitado no bloco de publicação.'),
        _kb_pp_shot('31-post-agendado.png', 'Post com o selo Agendado e o botão de cancelar ao lado.'),
        _kb_pp_shot('32-cancelar-agendamento.png', 'Botão Cancelar do agendamento.')
      ]
    ),
    _kb_pp_callout('⚠️', 'orange', 'Depois de agendado, a data e a legenda do Instagram ficam travadas. Para editar, cancele o agendamento primeiro.'),
    _kb_pp_p('Se o botão Agendar aparecer desabilitado, falta algo: data, legenda do Instagram, ou permissão de publicação na conta conectada. A própria tela indica o que está faltando.'),

    _kb_pp_h(2, 'E agora?'),
    _kb_pp_p('O post agendado aparece no calendário do cliente e no fluxo. Na hora marcada, o Mesaas publica sozinho e o status muda para Postado.'),
    _kb_pp_ol(
      ARRAY['Acompanhe pelo Calendário, pelas Entregas ou pelo Hub do cliente'],
      ARRAY[_kb_pp_shot('33-acompanhar-no-calendario.png', 'Calendário com o post agendado marcado na data.')]
    ),
    _kb_pp_p('Se a publicação falhar, o post mostra o motivo e um botão de tentar novamente. O artigo Agendar, publicar agora e resolver falhas no Instagram cobre cada erro possível.')
  ),
  'primeiros-passos',
  ARRAY['primeiro post', 'agendamento', 'onboarding', 'passo a passo', 'instagram', 'fluxo', 'aprovacao', 'equipe', 'cliente'],
  3
);
```

- [ ] **Step 3: Renumerar a categoria e os links de contexto**

Continua no mesmo arquivo. Sem isso, o artigo novo empata com `primeiros-30-minutos-no-mesaas` e a ordem da lista fica indefinida.

```sql
-- Renumeracao da categoria primeiros-passos. O leitor ordena so por
-- display_order, sem desempate, entao empate = ordem nao deterministica.
-- Ordem final: 1 bem-vindo, 2 configurar workspace, 3 primeiro post (novo),
-- 4 primeiros 30 minutos, 5 permissoes, 6 importacoes.
UPDATE kb_articles SET display_order = 4 WHERE slug = 'primeiros-30-minutos-no-mesaas';
UPDATE kb_articles SET display_order = 5 WHERE slug = 'permissoes-e-papeis-no-workspace';
UPDATE kb_articles SET display_order = 6 WHERE slug = 'importacoes-via-csv-no-mesaas';

-- Links de contexto de /dashboard. As tres chamadas sao reemitidas com as
-- ordens explicitas: _kb_pp_link faz ON CONFLICT DO UPDATE, entao nao ha
-- necessidade de DELETE.
SELECT _kb_pp_link('/dashboard', 'como-agendar-seu-primeiro-post', 'Agendar o primeiro post', 0);
SELECT _kb_pp_link('/dashboard', 'bem-vindo-ao-mesaas', NULL, 1);
SELECT _kb_pp_link('/dashboard', 'primeiros-30-minutos-no-mesaas', 'Primeiros passos', 2);

-- Limpeza dos helpers, seguindo o padrao das migrations anteriores.
DROP FUNCTION IF EXISTS _kb_pp_link(text, text, text, integer);
DROP FUNCTION IF EXISTS _kb_pp_upsert(uuid, text, text, text, jsonb, text, text[], integer);
DROP FUNCTION IF EXISTS _kb_pp_plain(jsonb);
DROP FUNCTION IF EXISTS _kb_pp_ol(text[], jsonb[]);
DROP FUNCTION IF EXISTS _kb_pp_shot(text, text);
DROP FUNCTION IF EXISTS _kb_pp_img(text, text);
DROP FUNCTION IF EXISTS _kb_pp_doc(jsonb[]);
DROP FUNCTION IF EXISTS _kb_pp_callout(text, text, text);
DROP FUNCTION IF EXISTS _kb_pp_h(int, text);
DROP FUNCTION IF EXISTS _kb_pp_p(text);
DROP FUNCTION IF EXISTS _kb_pp_text(text);
```

- [ ] **Step 4: Rodar o teste de guarda e confirmar que passa**

```bash
npx vitest run apps/crm/src/pages/ajuda/__tests__/primeiroPostArticle.test.ts
```

Esperado: PASS, três casos. Se o caso do travessão falhar, procure `—` no arquivo e troque por ponto ou dois-pontos.

- [ ] **Step 5: Conferir o prefixo de versão contra main**

Colisão de prefixo faz a segunda migration ser silenciosamente ignorada no banco remoto, e já aconteceu duas vezes neste repositório.

```bash
git ls-tree origin/main:supabase/migrations --name-only | tail -3
```

Esperado: nenhum arquivo com prefixo `20260806000002`. Se houver, renomeie o seu para um número acima da cauda de `main`.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260806000002_kb_primeiro_post_guide.sql
git commit -m "feat(ajuda): artigo visual Como agendar seu primeiro post"
```

---

### Task 8: Documento de capturas externas

**Files:**
- Create: `docs/superpowers/plans/2026-08-06-primeiro-post-external-shots.md`

**Interfaces:**
- Consumes: nada
- Produces: instruções para o usuário capturar 3 PNGs do Facebook

- [ ] **Step 1: Escrever o documento**

```markdown
# Capturas externas: guia do primeiro post

Três passos da etapa 3 do artigo `como-agendar-seu-primeiro-post` acontecem em telas do
Facebook, fora do Mesaas. O script de captura não alcança essas telas.

**Você captura, eu subo e autoro.** Deixe cada PNG no caminho da tabela, dentro de
`e2e/.shots/como-agendar-seu-primeiro-post/`, e me avise.

O artigo já está publicado com esses três slots vazios. O passo aparece com texto e sem
imagem, o que é o comportamento normal do helper. Nada quebra enquanto eles não chegarem.

## Configuração da captura

Para casar com as capturas automáticas: janela de navegador com cerca de 1440 de largura,
zoom normal, modo claro. Capture a aba do navegador, não a tela inteira. Formato PNG.

## Redação, confira antes de entregar

Depois de publicado, isso fica visível para todos os clientes. Borre ou corte:

- Seu e-mail e sua foto de perfil, que o Facebook mostra
- Nomes de páginas e de clientes reais no seletor de páginas, que é o maior risco do conjunto
- Qualquer workspace não relacionado a uma demonstração limpa

## As três capturas

| Arquivo | Tela | Estado necessário |
|---|---|---|
| `ext-13-facebook-autorizar.png` | Autorização do Facebook | A tela de "continuar como…" com a lista de permissões |
| `ext-14-selecionar-pagina.png` | Seletor de página vinculada | A lista de escolha de página, de preferência com mais de uma opção, para que a instrução de escolher a certa faça sentido |
| `ext-15-confirmar-permissoes.png` | Confirmação de permissões | A lista final de acessos concedidos, com a permissão de publicação visível e o botão de confirmar |

`ext-15` é a mais importante do conjunto. A permissão de publicação é a causa mais comum
de falha de agendamento, e o artigo pede em texto que o leitor a confirme nessa tela.

Este fluxo só aparece durante uma conexão real, e a tela de consentimento não volta sem
desconectar antes. Se tiver uma página de teste, conectá-la é o caminho mais seguro.

## Quando os arquivos estiverem no lugar

Me avise. Eu rodo:

    node --env-file=.env.kb-upload.local scripts/upload-kb-images.mjs como-agendar-seu-primeiro-post

e preencho os três slots `NULL` da etapa 3 na migration.
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/plans/2026-08-06-primeiro-post-external-shots.md
git commit -m "docs: lista de capturas externas do guia de primeiro post"
```

---

### Task 9: Verificação completa

**Files:**
- Nenhum. Roda o que o CI roda e confere o artigo no navegador.

**Interfaces:**
- Consumes: tudo das tasks anteriores
- Produces: evidência de que a branch está pronta para PR

- [ ] **Step 1: Format e lint**

```bash
npm run format && npm run lint
```

Esperado: sem erro. `npm run format` reescreve arquivos, então confira `git status` depois e commite se algo mudou.

- [ ] **Step 2: Os quatro typechecks que o CI roda**

`npm run build` cobre só o CRM. O CI checa os quatro projetos separadamente.

```bash
npx tsc -p apps/crm/tsconfig.json   --noEmit
npx tsc -p apps/hub/tsconfig.json   --noEmit
npx tsc -p apps/admin/tsconfig.json --noEmit
npx tsc -p tsconfig.scripts.json
```

Esperado: os quatro sem saída.

- [ ] **Step 3: Suíte de testes**

```bash
npm run test
```

Esperado: PASS, incluindo `primeiroPostArticle.test.ts`, `safety.test.ts` e `uploadKbImages.test.mjs`.

- [ ] **Step 4: Suíte das edge functions**

```bash
npm run test:functions
git checkout -- deno.lock
```

Esperado: PASS. O `git checkout` é obrigatório: rodar deno suja o `deno.lock` da raiz, e o lock sujo quebra `npm ci` no CI.

- [ ] **Step 5: Aplicar a migration em staging**

```bash
cat supabase/.temp/project-ref
```

Se não for `wlyzhyfondykzpsiqsce`, linke staging antes:

```bash
npx supabase link --project-ref wlyzhyfondykzpsiqsce
npx supabase db push --linked
```

- [ ] **Step 6: Ler o artigo no navegador**

```bash
npm run dev:staging
```

Abra `http://localhost:5173/ajuda/artigo/como-agendar-seu-primeiro-post` e confirme, um a um:

- As 30 imagens renderizam. Nenhuma quebrada, nenhum ícone de imagem faltando
- Os três passos do Facebook aparecem com texto e sem imagem, sem espaço quebrado
- O índice lateral lista as nove seções
- A Central de Ajuda mostra o guia na posição 3 de Primeiros Passos, com `primeiros-30-minutos-no-mesaas` logo abaixo
- O Dashboard mostra o guia como primeiro link de ajuda contextual
- Nenhum travessão no texto renderizado

- [ ] **Step 7: Confirmar que as imagens não expiram**

O modo de falha que este design existe para evitar aparece só depois de uma hora. Abra o artigo numa janela anônima, sem sessão, e confirme que as imagens carregam. URL pública não depende de sessão nem de assinatura, então isso prova o caminho.

- [ ] **Step 8: Reconferir o prefixo da migration antes de abrir o PR**

```bash
git fetch origin main && git ls-tree origin/main:supabase/migrations --name-only | tail -3
```

Se `main` avançou e alguém adicionou uma migration com o mesmo prefixo, renomeie a sua agora, antes do PR.

- [ ] **Step 9: Commit final**

```bash
git status
```

Se `npm run format` mudou algo, commite:

```bash
git add -A
git commit -m "chore: format"
```

---

## Notas de execução

**Tasks 1 e 2 são independentes de tudo o mais.** Podem ir num PR próprio se o guia
demorar, e valem por si: a lacuna do TikTok e o upload sem filtro são riscos que existem
hoje.

**A Task 3 pode parar o trabalho.** Se não houver post apto em produção, o plano manda
perguntar em vez de decidir. Não contorne.

**A Task 5 é barreira humana.** Nenhum byte sobe para o bucket público sem o usuário ter
olhado as capturas.
