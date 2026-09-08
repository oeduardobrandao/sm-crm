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

## Fix round 1 (revisão externa)

Seis achados de uma revisão externa (nível CRITICAL a Minor). Todos corrigidos
em `scripts/convert-hub-pages-richtext.ts`, `scripts/__tests__/`, `.gitignore`.

### 1. [CRITICAL] `.eq('content', expected as never)` era um no-op silencioso

Confirmado: `postgrest-js` serializa o valor de `.eq()` com template literal.
`expected` é um array de objetos JS, então vira o texto literal
`[object Object]`, não JSON -- Postgres rejeita contra a coluna `jsonb`
(22P02, HTTP 400). `updateIfUnchanged` lançava, `convert()` capturava, e as
29 linhas de produção cairiam todas em `failed`, sem nada escrito. E o dry
run nunca chega a chamar `updateIfUnchanged`, então nunca revelaria isso.

`JSON.stringify(expected)` também não resolve: até ~46.858 caracteres,
~70-110 KB de URL após percent-encoding -- Cloudflare corta em 16 KB (414
antes de chegar no Postgres).

**Fix aplicado** -- trocado por uma checagem que codifica a ameaça real (a
única escrita que o editor ao vivo pode fazer é `[{type:"richtext", doc}]`,
ver `writePageContent`), não igualdade de conteúdo completo:

```ts
.eq('id', id)
.not('content', 'cs', '[{"type":"richtext"}]')
```

Removido o `as never` (o compilador estava certo -- não era um operando de
filtro representável). `createSupabaseDb` agora é exportado. Documentado o
desvio no comentário de topo do arquivo, no JSDoc de `Db.updateIfUnchanged`
e inline em `createSupabaseDb`, explicando por que `content = $2` nunca
funcionaria (serialização + limite de URL) para que ninguém "restaure" a
versão quebrada depois.

**Teste novo** (pedido explicitamente pela task): `scripts/__tests__/convert-hub-pages-richtext.db.test.ts`
monta um `SupabaseClient` real via `createClient()` com `fetch` stubado,
chama `createSupabaseDb(client).updateIfUnchanged(...)` e inspeciona a URL
que o postgrest-js realmente monta -- não um mock da interface `Db`. Isso é
exatamente o que teria pego o bug original: os 6 testes existentes mockavam
`Db` inteiro e nunca olhavam para a requisição real.

URL construída pelo request de teste (path + query, decodificada):

```
/rest/v1/hub_pages?id=eq.p1&content=not.cs.[{"type":"richtext"}]&select=id
```

O teste também afirma que `[object Object]` (codificado ou não) nunca
aparece na URL, e que o comprimento fica bem abaixo de qualquer limite são.

### 2. [Important] `--apply` não era bloqueado em modo RLS-scoped

Fix em `main()`, logo após `connect()`:

```ts
if (apply && scoped) {
  throw new Error('--apply requires SUPABASE_SERVICE_ROLE_KEY. RLS-scoped mode is read-only.');
}
```

O novo modo `--restore` (item 4) recebeu a mesma trava.

### 3. [Important] Rollout documentado colocava a service-role key na linha de comando

`connect()` agora também lê `SUPABASE_SERVICE_ROLE_KEY` de `fileEnv` (o mesmo
arquivo `.env`/`.env.staging` já usado para url/anon/email/password no
fallback RLS-scoped), não só de `process.env`. O comentário de topo do
arquivo documenta o novo fluxo recomendado: um `.env.migration` gitignorado
na raiz do repo, fonteado via `set -a; . ./.env.migration; set +a` antes de
rodar o script -- nada de segredo na linha de comando. `.env.migration`
adicionado a `.gitignore`.

### 4. [Important] Rollback documentado não era executável

`UPDATE hub_pages SET content = '<...>'::jsonb` com aspas simples quebra ou
trunca silenciosamente contra copy em PT-BR com apóstrofos ASCII.

**Fix**: novo modo `--restore <backup-file>`, que relê o JSON do backup e
reaplica via o mesmo client (`restoreBackup()`), com um aviso explícito de
que a restauração é incondicional e sobrescreve qualquer edição legítima
feita depois da migração. O fallback manual em SQL na documentação agora usa
dollar-quoting:

