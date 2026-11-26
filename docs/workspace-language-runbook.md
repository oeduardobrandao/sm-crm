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

Detalhes do que a Fase A entrega: bullet "Idioma por workspace" do `CLAUDE.md`.

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
   Toda função desta lista é implantada com `--no-verify-jwt` (todas têm `verify_jwt = false` em
   `supabase/config.toml`; um caminho de deploy que não lê o `config.toml` devolveria 401 nos
   webhooks de pagamento e nos crons).
   Para achar importadores de um módulo que mudou:
   `grep -rl "<modulo>" supabase/functions/*/index.ts supabase/functions/*/handler.ts`.
2. Templates do Supabase Auth (seção abaixo), **staging e depois prod**.
3. Merge.

## PR 3: varredura do CRM (Fase C)

Só frontend, sem deploy além do PR 1. Merge direto.

## PR 4: relatórios e texto de IA (Fase D)

Edge apenas (rótulos do relatório HTML, título e rótulos dos relatórios em bloco, prompt da IA e
payload de impressão).

1. Edge functions, depois da migration do PR 1:
   - `report-docs`: confere o JWT do usuário sozinho e não tem entrada no `config.toml`
     (deploy normal, sem a flag, como hoje).
   - `hub-report-docs` com `--no-verify-jwt` (`verify_jwt = false` no `config.toml`): a rota
     `print-doc` passa a devolver `language` (campo aditivo, o Hub antigo o ignora).
   - `instagram-report-generator-v2` com `--no-verify-jwt` (`verify_jwt = false` no `config.toml`).
2. Merge.

Notas:

- A página de impressão que renderiza os blocos (KPIs, títulos de gráfico, "sem dados") vive no
  Hub e precisa aplicar `doc.language`; isso entra no PR que é dono do Hub. Até lá, o PDF dos
  relatórios em bloco continua em português, mesmo com o edge já devolvendo `language`.
- Nada que já foi gravado é regenerado: PDFs armazenados (`pdf_storage_path`), títulos e
  `period.label` dos documentos existentes e o texto de IA já salvo ficam no idioma em que foram
  criados. Só documentos novos e o rótulo do período no `refresh-data` seguem o idioma atual.

## Templates do Supabase Auth (Reset password, Invite user, Magic link)

Painel do Supabase > Authentication > Email Templates. Faça **staging primeiro, depois prod**.
Antes de editar cada template, copie o HTML atual do painel para um lugar seguro (rollback).

Cada corpo ramifica por `.Data.language`, com o mesmo guarda `printf "%v"` do "Confirm signup" (um
valor ausente vira a string `<no value>`, que cai no `else`). O `market` só conta quando
`language` não está definido (quem se cadastrou em `/en` antes de existir `language` no metadata);
um dono que trocou para `pt` não é sobrescrito por `market:"us"`:

```
{{ if or (eq (printf "%v" .Data.language) "en") (and (ne (printf "%v" .Data.language) "pt") (eq (printf "%v" .Data.market) "us")) }}
  ...corpo em inglês (abaixo)...
{{ else }}
  ...corpo atual em português, copiado do template de hoje, sem alterar um byte...
{{ end }}
```

Mantenha os mesmos placeholders de cada template de hoje (`{{ .ConfirmationURL }}`, etc.): um
placeholder errado faz o e-mail sumir em silêncio (veja `reference_auth_email_template_placeholders`
na memória). Use o mesmo layout, botão e rodapé do template em português.

### Assunto

O assunto **ramifica** igual ao corpo: o template "Confirm signup" de produção já usa
`{{ if eq (printf "%v" .Data.market) "us" }}Confirm your email{{ else }}...{{ end }}` no Subject.
Use a mesma condição do corpo, com o assunto em português atual, sem alterar, no `else`:

| Template | Assunto em inglês |
| --- | --- |
| Reset password | `Reset your password` |
| Invite user | `You've been invited to Mesaas` |

**Aplicado em 2026-11-26** (staging e prod) via Management API (`PATCH /v1/projects/<ref>/config/auth`,
campos `mailer_subjects_recovery`, `mailer_templates_recovery_content`, `mailer_subjects_invite`,
`mailer_templates_invite_content`), depois de conferir os quatro templates com o parser de templates
do Go nos casos da verificação abaixo. O corpo em inglês é a tradução do HTML de produção em
português, com o mesmo layout e o link de privacidade em `/en/privacy`. Magic link ficou como está
(o padrão do Supabase, em inglês nos dois projetos e sem uso no produto).

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

- Condição do template, quatro casos de metadata (ajuste pelo painel): `{market:us}` (sem
  `language`) sai em inglês; `{market:us, language:pt}` sai em português; `{language:en}` sai em
  inglês; metadata sem nenhum dos dois sai em português.
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

## Pendências

Nenhuma do lado do Auth: os templates foram aplicados em staging e prod em 2026-11-26 (seção
"Assunto" acima).

## Follow-ups conhecidos

- `claim_notification_emails` não devolve `workspace_id`: o idioma sai de uma leitura extra.
- `/cancelar-avisos` no CRM usa o idioma do visitante, não o do workspace.
- E-mails em inglês apontam para `/ajuda` e `/novidades` em português.
- O fuso padrão dos e-mails em inglês é America/New_York.
- `add-direct` não sincroniza o `language` do Auth do usuário criado.
- As análises de IA dentro do app (`instagram-analytics`) seguem em português.
- `refresh-data` grava o rótulo no idioma atual, enquanto o título armazenado mantém o idioma
  de quando o documento foi gerado (mistura possível).
- Dados em português ainda podem aparecer em relatórios em inglês: o rótulo "Cliente do Google"
  (avaliador anônimo) gravado nos snapshots (`report-docs/google-section.ts`), os nomes de países
  em português do relatório legado (`instagram-report-generator-v2/mappers.ts`, `COUNTRY_NAMES`)
  e os melhores horários, que usam o relógio de São Paulo e aparecem sem fuso em inglês.
