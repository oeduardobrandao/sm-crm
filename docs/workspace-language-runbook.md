# Idioma do workspace (runbook)

E-mails, push, relatórios e telas passam a seguir `workspaces.language` (`pt` | `en`). Spec:
`docs/superpowers/specs/2026-11-26-workspace-language-design.md`, plano:
`docs/superpowers/plans/2026-11-26-workspace-language.md`. Este runbook é interno.

Quatro PRs, em sequência. Qualquer falha de leitura do idioma cai em `pt` (nunca falha um envio).

## Como o idioma chega a cada e-mail

- E-mails do Mesaas (Resend) leem `workspaces.language` pelo `workspaceLang`/`ownerLang`.
- E-mails do Supabase Auth (Reset password, Invite user, Magic link) não têm contexto de
  workspace: leem `user_metadata.language` do usuário. Quem define esse valor:
  - o workspace que o usuário **é dono**: `workspace_set_language()` (migration `20261210000001`)
    regrava o metadata do dono quando ele troca o idioma, e o cadastro grava a partir de `market`;
  - senão, o workspace que **convidou**: `_shared/invite-actions.ts` manda `language` em
    `inviteUserByEmail(..., { data })` e, no reenvio de link para quem já confirmou o e-mail
    mas não tem senha (`resend-link`), atualiza o metadata com `auth.admin.updateUserById`
    (mescla com o metadata atual, não mexe em quem é dono de algum workspace, e uma falha só
    registra log, nunca derruba o convite). Um convite posterior de outro workspace sobrescreve.
  - remover um membro não regrava o metadata; trocar o idioma do workspace A regrava só o
    dono de A, nunca um membro.
- Limitação aceita (spec §4): quem está em workspaces de idiomas diferentes recebe os e-mails do
  Auth pela regra acima, não pelo workspace que tinha em mente. É um idioma por pessoa disfarçado
  e fica como melhor esforço até existir idioma por pessoa.
- O e-mail de convite para quem já tem conta (`resend-link`) é enviado pelo Mesaas via Resend, no
  idioma do workspace que convida, e não passa pelo template do Auth.

## PR 1: armazenamento, resolução no navegador, Configurações, Hub (Fase A)

1. Migration `20261210000001` em staging e depois em prod. Rode de um **checkout descartável**
   (o `npx supabase` local está quebrado em darwin-arm64; `db push --linked` aplica tudo o que
   estiver pendente). Reconfira a ponta de `main` e renumere se ela andou.
2. `hub-bootstrap` e `hub-auth` (ambas com `--no-verify-jwt`).
3. Merge.

## PR 2: e-mails, push e Auth (Fase B; esta branch)

Pré-requisito: a migration do PR 1 já está no ambiente alvo (os remetentes leem
`workspaces.language`; sem a coluna a leitura falha e tudo cai em `pt`, então nada quebra, mas
nada sai em inglês).

1. Edge functions, todas depois da migration do PR 1:
   `lifecycle-email-cron`, `nurture-unsub` (`--no-verify-jwt`), `notification-email-cron`,
   `notification-push-cron` (`--no-verify-jwt`), `invite-user`, `platform-admin`,
   `stripe-webhook`, `pagarme-webhook`, `instagram-connect-link`, `instagram-integration`,
   `report-worker`, `instagram-analytics`, `resend-webhook`, `client-event-email-cron`,
   `agenda-cliente-email`, `agenda-lembretes-email`, `hub-auth`, `client-email-unsub`.
   Levam `--no-verify-jwt`: `nurture-unsub`, `notification-push-cron`, `agenda-cliente-email`,
   `agenda-lembretes-email`, `hub-auth` e `client-email-unsub` (lista do CLAUDE.md). Confira
   `client-event-email-cron` (cron com `x-cron-secret`) contra o CLAUDE.md e use a flag se ele
   estiver listado.
   Para achar importadores de um módulo que mudou:
   `grep -rl "<modulo>" supabase/functions/*/index.ts supabase/functions/*/handler.ts`.
2. Templates do Supabase Auth (seção abaixo), **staging e depois prod**.
3. Merge.

## PR 3: varredura do CRM (Fase C)

Só frontend, sem deploy além do PR 1. Merge direto.

## PR 4: relatórios e texto de IA (Fase D)

1. `report-docs` e `instagram-report-generator-v2`.
2. Merge (o frontend não muda além da Fase C).

## Templates do Supabase Auth (Reset password, Invite user, Magic link)