```sql
UPDATE hub_pages SET content = $bkp$<content daquele id, do arquivo de backup>$bkp$::jsonb
WHERE id = '<id>';
```

### 5. [Minor] Backup só em `--apply`

`writeBackup()` agora roda em toda execução (dry run incluído), antes de
qualquer tentativa de escrita, e com `mode: 0o600` (o arquivo contém
conteúdo de cliente de produção).

### 6. [Minor] Linhas com bloco misto perdiam a metade legada em silêncio

`isLegacyContent()` é `true` se QUALQUER bloco não for `richtext`, mas
`readPageDocResult()` devolve o doc do PRIMEIRO bloco `richtext` encontrado
com `converted: true` -- então `[{richtext}, {markdown}]` converteria só o
richtext, descartando o markdown sem cair em `failed`. Produção não tem
nenhuma linha assim hoje e o editor ao vivo não consegue produzir uma
(`writePageContent` sempre devolve array de um elemento), mas adicionada uma
guarda em `convert()` antes de tentar `readPageDocResult()`: uma linha legada
que já contém um bloco `richtext` cai em `failed`, nunca é escrita
parcialmente. Teste novo cobrindo o caso em
`convert-hub-pages-richtext.test.ts`.

## Verificação (fix round 1)

```
npx vitest run scripts/
 Test Files  7 passed (7)
      Tests  21 passed (21)
```
(as 19 pré-existentes + 1 teste novo do achado 6 + 1 arquivo novo com 1
teste do achado 1 -- `convert-hub-pages-richtext.db.test.ts`.)

```
npx tsc -p tsconfig.scripts.json
```
Limpo, sem output.

```
npm run lint
```
0 erros, 85 warnings -- todos pré-existentes em arquivos não tocados por
esta rodada (confirmado rodando eslint isolado nos 4 arquivos tocados:
zero saída).

```
npx prettier --check scripts/convert-hub-pages-richtext.ts \
  scripts/__tests__/convert-hub-pages-richtext.test.ts \
  scripts/__tests__/convert-hub-pages-richtext.db.test.ts \
  scripts/__tests__/convert-hub-pages-richtext.fallback.test.ts
```
OK (um `--write` necessário na primeira passada do arquivo principal, por
causa da formatação do novo `hasRichtextBlock`).

`grep -rnP '\x{2014}'` (em dash) nos arquivos tocados + `.gitignore`: nenhuma
ocorrência.

### Dry run contra dado real -- NÃO executado nesta rodada

Diferente da rodada anterior desta task, não rodei o script contra staging
ou produção desta vez. Dois motivos:

1. **Sem credenciais de prod neste worktree**: não há `SUPABASE_SERVICE_ROLE_KEY`
   no ambiente, nem um arquivo `.env` (só existe `.env.staging`, que aponta
   para staging -- e staging não tem nenhuma linha em `hub_pages`, conforme
   já confirmado na rodada anterior). Não busquei nem solicitei a
   service-role key de produção para este fix.
2. **Um dry run não exerceria o código corrigido de qualquer forma**: o
   próprio Finding 1 é sobre isso -- `convert()` em `dryRun: true` nunca
   chama `db.updateIfUnchanged`, então nunca emite a requisição UPDATE
   corrigida contra um Postgrest de verdade. A única forma de exercitar a
   URL construída contra o Postgres real seria com `--apply`, que a task
   proíbe explicitamente.

A prova de que a URL construída está correta veio do teste com `fetch`
stubado (seção do achado 1 acima), que inspeciona a requisição real que o
`postgrest-js` monta -- não uma suposição sobre o formato.

## Rollout -- comando corrigido para a migração real

```bash
# 1. Credenciais em arquivo gitignorado, nunca na linha de comando:
cat > .env.migration << 'ENV'
SUPABASE_URL=<prod-url>
SUPABASE_SERVICE_ROLE_KEY=<prod-service-role-key>
ENV

# 2. Fontear no shell (nada de segredo aparece no histórico nem em `ps`):
set -a; . ./.env.migration; set +a

# 3. Dry run (sempre primeiro):
npx tsx --tsconfig tsconfig.scripts.json scripts/convert-hub-pages-richtext.ts

# 4. Conferir o relatório (as 4 listas). Se "failed" não estiver vazio, parar
#    e investigar antes de aplicar.

# 5. Aplicar:
npx tsx --tsconfig tsconfig.scripts.json scripts/convert-hub-pages-richtext.ts --apply

# 6. Conferir o backup gerado em scripts/backups/hub-pages-backup-<timestamp>.json
#    (agora também existe um backup do dry run do passo 3, para inspeção).

# 7. Se "raced" não estiver vazio, rodar de novo (só essas linhas mudaram de
#    content entre leitura e escrita).

# 8. Ao final, remover .env.migration ou garantir que fica fora do repo
#    (já está no .gitignore, mas convém não deixar a chave em disco além do
#    necessário).
```

