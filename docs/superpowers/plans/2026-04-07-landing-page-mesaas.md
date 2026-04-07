# Landing Page Mesaas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a public marketing landing page at `/` (root route) that educates agencies and freelance social media managers about Mesaas and converts them to free signups.

**Architecture:** A single `LandingPage.tsx` component with no auth/Supabase dependencies. The root route in `App.tsx` currently redirects authenticated users to `/dashboard` — we change it to render `LandingPage` publicly, and handle the auth redirect inside `ProtectedRoute` (already does this). The page is divided into self-contained section components within the same file.

**Tech Stack:** React 19, TypeScript, Tailwind CSS (CSS variables palette), lucide-react, no new dependencies.

---

## File Map

| Action | File | Responsibility |
|--------|------|---------------|
| Create | `src/pages/landing/LandingPage.tsx` | Full landing page — all sections |
| Modify | `src/App.tsx` | Change root route from redirect to `LandingPage` |

---

### Task 1: Register the root route

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Add LandingPage lazy import**

In `src/App.tsx`, after the existing public page imports (around line 14), add:

```tsx
const LandingPage = lazy(() => import('./pages/landing/LandingPage'));
```

- [ ] **Step 2: Replace the index route**

Find this line inside the protected `<Route element={<ProtectedRoute>...}>` block:

```tsx
<Route index element={<Navigate to="/dashboard" replace />} />
```

Replace it with a public route at the top level (outside the protected block), just before the protected routes block:

```tsx
{/* Landing page — public */}
<Route path="/" element={<LandingPage />} />
```

And change the protected index route to an explicit `/dashboard` redirect that only fires when the user navigates to `/dashboard` directly — which already exists as `<Route path="/dashboard" element={<DashboardPage />} />`. So simply remove the `<Route index ...>` line entirely from the protected block.

The final routes structure should look like:

```tsx
<Routes>
  {/* Public routes */}
  <Route path="/" element={<LandingPage />} />
  <Route path="/login" element={<LoginPage />} />
  <Route path="/configurar-senha" element={<ConfigurarSenhaPage />} />
  <Route path="/politica-de-privacidade" element={<PoliticaPage />} />
  <Route path="/portal/:token" element={<PortalPage />} />

  {/* Protected routes with sidebar layout */}
  <Route element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
    <Route path="/dashboard" element={<DashboardPage />} />
    {/* ... rest unchanged ... */}
  </Route>

  <Route path="*" element={<Navigate to="/login" replace />} />
</Routes>
```

- [ ] **Step 3: Verify the app compiles**

```bash
cd /Users/eduardosouza/Projects/sm-crm && npm run build 2>&1 | tail -20
```

Expected: build succeeds (or only fails because `LandingPage` file doesn't exist yet — that's fine at this step, proceed).

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx
git commit -m "feat: register public root route for landing page"
```

---

### Task 2: Create LandingPage — Header

**Files:**
- Create: `src/pages/landing/LandingPage.tsx`

- [ ] **Step 1: Create the file with the Header section**

Create `src/pages/landing/LandingPage.tsx`:

```tsx
import { useState } from 'react';
import { Users, CheckSquare, ExternalLink, Calendar, ChevronDown } from 'lucide-react';

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <Header />
      <Hero />
      <Testimonial />
      <Features />
      <Faq />
      <CtaFinal />
      <Footer />
    </div>
  );
}

function Header() {
  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <span className="text-xl font-bold tracking-tight">Mesaas</span>
        <nav className="hidden gap-6 text-sm text-muted-foreground md:flex">
          <a href="#features" className="hover:text-foreground transition-colors">Funcionalidades</a>
          <a href="#faq" className="hover:text-foreground transition-colors">FAQ</a>
        </nav>
        <a
          href="/login"
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 transition-opacity"
        >
          Criar conta grátis
        </a>
      </div>
    </header>
  );
}

function Hero() {
  return null; // implemented in next task
}

function Testimonial() {
  return null;
}

function Features() {
  return null;
}

function Faq() {
  return null;
}

function CtaFinal() {
  return null;
}

function Footer() {
  return null;
}
```

- [ ] **Step 2: Verify the page renders**

```bash
npm run dev
```

Navigate to `http://localhost:5173/` — should show the sticky header with "Mesaas" logo and "Criar conta grátis" button. No errors in console.

- [ ] **Step 3: Commit**

```bash
git add src/pages/landing/LandingPage.tsx
git commit -m "feat: add landing page scaffold and header"
```

---

### Task 3: Hero section

**Files:**
- Modify: `src/pages/landing/LandingPage.tsx`

- [ ] **Step 1: Implement Hero**

Replace the `Hero` function stub:

