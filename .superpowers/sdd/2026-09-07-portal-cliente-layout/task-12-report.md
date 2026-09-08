# Task 12 report: script de conversão das páginas existentes

## Status: DONE_WITH_CONCERNS

## O que foi feito

- Criado `scripts/convert-hub-pages-richtext.ts`: `PageRow`, `Db`, `Report`
  e `convert()` conforme o brief, com um desvio deliberado do Step 4 (ver
  "Os dois bloqueadores" abaixo) -- usa `readPageDocResult` em vez de
  `readPageDoc`, e trata `converted:false` como falha dura registrada em
  `report.failed`, nunca escrita.
- `main()` (CLI): backup em JSON antes de qualquer escrita, `--dry-run` por
  padrão exigindo `--apply`, relatório final com as quatro listas. Duas
  formas de conexão (ver "Conexão" abaixo).
- Testes: `scripts/__tests__/convert-hub-pages-richtext.test.ts` (as 4 do
  brief + 2 extras: array vazio/`content` não-array cai em `skipped`, e
  erro em `updateIfUnchanged` cai em `failed`) e
  `scripts/__tests__/convert-hub-pages-richtext.fallback.test.ts` (novo,
  cobrindo o caso `converted:false` com `vi.mock('@tiptap/html', ...)`,
  no mesmo padrão de `pageContent.fallback.test.ts` -- arquivo separado
  para não contaminar os testes que precisam do `generateJSON` real).

## Os dois bloqueadores do brief

**1. `tsconfig.scripts.json` sem `@/*`.** Resolvido adicionando
`"baseUrl": "."` + `"paths": { "@/*": ["apps/crm/src/*"] }` ao
`tsconfig.scripts.json`, em vez de importar por caminho relativo. Motivo:
`pageContent.ts` importa `pageEditorSchema.ts`, que importa
`@/pages/entregas/components/CalloutExtension` -- é a própria Task 8 que
documenta essa cadeia como intencionalmente compartilhada entre editor,
conversor e este script ("o script de migração usa este mesmo array"), então
reescrever esse import para caminho relativo teria significado editar
código de outra task só para meu benefício. A mesma edição também exigiu
`"lib": ["ES2022", "DOM", "DOM.Iterable"]` (ausente antes -- o alvo `ES2022`
sozinho não traz tipos de DOM, e `CalloutExtension.tsx` usa
`document`/`HTMLButtonElement`/etc.) e duas entradas novas em `include`
(`scripts/convert-hub-pages-richtext.ts` e os dois arquivos de teste --
`include` só define as raízes; os arquivos importados transitivamente,
como `pageContent.ts`, entram no programa sozinhos, sem precisar de glob).
Também precisei somar `'scripts/**/*.test.ts'` ao `include` do
`vitest.config.ts`, que antes só cobria `scripts/**/*.test.mjs` -- sem isso
`npx vitest run scripts/` reportaria sucesso sem nunca ter coletado os
testes novos.

**2. `readPageDoc` não expõe falha de conversão.** Resolvido usando
`readPageDocResult` em vez de `readPageDoc` dentro de `convert()`, e
tratando `converted === false` como entrada em `report.failed` (nunca
escrita). Isso é uma mudança em relação à implementação literal do Step 4
do brief, exigida pelo enunciado da task; os 4 testes do Step 2 continuam
passando sem alteração porque `'# A'` converte de verdade (`converted:true`)
-- o novo comportamento só aparece no teste dedicado do arquivo
`.fallback.test.ts`.

## Conexão (não especificada no brief, decisão minha)

O brief não define como `main()` se conecta ao banco. Implementei duas
formas, nesta ordem de preferência:

1. **Service role** (`SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` no
   ambiente) -- ignora RLS, único jeito de enxergar as 29 linhas em 21
   workspaces diferentes. É o modo esperado para a migração real.
2. **Fallback escopado por RLS** (sem service role key): lê
   `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` + `SEED_EMAIL` +
   `SEED_PASSWORD` de `.env` (ou `.env.staging` com `--staging`) e faz
   login, no mesmo padrão de `scripts/seed-demo.mjs`. Enxerga só o
   workspace daquele usuário. Implementei isso especificamente para poder
   cumprir a verificação pedida nesta task contra staging, onde não há
   `SUPABASE_SERVICE_ROLE_KEY` disponível neste worktree (só existe nos
   secrets das edge functions, não em `.env.staging` do frontend). Emite um
   aviso explícito no console quando cai nesse modo.

