# Painel do afiliado: login por link mágico + ajustes visuais

Data: 2026-10-10. Complementa `2026-10-10-programa-de-afiliados-design.md`.

## Problema

O painel hoje abre por `/afiliados/painel/:token`, com um token de 180 dias, reutilizável,
mandado por e-mail. Na prática é uma senha dentro da URL:

- fica no histórico do navegador, em favoritos, em prints e em links encaminhados;
- vai junto para o Stripe nas URLs de retorno e de refresh do onboarding (`return_url`,
  `refresh_url`), que o Stripe guarda;
- quem tiver a URL tem o painel por seis meses (incluindo o botão "Abrir painel do Stripe").

## Decisão

Login por link mágico de uso único, trocado por uma sessão guardada no navegador.

1. **Pedir acesso.** `/afiliados` (já existe "Já sou afiliado: receber link de acesso") e o
   cadastro mandam um e-mail com `https://<app>/afiliados/entrar#<login_token>`.
   - `login_token`: 32 bytes aleatórios (mesmo formato de hoje), **15 minutos**, **uso único**.
   - O token vai no **fragmento** (`#`), que o navegador não manda ao servidor nem no `Referer`.
2. **Entrar.** `/afiliados/entrar` lê o fragmento e apaga-o da barra (`history.replaceState`),
   mas **não troca sozinho**: mostra "Entrar no painel" e só chama a ação nova
   `exchange { login_token }` no clique. Filtros de e-mail que abrem o link e até executam JS
   (detonação de links) não queimam o token sem esse clique. A troca é **uma RPC atômica**
   (abaixo): no mesmo commit marca o login como usado e cria a sessão (32 bytes, **30 dias**).
   O front grava o `session_token` em `localStorage` (`mesaas:affiliate-session`) e navega
   para `/afiliados/painel`.
   - Token inválido, vencido ou já usado: tela "Este link expirou ou já foi usado" com o
     campo de e-mail para pedir outro (reusa `send_link`).
   - `localStorage` indisponível (bloqueado, cota cheia): a sessão fica em memória na aba,
     o painel abre com um aviso de que fechar ou recarregar a página exige um novo link, e
     o botão do Stripe avisa que a volta do onboarding vai pedir login de novo.
3. **Painel.** `/afiliados/painel` (sem token na URL) lê a sessão (memória, senão `localStorage`) e a envia
   nas ações existentes (`dashboard`, `connect_start`, `connect_dashboard`) no mesmo campo
   `token`. Sem sessão ou sessão vencida/revogada (404 da função): limpa o `localStorage` e
   mostra a mesma tela de pedir link.
4. **Stripe.** `return_url`/`refresh_url` passam a ser `/afiliados/painel?stripe=retorno|refresh`,
   sem token.
5. **Sair.** Botão "Sair" no cabeçalho do painel: ação nova `logout { token }` apaga a linha da
   sessão; o front limpa o `localStorage` e volta para `/afiliados`.

### Banco

`affiliate_access_tokens` ganha:

- `kind text NOT NULL DEFAULT 'session' CHECK (kind IN ('login','session'))`
- `used_at timestamptz` (só faz sentido para `login`)

`resolveToken` (usado pelas ações do painel) passa a aceitar só `kind = 'session'`.

Troca atômica: função `public.affiliate_exchange_login(p_login_hash text, p_session_hash text,
p_session_expires_at timestamptz) RETURNS uuid` (plpgsql, `SECURITY INVOKER`,
`SET search_path = public, pg_temp`): `UPDATE affiliate_access_tokens SET used_at = now()
WHERE token_hash = p_login_hash AND kind = 'login' AND used_at IS NULL AND expires_at > now()
RETURNING affiliate_id`; sem linha, devolve `NULL`; com linha, insere a sessão e devolve o
`affiliate_id`. Tudo na mesma transação: duas trocas concorrentes do mesmo link geram no
máximo uma sessão, e uma falha ao criar a sessão desfaz o `used_at`. Privilégios:
`REVOKE EXECUTE ... FROM PUBLIC, anon, authenticated` (nomeando os papéis, o REVOKE de
PUBLIC sozinho não basta no Supabase) e `GRANT EXECUTE ... TO service_role`.

Pedir um link novo **não** invalida logins ainda não usados nem sessões: senão qualquer um
derrubaria o acesso alheio pedindo link com o e-mail da vítima (mesma regra da migração
original). O prazo de 15 minutos e o uso único limitam a janela. A troca
aceita só `kind = 'login'`. Um token de login nunca abre o painel direto.