```tsx
function Hero() {
  return (
    <section className="mx-auto max-w-6xl px-6 py-24 text-center">
      <h1 className="mx-auto max-w-4xl text-4xl font-extrabold leading-tight tracking-tight md:text-5xl lg:text-6xl">
        Sua agência de social media com clientes organizados, entregas no prazo e relatórios em um só lugar
      </h1>
      <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground">
        Mesaas é o CRM feito para gestores e agências de social media. Gerencie clientes, workflows de entrega, financeiro e aprovações — sem planilha, sem caos.
      </p>
      <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
        <a
          href="/login"
          className="rounded-md bg-primary px-6 py-3 text-base font-semibold text-primary-foreground hover:opacity-90 transition-opacity"
        >
          Criar conta grátis
        </a>
        <a
          href="#features"
          className="text-base font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          Ver como funciona →
        </a>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Verify visually**

Open `http://localhost:5173/` — should show large headline, subtitle, and two CTAs centered on the page.

- [ ] **Step 3: Commit**

```bash
git add src/pages/landing/LandingPage.tsx
git commit -m "feat: add landing page hero section"
```

---

### Task 4: Testimonial section

**Files:**
- Modify: `src/pages/landing/LandingPage.tsx`

- [ ] **Step 1: Implement Testimonial**

Replace the `Testimonial` function stub:

```tsx
function Testimonial() {
  return (
    <section className="bg-muted/40 py-16">
      <div className="mx-auto max-w-3xl px-6 text-center">
        <blockquote className="text-xl font-medium leading-relaxed text-foreground">
          "[PLACEHOLDER — inserir depoimento real da agência beta]"
        </blockquote>
        <p className="mt-4 text-sm text-muted-foreground">
          — <strong>[Nome]</strong>, [Agência]
        </p>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Verify visually**

Open `http://localhost:5173/` — testimonial block should appear below the hero with muted background.

- [ ] **Step 3: Commit**

```bash
git add src/pages/landing/LandingPage.tsx
git commit -m "feat: add landing page testimonial placeholder"
```

---

### Task 5: Features section

**Files:**
- Modify: `src/pages/landing/LandingPage.tsx`

- [ ] **Step 1: Implement Features**

Replace the `Features` function stub:

```tsx
function Features() {
  const items = [
    {
      icon: <Users className="h-6 w-6 text-primary" />,
      title: 'Clientes e contratos organizados',
      description:
        'Cadastro de clientes, contratos, histórico e dados financeiros em um só lugar. Chega de informação espalhada.',
    },
    {
      icon: <CheckSquare className="h-6 w-6 text-primary" />,
      title: 'Workflows de entrega sem atrito',
      description:
        'Crie etapas de produção, atribua tarefas à equipe e acompanhe o status de cada entrega em tempo real.',
    },
    {
      icon: <ExternalLink className="h-6 w-6 text-primary" />,
      title: 'Portal de aprovação para o cliente',
      description:
        'Seu cliente aprova posts, deixa comentários e acompanha o progresso — sem precisar de login nem acesso ao sistema interno.',
    },
    {
      icon: <Calendar className="h-6 w-6 text-primary" />,
      title: 'Calendário e visão geral de conteúdo',
      description:
        'Veja todos os posts agendados e entregues por cliente em um calendário unificado, com status de cada publicação.',
    },
  ];

  return (
    <section id="features" className="mx-auto max-w-6xl px-6 py-24">
      <h2 className="text-center text-3xl font-bold tracking-tight md:text-4xl">
        Tudo que sua agência precisa em um só lugar
      </h2>
      <div className="mt-14 grid gap-8 md:grid-cols-2">
        {items.map((item) => (
          <div key={item.title} className="rounded-xl border border-border bg-card p-8">
            <div className="mb-4">{item.icon}</div>
            <h3 className="mb-2 text-lg font-semibold">{item.title}</h3>
            <p className="text-muted-foreground">{item.description}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Verify visually**

Open `http://localhost:5173/#features` — should show 2x2 grid of feature cards with icons, titles, and descriptions.

- [ ] **Step 3: Commit**

```bash
git add src/pages/landing/LandingPage.tsx
git commit -m "feat: add landing page features section"
```

---

### Task 6: FAQ section

**Files:**
- Modify: `src/pages/landing/LandingPage.tsx`

- [ ] **Step 1: Add useState import (already at top) and implement FAQ**

The `useState` import is already at the top of the file. Replace the `Faq` function stub:

```tsx
function Faq() {
  const [open, setOpen] = useState<number | null>(null);

  const items = [
    {
      q: 'É gratuito?',
      a: 'Sim, o Mesaas está em fase beta e é totalmente gratuito agora. Crie sua conta e comece hoje.',
    },
    {
      q: 'Preciso instalar alguma coisa?',
      a: 'Não. É 100% web, funciona em qualquer navegador.',
    },
    {
      q: 'Consigo migrar meus clientes de planilhas?',
      a: 'Sim, o cadastro é simples e rápido. Em minutos seus clientes estão dentro do sistema.',
    },
    {
      q: 'Meu cliente precisa criar uma conta para usar o portal?',
      a: 'Não. O portal de aprovação é acessado por um link único, sem login.',
    },
    {
      q: 'Funciona para freelancers ou só para agências?',
      a: 'Para os dois. Você pode gerenciar de 1 a dezenas de clientes.',
    },
    {
      q: 'Como faço para começar?',
      a: 'Clique em "Criar conta grátis", cadastre sua agência e comece a usar imediatamente.',
    },
  ];

  return (
    <section id="faq" className="bg-muted/40 py-24">
      <div className="mx-auto max-w-3xl px-6">
        <h2 className="mb-12 text-center text-3xl font-bold tracking-tight md:text-4xl">
          Perguntas frequentes
        </h2>
        <div className="divide-y divide-border rounded-xl border border-border bg-card">
          {items.map((item, i) => (
            <div key={i}>
              <button
                className="flex w-full items-center justify-between px-6 py-5 text-left font-medium hover:bg-muted/30 transition-colors"
                onClick={() => setOpen(open === i ? null : i)}
              >
                <span>{item.q}</span>
                <ChevronDown
                  className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open === i ? 'rotate-180' : ''}`}
                />
              </button>
              {open === i && (
                <div className="px-6 pb-5 text-muted-foreground">{item.a}</div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Verify visually**

Open `http://localhost:5173/#faq` — accordion should open/close each item on click.

- [ ] **Step 3: Commit**

```bash
git add src/pages/landing/LandingPage.tsx
git commit -m "feat: add landing page FAQ accordion"
```

---

### Task 7: CTA Final + Footer

**Files:**
- Modify: `src/pages/landing/LandingPage.tsx`

- [ ] **Step 1: Implement CtaFinal**

Replace the `CtaFinal` function stub:

```tsx
function CtaFinal() {
  return (
    <section className="mx-auto max-w-6xl px-6 py-24 text-center">
      <h2 className="text-3xl font-bold tracking-tight md:text-4xl">
        Pronto para sair das planilhas?
      </h2>
      <p className="mt-4 text-lg text-muted-foreground">
        Crie sua conta grátis e comece a organizar sua agência hoje.
      </p>
      <a
        href="/login"
        className="mt-8 inline-block rounded-md bg-primary px-8 py-3 text-base font-semibold text-primary-foreground hover:opacity-90 transition-opacity"
      >
        Criar conta grátis
      </a>
    </section>
  );
}
```

- [ ] **Step 2: Implement Footer**

Replace the `Footer` function stub:

```tsx
function Footer() {
  return (
    <footer className="border-t border-border py-8">
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-4 px-6 text-sm text-muted-foreground sm:flex-row sm:justify-between">
        <span className="font-semibold text-foreground">Mesaas</span>
        <div className="flex gap-6">
          <a href="/politica-de-privacidade" className="hover:text-foreground transition-colors">
            Política de Privacidade
          </a>
        </div>
        <span>© 2025 Mesaas. Todos os direitos reservados.</span>
      </div>
    </footer>
  );
}
```

- [ ] **Step 3: Verify full page**

Open `http://localhost:5173/` and scroll through the entire page. Verify:
- Header sticks on scroll
- Hero headline is large and readable
- Testimonial placeholder is visible
- Features grid is 2 columns on desktop, 1 on mobile (resize browser)
- FAQ accordion opens/closes
- CTA final section has contrast
- Footer shows links

- [ ] **Step 4: Final build check**

```bash
npm run build 2>&1 | tail -20
```

Expected: build succeeds with no errors.

- [ ] **Step 5: Commit**

```bash
git add src/pages/landing/LandingPage.tsx
git commit -m "feat: add landing page CTA final and footer — landing page complete"
```

---

## Self-Review

**Spec coverage:**
- ✅ Header sticky com nav e CTA — Task 2
- ✅ Hero com H1, subtítulo, CTAs primário e secundário — Task 3
- ✅ Depoimento placeholder — Task 4
- ✅ 4 feature cards com ícones corretos (Users, CheckSquare, ExternalLink, Calendar) — Task 5
- ✅ FAQ accordion 6 perguntas — Task 6
- ✅ CTA final + Footer com link política privacidade — Task 7
- ✅ Rota `/` pública registrada — Task 1
- ✅ Sem preços, sem números, sem Supabase

**Placeholder scan:** Nenhum TBD ou TODO de implementação. O depoimento é um placeholder intencional documentado no spec.

**Type consistency:** Sem tipos compartilhados entre tasks — cada função é independente. `useState<number | null>` definido e usado na mesma função.