Painel do Supabase > Authentication > Email Templates. Faça **staging primeiro, depois prod**.
Antes de editar cada template, copie o HTML atual do painel para um lugar seguro (rollback).

Cada corpo ramifica por `.Data.language`, com o mesmo guarda `printf "%v"` do "Confirm signup" (um
valor ausente vira a string `<no value>`, que cai no `else`). O `market` fica na condição para
quem se cadastrou em `/en` antes de existir `language` no metadata:

```
{{ if or (eq (printf "%v" .Data.language) "en") (eq (printf "%v" .Data.market) "us") }}
  ...corpo em inglês (abaixo)...
{{ else }}
  ...corpo atual em português, copiado do template de hoje, sem alterar um byte...
{{ end }}
```

Mantenha os mesmos placeholders de cada template de hoje (`{{ .ConfirmationURL }}`, etc.): um
placeholder errado faz o e-mail sumir em silêncio (veja `reference_auth_email_template_placeholders`
na memória). Use o mesmo layout, botão e rodapé do template em português.

### Assunto

O campo Subject do Supabase é uma linha só e **não ramifica** como o corpo (achado do runbook do
site em inglês, `docs/us-english-site-runbook.md`). O plano dizia "o mesmo vale para os
assuntos"; isso não é possível, então este runbook segue a abordagem daquele: **assunto neutro
nos dois idiomas** (opção a), porque um americano que recebe só português pode achar que é spam.
Alternativa: manter o assunto em português e aceitar a lacuna. Decisão a registrar no deploy.
Sugestão de assuntos (confirme o assunto atual de cada template e preserve o texto em português):

| Template | Assunto sugerido |
| --- | --- |
| Reset password | `Reset your password / Redefina sua senha` |
| Invite user | `You have been invited to Mesaas / Você foi convidado para o Mesaas` |
| Magic link | `Your Mesaas sign-in link / Seu link de acesso ao Mesaas` |

### Corpo em inglês: Reset password

```
Hi,

We received a request to reset your Mesaas password. Choose a new one here:

[ Reset password ]   ->  {{ .ConfirmationURL }}

If the button does not work, copy this link into your browser:
{{ .ConfirmationURL }}

If you did not ask for this, you can ignore this email. Your password will not change.

The Mesaas team
```

### Corpo em inglês: Invite user

```
Hi,

You have been invited to join a workspace on Mesaas. Accept the invitation and set your password:

[ Accept invitation ]   ->  {{ .ConfirmationURL }}

If the button does not work, copy this link into your browser:
{{ .ConfirmationURL }}

If you were not expecting this invitation, you can ignore this email.

The Mesaas team
```

### Corpo em inglês: Magic link

```
Hi,

Use this link to sign in to Mesaas:

[ Sign in ]   ->  {{ .ConfirmationURL }}

If the button does not work, copy this link into your browser:
{{ .ConfirmationURL }}

This link works once and expires soon. If you did not ask for it, you can ignore this email.

The Mesaas team
```

Se o template de hoje usa outro placeholder além de `{{ .ConfirmationURL }}` (por exemplo
`{{ .Token }}` ou `{{ .SiteURL }}`), reproduza o mesmo no corpo em inglês.

### Verificação depois de editar (staging, depois prod)

- Redefinir senha para um usuário sem `language` no metadata: e-mail em português igual ao de hoje.
- Mesmo fluxo para um usuário com `language: "en"` (ajuste o metadata pelo painel ou por
  `workspace_set_language` num workspace de teste): e-mail em inglês, botão com a URL certa.
- Convidar um e-mail novo a partir de um workspace em inglês: o e-mail de convite do Auth sai em
  inglês. A partir de um workspace em português: sai em português igual ao de hoje.
- Em prod, depois de cada template, repita o teste em português com um e-mail descartável.

## Rollback

Frontend primeiro (revert ou instant rollback da Vercel), depois as edge functions (redeploy da
versão anterior), por último o banco. A coluna `workspaces.language` e a migration podem ficar:
com tudo de volta, nada lê a coluna. Templates do Auth: restaure o HTML salvo antes de editar (o
ramo `else` já é o texto antigo, então deixar o template novo no ar com functions antigas é
seguro: sem `language` no metadata, o e-mail sai em português). O metadata `language` que já foi
gravado nos usuários pode ficar.

## Pendências a fechar na Tarefa 18

- Confirmar o assunto atual de cada template do painel e o texto em português de cada um (o
  runbook não os reproduz de propósito: o `else` é a cópia literal do painel).
- Registrar a decisão do assunto (neutro nos dois idiomas ou só português).
