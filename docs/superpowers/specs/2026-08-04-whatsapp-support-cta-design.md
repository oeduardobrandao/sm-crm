# CTA de suporte no WhatsApp

**Data:** 2026-08-04
**Status:** aprovado, pronto para plano de implementação

## Problema

Um usuário que acabou de criar a conta não tem nenhum canal de contato humano
proativo além do e-mail de boas-vindas, que só diz "responda este e-mail". O
Crisp existe em todas as páginas do CRM, mas é um widget passivo: o usuário
precisa descobrir e abrir.

Queremos oferecer ajuda de configuração pelo WhatsApp, onde o público brasileiro
de agências já vive.

## Decisão fundamental: link, não API

O número de suporte roda no **aplicativo WhatsApp Business**, com respostas
manuais. Não há WhatsApp Business Platform (Cloud API), não há WABA, não há
webhook.

Isso é o que mantém o escopo pequeno, e as consequências precisam ficar
registradas porque elas invertem tudo que vale no mundo da Cloud API:

| Na Cloud API | Aqui |
|---|---|
| Mensagem de saída exige template aprovado | Não existe mensagem de saída |
| Cobrança por mensagem entregue, por categoria | Custo zero |
| Janela de atendimento de 24h, aberta só pelo usuário | Irrelevante |
| Limite de 250 a ilimitado por 24h, por tier | Sem limite |
| Opt-in obrigatório para marketing | Não se aplica |

**O usuário inicia a conversa.** Por isso não existe consentimento a coletar,
nenhuma coluna nova no banco e nenhuma alteração no lockdown de escrita de
`profiles`. Esse é o motivo principal de o desenho ser tão pequeno.

Limitações aceitas conscientemente:

- Não escala além do que uma pessoa consegue ler.
- A conversa acontece fora do Mesaas. Não há registro no CRM de que ela existiu.
- Não há roteamento por workspace nem histórico consultável no produto.

## Escopo

Três superfícies, um mesmo link `wa.me`:

1. Rodapé de `/comecar`, última tela antes do app.
2. Card dispensável no `/dashboard`.
3. Botão no e-mail de boas-vindas do `lifecycle-email-cron`.

O Crisp permanece exatamente como está. Os dois canais coexistem.

## Arquitetura

```
apps/crm/src/lib/whatsapp.ts              builder + flag de habilitado
apps/crm/src/components/support/
  WhatsAppSupportButton.tsx               <a> apresentacional, dispara analytics
  WhatsAppSupportCard.tsx                 card do dashboard
supabase/functions/_shared/whatsapp.ts    gêmeo Deno do builder, para o e-mail
```

A duplicação entre `apps/crm/src/lib/whatsapp.ts` e
`supabase/functions/_shared/whatsapp.ts` é deliberada. São runtimes diferentes
(Vite e Deno). A alternativa seria mover o builder para `packages/`, coisa que
nenhuma edge function faz hoje e que arrastaria o build de `packages/` para
dentro do bundle da function. Não vale por duas linhas de `encodeURIComponent`.

### Variáveis de ambiente

| Variável | Runtime | Obrigatória |
|---|---|---|
| `VITE_WHATSAPP_SUPPORT_NUMBER` | CRM (build-time) | não |
| `WHATSAPP_SUPPORT_NUMBER` | edge functions (`Deno.env`) | não |

Formato: número internacional só com dígitos, sem `+`, sem espaços, sem
pontuação. Exemplo: `5511999999999`.

**Ambas são opcionais e falham fechado, tanto na ausência quanto no
malformado.** O builder valida contra `^\d+$` e retorna `null` se a variável
estiver ausente, vazia **ou** não casar. Só validar ausência deixaria passar um
`+55 11 99999-9999` copiado do celular, que produz um `href` quebrado no app e
um link morto no e-mail. Uma variável esquecida ou mal preenchida publica
ausência de link, nunca um `wa.me/undefined` nem um `wa.me/+55%2011`.

