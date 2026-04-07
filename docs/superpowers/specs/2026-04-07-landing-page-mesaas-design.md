# Landing Page Mesaas — Design Spec

**Data:** 2026-04-07  
**Rota:** `/` (root route — `www.mesaas.com.br`)  
**Idioma:** Português Brasileiro  
**Stack:** React + TypeScript + Tailwind CSS + shadcn/ui + lucide-react  
**Objetivo de conversão:** Signup para conta gratuita (fase beta)

---

## Contexto

Mesaas é um CRM focado em gestores e agências de social media. A landing page serve como ponto de entrada público para educar visitantes e converter em cadastros. O público-alvo são agências de social media e freelancers de social media.

A estrutura segue o padrão feature-led da referência automarticles.com: hero forte → credibilidade → features → FAQ → CTA final.

---

## Estrutura de Seções

### 1. Header / Navegação

- Logo "Mesaas" à esquerda
- Links de navegação: ancora para #features, #faq
- Botão "Criar conta grátis" à direita (link para `/login` ou rota de signup)
- Sticky no scroll

### 2. Hero

**H1:** "Sua agência de social media com clientes organizados, entregas no prazo e relatórios em um só lugar"

**Subtítulo:** "Mesaas é o CRM feito para gestores e agências de social media. Gerencie clientes, workflows de entrega, financeiro e aprovações — sem planilha, sem caos."

**CTAs:**
- Botão primário: "Criar conta grátis" → `/login`
- Link secundário: "Ver como funciona →" → ancora para `#features`

Sem números/estatísticas (fase beta, apenas 1 agência testando).

### 3. Depoimento / Prova Social

Bloco de citação centralizado com um depoimento da agência beta.

> *[PLACEHOLDER — inserir depoimento real da agência beta]*  
> — **[Nome]**, [Agência]

### 4. Features

ID de âncora: `#features`

Quatro blocos em grid (2x2 em desktop, 1 coluna em mobile), cada um com ícone lucide, título e descrição:

| # | Ícone | Título | Descrição |
|---|-------|--------|-----------|
| 1 | `Users` | Clientes e contratos organizados | Cadastro de clientes, contratos, histórico e dados financeiros em um só lugar. Chega de informação espalhada. |
| 2 | `CheckSquare` | Workflows de entrega sem atrito | Crie etapas de produção, atribua tarefas à equipe e acompanhe o status de cada entrega em tempo real. |
| 3 | `ExternalLink` | Portal de aprovação para o cliente | Seu cliente aprova posts, deixa comentários e acompanha o progresso — sem precisar de login nem acesso ao sistema interno. |
| 4 | `Calendar` | Calendário e visão geral de conteúdo | Veja todos os posts agendados e entregues por cliente em um calendário unificado, com status de cada publicação. |

### 5. FAQ

ID de âncora: `#faq`

Accordion com 6 perguntas:

1. **É gratuito?** — Sim, o Mesaas está em fase beta e é totalmente gratuito agora. Crie sua conta e comece hoje.
2. **Preciso instalar alguma coisa?** — Não. É 100% web, funciona em qualquer navegador.
3. **Consigo migrar meus clientes de planilhas?** — Sim, o cadastro é simples e rápido. Em minutos seus clientes estão dentro do sistema.
4. **Meu cliente precisa criar uma conta para usar o portal?** — Não. O portal de aprovação é acessado por um link único, sem login.
5. **Funciona para freelancers ou só para agências?** — Para os dois. Você pode gerenciar de 1 a dezenas de clientes.
6. **Como faço para começar?** — Clique em "Criar conta grátis", cadastre sua agência e comece a usar imediatamente.

### 6. CTA Final

Bloco centralizado com fundo destacado:

- **Título:** "Pronto para sair das planilhas?"
- **Subtítulo:** "Crie sua conta grátis e comece a organizar sua agência hoje."
- **Botão:** "Criar conta grátis" → `/login`

### 7. Footer

- Logo Mesaas
- Link: Política de Privacidade → `/politica-de-privacidade`
- © 2025 Mesaas. Todos os direitos reservados.

---

## Implementação

### Arquivo a criar

`src/pages/landing/LandingPage.tsx` — componente único, sem dependências de auth ou Supabase.

### Rota a adicionar em `src/App.tsx`

```tsx
const LandingPage = lazy(() => import('./pages/landing/LandingPage'));
// ...
<Route path="/" element={<LandingPage />} />
```

Remover o `<Route index element={<Navigate to="/dashboard" replace />} />` atual ou restringir para usuários autenticados — a rota `/` deve ser pública e mostrar a landing.

### Estilo

- Tailwind CSS puro (sem antd, sem shadcn components desnecessários)
- Usar `@radix-ui/react-accordion` (já disponível via shadcn) para o FAQ
- Paleta: cor primária do projeto (verificar `style.css` ou `tailwind.config`)
- Responsivo: mobile-first, breakpoints `md` e `lg`

### Sem dependências novas

Tudo necessário já está no projeto: Tailwind, lucide-react, Radix UI.

---

## Fora do escopo

- Seção de preços (sem planos pagos no momento)
- Estatísticas/números (sem dados suficientes)
- Animações complexas
- Integração com qualquer API ou Supabase