## Rollback -- comando corrigido

```bash
set -a; . ./.env.migration; set +a
npx tsx --tsconfig tsconfig.scripts.json scripts/convert-hub-pages-richtext.ts \
  --restore scripts/backups/hub-pages-backup-<timestamp>.json
```

Isso sobrescreve `content` incondicionalmente para cada id do arquivo de
backup -- só usar para reverter a migração inteira, nunca para corrigir uma
linha à mão. Fallback manual (só se o script estiver indisponível), com
dollar-quoting em vez de aspas simples:

```sql
UPDATE hub_pages SET content = $bkp$<content daquele id, do arquivo de backup>$bkp$::jsonb
WHERE id = '<id>';
```

Nenhum comando com `--apply` ou `--restore` foi executado contra dado real
nesta rodada, por instrução explícita da task.

## Fix round 2

Dois achados operacionais novos, ambos na superfície que o operador humano
dirige (não na lógica de conversão em si).

### Achado 1 [Important] Um run `--staging` podia escrever em PRODUÇÃO, em silêncio

`connect()` resolvia `process.env.SUPABASE_URL || fileEnv.VITE_SUPABASE_URL`
(e o mesmo padrão para `SUPABASE_SERVICE_ROLE_KEY`) -- `process.env` sempre
ganha. A recomendação da rodada anterior (`set -a; . ./.env.migration;
set +a`, colocando URL e chave de produção no shell) cria exatamente o cenário
perigoso: nesse mesmo shell, um `--staging --apply` posterior lê
`.env.staging` para o valor de arquivo, mas `process.env` continua ganhando,
então o script conectava em produção com uma chave service-role. A guarda
RLS-scoped nunca disparava, porque a chave era mesmo service-role de verdade.
E `main()` nunca ecoava a que host tinha se conectado -- nenhum sinal, o run
parecia normal.

**Fix, duas partes:**

1. `connect()` agora ecoa `Connecting to <url>` logo após resolver a URL, em
   todo caminho -- dry run, `--apply` e `--restore`, service-role e
   RLS-scoped -- antes de qualquer leitura ou escrita.
2. `connect()` agora recebe `opts: { staging: boolean }`. Quando `staging` é
   `true`, `envFile` já é `.env.staging` (ver `main()`), então `fileEnv` já
   contém a URL real de staging -- comparada contra a URL efetivamente
   resolvida via um novo helper `projectRef()` (extrai o ref, o subdomínio de
   um host `*.supabase.co`). Se não baterem, lança e nada é conectado.
   `projectRef()` cai para as constantes `STAGING_PROJECT_REF` /
   `PRODUCTION_PROJECT_REF` só quando o arquivo não tem uma URL para comparar
   -- a fonte preferida é sempre o arquivo, não a constante hardcoded.

**Guarda simétrica -- decisão:** a task pediu para considerar recusar
`--apply` (e por extensão `--restore`, igualmente destrutivo) contra produção
sem uma flag explícita. Implementei: `assertProductionWriteConfirmed()` exige
`--confirm-production` sempre que a URL resolvida bate com o ref de produção
conhecido e `--staging` não foi passado (quando `--staging` foi passado, a
checagem acima já provou -- ou lançou -- que o alvo é staging de verdade, então
fica isento). Escolhi implementar porque:

- O problema do achado 1 era justamente ausência de sinal; a guarda simétrica
  fecha o lado oposto do mesmo buraco -- esquecer `--staging` de vez, ou uma
  `SUPABASE_URL` de produção esquecida no shell, sem digitar `--staging`
  nenhuma vez.
- O script já trata produção com um cuidado incomum (dry run por padrão,
  backup em toda execução, UPDATE condicional) -- uma flag a mais no comando
  documentado de produção é um custo pequeno perto do que evita.