Como o builder é a única fonte de `href` e ele só devolve `null` ou uma URL
`https://wa.me/<digitos>?text=<encoded>`, o valor que chega ao `escapeHtml` do
e-mail já é estruturalmente seguro. O escape continua obrigatório mesmo assim,
por não depender dessa garantia à distância.

**As duas variáveis são independentes e podem divergir.** Nada no build
verifica que CRM e edge function apontam para o mesmo número, então um deploy
que atualize só uma deixa as superfícies apontando para números diferentes, ou
o e-mail sem botão enquanto o app tem. Isso é aceito conscientemente: unificar
exigiria buscar o número do banco em runtime, o que a seção "Fora de escopo"
descarta. Ao trocar o número, atualizar as duas e conferir o e-mail de
boas-vindas, que é a superfície mais fácil de esquecer por não ser visível no
app.

O número é público por natureza, então expô-lo em bundle `VITE_` não é
problema de segurança.

Adicionar as duas ao `.env.example` e à seção de variáveis do `CLAUDE.md`.

### O builder

```ts
type WhatsAppContext = 'onboarding' | 'dashboard';

buildWhatsAppSupportUrl(p: {
  nome?: string | null;
  empresa?: string | null;
  context: WhatsAppContext;
}): string | null
```

Retorna `https://wa.me/<numero>?text=<encodeURIComponent(texto)>`, ou `null`
quando a variável de ambiente não estiver definida.

`nome` é reduzido à primeira palavra, com a mesma regra de `firstNameFrom()` em
`supabase/functions/_shared/lifecycle-emails.ts:8` (trim, split em whitespace,
primeiro elemento, `null` se vazio).

Textos por contexto:

| Contexto | Texto |
|---|---|
| `onboarding` | `Oi! Sou {nome}, da {empresa}. Acabei de criar minha conta no Mesaas e queria ajuda pra configurar.` |
| `dashboard` | `Oi! Sou {nome}, da {empresa}. Queria falar com vocês sobre o Mesaas.` |

**Sem artigo antes do nome.** "Sou o Ana" concorda errado e "Sou o/a" é feio;
qualquer artigo fixo erra o gênero de metade dos usuários. `Sou {nome}` é
correto e neutro em pt-BR.

Degradação quando faltar dado, sem nunca emitir `da undefined`:

| Dados presentes | Resultado (contexto onboarding) |
|---|---|
| nome + empresa | `Oi! Sou Ana, da Acme. Acabei de criar minha conta no Mesaas e queria ajuda pra configurar.` |
| só nome | `Oi! Sou Ana. Acabei de criar minha conta no Mesaas e queria ajuda pra configurar.` |
| só empresa | `Oi! Sou da Acme. Acabei de criar minha conta no Mesaas e queria ajuda pra configurar.` |
| nenhum | `Oi! Acabei de criar minha conta no Mesaas e queria ajuda pra configurar.` |

O texto é apenas uma dica: o usuário pode editar antes de enviar. Nada no
produto pode depender dele para identificar a conta.

### O botão

```ts
<WhatsAppSupportButton context={...} label={...} className={...} />
```

`WhatsAppSupportButton` **lê `useAuth()` internamente** para obter `nome` e
`empresa` e chama o builder. Não é um componente puramente apresentacional, e
isso é deliberado: as duas superfícies do CRM precisariam repassar exatamente os
mesmos dois campos, e prop-drilling duplicado é o caminho mais curto para as
duas telas divergirem. Um único componente sabe de onde vem o dado.

Renderiza `<a href target="_blank" rel="noopener noreferrer">` e retorna `null`
quando o builder devolve `null`.

`target="_blank"` para o usuário não perder o CRM: no desktop o `wa.me`
redireciona para o `web.whatsapp.com`, no mobile abre o app.

Testabilidade não sofre: o `AuthContext` já é mockado nos testes de componente
do repo (ver `apps/crm/src/components/layout/__tests__/ProtectedRoute.test.tsx`).

## Superfícies

### 1. `/comecar`

