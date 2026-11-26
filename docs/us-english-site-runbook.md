# Site em inglês dos EUA, `/en` (runbook)

O site público em inglês (`/en`, `/en/pricing`, `/en/privacy`, `/en/terms`) e o cadastro que
cria workspace em USD. Spec: `docs/superpowers/specs/2026-11-25-us-english-site-design.md`.
Depende da cobrança em USD (`docs/usd-billing-runbook.md`). Este runbook é interno.

## Como funciona

- Só frontend, uma migration e uma mudança no painel do Supabase. Nenhuma edge function.
- O cadastro em `/en` manda `market: 'us'` no metadata do usuário. O trigger
  `on_auth_user_created_zz_billing_market` põe o workspace em USD. Se ele falhar (vira só
  WARNING), `billing_market_apply()` (migration `20261207000001`) repara no `/workspace-setup`.
- O app abre em inglês depois de uma visita a `/en` (spec §5). As lacunas de inglês dentro do
  app e dos e-mails de ciclo de vida são a Parte 3.
- Telas em inglês: `EN_LANDING_IMAGES` está vazio de propósito e `/en` usa os screenshots em
  português pelo fallback de `apps/crm/src/pages/landing/landing-images.ts`. Os screenshots em
  inglês esperam a Parte 3 (a UI em inglês do app fica pronta lá).
- Consentimento (spec §9): em `/en`, a primeira visita grava um registro `basis: 'us_default'`
  (analytics e suporte ligados, publicidade ligada, exceto com GPC) e mostra o aviso dos EUA,
  não o banner de opt-in. Esse registro só vale em `/en`; fora dele o `getConsent()` o lê como
  indeciso e o banner brasileiro aparece. GPC (`navigator.globalPrivacyControl`) desliga a
  publicidade dentro do `getConsent()`, em qualquer página.

## Antes do merge: preview da Vercel

Na URL de preview do deploy do PR, confira:

- `/en` responde 200 com `lang="en"`.
- `/en/` redireciona (301/308) para `/en`, sem loop.
- `/en/x` dá 404.
- `/en/pricing`, `/en/privacy` e `/en/terms` respondem 200.
- `/` e `/precos` seguem como estavam (sem mudança).

## Ordem de deploy

1. **Migration `20261207000001_billing_market_apply.sql` em staging e depois em prod.**
   Aditiva; nada a chama até o frontend subir. O `npx supabase` local está quebrado em
   darwin-arm64, então rode de um **checkout descartável** de `main` mais esta migration
   (veja `reference_db_push_remote_ahead_disposable_checkout` na memória: `db push --linked`
   aplica tudo o que estiver pendente). Confira a ponta de `main` antes do PR e renumere a
   migration se ela andou.
2. **Staging.**
   - Admin: `price_usd` e `price_usd_annual` nos três planos pagos.
   - Template "Confirm signup" do Supabase Auth (seção abaixo).
   - Deploy do preview da branch e um cadastro real por `/en` no staging: o e-mail em inglês
     chega, o workspace é USD e o app abre em inglês.
3. **Prod, antes do merge.**
   - Template "Confirm signup" (seção abaixo). Logo depois, faça **um cadastro real em
     português** (e-mail descartável em `/login`) e confira que o e-mail em português chega
     igual ao de hoje.
   - Admin: `price_usd` e `price_usd_annual` nos três planos pagos, para o `/en/pricing` nunca
     subir no estado "em breve". (O checkout em USD segue falhando até o passo 5 do runbook de
     cobrança em USD, mas só cadastros `/en` têm workspace USD.)
4. **Merge** (a Vercel faz o deploy).
5. **Prod, depois do merge:** um cadastro real por `/en` com e-mail descartável. Confirme
   workspace USD (Admin) e app em inglês.

## Template "Confirm signup" (Supabase Auth, staging e prod)

Painel do Supabase > Authentication > Email Templates > Confirm signup. O corpo ramifica por
`.Data.market` (o `raw_user_meta_data` do usuário). Cadastros sem `market` (todos os
brasileiros) caem no `else` e recebem o e-mail atual sem mudança.