- Isso muda o comando de rollout/rollback documentado (agora inclui
  `--confirm-production`); atualizei o comentário de cabeçalho do script e as
  seções de Rollout/Rollback abaixo.

**Testes novos** (`convert-hub-pages-richtext.connect.test.ts`, 4 casos):
chamam `connect()` de verdade contra um arquivo de env temporário, sem stub de
fetch -- a recusa (ou o retorno antecipado do branch service-role) acontece
antes de qualquer request de rede:

- `--staging` com `process.env.SUPABASE_URL` de produção exportado -> lança,
  mensagem cita "staging" e o ref de produção.
- mesmo caso mas `.env.staging` sem nenhuma URL própria -> cai no fallback de
  constante e ainda assim lança.
- `--staging` com a URL resolvida batendo com staging de verdade -> não lança,
  devolve `url` correto.
- sem `--staging` -> guarda não entra em ação, comportamento inalterado.

### Achado 2 [Important] `--restore` reportava sucesso para linhas que não restaurou

`restoreBackup()` fazia `.update({ content }).eq('id', row.id)` sem
`.select()`. Verificado com fetch stubado: um match de zero linhas volta
`{ data: null, error: null, status: 204 }` -- `Prefer: return=minimal`, o
default do postgrest-js sem `.select()`. O loop então logava `Restored <id>`
e não incrementava nenhum contador de falha. Um backup reaplicado depois que
algumas linhas foram apagadas reportava rollback 100% bem-sucedido tendo
restaurado menos linhas do que afirmou -- durante um incidente, que é a pior
hora possível para ser enganado.

**Fix:** `.select('id')` adicionado ao update. `restoreBackup()` agora
devolve um `RestoreReport { restored: string[]; failed: { id, error }[] }`,
no mesmo espírito do `Report` de `convert()`: um match de zero linhas
(`(data ?? []).length === 0`) vira `failed` com uma mensagem explícita
("UPDATE matched zero rows..."), nunca `restored`. `main()` só usa o retorno
para não quebrar o fluxo existente, mas o relatório completo (`restored` e
`failed` com ids) agora existe para quem chamar `restoreBackup()`
programaticamente. `restoreBackup()` e o novo tipo `RestoreReport` foram
exportados para o teste.

**Teste novo** (`convert-hub-pages-richtext.restore.test.ts`, 3 casos), no
mesmo estilo do `.db.test.ts` já existente -- `SupabaseClient` real com
`fetch` stubado, afirmando a requisição de verdade que o postgrest-js monta:

- match de zero linhas (fetch stubado devolve `[]`, 200) -> URL carrega
  `select=id` e `Prefer: return=representation`; `restored` fica vazio,
  `failed` tem 1 entrada citando "zero rows", e `process.exitCode` vira `1`.
- match de uma linha (fetch stubado devolve `[{id}]`) -> vai para `restored`,
  não para `failed`; `process.exitCode` não é `1`.
- mistura de uma linha que bate e uma que não bate -> `restored` e `failed`
  reportam ids corretos e separados.

`process.exitCode` é salvo e restaurado em `afterEach` nos três casos --
`restoreBackup()` seta `process.exitCode = 1` como efeito colateral real no
processo Node, e sem isso o teste vazaria esse valor para o restante do run
do vitest.

## Verificação (fix round 2)

```
npx vitest run scripts/
 Test Files  9 passed (9)
      Tests  28 passed (28)
```
(as 21 pré-existentes da rodada 1 + 4 testes novos de `connect()` + 3 testes
novos de `restoreBackup()`, em dois arquivos novos:
`convert-hub-pages-richtext.connect.test.ts` e
`convert-hub-pages-richtext.restore.test.ts`.)

```
npx tsc -p tsconfig.scripts.json
```
Limpo, sem output. Os dois arquivos de teste novos foram adicionados ao
`include` de `tsconfig.scripts.json` (mesmo padrão de `.test.ts` e
`.fallback.test.ts`; `.db.test.ts` já não estava incluído antes desta rodada
e não mexi nisso, fora do escopo dos dois achados).

```
npm run lint
```
0 erros, 85 warnings -- todos pré-existentes em arquivos não tocados por esta
rodada (confirmado rodando eslint isolado nos 6 arquivos tocados: zero
saída).

