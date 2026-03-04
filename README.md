# CRM Fluxo 🚀

**Gestão Inteligente para Social Media Managers**

CRM completo para gerenciar clientes, finanças, contratos e equipe — com design premium, frosted glass e navegação responsiva.

![Vite](https://img.shields.io/badge/Vite-5.x-646CFF?logo=vite&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)
![Supabase](https://img.shields.io/badge/Supabase-Auth%20%2B%20DB-3ECF8E?logo=supabase&logoColor=white)

## ✨ Features

- **Dashboard** — Painel de controle com KPIs e receita por cliente
- **Clientes** — CRUD completo de clientes com filtros por status
- **Financeiro** — Controle de receitas e despesas
- **Contratos** — Gestão de contratos por status
- **Equipe** — Membros CLT e freelancers
- **Integrações** — Status de conexões externas
- **Auth** — Login/cadastro com Supabase Auth
- **Responsivo** — Bottom nav bar para mobile, sidebar para desktop

## 🛠 Tech Stack

- **Frontend:** Vanilla TypeScript + Vite
- **Styling:** CSS puro (frosted glass, dark sidebar, animações)
- **Backend:** Supabase (Auth + Postgres + RLS)
- **Icons:** Font Awesome 6
- **Font:** Plus Jakarta Sans

## 🚀 Setup Local

### Pré-requisitos
- Node.js 18+
- Conta no [Supabase](https://supabase.com)

### Instalação

```bash
# Clone o repositório
git clone https://github.com/SEU_USUARIO/sm-crm.git
cd sm-crm

# Instale dependências
npm install

# Configure variáveis de ambiente
cp .env.example .env
# Edite .env com suas credenciais do Supabase

# Inicie o dev server
npm run dev
```

### Variáveis de Ambiente

| Variável | Descrição |
|----------|-----------|
| `VITE_SUPABASE_URL` | URL do seu projeto Supabase |
| `VITE_SUPABASE_ANON_KEY` | Chave anon/pública do Supabase |

> ⚠️ **Nunca commite o arquivo `.env`!** Use `.env.example` como template.

## 📦 Build & Deploy

```bash
# Build de produção
npm run build

# Preview local
npm run preview
```

### Deploy no Vercel

1. Importe o repositório no [Vercel](https://vercel.com/new)
2. Configure as variáveis de ambiente:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
3. Framework Preset: **Vite**
4. Deploy automático a cada push na `main`

## 📁 Estrutura

```
sm-crm/
├── index.html          # HTML principal (sidebar + mobile nav)
├── style.css           # Design system completo
├── src/
│   ├── main.ts         # Bootstrap + event listeners
│   ├── router.ts       # SPA router com auth guard
│   ├── store.ts        # CRUD operations (Supabase)
│   ├── vite-env.d.ts   # Tipagem das env vars
│   ├── lib/
│   │   └── supabase.ts # Client Supabase + auth helpers
│   └── pages/
│       ├── dashboard.ts
│       ├── clientes.ts
│       ├── financeiro.ts
│       ├── contratos.ts
│       ├── equipe.ts
│       ├── integracoes.ts
│       ├── configuracao.ts
│       └── login.ts
├── .env.example        # Template de variáveis
└── .gitignore
```

## 🔒 Segurança

- **RLS (Row Level Security)** habilitado em todas as tabelas
- **Chaves API** via variáveis de ambiente (não commitadas)
- **Auth** gerenciado pelo Supabase Auth
- **Sessão** persistida via `getSession()` direto (sem race conditions)

## 📄 Licença

Projeto privado. Todos os direitos reservados.