Tokens existentes (180 dias, todos `session` pelo default) seguem válidos até vencer.

### Compatibilidade

`/afiliados/painel/:token` continua existindo como rota legada: guarda o token como sessão no
`localStorage`, troca a URL por `/afiliados/painel` (`replace`) e segue. Os links já mandados
por e-mail não quebram, e o token some da barra no primeiro acesso.

### E-mail

Assunto "Seu link de acesso ao painel de afiliado Mesaas". Corpo: o link vale por 15 minutos e
funciona uma vez; para entrar de novo, peça outro em `/afiliados`. Sai o texto herdado que fala
em cadastrar "chave PIX" (o repasse é pelo Stripe, para a conta bancária). Visual no padrão do
app (botão ink), não mais o verde `#1a3d2b`. `reply_to` continua
`eduardo@mesaas.com.br`.

### Limites

Os rate limits atuais (`affiliate-link:email` 3/h, por IP 5/h) seguem valendo para pedir link.
`exchange` ganha limite por IP (20/h). Uma sessão de 30 dias é um compromisso: o painel não
mexe em dinheiro (o repasse vai para a conta bancária cadastrada no próprio Stripe, que tem o
seu login), e pedir link a cada visita afasta o afiliado.

## Ajustes visuais (mesmo PR)

- **Títulos:** `h1`/`h2` das páginas `/afiliados*` usam a fonte de títulos do app
  (`var(--font-heading)`, SF Pro Display) com `letter-spacing: -0.01em`, como `.header-title h1`
  no CRM. Hoje usam a fonte do corpo com espaçamento padrão.
- **Rodapé:** compartilhado entre `/afiliados`, `/afiliados/entrar` e `/afiliados/painel`: logo,
  "Programa de afiliados", Termos de uso, Privacidade, LGPD, preferências de cookies,
  contato `eduardo@mesaas.com.br` e "© 2026 Mesaas". Tailwind (o `LandingFooter` depende do CSS
  da landing).

## Fora do escopo

Conta Supabase Auth para afiliado; troca de e-mail pelo próprio afiliado; lista de sessões.

## Deploy

Migração (só colunas novas com default) → `affiliate-public` → front (merge). A função nova
continua aceitando os tokens antigos, então a ordem migração → função → front não quebra nada.

## Detalhes de implementação (revisão Fable + Codex)

- **Troca:** `exchange` valida o formato com `ACCESS_TOKEN_RE` antes do hash; inválido, vencido
  e já usado respondem igual (404 + `MSG_INVALID_LINK`), sem dizer qual caso foi.
- **`/afiliados/entrar` no front:** guarda o fragmento num ref antes do `replaceState`; a troca
  roda em `useMutation` (o `installSilentUpdate` segura a atualização silenciosa enquanto ela
  está em voo); uma segunda montagem não reusa o token já gasto; erro de rede/5xx oferece
  "Tentar novamente" com o token em memória, 404 cai na tela de link expirado.
- **404 em qualquer ação do painel** (`dashboard`, `connect_start`, `connect_dashboard`) limpa a
  sessão e mostra a tela de pedir link. 429 e 5xx não limpam a sessão.
- **Rota legada `/afiliados/painel/:token`:** preserva `?stripe=retorno|refresh` (links de
  onboarding já emitidos voltam com ele) e só adota o token da URL se não houver sessão salva,
  para um link velho não derrubar uma sessão válida.
- **TTLs:** `LOGIN_TTL` 15 min e `SESSION_TTL` 30 dias em `logic.ts` (hoje um único de 180 dias).
- **Tokens antigos:** a migração corta os 180 dias para no máximo 30 a partir de agora
  (`expires_at = least(expires_at, now() + interval '30 days')`).
- **Limpeza:** a RPC de troca apaga as linhas vencidas do mesmo afiliado.
- **Rodapé:** reusa `components/consent/CookiePreferencesLink.tsx`.
- **Migração:** prefixo acima de `20261013000002`.
- **Testes que mudam:** `affiliate-public_test.ts` (caminho do link, `return_url` sem token),
  `AfiliadoPainelPage.test.tsx` (rota e chamadas com token). Novos: troca repetida (404),
  logout, rota legada, `/afiliados/entrar`.
- **Fora:** vínculo com IP/UA, lista de sessões, expiração deslizante. `vercel.json` já cobre
  `afiliados(/.*)?`.