```
npx prettier --check scripts/convert-hub-pages-richtext.ts \
  scripts/__tests__/convert-hub-pages-richtext.test.ts \
  scripts/__tests__/convert-hub-pages-richtext.db.test.ts \
  scripts/__tests__/convert-hub-pages-richtext.fallback.test.ts \
  scripts/__tests__/convert-hub-pages-richtext.connect.test.ts \
  scripts/__tests__/convert-hub-pages-richtext.restore.test.ts \
  tsconfig.scripts.json
```
OK (um `--write` necessário nos dois arquivos de teste novos, na primeira
passada, por quebra de linha).

`grep -rnP '\x{2014}'` (em dash) nos arquivos tocados: nenhuma ocorrência.

O teste pinado que guarda o achado Critical da rodada 1
(`convert-hub-pages-richtext.db.test.ts`, a query string
`not.cs.[{"type":"richtext"}]`) continua verde, intocado.

Nenhum comando com `--apply` ou `--restore` foi executado contra dado real
nesta rodada, por instrução explícita da task -- os dois achados foram
verificados só com fetch stubado e com `connect()` chamado diretamente contra
arquivos de env temporários.

## Rollout -- comando final corrigido

```bash
# 1. Credenciais em arquivo gitignorado, nunca na linha de comando:
cat > .env.migration << 'ENV'
SUPABASE_URL=<prod-url>
SUPABASE_SERVICE_ROLE_KEY=<prod-service-role-key>
ENV

# 2. Fontear no shell (nada de segredo aparece no histórico nem em `ps`):
set -a; . ./.env.migration; set +a

# 3. Dry run (sempre primeiro). O host resolvido é ecoado antes de qualquer
#    leitura ou escrita -- conferir que é mesmo produção:
npx tsx --tsconfig tsconfig.scripts.json scripts/convert-hub-pages-richtext.ts

# 4. Conferir o relatório (as 4 listas). Se "failed" não estiver vazio, parar
#    e investigar antes de aplicar.

# 5. Aplicar. Produção exige --confirm-production explicitamente:
npx tsx --tsconfig tsconfig.scripts.json scripts/convert-hub-pages-richtext.ts \
  --apply --confirm-production

# 6. Conferir o backup gerado em scripts/backups/hub-pages-backup-<timestamp>.json
#    (agora também existe um backup do dry run do passo 3, para inspeção).

# 7. Se "raced" não estiver vazio, rodar de novo (só essas linhas mudaram de
#    content entre leitura e escrita).

# 8. Ao final, remover .env.migration ou garantir que fica fora do repo
#    (já está no .gitignore, mas convém não deixar a chave em disco além do
#    necessário).
```

Para um dry run contra staging no mesmo shell (por exemplo, para comparar
comportamento), abrir um shell novo sem `.env.migration` fonteado, ou rodar
`unset SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY` antes de:

```bash
npx tsx --tsconfig tsconfig.scripts.json scripts/convert-hub-pages-richtext.ts --staging
```

Se `SUPABASE_URL` de produção ainda estiver exportado nesse shell, o comando
acima agora recusa a rodar (é exatamente o achado 1) em vez de conectar em
produção silenciosamente.

## Rollback -- comando final corrigido

```bash
set -a; . ./.env.migration; set +a
npx tsx --tsconfig tsconfig.scripts.json scripts/convert-hub-pages-richtext.ts \
  --restore scripts/backups/hub-pages-backup-<timestamp>.json --confirm-production
```

Isso sobrescreve `content` incondicionalmente para cada id do arquivo de
backup -- só usar para reverter a migração inteira, nunca para corrigir uma
linha à mão. O relatório final agora separa `restored` de `failed`: uma linha
cujo UPDATE bateu zero vezes (por exemplo, apagada depois do backup) aparece
em `failed`, nunca é contada como restaurada em silêncio. Fallback manual (só
se o script estiver indisponível), com dollar-quoting em vez de aspas
simples:

```sql
UPDATE hub_pages SET content = $bkp$<content daquele id, do arquivo de backup>$bkp$::jsonb
WHERE id = '<id>';
```

Nenhum comando com `--apply` ou `--restore` foi executado contra dado real
nesta rodada, por instrução explícita da task.