Isso não estava no brief e é uma decisão de projeto minha -- se preferir
que `main()` exija só service role (falhando explicitamente sem ele), é uma
mudança pequena e localizada em `connect()`.

## Verificação

`npx vitest run scripts/`:
```
Test Files  6 passed (6)
     Tests  19 passed (19)
```
(as 6 do brief + 6 na `.test.ts` + 2 na `.fallback.test.ts`, mais os
arquivos `.test.mjs` pré-existentes de `scripts/`.)

`npx vitest run` (suíte inteira): 522 arquivos, 5425 testes, todos
passando.

`npx tsc -p tsconfig.scripts.json`: limpo.
`npx tsc -p apps/crm/tsconfig.json --noEmit`: limpo.
`npx tsc -p apps/hub/tsconfig.json --noEmit`: limpo.
`npx tsc -p apps/admin/tsconfig.json --noEmit`: limpo.

`npm run lint`: 0 erros, 85 warnings pré-existentes em arquivos não tocados
por esta task (confirmado rodando eslint isolado nos 3 arquivos novos: zero
saída).

`npx prettier --check` nos arquivos tocados (`scripts/convert-hub-pages-richtext.ts`,
os dois arquivos de teste, `tsconfig.scripts.json`, `vitest.config.ts`): OK
(um `--write` foi necessário na primeira passada do script principal).

`npm run test:functions`: 2816 testes Deno, todos passando. Sujou
`node_modules/.deno` e `deno.lock` como o esperado -- rodei `npm ci` (1122
pacotes reinstalados) e `git checkout -- deno.lock` depois, confirmando
`tsc`/`vitest` limpos de novo em seguida.

`grep -rn "useBlocker" apps/` (excluindo `silent-update`): só comentários e
uma asserção de teste que verifica a ausência de `useBlocker` -- nenhuma
ocorrência real.

### Dry run contra staging (dado real, nada escrito)

Rodado com `.env.staging` (ref `wlyzhyfondykzpsiqsce`), sem `--apply`:

```
npx tsx --tsconfig tsconfig.scripts.json scripts/convert-hub-pages-richtext.ts --staging

DRY RUN. No writes will occur.
WARNING: no SUPABASE_SERVICE_ROLE_KEY set. Running RLS-scoped as a single workspace user...
Read 0 row(s) from hub_pages (RLS-scoped).

=== Report ===
converted (0): []
skipped (0): []
raced (0): []
failed (0):
```

O script rodou de ponta a ponta contra o Supabase de staging de verdade:
importou `pageContent.ts` (confirmando que a resolução do import solto de
`@tiptap/html`, documentada no topo daquele arquivo, funciona também sob
`tsx` puro, não só Vite/vitest), autenticou com `SEED_EMAIL`/`SEED_PASSWORD`,
consultou `hub_pages` e imprimiu o relatório com as quatro listas -- mas o
workspace daquele usuário não tem nenhuma linha em `hub_pages`.

**Staging não tem NENHUMA linha em `hub_pages`, em nenhum workspace** --
confirmei isso à parte, fora do script, com uma query somente leitura via
`npx supabase db query --linked` (link trocado com cuidado para
`wlyzhyfondykzpsiqsce`, verificado antes e depois, e devolvido para
`skjzpekeqefvlojenfsw` -- prod -- ao final, no estado em que encontrei):

```sql
SELECT count(*) AS total,
       count(*) FILTER (WHERE content = '[]'::jsonb) AS empty_content,
       count(*) FILTER (WHERE content @> '[{"type":"richtext"}]'::jsonb) AS already_richtext
FROM hub_pages;
-- total: 0, empty_content: 0, already_richtext: 0
```