Uma linha nova dentro do `comecar-foot` existente
(`apps/crm/src/pages/comecar/ComecarPage.tsx:277`), abaixo de "Prefiro
continuar no plano Free por enquanto". Contexto `onboarding`.

Fica no rodapé de propósito. A função primária da página é o CTA de teste
grátis entregue no #290, e um link de suporte com o mesmo peso visual custaria
checkouts.

Nome e empresa vêm de `useAuth().profile`. `getCurrentProfile()` faz
`select('*')` em `profiles` (`apps/crm/src/lib/supabase.ts:55`), então
`profiles.empresa` chega inteiro: é gravado no cadastro pelo `handle_new_user`,
editável na `PerfilTab`, e já lido pelo `ProtectedRoute.tsx:61` para decidir o
desvio para `/workspace-setup`.

Duas ressalvas:

- **`cachedProfile` é tipado `any`.** Todo call site existente faz cast
  (`(profile as any).empresa`, `(profile as unknown as Record<string,string>).empresa`).
  O builder deve aceitar `string | null | undefined` nos dois campos e tratar
  valor ausente pela tabela de degradação, em vez de confiar no tipo.
- **`profiles.empresa` não é o nome do workspace ativo.** Num setup
  multi-workspace os dois divergem. Para o prefill, `profiles.empresa` é a
  escolha certa: identifica quem está escrevendo, não qual workspace estava
  aberto na tela. Não trocar por `getCurrentWorkspace()`.

### 2. Card do dashboard

`WhatsAppSupportCard`, renderizado a partir do `DashboardPage` ao lado dos três
nudges existentes. Segue o padrão de
`apps/crm/src/components/billing/TrialNudgeCard.tsx`:

- Visível só para owner, via `(workspaceRole ?? role) === 'owner'`.
- Dispensa persistida em `localStorage`, chave
  `whatsapp_support_dismissed_${conta_id}`.

**Formato e leitura da chave**, para não haver ambiguidade entre "dispensado" e
"corrompido":

| | |
|---|---|
| Escrita | `new Date().toISOString()`, mesmo formato do `TrialNudgeCard` |
| Leitura | dispensado quando a chave existe **e** `new Date(raw).getTime()` não é `NaN` |
| Ausente, vazia, ou não parseável como data | **não** dispensado, card aparece |

Ou seja, presença sozinha não basta: o valor precisa ser uma data válida. É a
mesma função `isDismissalActive` do `TrialNudgeCard`
(`apps/crm/src/components/billing/TrialNudgeCard.tsx:17`) sem a comparação de
janela. Um `localStorage` sujo por outra aplicação no mesmo domínio falha para
mostrar o card, não para escondê-lo para sempre.

Duas diferenças em relação ao `TrialNudgeCard`:

- **A dispensa é permanente**, não uma janela de 7 dias. Uma data válida
  qualquer, de qualquer idade, significa dispensado.
- **Não há query de billing.** O card renderiza na primeira pintura, sem gate de
  carregamento.

Público: todos os owners, até dispensarem. Como uma conta antiga também vê o
card, a copy precisa ser correta em qualquer idade de conta. Título "Fale com a
gente no WhatsApp", não "precisa de ajuda pra configurar?". Contexto
`dashboard`.

### 3. E-mail de boas-vindas

Botão de WhatsApp junto da linha "responder este e-mail" em
`buildWelcomeEmail` (`supabase/functions/_shared/lifecycle-emails.ts:109`),
reutilizando o helper `ctaButton` do módulo.

O href passa por `escapeHtml`, já importado ali, porque entra em HTML cru.

**O prefill do e-mail carrega só o primeiro nome, sem empresa.** Isso está
fechado, não é uma decisão adiada. A empresa não chega ao handler hoje:
`get_welcome_email_candidates()` retorna exatamente
`(user_id, email, nome, attempts)`
(`supabase/migrations/20260730000001_lifecycle_emails.sql:45`), e nem
`sendWelcome`, nem `LifecycleCronDeps`, nem `buildWelcomeEmail` recebem
workspace. Trazê-la exigiria alterar RPC, migração, tipos e testes em cadeia,
o que não se justifica por uma string de prefill.

