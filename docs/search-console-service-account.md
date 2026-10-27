# Search Console do blog: conta de serviço e secret

O `blog-search-console-cron` lê cliques, impressões, posição e o status de indexação de cada
post no Google Search Console e grava no banco para o Admin (`/admin/blog`). Ele autentica
com uma conta de serviço do Google. Este passo a passo cria a conta, dá acesso de leitura ao
site e entrega a chave às edge functions.

Spec: `docs/superpowers/specs/2026-10-27-blog-metrics-design.md` (seção 4).

## 1. Criar a conta de serviço no Google Cloud

Pré-requisito: `jq` instalado (vem com o macOS 15 ou mais novo; senão `brew install jq`).

1. No [Google Cloud Console](https://console.cloud.google.com/), crie um projeto novo (por
   exemplo `mesaas-search-console`) ou escolha um existente que não seja de produção de outro
   serviço.
2. Em **APIs e serviços > Biblioteca**, ative a **Google Search Console API**
   (`searchconsole.googleapis.com`).
3. Em **IAM e administrador > Contas de serviço**, crie uma conta (por exemplo
   `blog-search-console`). Não atribua nenhum papel do projeto: ela só precisa de acesso ao
   Search Console, que é dado no passo 2.
4. Na conta criada, aba **Chaves > Adicionar chave > Criar nova chave > JSON**. O navegador baixa
   um arquivo `.json`. Ele é a credencial inteira: trate como senha.
   Se a política de organização `iam.disableServiceAccountKeyCreation` bloquear a criação da
   chave, um administrador da organização precisa liberá-la para este projeto.
5. Anote o e-mail da conta (`...@<projeto>.iam.gserviceaccount.com`).

## 2. Dar acesso à propriedade no Search Console

1. No [Search Console](https://search.google.com/search-console/), abra a propriedade de domínio
   `sc-domain:mesaas.com.br`.
2. **Configurações > Usuários e permissões > Adicionar usuário**.
3. Cole o e-mail da conta de serviço e escolha a permissão **Restrita**. Ela cobre tudo que o
   cron faz (consulta de desempenho e inspeção de URL). Não use Total nem Proprietário.

A propriedade padrão é `sc-domain:mesaas.com.br`. Se o site estiver registrado de outra forma
(prefixo de URL, por exemplo), defina também o secret `GSC_SITE_URL` com o valor exato da
propriedade.

## 3. Entregar a chave à edge function (prod)

A chave nunca vai na linha de comando nem no histórico do shell. O CLI do Supabase não lê um
valor de arquivo direto (`NAME=@arquivo` não existe), então use `--env-file` com um arquivo
temporário que contenha o JSON numa linha só. O arquivo fica fora do repositório.

Troque só a linha `KEY` pelo caminho do arquivo baixado e cole o bloco inteiro no terminal.
Não deixe nenhum `<...>` no comando: o zsh lê `<` como redirecionamento e o bloco inteiro falha
com `parse error near '\n'`, sem rodar nada.

```bash
(
  set -eu
  # KEY é o caminho do JSON baixado. O comando só cita caminhos, nunca o conteúdo da chave.
  KEY="$HOME/Downloads/mesaas-search-console-chave.json"
  PROD_REF="skjzpekeqefvlojenfsw"
  ENVF="$(mktemp)"
  trap 'rm -f "$ENVF"' EXIT   # o arquivo temporário some em qualquer saída, Ctrl-C incluído

  JSON="$(jq -c . "$KEY")"    # se o jq falhar, o set -e aborta aqui
  [ -n "$JSON" ]              # e um JSON vazio também aborta
  printf "GSC_SERVICE_ACCOUNT_JSON='%s'\n" "$JSON" > "$ENVF"

  npx --yes supabase@2.110.0 secrets set --env-file "$ENVF" --project-ref "$PROD_REF"

  rm -f "$KEY"                # só chega aqui se o secrets set deu certo
)
```

O bloco roda num subshell para que uma falha não derrube o terminal. Se qualquer passo falhar,
o arquivo temporário é apagado e a chave baixada continua onde estava: corrija o problema e rode
de novo. Depois confira (o nome `GSC_SERVICE_ACCOUNT_JSON` precisa aparecer na lista):

```bash
npx --yes supabase@2.110.0 secrets list --project-ref skjzpekeqefvlojenfsw | grep GSC
```

O CLI vai fixado em `supabase@2.110.0` porque um `npx supabase` sem versão pode pegar do cache
do npx uma versão que não traz o binário do Mac e falha com `No matching Supabase CLI binary
package found for darwin-arm64`.

Cuidados:

- O `.json` baixado é apagado pelo próprio bloco depois que o secret é gravado. A chave passa a
  existir só no Supabase; se precisar de outra, gere uma nova no passo 1 e revogue a antiga.
- Nunca commite o arquivo da chave nem o `--env-file` temporário. O `mktemp` acima cria o
  arquivo fora do repositório; mantenha assim.
- O `secrets list` acima confirma que o secret existe (mostra só o nome e um hash, nunca o
  valor).
- Não precisa de redeploy: a edge function lê os secrets quando sobe um isolate novo, então a
  próxima execução do cron já usa o valor gravado. O deploy de `blog-search-console-cron` só é
  necessário uma vez, antes de agendar o cron (`--no-verify-jwt`).

## 4. Staging

Staging não recebe o secret. Sem `GSC_SERVICE_ACCOUNT_JSON` o cron responde 200 com
`{ "skipped": "not_configured" }` sem tocar em nada, e o Admin mostra "Search Console não
configurado" no lugar dos números do Google (as views continuam aparecendo).

## 5. Conferir depois do deploy

- O cron roda todo dia às 07:38 UTC (04:38 em São Paulo), agendado pela migration
  `20261101000003_blog_search_console_cron.sql`.
- A última execução fica em `blog_search_runs` (`ok`, `finished_at`); os números por dia em
  `blog_search_daily` e o status de indexação em `blog_index_status`.
- Cada execução faz o backfill de até quatro janelas de 30 dias, então os 16 meses de histórico
  completam em cerca de quatro execuções diárias.
- Falha de token ou da consulta chama `reportCronFailure` (e-mail e triagem, ver
  `docs/cron-triage.md`). Se todas as inspeções de URL tentadas falharem, a execução fecha ok
  (os números foram atualizados), mas também chama `reportCronFailure` e grava o motivo em
  `blog_search_runs.error`. Erro 403 do Google quase sempre é a conta de serviço sem acesso à
  propriedade (passo 2) ou a API não ativada (passo 1).