Então, como a task pede para dizer explicitamente: **não há dado real em
staging para exercitar o caminho de conversão** (`skipped`/`converted`
diferentes de zero). O que foi comprovado contra staging é a conectividade,
autenticação, leitura, e a impressão correta de um relatório vazio -- não a
lógica de conversão em si, que só foi exercitada pelos testes unitários com
o `Db` fake. Não tentei nenhuma alternativa para popular `hub_pages` em
staging (fora de escopo desta task, e mexeria em dado de outro ambiente sem
pedido explícito).

## Rollout -- comando para a migração real

Depois do deploy das duas functions (`mcp`, `hub-pages`) e do merge,
conforme o "Rollout" do brief:

```bash
# 1. Dry run (sempre primeiro, mesmo já tendo rodado nesta task -- rodar de novo
#    após o merge, contra prod, para conferir a leitura real):
SUPABASE_URL=<prod-url> SUPABASE_SERVICE_ROLE_KEY=<prod-service-role-key> \
  npx tsx --tsconfig tsconfig.scripts.json scripts/convert-hub-pages-richtext.ts

# 2. Conferir o relatório (as 4 listas). Se "failed" não estiver vazio, parar e investigar
#    antes de aplicar -- são linhas que readPageDocResult não conseguiu converter.

# 3. Aplicar:
SUPABASE_URL=<prod-url> SUPABASE_SERVICE_ROLE_KEY=<prod-service-role-key> \
  npx tsx --tsconfig tsconfig.scripts.json scripts/convert-hub-pages-richtext.ts --apply

# 4. Conferir o backup gerado em scripts/backups/hub-pages-backup-<timestamp>.json
#    (id + content de cada linha, exatamente como lida, escrito ANTES da primeira escrita).

# 5. Se "raced" não estiver vazio, rodar de novo (só essas linhas mudaram de content
#    entre leitura e escrita -- provavelmente alguém salvou a página manualmente nesse meio-tempo).
```

Esse comando real com `--apply` **não foi executado** nesta task, por
instrução explícita ("Do NOT run it with --apply against anything").

## Rollback

O arquivo de backup é um array JSON de `{ id, content }`, exatamente como
lido antes de qualquer escrita. Para reverter uma linha:

```sql
UPDATE hub_pages
SET content = '<content daquele id, copiado do arquivo de backup>'::jsonb
WHERE id = '<id>';
```

Repetir por linha para quantas precisarem reverter. O arquivo inteiro cobre
todas as linhas lidas na mesma execução (não só as convertidas), então
também serve para reverter linhas que ficaram em `raced` caso, por engano,
alguém force uma escrita nelas depois.

## Concerns

1. **Staging não tem dado real para exercitar a conversão** (ver acima) --
   a prova "contra dado real" ficou limitada a conectividade/autenticação/
   leitura/relatório vazio. A lógica de conversão em si só tem cobertura de
   teste unitário (`Db` fake) e checagem estática dos tipos/imports. Julgo
   isso aceitável dado que staging genuinamente não tem hub_pages, mas
   registro para quem revisar decidir se quer mais garantia antes do
   `--apply` em produção (por exemplo, com um dry run script criando 1-2
   linhas de teste em staging antes de rodar -- não fiz isso por não ter
   sido pedido e por mexer em dado fora do escopo da task).
2. **Decisão de conexão dupla (service role vs. RLS-scoped) não estava no
   brief** -- documentei o raciocínio acima; é reversível com uma mudança
   pequena caso prefiram exigir só service role.
3. **Backup só é gravado em disco quando `--apply` é passado**, não em dry
   run -- interpretação minha de "antes de qualquer escrita" (não há
   escrita nenhuma em dry run, então nada para proteger). Se quiserem um
   backup também em dry run (por exemplo, para ter um snapshot histórico
   mesmo sem aplicar), é uma mudança de uma linha em `main()`.
4. Nenhuma ocorrência de em dash (U+2014) confirmada por grep nos arquivos
   novos.

## Commit

`feat(portal): script de conversão das páginas legadas` -- inclui
`scripts/convert-hub-pages-richtext.ts`, os dois arquivos de teste,
`tsconfig.scripts.json`, `vitest.config.ts` e `.gitignore`
(`scripts/backups/` adicionado -- os backups contêm conteúdo de cliente e
nunca devem ser versionados).