Na prática o builder é chamado com `empresa: null`, caindo na linha "só nome"
da tabela de degradação. Nenhum código novo é necessário para isso, o que é
justamente o motivo de a degradação estar especificada.

## Analytics

Um evento novo, `whatsapp_support_clicked`, adicionado à união fechada em
`apps/crm/src/lib/analytics.ts:9`, com `{ context }` como propriedade.

Capturado com `sendInstantly: true`. A troca para o app no mobile pode suspender
a página antes de o posthog-js esvaziar a fila, e o handler de `pagehide`
normalmente salva o evento mas "normalmente" não é garantia que valha a pena
correr.

Sem evento de dispensa. O `TrialNudgeCard` também não tem, e a taxa de dispensa
não muda nenhuma decisão hoje.

## Fora de escopo

- Qualquer coisa de Cloud API: template, webhook, WABA, número verificado.
- Coluna no banco, RPC, ou caminho de escrita para `profiles.whatsapp_opt_in`.
- Alteração no `supabase/migrations/20260729000002_profiles_write_lockdown.sql`.
- Configuração do número pelo portal admin ou por tabela de settings. O número
  vive em variável de ambiente.
- Qualquer mudança no Crisp.
- Registro no CRM das conversas de WhatsApp.

## Testes

**Vitest, builder:**

- monta a URL com nome e empresa, com encoding correto de acentos e espaços
- degrada para as três variantes sem nome, sem empresa, sem os dois
- reduz `nome` à primeira palavra
- aceita `null` e `undefined` nos dois campos sem lançar, já que o `profile`
  vem tipado `any`
- retorna `null` quando a variável de ambiente não está definida
- retorna `null` para valor malformado: `+5511999999999`, `55 11 99999-9999`,
  `(11) 99999-9999`, string vazia
- aceita um valor válido só de dígitos
- `context` seleciona o texto certo

**Vitest, card:**

- não renderiza para não-owner
- não renderiza quando já dispensado, com timestamp ISO válido na chave
- não renderiza quando a variável não está definida
- clicar em dispensar grava um ISO válido no `localStorage` e some com o card
- valor não parseável como data (`'true'`, `'sim'`, `''`) mostra o card
- timestamp ISO antigo, de meses atrás, continua contando como dispensado, o
  que separa este card da janela de 7 dias do `TrialNudgeCard`

**Deno, e-mail:**

- o HTML do e-mail de boas-vindas contém o link `wa.me` quando
  `WHATSAPP_SUPPORT_NUMBER` está definida
- o e-mail sai íntegro, sem botão e sem href quebrado, quando não está

**Typecheck:** a união fechada de `AnalyticsEvent` faz um nome de evento
digitado errado virar erro de `tsc`, não um passo de funil silenciosamente
ausente.

## Verificação antes do PR

Rodar os quatro `tsc` do CI (crm, hub, admin, scripts), `npm run test`,
`npm run test:functions`, `npm run lint` e `npm run format:check`.

`npm run test:functions` suja o `deno.lock` da raiz. Reverter com
`git checkout -- deno.lock` antes de commitar.

Verificar o card e o rodapé no browser em viewport de desktop e de mobile. O
jsdom não avalia media query, então responsividade não é verificável em teste.

## Riscos

| Risco | Mitigação |
|---|---|
| Volume de mensagens acima do que uma pessoa lê | O card é dispensável e o link não é o CTA primário em nenhuma tela. Se o volume incomodar, remover a superfície mais barulhenta primeiro |
| Variável esquecida em produção | Falha fechado: sem link, sem erro |
| Nome e empresa na query string do `wa.me` | O destino é o próprio mensageiro da Meta, então o dado ia para lá de qualquer forma. Vale uma linha na página de LGPD se um dia ela listar fluxos de dado |
| Usuário edita o prefill e some com a identificação | Tratado como dica, nunca como fonte de verdade |
