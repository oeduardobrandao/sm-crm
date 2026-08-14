# Mesaas 🚀

**Gestão inteligente para social media managers.**

CRM para agências de social media: clientes, entregas, aprovações, financeiro, contratos,
equipe e analytics de Instagram — com um portal whitelabel para o cliente final.

![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-6.x-646CFF?logo=vite&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)
![Supabase](https://img.shields.io/badge/Supabase-Auth%20%2B%20Postgres%20%2B%20Edge-3ECF8E?logo=supabase&logoColor=white)

## 📦 O que tem aqui

Monorepo com npm workspaces (`apps/*`, `packages/*`) — **três aplicações React sobre um
único backend Supabase**:

| App | Porta | O que é |
|---|---|---|
| `apps/crm` | 5173 | Dashboard interno da agência |
| `apps/hub` | 5175 | Portal do cliente, acesso por token (sem login) |
| `apps/admin` | 5177 | Admin da plataforma (workspaces, planos, convites) |

| Pasta | O que é |
|---|---|
| `packages/ui`, `packages/i18n` | Primitivos e traduções compartilhados |
| `supabase/functions/` | 71 edge functions em **Deno** (+ `_shared/` e `__tests__/`) |
| `supabase/migrations/` | Migrations SQL |
| `workers/media-proxy/` | Cloudflare Worker (deploy manual) |
| `e2e/` | Playwright |
| `docs/superpowers/specs/` | Specs de design e planos de implementação |

## ✨ Funcionalidades

**CRM** — dashboard com KPIs, clientes, entregas (kanban de workflows), calendário editorial,
aprovações, arquivos, ideias, leads, financeiro, contratos, equipe, analytics de conta e de
fluxos, relatórios em PDF, e configuração de planos e cobrança.

**Hub do cliente** — home, postagens (com deep-link por post), aprovações, briefing, ideias,
marca, páginas, mensagens e relatórios. Visual whitelabel dirigido pelo `brand_color` do
workspace.

**Integrações** — Instagram (publicação, métricas, relatórios), TikTok, Stripe (assinaturas
e dunning), Cloudflare R2 (mídia), Resend (e-mail), e um servidor MCP para agentes.

## 🛠 Stack

- **Frontend:** React 19 + TypeScript + Vite 6. React Router v7 no CRM,
  `createBrowserRouter` no Hub. TanStack Query para dados do servidor.
- **Estilo:** Tailwind CSS 3.4 + shadcn/ui (Radix). Ver [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md).
- **Backend:** Supabase — Postgres com RLS, Auth e Edge Functions (Deno).
- **Ícones:** `lucide-react`. **Formulários:** `react-hook-form` + `zod`.
  **Rich text:** TipTap. **Toasts:** `sonner`.
- **Testes:** Vitest (frontend), `deno test` (edge functions), Playwright (E2E),
  psql (entitlements).

## 🚀 Setup local

Requer **Node 18+** e uma conta [Supabase](https://supabase.com).

```bash
git clone https://github.com/SEU_USUARIO/sm-crm.git
cd sm-crm
npm install
cp .env.example .env    # preencha com as credenciais do Supabase
npm run dev             # CRM em http://localhost:5173
```

Por padrão o dev server aponta para **produção** (`.env`). Para trabalhar contra staging use
os scripts `:staging`, que sobrepõem `.env.staging`.

```bash
npm run dev             # CRM            npm run dev:staging
npm run dev:hub         # Hub            npm run dev:hub:staging
npm run dev:admin       # Admin          npm run dev:admin:staging
npm run dev:all         # os três juntos npm run dev:all:staging
```

### Variáveis de ambiente

O frontend só precisa de duas (prefixo `VITE_`, expostas ao browser):

| Variável | Descrição |
|---|---|
| `VITE_SUPABASE_URL` | URL do projeto Supabase |
| `VITE_SUPABASE_ANON_KEY` | Chave anon/pública |

As edge functions têm as suas próprias, configuradas em `supabase secrets` e **não** no `.env`
do frontend: `TOKEN_ENCRYPTION_KEY`, `META_APP_*`, `R2_*`, `STRIPE_*`, `CRON_SECRET`,
`INTERNAL_FUNCTION_SECRET`, `TIKTOK_*`, `GEMINI_API_KEY`, entre outras.

> ⚠️ Não existe hoje uma lista completa em um só lugar. O `.env.example` cobre apenas as
> variáveis do frontend mais `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET`, e o
> [CLAUDE.md](CLAUDE.md) documenta a maioria mas não todas — `INTERNAL_FUNCTION_SECRET`, por
> exemplo, é obrigatória e faz o `report-worker` e os geradores de relatório falharem no
> boot se faltar. Ao provisionar um ambiente novo, confira também os `Deno.env.get` das
> functions que for usar.

> ⚠️ Nunca commite `.env`, `.env.local` ou `.env.staging`.

## ✅ Verificando as mudanças

Tudo abaixo roda no CI e barra o merge:

**`npm run build` só faz o typecheck do CRM.** O CI checa os três apps e os scripts
separadamente, então uma mudança no Hub ou no Admin pode passar localmente e quebrar o CI.
Rode os mesmos quatro que o CI roda:

```bash
npx tsc -p apps/crm/tsconfig.json   --noEmit
npx tsc -p apps/hub/tsconfig.json   --noEmit
npx tsc -p apps/admin/tsconfig.json --noEmit
npx tsc -p tsconfig.scripts.json

npm run test           # Vitest
npm run test:functions # deno test nas edge functions
npm run lint           # eslint apps/ packages/
npm run format:check   # prettier
```

Jobs do CI (oito, em `.github/workflows/ci.yml`): `typecheck-and-test`,
`edge-function-tests`, `entitlement-tests`, `coverage-threshold`, `format-check`,
`migration-version-guard`, `e2e` e `e2e-secrets-guard`.

Três detalhes que costumam enganar:

- `migration-version-guard` falha se duas migrations compartilharem o prefixo de
  versão, porque a segunda seria silenciosamente ignorada no banco remoto.
- `entitlement-tests` sobe um Supabase local e roda
  `supabase/tests/entitlements/*.sql`. Rodar essas suítes na mão exige Docker,
  mas elas **são** barradas pelo CI de qualquer forma.
- `e2e` verde nem sempre quer dizer que o e2e rodou: sem os secrets configurados
  o job pula em silêncio. É para isso que existe o `e2e-secrets-guard`, que
  avisa quais secrets faltam.

## 📦 Build & Deploy

```bash
npm run build          # CRM   -> dist/
npm run build:hub      # Hub   -> dist/hub/  (base path /hub/)
npm run build:admin    # Admin
```

- **Hosting:** Vercel. `vercel.json` roda os builds e faz os rewrites. **Não há catch-all
  para o CRM** — as rotas são uma lista nomeada:

  | Rota | Destino |
  |---|---|
  | `/:workspace/hub/:token…` | `/hub/index.html` |
  | `/admin/…` | `/admin/index.html` |
  | `/precos`, `/sobre`, `/novidades`, `/lgpd`, … | HTML próprio, pré-renderado |
  | `/(login\|dashboard\|clientes\|financeiro\|…)` | `/app.html` |

  > ⚠️ **Ao adicionar uma rota nova no CRM é obrigatório incluí-la nesse padrão nomeado do
  > `vercel.json`.** Sem isso a rota funciona em dev e dá 404 em produção.
- **Backend:** Supabase. `npx supabase functions deploy <nome>` (use `--no-verify-jwt` em
  functions que tratam a própria auth: callbacks OAuth, crons, hub) e
  `npx supabase db push --linked` para migrations.
- **Mídia:** Cloudflare R2 via URLs pré-assinadas.

## 🔒 Segurança

- **RLS** em todas as tabelas; toda edge function confere a posse do workspace (`conta_id`)
  antes de devolver ou alterar dados.
- **CORS** sempre via `buildCorsHeaders(req)` — nunca wildcard `*`.
- **Crons** autenticam pelo header `x-cron-secret`; as demais functions validam o JWT.
- **Segredos** só por variável de ambiente. `TOKEN_ENCRYPTION_KEY` é obrigatória e não tem
  fallback.
- Edge functions nunca devolvem detalhe de erro ao cliente — mensagem genérica para fora,
  detalhe no log interno.

## 📚 Documentação

| Arquivo | Para quê |
|---|---|
| [CLAUDE.md](CLAUDE.md) | Convenções e comandos para o Claude Code |
| [AGENTS.md](AGENTS.md) | Convenções e prioridades de review para agentes em geral |
| [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) | Tokens, tipografia, layout e componentes |
| `docs/superpowers/specs/` | Specs de design por feature |

## 📄 Licença

Projeto privado. Todos os direitos reservados.