```
{{ if eq .Data.market "us" }}
  ...corpo em inglês (rascunho abaixo)...
{{ else }}
  ...corpo atual em português, copiado do template de hoje, sem alterar...
{{ end }}
```

Antes de editar, copie o HTML atual do painel para um lugar seguro (rollback do template).
Mantenha os mesmos placeholders do template de hoje (`{{ .ConfirmationURL }}`, etc.): um
placeholder errado faz o e-mail sumir em silêncio (veja
`reference_auth_email_template_placeholders` na memória).

**Assunto.** O Supabase não ramifica o assunto do template (o campo Subject é uma linha só,
sem Go template). Opções: (a) assunto neutro nos dois idiomas, por exemplo
`Confirm your email / Confirme seu e-mail`; (b) manter o assunto em português e aceitar a
lacuna conhecida para `/en`. Decisão do construtor, a registrar aqui no deploy. Recomendação:
(a), porque um americano que recebe só português pode achar que é spam.

Rascunho do corpo em inglês (use o mesmo layout e botão do template em português):

```
Hi,

Welcome to Mesaas. Confirm your email to finish creating your account:

[ Confirm my email ]   ->  {{ .ConfirmationURL }}

If the button does not work, copy this link into your browser:
{{ .ConfirmationURL }}

If you did not create a Mesaas account, you can ignore this email.

The Mesaas team
```

## Verificações depois do merge

- `/en`, `/en/pricing`, `/en/privacy` e `/en/terms` respondem 200 e o HTML traz `lang="en"`.
- `/en/` redireciona (301) para `/en`.
- `/en/qualquer-coisa` dá 404.
- Um cadastro por `/en` cria workspace USD e o app abre em inglês (passo 5 acima).
- Consentimento:
  - primeira visita a `/en` (janela anônima): o aviso dos EUA aparece, sem banner de opt-in;
  - ir depois para `/`: aparece o banner de opt-in brasileiro e nada não essencial carrega
    antes do aceite;
  - navegador com GPC ligado: a publicidade fica desligada (pixels Meta, Google e OpenAI não
    carregam) em `/en` e fora dele; no diálogo de preferências o interruptor aparece
    desligado e travado.
- `/en/privacy` e `/en/terms` abrem normalmente no app iOS pelo Safari (estão em `SITE_PAGES`
  de `apps/crm/src/native/blockedPaths.ts`; o resto de `/en` é bloqueado no app).

## Rollback

Frontend primeiro (revert ou instant rollback da Vercel). A migration e os preços `price_usd*`
podem ficar. Para o template de e-mail, volte o HTML que você copiou antes de editar. Nunca
mude a moeda de workspaces já criados em USD por causa do rollback: eles continuam válidos.

## Antes de ligar anúncios

Nada disto está feito por este deploy. Os anúncios esperam tudo:

1. `currency_options.usd` nos preços Stripe live (só com aprovação do dono; passo 5 do
   runbook de cobrança em USD).
2. Auditoria do portal do cliente da Stripe (passo 7).
3. Uma cobrança real em USD e o reembolso, num workspace interno (passo 8).
4. Revisão de um advogado de `/en/privacy` e `/en/terms` (os textos foram rascunhados pelo
   Claude).
5. Screenshots em inglês (`EN_LANDING_IMAGES`, `apps/crm/public/landing/en/`).
6. Conversões e analytics do cadastro dos EUA só disparam depois que o visitante aceita em
   `/login` (um registro `us_default` vale só em `/en` e em `/login` lê como indeciso;
   decisão de consentimento). Decida isso antes dos anúncios; até lá, o único sinal sem
   consentimento é o `console.error` de `us_signup_currency_mismatch`.
7. Parte 3: lacunas de inglês no app e nos e-mails de ciclo de vida e transacionais. Um
   cadastro orgânico em `/en` antes da Parte 3 recebe esses e-mails em português.

## Pendências conhecidas (fora desta fase)

- 404 em inglês para `/en/...` desconhecido.
- Páginas de marketing e blog em inglês.
