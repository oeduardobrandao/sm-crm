# Guia de primeiros passos — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Modal de onboarding com 3 trilhas/15 páginas para donos de workspace novo, com pill de reentrada, deep links "Fazer agora", auto-conclusão por sinais, aposentadoria do OnboardingBanner e glossário fixo no assistente de fluxo.

**Architecture:** Um `GuideProvider` leve montado no `AppLayout` (contexto + gating + progresso), consumido por `GuideDialog` (modal lazy), `GuidePill` (fixed, desktop) e `GuideNavItem` (sidebar drawer + sheet "Mais" do MobileNav). Conteúdo declarativo em `guideContent.tsx`; sinais de conclusão via TanStack Query reusando as query keys do app; progresso em localStorage por workspace.

**Tech Stack:** React 19, TanStack Query, shadcn Dialog, lucide-react, Vitest + @testing-library/react, localStorage.

**Spec:** `docs/superpowers/specs/2026-08-25-guia-primeiros-passos-design.md` — leia antes de executar qualquer task.

## Global Constraints

- Toda cópia visível é **pt-BR hardcoded** (como os wizards existentes). **Proibido em-dash (—) em copy visível**: use `:`, `·` ou ponto final.
- Nomenclatura em copy nova: **"modelo"**, nunca "template". Identificadores de código, eventos e banco NÃO mudam.
- Ícones: `lucide-react` exclusivamente.
- Sinais de conclusão: **proibido `data ?? []`**. Erro de query é inconclusivo (chave ausente), nunca zero.
- Query keys dos sinais: `['clientes']`, `['membros']`, `['workflows']`, `['portfolioSummary']`, `['hub-token-any']` — exatamente estas.
- localStorage: chave `guia_v1_${conta_id}`; `conta_id` vem de `profile.conta_id`.
- `profiles.onboarding_complete` NÃO é tocado (significa "aceitou convite").
- Nenhuma rota nova → nenhuma mudança em `vercel.json`.
- Dark mode via `[data-theme='dark']`; tokens legados (`var(--card-bg)`, `var(--border-color)`, `var(--primary-color)`, `var(--text-muted)`).
- CI local antes do push final: `npm run lint`, `npm run format:check`, os **4** tsc (`apps/crm`, `apps/hub`, `apps/admin`, `tsconfig.scripts.json`), `npm run test`.
- Commits pequenos por task, mensagem `feat(guia): ...`/`test(guia): ...`, com `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Rode os comandos a partir da raiz do worktree: `/Users/eduardosouza/Projects/sm-crm/.claude/worktrees/workflow-template-migration-54002c` (confira com `pwd` — nunca use o repo principal).

---

### Task 1: guideStorage (persistência pura)

**Files:**
- Create: `apps/crm/src/components/guide/guideStorage.ts`
- Test: `apps/crm/src/components/guide/__tests__/guideStorage.test.ts`

**Interfaces:**
- Consumes: nada (módulo puro sobre localStorage).
- Produces:
  - `interface GuideProgress { autoOpenedAt?: string; dismissedAt?: string; pagesSeen: string[]; pagesDone: string[]; trailsCompleted: string[]; lastPageId?: string; concludedAt?: string }`
  - `EMPTY_PROGRESS: GuideProgress`
  - `guideStorageKey(contaId: string): string`
  - `loadGuideProgress(contaId: string): GuideProgress`
  - `saveGuideProgress(contaId: string, p: GuideProgress): void`

- [ ] **Step 1: Write the failing test**

```ts
// apps/crm/src/components/guide/__tests__/guideStorage.test.ts
import { beforeEach, describe, expect, it } from 'vitest';
import {
  EMPTY_PROGRESS,
  guideStorageKey,
  loadGuideProgress,
  saveGuideProgress,
} from '../guideStorage';

describe('guideStorage', () => {
  beforeEach(() => localStorage.clear());

  it('usa a chave versionada por workspace', () => {
    expect(guideStorageKey('ws-1')).toBe('guia_v1_ws-1');
  });

  it('devolve progresso vazio quando não há nada salvo', () => {
    expect(loadGuideProgress('ws-1')).toEqual(EMPTY_PROGRESS);
  });

  it('faz round-trip de um progresso salvo', () => {
    saveGuideProgress('ws-1', {
      ...EMPTY_PROGRESS,
      pagesSeen: ['t1p1'],
      pagesDone: ['t1p1'],
      lastPageId: 't1p2',
    });
    const loaded = loadGuideProgress('ws-1');
    expect(loaded.pagesSeen).toEqual(['t1p1']);
    expect(loaded.lastPageId).toBe('t1p2');
  });

  it('reseta para vazio em JSON corrompido', () => {
    localStorage.setItem('guia_v1_ws-1', '{nope');
    expect(loadGuideProgress('ws-1')).toEqual(EMPTY_PROGRESS);
  });

  it('preenche arrays ausentes em payload parcial antigo', () => {
    localStorage.setItem('guia_v1_ws-1', JSON.stringify({ lastPageId: 't1p3' }));
    const loaded = loadGuideProgress('ws-1');
    expect(loaded.pagesSeen).toEqual([]);
    expect(loaded.trailsCompleted).toEqual([]);
    expect(loaded.lastPageId).toBe('t1p3');
  });

  it('não vaza progresso entre workspaces', () => {
    saveGuideProgress('ws-1', { ...EMPTY_PROGRESS, pagesSeen: ['t1p1'] });
    expect(loadGuideProgress('ws-2')).toEqual(EMPTY_PROGRESS);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/crm/src/components/guide/__tests__/guideStorage.test.ts`
Expected: FAIL (módulo `../guideStorage` não existe)

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/crm/src/components/guide/guideStorage.ts
/**
 * Progresso do guia de primeiros passos, por workspace, em localStorage
 * (padrão da casa para UI dispensável; ver spec 2026-08-25).
 */
export interface GuideProgress {
  autoOpenedAt?: string;
  dismissedAt?: string;
  pagesSeen: string[];
  pagesDone: string[];
  trailsCompleted: string[];
  lastPageId?: string;
  concludedAt?: string;
}

export const EMPTY_PROGRESS: GuideProgress = {
  pagesSeen: [],
  pagesDone: [],
  trailsCompleted: [],
};

export function guideStorageKey(contaId: string): string {
  return `guia_v1_${contaId}`;
}

export function loadGuideProgress(contaId: string): GuideProgress {
  try {
    const raw = localStorage.getItem(guideStorageKey(contaId));
    if (!raw) return { ...EMPTY_PROGRESS };
    const parsed = JSON.parse(raw) as Partial<GuideProgress>;
    return {
      ...EMPTY_PROGRESS,
      ...parsed,
      pagesSeen: Array.isArray(parsed.pagesSeen) ? parsed.pagesSeen : [],
      pagesDone: Array.isArray(parsed.pagesDone) ? parsed.pagesDone : [],
      trailsCompleted: Array.isArray(parsed.trailsCompleted) ? parsed.trailsCompleted : [],
    };
  } catch {
    return { ...EMPTY_PROGRESS };
  }
}

export function saveGuideProgress(contaId: string, p: GuideProgress): void {
  localStorage.setItem(guideStorageKey(contaId), JSON.stringify(p));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run apps/crm/src/components/guide/__tests__/guideStorage.test.ts`
Expected: PASS (6 testes)

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/components/guide
git commit -m "feat(guia): persistência do progresso por workspace

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: hasAnyHubToken + invalidação centralizada do hub

**Files:**
- Modify: `apps/crm/src/store/hub.ts` (após `getHubToken`, ~linha 92)
- Modify: `apps/crm/src/pages/cliente-detalhe/HubTab.tsx:223,238,252,399` (troca das invalidações)
- Test: `apps/crm/src/store/__tests__/hubTokenQueries.test.ts`

**Interfaces:**
- Consumes: `supabase` (client singleton já importado em `store/hub.ts`).
- Produces:
  - `hasAnyHubToken(): Promise<boolean>` — count head em `client_hub_tokens` (RLS escopa ao workspace); **lança** em erro (sinal inconclusivo).
  - `invalidateHubTokenQueries(qc: QueryClient, clienteId: number): void` — invalida `['hub-token', clienteId]` E `['hub-token-any']`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/crm/src/store/__tests__/hubTokenQueries.test.ts
import { describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { invalidateHubTokenQueries } from '../hub';

describe('invalidateHubTokenQueries', () => {
  it('invalida a chave por cliente E a chave agregada do guia', () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, 'invalidateQueries');
    invalidateHubTokenQueries(qc, 42);
    expect(spy).toHaveBeenCalledWith({ queryKey: ['hub-token', 42] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['hub-token-any'] });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/crm/src/store/__tests__/hubTokenQueries.test.ts`
Expected: FAIL (`invalidateHubTokenQueries` não exportado)

- [ ] **Step 3: Implement in `store/hub.ts`**

Adicionar após `getHubToken` (import de tipo no topo do arquivo):

```ts
import type { QueryClient } from '@tanstack/react-query';

/** Sinal do guia de primeiros passos: existe QUALQUER token de hub no workspace?
 *  Lança em erro para a query ficar inconclusiva (nunca tratar erro como zero). */
export async function hasAnyHubToken(): Promise<boolean> {
  const { count, error } = await supabase
    .from('client_hub_tokens')
    .select('id', { count: 'exact', head: true });
  if (error) throw error;
  return (count ?? 0) > 0;
}

/** Toda mutação de token do HubTab passa por aqui: sem a chave agregada, o
 *  sinal do guia ficaria stale na mesma aba (a ação acontece dentro da SPA). */
export function invalidateHubTokenQueries(qc: QueryClient, clienteId: number): void {
  qc.invalidateQueries({ queryKey: ['hub-token', clienteId] });
  qc.invalidateQueries({ queryKey: ['hub-token-any'] });
}
```

- [ ] **Step 4: Swap the four HubTab call sites**

Em `apps/crm/src/pages/cliente-detalhe/HubTab.tsx`, importar `invalidateHubTokenQueries` de `../../store/hub` e substituir **cada** ocorrência de
`qc.invalidateQueries({ queryKey: ['hub-token', clienteId] })` (linhas ~223, ~238, ~252, ~399) por
`invalidateHubTokenQueries(qc, clienteId)`.
Depois: `grep -n "queryKey: \['hub-token'" apps/crm/src/pages/cliente-detalhe/HubTab.tsx` deve retornar SÓ a declaração da query (linha ~164), nenhuma invalidação manual.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run apps/crm/src/store/__tests__/hubTokenQueries.test.ts`
Expected: PASS

- [ ] **Step 6: Typecheck do CRM**

Run: `npx tsc -p apps/crm/tsconfig.json --noEmit`
Expected: sem erros

- [ ] **Step 7: Commit**

```bash
git add apps/crm/src/store apps/crm/src/pages/cliente-detalhe/HubTab.tsx
git commit -m "feat(guia): sinal hub-token-any + invalidação centralizada no HubTab

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: guideBits + guideContent (conteúdo declarativo das 15 páginas)

**Files:**
- Create: `apps/crm/src/components/guide/guideBits.tsx`
- Create: `apps/crm/src/components/guide/guideContent.tsx`
- Test: `apps/crm/src/components/guide/__tests__/guideContent.test.ts`

**Interfaces:**
- Consumes: `guideBits` (componentes presentacionais), `lucide-react`.
- Produces (usado pelas Tasks 4–9):
  - `type SignalKey = 'hasCliente' | 'hasInstagram' | 'hasHubToken' | 'hasMembro' | 'hasWorkflow'`
  - `interface GuideCtx { latestClienteId: number | null }`
  - `interface GuideAction { label: string; caption: string; to(ctx: GuideCtx): string }`
  - `interface GuideRecapItem { signal: SignalKey; label: string }`
  - `interface GuidePage { id: string; title: string; lead: string; body?: ReactNode; recap?: GuideRecapItem[]; action?: GuideAction; signal?: SignalKey; entitlementFlag?: string; bridgeTo?: 't2' | 't3'; conclude?: boolean }`
  - `interface GuideTrail { id: 't1' | 't2' | 't3'; title: string; subtitle: string; icon: LucideIcon; pages: GuidePage[] }`
  - `GUIDE_TRAILS: GuideTrail[]`
  - `filterTrails(hasFeature: (flag: string) => boolean): GuideTrail[]`
  - `allPages(trails: GuideTrail[]): GuidePage[]`
  - `requiredSignals(trails: GuideTrail[]): SignalKey[]`

- [ ] **Step 1: Write the failing test**

```ts
// apps/crm/src/components/guide/__tests__/guideContent.test.ts
import { describe, expect, it } from 'vitest';
import { GUIDE_TRAILS, allPages, filterTrails, requiredSignals } from '../guideContent';

const ALL_ON = () => true;

describe('guideContent', () => {
  it('tem 3 trilhas com 5, 4 e 6 páginas (15 no total)', () => {
    expect(GUIDE_TRAILS.map((t) => t.pages.length)).toEqual([5, 4, 6]);
    expect(allPages(GUIDE_TRAILS)).toHaveLength(15);
  });

  it('todos os ids de página são únicos', () => {
    const ids = allPages(GUIDE_TRAILS).map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('sem feature_hub_portal a página do hub sai e o total vira 14', () => {
    const trails = filterTrails((flag) => flag !== 'feature_hub_portal');
    expect(allPages(trails)).toHaveLength(14);
    expect(allPages(trails).some((p) => p.id === 't1p4')).toBe(false);
  });

  it('sinais exigidos derivam da trilha filtrada (hub fora sem a flag)', () => {
    expect(requiredSignals(filterTrails(ALL_ON))).toEqual([
      'hasCliente',
      'hasInstagram',
      'hasHubToken',
      'hasMembro',
      'hasWorkflow',
    ]);
    expect(requiredSignals(filterTrails((f) => f !== 'feature_hub_portal'))).not.toContain(
      'hasHubToken',
    );
  });

  it('deep links por cliente caem em /clientes sem cliente', () => {
    const pages = allPages(GUIDE_TRAILS);
    const ig = pages.find((p) => p.id === 't1p3')!;
    expect(ig.action!.to({ latestClienteId: 7 })).toBe('/clientes/7/redes-sociais');
    expect(ig.action!.to({ latestClienteId: null })).toBe('/clientes');
    const hub = pages.find((p) => p.id === 't1p4')!;
    expect(hub.action!.to({ latestClienteId: 7 })).toBe('/clientes/7/hub');
  });

  it('cópia visível não usa em-dash', () => {
    for (const p of allPages(GUIDE_TRAILS)) {
      expect(p.title, p.id).not.toContain('—');
      expect(p.lead, p.id).not.toContain('—');
    }
  });

  it('pontes e conclusão estão nas últimas páginas', () => {
    expect(GUIDE_TRAILS[0].pages[4].bridgeTo).toBe('t2');
    expect(GUIDE_TRAILS[1].pages[3].bridgeTo).toBe('t3');
    expect(GUIDE_TRAILS[2].pages[5].conclude).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/crm/src/components/guide/__tests__/guideContent.test.ts`
Expected: FAIL (módulo não existe)

- [ ] **Step 3: Write `guideBits.tsx`**

```tsx
// apps/crm/src/components/guide/guideBits.tsx
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

/** Peças presentacionais dos corpos de página do guia. Sem estado, sem dados. */

export function GuideTip({ children }: { children: ReactNode }) {
  return (
    <p
      style={{
        marginTop: 16,
        background: 'rgba(255,191,48,0.14)',
        border: '1px solid rgba(255,191,48,0.55)',
        borderRadius: 10,
        padding: '12px 14px',
        fontSize: '0.8rem',
        lineHeight: 1.6,
      }}
    >
      {children}
    </p>
  );
}

export function GuideFine({ children }: { children: ReactNode }) {
  return (
    <p style={{ marginTop: 12, fontSize: '0.78rem', color: 'var(--text-muted)', lineHeight: 1.55 }}>
      {children}
    </p>
  );
}

export function GuideInfoBox({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        marginTop: 14,
        background: 'var(--surface-2, #f8fafc)',
        border: '1px solid var(--border-color)',
        borderRadius: 10,
        padding: '12px 14px',
        fontSize: '0.8rem',
        lineHeight: 1.7,
      }}
    >
      {children}
    </div>
  );
}

export function GuideOptionGrid({ columns, children }: { columns: 2 | 3; children: ReactNode }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(auto-fit, minmax(${columns === 3 ? 150 : 200}px, 1fr))`,
        gap: 10,
        marginTop: 14,
      }}
    >
      {children}
    </div>
  );
}

export function GuideOption({
  icon: Icon,
  title,
  children,
}: {
  icon: LucideIcon;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div style={{ border: '1px solid var(--border-color)', borderRadius: 10, padding: '12px 14px' }}>
      <p
        style={{
          margin: 0,
          fontSize: '0.82rem',
          fontWeight: 600,
          display: 'flex',
          gap: 8,
          alignItems: 'center',
        }}
      >
        <Icon className="h-4 w-4" />
        {title}
      </p>
      {children && (
        <p style={{ margin: '6px 0 0', fontSize: '0.76rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
          {children}
        </p>
      )}
    </div>
  );
}

export function GuideCheckList({ items }: { items: ReactNode[] }) {
  return (
    <ul style={{ listStyle: 'none', padding: 0, margin: '14px 0 0', display: 'grid', gap: 9 }}>
      {items.map((item, i) => (
        <li key={i} style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: '0.82rem' }}>
          <span
            aria-hidden="true"
            style={{
              width: 20,
              height: 20,
              borderRadius: '50%',
              background: 'rgba(62,207,142,0.18)',
              color: '#15803d',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              flex: 'none',
              fontSize: '0.7rem',
              fontWeight: 700,
            }}
          >
            ✓
          </span>
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

export function GuideStatusPill({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'success' | 'warning';
}) {
  const tones = {
    neutral: { bg: 'var(--surface-2, #f1f5f9)', fg: 'var(--text-muted)' },
    success: { bg: 'rgba(62,207,142,0.16)', fg: '#15803d' },
    warning: { bg: 'rgba(255,191,48,0.2)', fg: '#a16207' },
  } as const;
  const t = tones[tone];
  return (
    <span
      style={{
        fontSize: '0.7rem',
        padding: '2px 9px',
        borderRadius: 999,
        background: t.bg,
        color: t.fg,
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  );
}
```

- [ ] **Step 4: Write `guideContent.tsx`**

```tsx
// apps/crm/src/components/guide/guideContent.tsx
import type { ReactNode } from 'react';
import {
  Calendar,
  Columns,
  Crown,
  IdCard,
  Instagram,
  KeyRound,
  Link as LinkIcon,
  Pencil,
  Shield,
  UserPlus,
  Users,
  type LucideIcon,
} from 'lucide-react';
import {
  GuideCheckList,
  GuideFine,
  GuideInfoBox,
  GuideOption,
  GuideOptionGrid,
  GuideStatusPill,
  GuideTip,
} from './guideBits';

export type SignalKey = 'hasCliente' | 'hasInstagram' | 'hasHubToken' | 'hasMembro' | 'hasWorkflow';

export interface GuideCtx {
  latestClienteId: number | null;
}

export interface GuideAction {
  label: string;
  caption: string;
  to(ctx: GuideCtx): string;
}

export interface GuideRecapItem {
  signal: SignalKey;
  label: string;
}

export interface GuidePage {
  id: string;
  title: string;
  lead: string;
  body?: ReactNode;
  /** Linhas de recap com check dinâmico pelo sinal (página de fechamento). */
  recap?: GuideRecapItem[];
  action?: GuideAction;
  /** Presente: a página conclui quando o sinal fica true. Ausente: conclui ao ser vista. */
  signal?: SignalKey;
  entitlementFlag?: string;
  bridgeTo?: 't2' | 't3';
  conclude?: boolean;
}

export interface GuideTrail {
  id: 't1' | 't2' | 't3';
  title: string;
  subtitle: string;
  icon: LucideIcon;
  pages: GuidePage[];
}

const clienteDeepLink = (suffix: string) => (ctx: GuideCtx) =>
  ctx.latestClienteId != null ? `/clientes/${ctx.latestClienteId}/${suffix}` : '/clientes';

export const GUIDE_TRAILS: GuideTrail[] = [
  {
    id: 't1',
    title: 'Adicionar seu primeiro cliente',
    subtitle: 'Cadastro, Instagram e link do Hub',
    icon: UserPlus,
    pages: [
      {
        id: 't1p1',
        title: 'Tudo começa com um cliente',
        lead: 'Cada cliente reúne cadastro, briefing, entregas e um portal próprio. É em volta dele que o Mesaas gira.',
        body: (
          <GuideTip>
            Dica: cadastre o seu próprio Instagram como primeiro cliente. Você aprende o caminho
            inteiro antes de trazer um cliente de verdade.
          </GuideTip>
        ),
      },
      {
        id: 't1p2',
        title: 'Crie o cadastro',
        lead: 'Só o nome é obrigatório. E-mail, telefone e valores podem esperar.',
        action: {
          label: 'Fazer agora',
          caption: 'Abre seus clientes com o cadastro pronto para preencher. O guia continua de onde parou.',
          to: () => '/clientes?novo=1',
        },
        signal: 'hasCliente',
      },
      {
        id: 't1p3',
        title: 'Conecte o Instagram do cliente',
        lead: 'Com a conta conectada, você agenda, publica e acompanha métricas direto pelo Mesaas. Dois caminhos:',
        body: (
          <GuideOptionGrid columns={2}>
            <GuideOption icon={Instagram} title="Você conecta agora">
              Entre com a conta do cliente pelo login da Meta.
            </GuideOption>
            <GuideOption icon={LinkIcon} title="O cliente conecta sozinho">
              Envie um link seguro, válido por 30 dias. Ele conecta sem senha e sem login no Mesaas.
            </GuideOption>
          </GuideOptionGrid>
        ),
        action: {
          label: 'Fazer agora',
          caption: 'Abre a aba Redes sociais do cliente que você criou.',
          to: clienteDeepLink('redes-sociais'),
        },
        signal: 'hasInstagram',
      },
      {
        id: 't1p4',
        title: 'Gere o link do Hub',
        lead: 'O Hub é o portal do seu cliente: aprovações, postagens e briefing com a sua marca. Sem login e sem senha.',
        body: (
          <GuideFine>
            O link renova a validade a cada visita do cliente. Você pode desativar ou trocar quando
            quiser.
          </GuideFine>
        ),
        action: {
          label: 'Fazer agora',
          caption: 'Abre a aba Hub do cliente para gerar e copiar o link.',
          to: clienteDeepLink('hub'),
        },
        signal: 'hasHubToken',
        entitlementFlag: 'feature_hub_portal',
      },
      {
        id: 't1p5',
        title: 'Primeiro cliente pronto',
        lead: 'É esse caminho para cada cliente novo. Agora, quem trabalha com você?',
        recap: [
          { signal: 'hasCliente', label: 'Cadastro criado' },
          { signal: 'hasInstagram', label: 'Instagram conectado' },
          { signal: 'hasHubToken', label: 'Link do Hub gerado' },
        ],
        bridgeTo: 't2',
      },
    ],
  },
  {
    id: 't2',
    title: 'Montar sua equipe',
    subtitle: 'Membros, papéis de acesso e tarefas',
    icon: Users,
    pages: [
      {
        id: 't2p1',
        title: 'Membro é uma coisa, acesso é outra',
        lead: 'Essa separação deixa o controle simples:',
        body: (
          <>
            <GuideOptionGrid columns={2}>
              <GuideOption icon={IdCard} title="Membro">
                O registro de quem trabalha com você: cargo, tipo de contrato, custos.
              </GuideOption>
              <GuideOption icon={KeyRound} title="Acesso">
                Um convite por e-mail para a pessoa entrar no Mesaas. Opcional.
              </GuideOption>
            </GuideOptionGrid>
            <GuideFine>
              Dá para ter membro sem acesso: um freelancer que você só gerencia, por exemplo.
            </GuideFine>
          </>
        ),
      },
      {
        id: 't2p2',
        title: 'Três papéis de acesso',
        lead: 'O papel define o que a pessoa vê e faz.',
        body: (
          <>
            <GuideOptionGrid columns={3}>
              <GuideOption icon={Crown} title="Dono">
                Tudo, inclusive planos, cobrança e financeiro.
              </GuideOption>
              <GuideOption icon={Shield} title="Admin">
                Gerencia clientes, equipe e entregas.
              </GuideOption>
              <GuideOption icon={Pencil} title="Agente">
                Trabalha nas entregas e tarefas. Sem financeiro.
              </GuideOption>
            </GuideOptionGrid>
            <GuideFine>Você é o dono do workspace. Convites saem como admin ou agente.</GuideFine>
          </>
        ),
      },
      {
        id: 't2p3',
        title: 'Adicione alguém da equipe',
        lead: 'O convite mora no cadastro do membro: crie, ative o convite e escolha o papel.',
        action: {
          label: 'Fazer agora',
          caption: 'Abre a Equipe com o cadastro de membro aberto.',
          to: () => '/equipe?novo=1',
        },
        signal: 'hasMembro',
      },
      {
        id: 't2p4',
        title: 'O dia a dia vive nas Tarefas',
        lead: 'Distribua o trabalho: cada tarefa tem responsável e prazo, e cada post tem os seus responsáveis.',
        bridgeTo: 't3',
      },
    ],
  },
  {
    id: 't3',
    title: 'Criar suas entregas',
    subtitle: 'Fluxos, posts, status e agendamento',
    icon: Columns,
    pages: [
      {
        id: 't3p1',
        title: 'Três palavras resolvem as Entregas',
        lead: 'Fluxo, etapas e posts. O resto deriva delas.',
        body: (
          <>
            <GuideInfoBox>
              <b>Fluxo</b> · o ciclo de trabalho de um cliente, o card do kanban. Ex.: Posts de
              setembro
              <br />
              <b>Etapas</b> · as fases do fluxo; só uma fica ativa por vez
              <br />
              <b>Posts</b> · o conteúdo em si; cada um com o próprio status
            </GuideInfoBox>
            <GuideFine>Modelo: a receita reutilizável que cria fluxos iguais todo mês.</GuideFine>
          </>
        ),
      },
      {
        id: 't3p2',
        title: 'Crie o primeiro fluxo',
        lead: 'O assistente monta tudo: escolha um modelo pronto, diga o cliente e pronto.',
        body: (
          <GuideOptionGrid columns={3}>
            <GuideOption icon={Calendar} title="Posts mensais">
              Ciclo recorrente por mês.
            </GuideOption>
            <GuideOption icon={Columns} title="Outros modelos">
              Reels, campanhas, branding.
            </GuideOption>
            <GuideOption icon={Pencil} title="Do zero">
              Monte as suas etapas.
            </GuideOption>
          </GuideOptionGrid>
        ),
        action: {
          label: 'Fazer agora',
          caption: 'Abre o assistente de novo fluxo nas Entregas.',
          to: () => '/entregas?novo-fluxo=1',
        },
        signal: 'hasWorkflow',
      },
      {
        id: 't3p3',
        title: 'O post reúne tudo',
        lead: 'Dentro do fluxo, cada post junta a mídia, quem faz e a legenda.',
        body: (
          <GuideInfoBox>
            Anexe imagens e vídeos, defina responsáveis e escreva a legenda no próprio post. Tudo em
            um lugar só, pronto para aprovação.
          </GuideInfoBox>
        ),
      },
      {
        id: 't3p4',
        title: 'Status contam a história',
        lead: 'O post anda por status até o publicado. E você pode criar os seus.',
        body: (
          <>
            <div
              style={{
                display: 'flex',
                gap: 6,
                marginTop: 14,
                flexWrap: 'wrap',
                alignItems: 'center',
              }}
            >
              <GuideStatusPill>Rascunho</GuideStatusPill>
              <GuideStatusPill>Revisão interna</GuideStatusPill>
              <GuideStatusPill>Enviado ao cliente</GuideStatusPill>
              <GuideStatusPill tone="success">Aprovado pelo cliente</GuideStatusPill>
              <GuideStatusPill tone="warning">Agendado</GuideStatusPill>
              <GuideStatusPill tone="success">Postado</GuideStatusPill>
            </div>
            <GuideFine>
              Crie status personalizados, com automações: por exemplo, avisar a equipe quando um
              post for aprovado.
            </GuideFine>
          </>
        ),
      },
      {
        id: 't3p5',
        title: 'O que um post precisa para ser agendado',
        lead: 'O Mesaas confere tudo isso antes de enviar ao Instagram. Se faltar algo, o botão Agendar mostra o que é.',
        body: (
          <>
            <GuideCheckList
              items={[
                <>
                  Status <GuideStatusPill tone="success">Aprovado pelo cliente</GuideStatusPill>
                </>,
                'Data e hora pelo menos 10 minutos no futuro',
                'Legenda do Instagram escrita (stories dispensam)',
                'Pelo menos uma mídia dentro dos limites',
                'Conta do Instagram do cliente conectada',
              ]}
            />
            <GuideInfoBox>
              <b>Limites de mídia</b> · imagens JPEG, PNG ou WebP até 8 MB · vídeos MP4 ou MOV de 3
              a 90 s, até 250 MB · carrossel com até 10 itens
            </GuideInfoBox>
          </>
        ),
      },
      {
        id: 't3p6',
        title: 'Pronto para rodar',
        lead: 'Cliente, equipe e entregas: o essencial está de pé. Depois, explore o Calendário, o Analytics e os Relatórios.',
        conclude: true,
      },
    ],
  },
];

export function filterTrails(hasFeature: (flag: string) => boolean): GuideTrail[] {
  return GUIDE_TRAILS.map((t) => ({
    ...t,
    pages: t.pages.filter((p) => !p.entitlementFlag || hasFeature(p.entitlementFlag)),
  })).filter((t) => t.pages.length > 0);
}

export function allPages(trails: GuideTrail[]): GuidePage[] {
  return trails.flatMap((t) => t.pages);
}

/** Sinais que a regra de auto-conclusão exige: só os das páginas presentes. */
export function requiredSignals(trails: GuideTrail[]): SignalKey[] {
  const keys: SignalKey[] = [];
  for (const p of allPages(trails)) {
    if (p.signal && !keys.includes(p.signal)) keys.push(p.signal);
  }
  return keys;
}
```

Nota: se `IdCard` não existir na versão do `lucide-react` do repo (o typecheck acusa), troque por `ContactRound` (mesmo papel visual); nenhum outro ícone do arquivo é de adição recente.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run apps/crm/src/components/guide/__tests__/guideContent.test.ts`
Expected: PASS (7 testes)

- [ ] **Step 6: Commit**

```bash
git add apps/crm/src/components/guide
git commit -m "feat(guia): conteúdo declarativo das 3 trilhas e 15 páginas

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: useGuideSignals (queries dos sinais)

**Files:**
- Create: `apps/crm/src/components/guide/useGuideSignals.ts`
- Test: `apps/crm/src/components/guide/__tests__/useGuideSignals.test.tsx`

**Interfaces:**
- Consumes: `getClientes`, `getMembros`, `getWorkflows` (barrel `../../store`), `getPortfolioSummary` (`../../services/analytics`), `hasAnyHubToken` (`../../store/hub`), `SignalKey` (Task 3).
- Produces:
  - `interface GuideSignals { values: Partial<Record<SignalKey, boolean>>; latestClienteId: number | null; clientes: { status: 'pending' | 'error' | 'success'; count: number }; workflows: { status: 'pending' | 'error' | 'success'; count: number } }`
  - `useGuideSignals(enabled: boolean): GuideSignals`
  - Semântica: chave ausente em `values` = inconclusivo (query pending/error). `clientes`/`workflows` expostos com status para o gating da Task 6.

- [ ] **Step 1: Write the failing test**

```tsx
// apps/crm/src/components/guide/__tests__/useGuideSignals.test.tsx
import React from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getClientesMock, getMembrosMock, getWorkflowsMock, getPortfolioSummaryMock, hasAnyHubTokenMock } =
  vi.hoisted(() => ({
    getClientesMock: vi.fn(),
    getMembrosMock: vi.fn(),
    getWorkflowsMock: vi.fn(),
    getPortfolioSummaryMock: vi.fn(),
    hasAnyHubTokenMock: vi.fn(),
  }));

vi.mock('../../../store', () => ({
  getClientes: getClientesMock,
  getMembros: getMembrosMock,
  getWorkflows: getWorkflowsMock,
}));
vi.mock('../../../services/analytics', () => ({ getPortfolioSummary: getPortfolioSummaryMock }));
vi.mock('../../../store/hub', () => ({ hasAnyHubToken: hasAnyHubTokenMock }));

import { useGuideSignals } from '../useGuideSignals';

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('useGuideSignals', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getClientesMock.mockResolvedValue([{ id: 3 }, { id: 9 }]);
    getMembrosMock.mockResolvedValue([]);
    getWorkflowsMock.mockResolvedValue([{ id: 1 }]);
    getPortfolioSummaryMock.mockResolvedValue({ accounts: [] });
    hasAnyHubTokenMock.mockResolvedValue(true);
  });

  it('deriva sinais de queries bem-sucedidas', async () => {
    const { result } = renderHook(() => useGuideSignals(true), { wrapper });
    await waitFor(() => expect(result.current.values.hasCliente).toBe(true));
    expect(result.current.values.hasMembro).toBe(false);
    expect(result.current.values.hasWorkflow).toBe(true);
    expect(result.current.values.hasInstagram).toBe(false);
    expect(result.current.values.hasHubToken).toBe(true);
    expect(result.current.clientes).toEqual({ status: 'success', count: 2 });
  });

  it('pega o cliente mais recente pelo maior id', async () => {
    const { result } = renderHook(() => useGuideSignals(true), { wrapper });
    await waitFor(() => expect(result.current.latestClienteId).toBe(9));
  });

  it('query em erro fica INCONCLUSIVA: chave ausente, nunca false', async () => {
    hasAnyHubTokenMock.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useGuideSignals(true), { wrapper });
    await waitFor(() => expect(result.current.values.hasCliente).toBe(true));
    expect('hasHubToken' in result.current.values).toBe(false);
  });

  it('erro em clientes vira status error, nunca count 0 confiável', async () => {
    getClientesMock.mockRejectedValue(new Error('down'));
    const { result } = renderHook(() => useGuideSignals(true), { wrapper });
    await waitFor(() => expect(result.current.clientes.status).toBe('error'));
    expect('hasCliente' in result.current.values).toBe(false);
  });

  it('enabled=false não dispara nenhuma query', () => {
    renderHook(() => useGuideSignals(false), { wrapper });
    expect(getClientesMock).not.toHaveBeenCalled();
    expect(hasAnyHubTokenMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/crm/src/components/guide/__tests__/useGuideSignals.test.tsx`
Expected: FAIL (módulo não existe)

- [ ] **Step 3: Write implementation**

```ts
// apps/crm/src/components/guide/useGuideSignals.ts
import { useQueries } from '@tanstack/react-query';
import { getClientes, getMembros, getWorkflows } from '../../store';
import { getPortfolioSummary } from '../../services/analytics';
import { hasAnyHubToken } from '../../store/hub';
import type { SignalKey } from './guideContent';

export interface GuideSignals {
  /** Chave ausente = inconclusivo (query pending ou em erro). NUNCA `data ?? []`. */
  values: Partial<Record<SignalKey, boolean>>;
  latestClienteId: number | null;
  clientes: { status: 'pending' | 'error' | 'success'; count: number };
  workflows: { status: 'pending' | 'error' | 'success'; count: number };
}

/**
 * Sinais de conclusão do guia. Reusa as query keys do app (['clientes'],
 * ['membros'], ['workflows'], ['portfolioSummary']) para herdar as invalidações
 * existentes; a única chave própria é ['hub-token-any'] (ver store/hub.ts).
 * refetchOnWindowFocus fica no default (true) para a volta de deep links.
 */
export function useGuideSignals(enabled: boolean): GuideSignals {
  const [clientesQ, membrosQ, workflowsQ, portfolioQ, hubQ] = useQueries({
    queries: [
      { queryKey: ['clientes'], queryFn: getClientes, enabled },
      { queryKey: ['membros'], queryFn: getMembros, enabled },
      { queryKey: ['workflows'], queryFn: getWorkflows, enabled },
      { queryKey: ['portfolioSummary'], queryFn: () => getPortfolioSummary(), enabled },
      { queryKey: ['hub-token-any'], queryFn: hasAnyHubToken, enabled },
    ],
  });

  const values: Partial<Record<SignalKey, boolean>> = {};
  if (clientesQ.status === 'success') values.hasCliente = clientesQ.data.length > 0;
  if (membrosQ.status === 'success') values.hasMembro = membrosQ.data.length > 0;
  if (workflowsQ.status === 'success') values.hasWorkflow = workflowsQ.data.length > 0;
  if (portfolioQ.status === 'success') values.hasInstagram = portfolioQ.data.accounts.length > 0;
  if (hubQ.status === 'success') values.hasHubToken = hubQ.data;

  const latestClienteId =
    clientesQ.status === 'success' && clientesQ.data.length > 0
      ? clientesQ.data.reduce((max, c) => (c.id > max ? c.id : max), clientesQ.data[0].id)
      : null;

  return {
    values,
    latestClienteId,
    clientes: { status: clientesQ.status, count: clientesQ.data?.length ?? 0 },
    workflows: { status: workflowsQ.status, count: workflowsQ.data?.length ?? 0 },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run apps/crm/src/components/guide/__tests__/useGuideSignals.test.tsx`
Expected: PASS (5 testes)

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/components/guide
git commit -m "feat(guia): sinais de conclusão com erro inconclusivo

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: useGuideProgress (view-model)

**Files:**
- Create: `apps/crm/src/components/guide/useGuideProgress.ts`
- Test: `apps/crm/src/components/guide/__tests__/useGuideProgress.test.tsx`

**Interfaces:**
- Consumes: Task 1 (`loadGuideProgress`/`saveGuideProgress`/`GuideProgress`), Task 3 (`filterTrails`, `allPages`, `requiredSignals`, tipos), Task 4 (`GuideSignals`).
- Produces:
  - `interface GuideView { trails: GuideTrail[]; doneIds: Set<string>; totals: { done: number; total: number }; isConcluded: boolean; signalsSatisfied: boolean; progress: GuideProgress; markSeen(pageId: string): void; setLastPage(pageId: string): void; dismiss(): void; conclude(): void; recordAutoOpen(): void; recordTrailCompleted(trailId: string): void }`
  - `useGuideProgress(contaId: string | null, signals: GuideSignals, hasFeature: (f: string) => boolean): GuideView`
  - Regras: `doneIds` = pagesDone salvos ∪ (páginas sem `signal` vistas) ∪ (páginas com `signal` cujo sinal é `true`); `signalsSatisfied` = todo sinal de `requiredSignals(trilha filtrada)` é `true`; `isConcluded` = `concludedAt` OU `done === total` OU `signalsSatisfied`.

- [ ] **Step 1: Write the failing test**

```tsx
// apps/crm/src/components/guide/__tests__/useGuideProgress.test.tsx
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useGuideProgress } from '../useGuideProgress';
import { loadGuideProgress, saveGuideProgress, EMPTY_PROGRESS } from '../guideStorage';
import type { GuideSignals } from '../useGuideSignals';

const ALL_ON = () => true;
const NO_SIGNALS: GuideSignals = {
  values: {},
  latestClienteId: null,
  clientes: { status: 'pending', count: 0 },
  workflows: { status: 'pending', count: 0 },
};

describe('useGuideProgress', () => {
  beforeEach(() => localStorage.clear());

  it('começa com 0 de 15 e nada concluído', () => {
    const { result } = renderHook(() => useGuideProgress('ws-1', NO_SIGNALS, ALL_ON));
    expect(result.current.totals).toEqual({ done: 0, total: 15 });
    expect(result.current.isConcluded).toBe(false);
  });

  it('markSeen conclui página SEM sinal, mas não página COM sinal', () => {
    const { result } = renderHook(() => useGuideProgress('ws-1', NO_SIGNALS, ALL_ON));
    act(() => result.current.markSeen('t1p1'));
    act(() => result.current.markSeen('t1p2'));
    expect(result.current.doneIds.has('t1p1')).toBe(true);
    expect(result.current.doneIds.has('t1p2')).toBe(false);
    expect(result.current.totals.done).toBe(1);
  });

  it('sinal true conclui a página mesmo sem ser vista', () => {
    const signals = { ...NO_SIGNALS, values: { hasCliente: true } };
    const { result } = renderHook(() => useGuideProgress('ws-1', signals, ALL_ON));
    expect(result.current.doneIds.has('t1p2')).toBe(true);
  });

  it('persiste vistas e dismissal no localStorage', () => {
    const { result } = renderHook(() => useGuideProgress('ws-1', NO_SIGNALS, ALL_ON));
    act(() => result.current.markSeen('t1p1'));
    act(() => result.current.dismiss());
    const stored = loadGuideProgress('ws-1');
    expect(stored.pagesSeen).toContain('t1p1');
    expect(stored.dismissedAt).toBeTruthy();
  });

  it('signalsSatisfied exige só os sinais da trilha filtrada', () => {
    const semHub = (f: string) => f !== 'feature_hub_portal';
    const signals = {
      ...NO_SIGNALS,
      values: { hasCliente: true, hasInstagram: true, hasMembro: true, hasWorkflow: true },
    };
    const comHub = renderHook(() => useGuideProgress('ws-1', signals, ALL_ON));
    expect(comHub.result.current.signalsSatisfied).toBe(false);
    const filtrado = renderHook(() => useGuideProgress('ws-1', signals, semHub));
    expect(filtrado.result.current.signalsSatisfied).toBe(true);
    expect(filtrado.result.current.isConcluded).toBe(true);
    expect(filtrado.result.current.totals.total).toBe(14);
  });

  it('conclude persiste concludedAt e isConcluded fica true', () => {
    const { result } = renderHook(() => useGuideProgress('ws-1', NO_SIGNALS, ALL_ON));
    act(() => result.current.conclude());
    expect(result.current.isConcluded).toBe(true);
    expect(loadGuideProgress('ws-1').concludedAt).toBeTruthy();
  });

  it('recordTrailCompleted grava uma vez só', () => {
    const { result } = renderHook(() => useGuideProgress('ws-1', NO_SIGNALS, ALL_ON));
    act(() => result.current.recordTrailCompleted('t1'));
    act(() => result.current.recordTrailCompleted('t1'));
    expect(loadGuideProgress('ws-1').trailsCompleted).toEqual(['t1']);
  });

  it('contaId null é inerte (não lê nem grava)', () => {
    saveGuideProgress('unknown', { ...EMPTY_PROGRESS, pagesSeen: ['t1p1'] });
    const { result } = renderHook(() => useGuideProgress(null, NO_SIGNALS, ALL_ON));
    expect(result.current.totals.done).toBe(0);
    act(() => result.current.markSeen('t1p1'));
    expect(loadGuideProgress('unknown').pagesSeen).toEqual(['t1p1']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/crm/src/components/guide/__tests__/useGuideProgress.test.tsx`
Expected: FAIL

- [ ] **Step 3: Write implementation**

```ts
// apps/crm/src/components/guide/useGuideProgress.ts
import { useCallback, useMemo, useState } from 'react';
import {
  EMPTY_PROGRESS,
  loadGuideProgress,
  saveGuideProgress,
  type GuideProgress,
} from './guideStorage';
import { allPages, filterTrails, requiredSignals, type GuideTrail } from './guideContent';
import type { GuideSignals } from './useGuideSignals';

export interface GuideView {
  trails: GuideTrail[];
  doneIds: Set<string>;
  totals: { done: number; total: number };
  isConcluded: boolean;
  signalsSatisfied: boolean;
  progress: GuideProgress;
  markSeen(pageId: string): void;
  setLastPage(pageId: string): void;
  dismiss(): void;
  conclude(): void;
  recordAutoOpen(): void;
  recordTrailCompleted(trailId: string): void;
}

export function useGuideProgress(
  contaId: string | null,
  signals: GuideSignals,
  hasFeature: (flag: string) => boolean,
): GuideView {
  const [progress, setProgress] = useState<GuideProgress>(() =>
    contaId ? loadGuideProgress(contaId) : { ...EMPTY_PROGRESS },
  );

  const patch = useCallback(
    (updater: (prev: GuideProgress) => GuideProgress) => {
      setProgress((prev) => {
        const next = updater(prev);
        if (contaId) saveGuideProgress(contaId, next);
        return next;
      });
    },
    [contaId],
  );

  const trails = useMemo(() => filterTrails(hasFeature), [hasFeature]);
  const pages = useMemo(() => allPages(trails), [trails]);

  const doneIds = useMemo(() => {
    const done = new Set(progress.pagesDone);
    const seen = new Set(progress.pagesSeen);
    for (const p of pages) {
      if (!p.signal && seen.has(p.id)) done.add(p.id);
      if (p.signal && signals.values[p.signal] === true) done.add(p.id);
    }
    return done;
  }, [pages, progress.pagesDone, progress.pagesSeen, signals.values]);

  const totals = useMemo(
    () => ({ done: pages.filter((p) => doneIds.has(p.id)).length, total: pages.length }),
    [pages, doneIds],
  );

  const signalsSatisfied = useMemo(() => {
    const required = requiredSignals(trails);
    return required.length > 0 && required.every((s) => signals.values[s] === true);
  }, [trails, signals.values]);

  const isConcluded =
    Boolean(progress.concludedAt) || totals.done === totals.total || signalsSatisfied;

  const markSeen = useCallback(
    (pageId: string) =>
      patch((prev) =>
        prev.pagesSeen.includes(pageId)
          ? prev
          : { ...prev, pagesSeen: [...prev.pagesSeen, pageId] },
      ),
    [patch],
  );

  const setLastPage = useCallback(
    (pageId: string) => patch((prev) => ({ ...prev, lastPageId: pageId })),
    [patch],
  );

  const dismiss = useCallback(
    () => patch((prev) => ({ ...prev, dismissedAt: new Date().toISOString() })),
    [patch],
  );

  const conclude = useCallback(
    () =>
      patch((prev) => (prev.concludedAt ? prev : { ...prev, concludedAt: new Date().toISOString() })),
    [patch],
  );

  const recordAutoOpen = useCallback(
    () => patch((prev) => ({ ...prev, autoOpenedAt: new Date().toISOString() })),
    [patch],
  );

  const recordTrailCompleted = useCallback(
    (trailId: string) =>
      patch((prev) =>
        prev.trailsCompleted.includes(trailId)
          ? prev
          : { ...prev, trailsCompleted: [...prev.trailsCompleted, trailId] },
      ),
    [patch],
  );

  return {
    trails,
    doneIds,
    totals,
    isConcluded,
    signalsSatisfied,
    progress,
    markSeen,
    setLastPage,
    dismiss,
    conclude,
    recordAutoOpen,
    recordTrailCompleted,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run apps/crm/src/components/guide/__tests__/useGuideProgress.test.tsx`
Expected: PASS (8 testes)

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/components/guide
git commit -m "feat(guia): view-model de progresso com auto-conclusão por sinais

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: gating puro de auto-abertura + eventos no union de analytics

**Files:**
- Create: `apps/crm/src/components/guide/guideGating.ts`
- Modify: `apps/crm/src/lib/analytics.ts` (union `AnalyticsEvent`, ~linha 9)
- Test: `apps/crm/src/components/guide/__tests__/guideGating.test.ts`

**Interfaces:**
- Consumes: `GuideProgress` (Task 1).
- Produces:
  - `shouldAutoOpenGuide(i: { authLoading: boolean; isOwner: boolean; pathname: string; progress: GuideProgress; clientes: { status: string; count: number }; workflows: { status: string; count: number } }): boolean`
  - Eventos novos no union: `'guide_opened' | 'guide_closed' | 'guide_page_viewed' | 'guide_action_clicked' | 'guide_trail_completed' | 'guide_completed'`

- [ ] **Step 1: Write the failing test**

```ts
// apps/crm/src/components/guide/__tests__/guideGating.test.ts
import { describe, expect, it } from 'vitest';
import { shouldAutoOpenGuide } from '../guideGating';
import { EMPTY_PROGRESS } from '../guideStorage';

const OK = {
  authLoading: false,
  isOwner: true,
  pathname: '/dashboard',
  progress: { ...EMPTY_PROGRESS },
  clientes: { status: 'success', count: 0 },
  workflows: { status: 'success', count: 0 },
};

describe('shouldAutoOpenGuide', () => {
  it('abre para dono, no dashboard, workspace vazio, queries success', () => {
    expect(shouldAutoOpenGuide(OK)).toBe(true);
  });

  it('nunca abre para não-dono ou durante o loading do auth', () => {
    expect(shouldAutoOpenGuide({ ...OK, isOwner: false })).toBe(false);
    expect(shouldAutoOpenGuide({ ...OK, authLoading: true })).toBe(false);
  });

  it('só abre em /dashboard', () => {
    expect(shouldAutoOpenGuide({ ...OK, pathname: '/clientes' })).toBe(false);
  });

  it('abre no máximo uma vez: autoOpenedAt, dismissedAt ou concludedAt bloqueiam', () => {
    expect(
      shouldAutoOpenGuide({ ...OK, progress: { ...OK.progress, autoOpenedAt: 'x' } }),
    ).toBe(false);
    expect(
      shouldAutoOpenGuide({ ...OK, progress: { ...OK.progress, dismissedAt: 'x' } }),
    ).toBe(false);
    expect(
      shouldAutoOpenGuide({ ...OK, progress: { ...OK.progress, concludedAt: 'x' } }),
    ).toBe(false);
  });

  it('erro ou pending NUNCA conta como vazio', () => {
    expect(
      shouldAutoOpenGuide({ ...OK, clientes: { status: 'error', count: 0 } }),
    ).toBe(false);
    expect(
      shouldAutoOpenGuide({ ...OK, workflows: { status: 'pending', count: 0 } }),
    ).toBe(false);
  });

  it('workspace com dados não abre', () => {
    expect(shouldAutoOpenGuide({ ...OK, clientes: { status: 'success', count: 3 } })).toBe(false);
    expect(shouldAutoOpenGuide({ ...OK, workflows: { status: 'success', count: 1 } })).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/crm/src/components/guide/__tests__/guideGating.test.ts`
Expected: FAIL

- [ ] **Step 3: Write `guideGating.ts` and extend the analytics union**

```ts
// apps/crm/src/components/guide/guideGating.ts
import type { GuideProgress } from './guideStorage';

/**
 * Auto-abertura do guia (spec 2026-08-25): dono do workspace, primeira visita
 * ao dashboard, workspace sem clientes E sem fluxos, com AMBAS as queries em
 * sucesso explícito. Erro nunca conta como vazio: abrir o wizard para um
 * workspace ativo durante uma falha transitória seria pior que não abrir.
 */
export function shouldAutoOpenGuide(i: {
  authLoading: boolean;
  isOwner: boolean;
  pathname: string;
  progress: GuideProgress;
  clientes: { status: string; count: number };
  workflows: { status: string; count: number };
}): boolean {
  if (i.authLoading || !i.isOwner) return false;
  if (i.pathname !== '/dashboard') return false;
  if (i.progress.autoOpenedAt || i.progress.dismissedAt || i.progress.concludedAt) return false;
  if (i.clientes.status !== 'success' || i.workflows.status !== 'success') return false;
  return i.clientes.count === 0 && i.workflows.count === 0;
}
```

Em `apps/crm/src/lib/analytics.ts`, adicionar ao union `AnalyticsEvent` (junto dos eventos de tour, ~linha 21):

```ts
  | 'guide_opened'
  | 'guide_closed'
  | 'guide_page_viewed'
  | 'guide_action_clicked'
  | 'guide_trail_completed'
  | 'guide_completed'
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run apps/crm/src/components/guide/__tests__/guideGating.test.ts`
Expected: PASS (6 testes)

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/components/guide apps/crm/src/lib/analytics.ts
git commit -m "feat(guia): gating de auto-abertura e eventos de analytics

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: GuideProvider (contexto + efeitos + analytics)

**Files:**
- Create: `apps/crm/src/components/guide/GuideContext.tsx`
- Test: `apps/crm/src/components/guide/__tests__/GuideContext.test.tsx`

**Interfaces:**
- Consumes: Tasks 1, 3–6; `useAuth` (`context/AuthContext`), `useIsWorkspaceOwner` (`hooks/useIsWorkspaceOwner`), `useEntitlements` (`hooks/useEntitlements`), `useLocation` (react-router), `captureEvent` (`lib/analytics`).
- Produces (consumido por GuideDialog/GuidePill/GuideNavItem e AppLayout):
  - `type GuideOpenSource = 'auto' | 'pill' | 'sidebar' | 'mobile_nav'`
  - `interface GuideApi extends GuideView { isOpen: boolean; currentPageId: string | null; latestClienteId: number | null; signalValues: GuideSignals['values']; showEntryPoint: boolean; open(source: GuideOpenSource): void; close(): void; goTo(pageId: string | null): void; concludeGuide(): void }`
  - `GuideContext` (exportado para testes), `GuideProvider`, `useGuide(): GuideApi | null`

- [ ] **Step 1: Write the failing test**

```tsx
// apps/crm/src/components/guide/__tests__/GuideContext.test.tsx
import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadGuideProgress } from '../guideStorage';
import type { GuideSignals } from '../useGuideSignals';

const { useAuthMock, useIsWorkspaceOwnerMock, useEntitlementsMock, useGuideSignalsMock, captureEventMock } =
  vi.hoisted(() => ({
    useAuthMock: vi.fn(),
    useIsWorkspaceOwnerMock: vi.fn(),
    useEntitlementsMock: vi.fn(),
    useGuideSignalsMock: vi.fn(),
    captureEventMock: vi.fn(),
  }));

vi.mock('../../../context/AuthContext', () => ({ useAuth: useAuthMock }));
vi.mock('../../../hooks/useIsWorkspaceOwner', () => ({ useIsWorkspaceOwner: useIsWorkspaceOwnerMock }));
vi.mock('../../../hooks/useEntitlements', () => ({ useEntitlements: useEntitlementsMock }));
vi.mock('../useGuideSignals', () => ({ useGuideSignals: useGuideSignalsMock }));
vi.mock('../../../lib/analytics', () => ({ captureEvent: captureEventMock }));

import { GuideProvider, useGuide } from '../GuideContext';

const EMPTY_SIGNALS: GuideSignals = {
  values: {},
  latestClienteId: null,
  clientes: { status: 'success', count: 0 },
  workflows: { status: 'success', count: 0 },
};

function Probe() {
  const g = useGuide();
  if (!g) return null;
  return (
    <div>
      <span data-testid="open">{String(g.isOpen)}</span>
      <span data-testid="entry">{String(g.showEntryPoint)}</span>
      <button onClick={() => g.open('pill')}>abrir</button>
      <button onClick={() => g.close()}>fechar</button>
    </div>
  );
}

function renderProvider(path = '/dashboard') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <GuideProvider>
        <Probe />
      </GuideProvider>
    </MemoryRouter>,
  );
}

describe('GuideProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    useAuthMock.mockReturnValue({ loading: false, profile: { conta_id: 'ws-1' } });
    useIsWorkspaceOwnerMock.mockReturnValue(true);
    useEntitlementsMock.mockReturnValue({ hasFeature: () => true });
    useGuideSignalsMock.mockReturnValue(EMPTY_SIGNALS);
  });

  it('auto-abre no dashboard vazio e grava autoOpenedAt uma vez', async () => {
    renderProvider();
    await waitFor(() => expect(screen.getByTestId('open').textContent).toBe('true'));
    expect(loadGuideProgress('ws-1').autoOpenedAt).toBeTruthy();
    expect(captureEventMock).toHaveBeenCalledWith('guide_opened', { source: 'auto' });
  });

  it('não auto-abre fora do dashboard nem para não-dono', () => {
    renderProvider('/clientes');
    expect(screen.getByTestId('open').textContent).toBe('false');
    useIsWorkspaceOwnerMock.mockReturnValue(false);
    renderProvider();
    expect(screen.getAllByTestId('open').at(-1)!.textContent).toBe('false');
  });

  it('fechar grava dismissedAt e captura guide_closed', async () => {
    renderProvider();
    await waitFor(() => expect(screen.getByTestId('open').textContent).toBe('true'));
    act(() => screen.getByText('fechar').click());
    expect(screen.getByTestId('open').textContent).toBe('false');
    expect(loadGuideProgress('ws-1').dismissedAt).toBeTruthy();
    expect(captureEventMock).toHaveBeenCalledWith('guide_closed', { page: null });
  });

  it('showEntryPoint é false para não-dono e após conclusão por sinais', () => {
    useGuideSignalsMock.mockReturnValue({
      ...EMPTY_SIGNALS,
      clientes: { status: 'success', count: 1 },
      values: {
        hasCliente: true,
        hasInstagram: true,
        hasHubToken: true,
        hasMembro: true,
        hasWorkflow: true,
      },
    });
    renderProvider();
    expect(screen.getByTestId('entry').textContent).toBe('false');
  });

  it('conclusão por sinais persiste concludedAt e captura guide_completed via signals', async () => {
    useGuideSignalsMock.mockReturnValue({
      ...EMPTY_SIGNALS,
      clientes: { status: 'success', count: 1 },
      values: {
        hasCliente: true,
        hasInstagram: true,
        hasHubToken: true,
        hasMembro: true,
        hasWorkflow: true,
      },
    });
    renderProvider();
    await waitFor(() => expect(loadGuideProgress('ws-1').concludedAt).toBeTruthy());
    expect(captureEventMock).toHaveBeenCalledWith('guide_completed', { via: 'signals' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/crm/src/components/guide/__tests__/GuideContext.test.tsx`
Expected: FAIL

- [ ] **Step 3: Write implementation**

```tsx
// apps/crm/src/components/guide/GuideContext.tsx
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useIsWorkspaceOwner } from '../../hooks/useIsWorkspaceOwner';
import { useEntitlements } from '../../hooks/useEntitlements';
import { captureEvent } from '../../lib/analytics';
import { useGuideSignals, type GuideSignals } from './useGuideSignals';
import { useGuideProgress, type GuideView } from './useGuideProgress';
import { shouldAutoOpenGuide } from './guideGating';

export type GuideOpenSource = 'auto' | 'pill' | 'sidebar' | 'mobile_nav';

export interface GuideApi extends GuideView {
  isOpen: boolean;
  /** null = tela inicial (trilhas). */
  currentPageId: string | null;
  latestClienteId: number | null;
  signalValues: GuideSignals['values'];
  showEntryPoint: boolean;
  open(source: GuideOpenSource): void;
  close(): void;
  goTo(pageId: string | null): void;
  concludeGuide(): void;
}

export const GuideContext = createContext<GuideApi | null>(null);

export function useGuide(): GuideApi | null {
  return useContext(GuideContext);
}

export function GuideProvider({ children }: { children: ReactNode }) {
  const { loading, profile } = useAuth();
  const isOwner = useIsWorkspaceOwner();
  const { hasFeature } = useEntitlements();
  const location = useLocation();

  const contaId = profile?.conta_id ?? null;
  const signals = useGuideSignals(isOwner);
  const view = useGuideProgress(contaId, signals, hasFeature);

  const [isOpen, setIsOpen] = useState(false);
  const [currentPageId, setCurrentPageId] = useState<string | null>(null);

  const open = useCallback(
    (source: GuideOpenSource) => {
      setCurrentPageId(source === 'auto' ? null : (view.progress.lastPageId ?? null));
      setIsOpen(true);
      captureEvent('guide_opened', { source });
    },
    [view.progress.lastPageId],
  );

  const close = useCallback(() => {
    setIsOpen(false);
    view.dismiss();
    captureEvent('guide_closed', { page: currentPageId });
  }, [view, currentPageId]);

  const goTo = useCallback((pageId: string | null) => {
    setCurrentPageId(pageId);
    if (pageId) captureEvent('guide_page_viewed', { page: pageId });
  }, []);

  const concludeGuide = useCallback(() => {
    view.conclude();
    setIsOpen(false);
    captureEvent('guide_completed', { via: 'cta' });
  }, [view]);

  // Auto-abertura: uma vez por workspace, condições da spec.
  const autoOpenTried = useRef(false);
  useEffect(() => {
    if (autoOpenTried.current || isOpen) return;
    const ok = shouldAutoOpenGuide({
      authLoading: loading,
      isOwner,
      pathname: location.pathname,
      progress: view.progress,
      clientes: signals.clientes,
      workflows: signals.workflows,
    });
    if (!ok) return;
    autoOpenTried.current = true;
    view.recordAutoOpen();
    open('auto');
  }, [loading, isOwner, location.pathname, view, signals.clientes, signals.workflows, isOpen, open]);

  // Trilha completada: captura uma vez por trilha.
  useEffect(() => {
    for (const trail of view.trails) {
      const done = trail.pages.every((p) => view.doneIds.has(p.id));
      if (done && !view.progress.trailsCompleted.includes(trail.id)) {
        view.recordTrailCompleted(trail.id);
        captureEvent('guide_trail_completed', { trail: trail.id });
      }
    }
  }, [view]);

  // Conclusão por sinais: workspace claramente ativo dispensa o guia.
  useEffect(() => {
    if (view.signalsSatisfied && !view.progress.concludedAt) {
      view.conclude();
      captureEvent('guide_completed', { via: 'signals' });
    }
  }, [view]);

  const api: GuideApi = {
    ...view,
    isOpen,
    currentPageId,
    latestClienteId: signals.latestClienteId,
    signalValues: signals.values,
    showEntryPoint: isOwner && !view.isConcluded,
    open,
    close,
    goTo,
    concludeGuide,
  };

  return <GuideContext.Provider value={api}>{children}</GuideContext.Provider>;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run apps/crm/src/components/guide/__tests__/GuideContext.test.tsx`
Expected: PASS (5 testes)

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/components/guide
git commit -m "feat(guia): provider com auto-abertura, conclusão por sinais e analytics

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: GuideDialog (o modal)

**Files:**
- Create: `apps/crm/src/components/guide/GuideDialog.tsx`
- Test: `apps/crm/src/components/guide/__tests__/GuideDialog.test.tsx`

**Interfaces:**
- Consumes: `useGuide()`/`GuideContext` (Task 7), `Dialog`/`DialogContent`/`DialogTitle` (`components/ui/dialog`), `Button` (`components/ui/button`), `useNavigate`, `captureEvent`, tipos da Task 3.
- Produces: `export default function GuideDialog()` — home (cards de trilha) quando `currentPageId === null`; página quando setado. "Fazer agora": `captureEvent('guide_action_clicked', { page })`, `setLastPage(page.id)`, fecha SEM `dismiss()` (só `setIsOpen` via `closeForAction()` exposto? não: usar `goTo` + navegação) e `navigate(action.to(ctx))`.
  - Para fechar sem marcar dismissal, a API da Task 7 ganha um detalhe: o `close()` do provider grava dismissal; o Fazer agora precisa fechar sem gravar. **Adicionar ao `GuideApi` (Task 7): `closeForAction(): void`** que só seta `isOpen=false` (sem `dismiss`, sem evento `guide_closed`). Implementar junto desta task (patch pequeno no `GuideContext.tsx` + tipo).

- [ ] **Step 1: Add `closeForAction` to the provider (small patch)**

Em `GuideContext.tsx`: adicionar ao tipo `GuideApi` a linha `closeForAction(): void;`, e no provider:

```tsx
  const closeForAction = useCallback(() => setIsOpen(false), []);
```

e incluir `closeForAction` no objeto `api`.

- [ ] **Step 2: Write the failing test**

```tsx
// apps/crm/src/components/guide/__tests__/GuideDialog.test.tsx
import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { GuideContext, type GuideApi } from '../GuideContext';
import { GUIDE_TRAILS } from '../guideContent';
import GuideDialog from '../GuideDialog';

vi.mock('../../../lib/analytics', () => ({ captureEvent: vi.fn() }));

function makeApi(overrides: Partial<GuideApi> = {}): GuideApi {
  return {
    trails: GUIDE_TRAILS,
    doneIds: new Set<string>(),
    totals: { done: 0, total: 15 },
    isConcluded: false,
    signalsSatisfied: false,
    progress: { pagesSeen: [], pagesDone: [], trailsCompleted: [] },
    markSeen: vi.fn(),
    setLastPage: vi.fn(),
    dismiss: vi.fn(),
    conclude: vi.fn(),
    recordAutoOpen: vi.fn(),
    recordTrailCompleted: vi.fn(),
    isOpen: true,
    currentPageId: null,
    latestClienteId: null,
    signalValues: {},
    showEntryPoint: true,
    open: vi.fn(),
    close: vi.fn(),
    closeForAction: vi.fn(),
    goTo: vi.fn(),
    concludeGuide: vi.fn(),
    ...overrides,
  };
}

function LocationProbe() {
  const loc = useLocation();
  return <span data-testid="loc">{loc.pathname + loc.search}</span>;
}

function renderDialog(api: GuideApi) {
  return render(
    <MemoryRouter initialEntries={['/dashboard']}>
      <GuideContext.Provider value={api}>
        <GuideDialog />
        <Routes>
          <Route path="*" element={<LocationProbe />} />
        </Routes>
      </GuideContext.Provider>
    </MemoryRouter>,
  );
}

describe('GuideDialog', () => {
  it('home mostra as três trilhas e o contador geral', () => {
    renderDialog(makeApi());
    expect(screen.getByText('Bem-vindo ao Mesaas')).toBeInTheDocument();
    expect(screen.getByText('Adicionar seu primeiro cliente')).toBeInTheDocument();
    expect(screen.getByText('Montar sua equipe')).toBeInTheDocument();
    expect(screen.getByText('Criar suas entregas')).toBeInTheDocument();
    expect(screen.getByText('0 de 15 páginas')).toBeInTheDocument();
  });

  it('começar uma trilha navega para a primeira página dela', async () => {
    const api = makeApi();
    renderDialog(api);
    await userEvent.click(screen.getAllByRole('button', { name: 'Começar' })[0]);
    expect(api.goTo).toHaveBeenCalledWith('t1p1');
  });

  it('página renderiza título, posição e markSeen dispara', () => {
    const api = makeApi({ currentPageId: 't1p1' });
    renderDialog(api);
    expect(screen.getByText('Tudo começa com um cliente')).toBeInTheDocument();
    expect(screen.getByText('Página 1 de 5')).toBeInTheDocument();
    expect(api.markSeen).toHaveBeenCalledWith('t1p1');
  });

  it('Fazer agora fecha sem dismissal, grava lastPage e navega', async () => {
    const api = makeApi({ currentPageId: 't1p2' });
    renderDialog(api);
    await userEvent.click(screen.getByRole('button', { name: 'Fazer agora' }));
    expect(api.setLastPage).toHaveBeenCalledWith('t1p2');
    expect(api.closeForAction).toHaveBeenCalled();
    expect(api.dismiss).not.toHaveBeenCalled();
    expect(screen.getByTestId('loc').textContent).toBe('/clientes?novo=1');
  });

  it('a última página da trilha 1 tem a ponte para a trilha 2', async () => {
    const api = makeApi({ currentPageId: 't1p5' });
    renderDialog(api);
    await userEvent.click(screen.getByRole('button', { name: /Montar sua equipe/ }));
    expect(api.goTo).toHaveBeenCalledWith('t2p1');
  });

  it('a conclusão chama concludeGuide', async () => {
    const api = makeApi({ currentPageId: 't3p6' });
    renderDialog(api);
    await userEvent.click(screen.getByRole('button', { name: 'Concluir guia' }));
    expect(api.concludeGuide).toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run apps/crm/src/components/guide/__tests__/GuideDialog.test.tsx`
Expected: FAIL

- [ ] **Step 4: Write implementation**

```tsx
// apps/crm/src/components/guide/GuideDialog.tsx
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Check, ExternalLink, X } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from '../ui/dialog';
import { Button } from '../ui/button';
import { captureEvent } from '../../lib/analytics';
import { useGuide } from './GuideContext';
import type { GuidePage, GuideTrail } from './guideContent';

const seg = (on: boolean): React.CSSProperties => ({
  flex: 1,
  height: 4,
  borderRadius: 2,
  background: on ? 'var(--primary-color)' : 'var(--border-color)',
});

export default function GuideDialog() {
  const g = useGuide();
  const navigate = useNavigate();

  const page =
    g?.currentPageId != null
      ? g.trails.flatMap((t) => t.pages).find((p) => p.id === g.currentPageId)
      : undefined;
  const trail = page ? g!.trails.find((t) => t.pages.some((p) => p.id === page.id)) : undefined;

  // Página vista: conclui páginas sem sinal e alimenta o contador.
  useEffect(() => {
    if (g && page) g.markSeen(page.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page?.id]);

  if (!g) return null;

  const runAction = (p: GuidePage) => {
    if (!p.action) return;
    captureEvent('guide_action_clicked', { page: p.id });
    g.setLastPage(p.id);
    g.closeForAction();
    navigate(p.action.to({ latestClienteId: g.latestClienteId }));
  };

  const firstPageOf = (trailId: string) =>
    g.trails.find((t) => t.id === trailId)?.pages[0]?.id ?? null;

  return (
    <Dialog open={g.isOpen} onOpenChange={(open) => (!open ? g.close() : undefined)}>
      <DialogContent style={{ maxWidth: 640, width: 'calc(100vw - 2rem)' }}>
        {page && trail ? (
          <PageView
            page={page}
            trail={trail}
            onBack={() => {
              const idx = trail.pages.findIndex((p) => p.id === page.id);
              g.goTo(idx > 0 ? trail.pages[idx - 1].id : null);
            }}
            onHome={() => g.goTo(null)}
            onNext={() => {
              const idx = trail.pages.findIndex((p) => p.id === page.id);
              if (page.bridgeTo) return g.goTo(firstPageOf(page.bridgeTo));
              if (page.conclude) return g.concludeGuide();
              g.goTo(idx < trail.pages.length - 1 ? trail.pages[idx + 1].id : null);
            }}
            onAction={() => runAction(page)}
            signalValues={g.signalValues}
          />
        ) : (
          <HomeView
            trails={g.trails}
            doneIds={g.doneIds}
            totals={g.totals}
            onStart={(t) => {
              const next = t.pages.find((p) => !g.doneIds.has(p.id)) ?? t.pages[0];
              g.goTo(next.id);
            }}
            onClose={() => g.close()}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function HomeView({
  trails,
  doneIds,
  totals,
  onStart,
  onClose,
}: {
  trails: GuideTrail[];
  doneIds: Set<string>;
  totals: { done: number; total: number };
  onStart(t: GuideTrail): void;
  onClose(): void;
}) {
  const pct = totals.total > 0 ? Math.round((totals.done / totals.total) * 100) : 0;
  return (
    <div>
      <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: 0 }}>
        Guia de primeiros passos
      </p>
      <DialogTitle style={{ fontSize: '1.25rem', margin: '4px 0 0' }}>
        Bem-vindo ao Mesaas
      </DialogTitle>
      <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: '6px 0 0' }}>
        Três trilhas curtas, em páginas rápidas de ler. Feche quando quiser: o guia continua de onde
        parou.
      </p>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '16px 0 4px' }}>
        <div
          aria-hidden="true"
          style={{
            flex: 1,
            height: 4,
            borderRadius: 2,
            background: 'var(--border-color)',
            overflow: 'hidden',
          }}
        >
          <div style={{ width: `${pct}%`, height: '100%', background: 'var(--primary-color)' }} />
        </div>
        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
          {totals.done} de {totals.total} páginas
        </span>
      </div>
      <div style={{ display: 'grid', gap: 10, marginTop: 12 }}>
        {trails.map((t, i) => {
          const done = t.pages.filter((p) => doneIds.has(p.id)).length;
          const started = done > 0 && done < t.pages.length;
          const Icon = t.icon;
          return (
            <div
              key={t.id}
              style={{
                border: '1px solid var(--border-color)',
                borderRadius: 12,
                padding: '13px 15px',
                display: 'flex',
                gap: 13,
                alignItems: 'center',
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 10,
                  background: 'var(--surface-2, #f5f6f8)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flex: 'none',
                }}
              >
                <Icon className="h-5 w-5" />
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ margin: 0, fontSize: '0.86rem', fontWeight: 600 }}>
                  {i + 1}. {t.title}
                </p>
                <p style={{ margin: '2px 0 0', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  {t.subtitle} · {done} de {t.pages.length} páginas
                </p>
              </div>
              <Button
                variant={started || (i === 0 && done === 0) ? 'default' : 'outline'}
                size="sm"
                onClick={() => onStart(t)}
              >
                {started ? 'Continuar' : done === t.pages.length ? 'Rever' : 'Começar'}
              </Button>
            </div>
          );
        })}
      </div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginTop: 16,
          paddingTop: 12,
          borderTop: '1px solid var(--border-color)',
        }}
      >
        <button
          type="button"
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            fontSize: '0.8rem',
            color: 'var(--text-muted)',
            textDecoration: 'underline',
            cursor: 'pointer',
            padding: 0,
          }}
        >
          Fechar por enquanto
        </button>
        <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
          Seu progresso fica salvo
        </span>
      </div>
    </div>
  );
}

function PageView({
  page,
  trail,
  onBack,
  onHome,
  onNext,
  onAction,
  signalValues,
}: {
  page: GuidePage;
  trail: GuideTrail;
  onBack(): void;
  onHome(): void;
  onNext(): void;
  onAction(): void;
  signalValues: Partial<Record<string, boolean>>;
}) {
  const idx = trail.pages.findIndex((p) => p.id === page.id);
  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 10,
        }}
      >
        <button
          type="button"
          onClick={onHome}
          style={{
            background: 'none',
            border: 'none',
            display: 'inline-flex',
            gap: 7,
            alignItems: 'center',
            fontSize: '0.75rem',
            color: 'var(--text-muted)',
            cursor: 'pointer',
            padding: 0,
          }}
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {trail.title}
        </button>
        <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
          Página {idx + 1} de {trail.pages.length}
        </span>
      </div>
      <div aria-hidden="true" style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
        {trail.pages.map((p, i) => (
          <span key={p.id} style={seg(i <= idx)} />
        ))}
      </div>
      <DialogTitle style={{ fontSize: '1.05rem', margin: 0 }}>{page.title}</DialogTitle>
      <p style={{ fontSize: '0.85rem', color: 'var(--text-main, inherit)', margin: '8px 0 0', lineHeight: 1.6 }}>
        {page.lead}
      </p>
      {page.body}
      {page.recap && (
        <ul style={{ listStyle: 'none', padding: 0, margin: '14px 0 0', display: 'grid', gap: 9 }}>
          {page.recap.map((r) => {
            const ok = signalValues[r.signal] === true;
            return (
              <li
                key={r.signal}
                style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: '0.82rem' }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    width: 20,
                    height: 20,
                    borderRadius: '50%',
                    background: ok ? 'rgba(62,207,142,0.18)' : 'var(--surface-2, #f1f5f9)',
                    color: ok ? '#15803d' : 'var(--text-muted)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flex: 'none',
                  }}
                >
                  <Check className="h-3 w-3" />
                </span>
                {r.label}
              </li>
            );
          })}
        </ul>
      )}
      {page.action && (
        <div
          style={{
            marginTop: 16,
            background: 'var(--surface-2, #f8fafc)',
            border: '1px solid var(--border-color)',
            borderRadius: 10,
            padding: '13px 15px',
            display: 'flex',
            gap: 13,
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <p style={{ margin: 0, fontSize: '0.76rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
            {page.action.caption}
          </p>
          <Button size="sm" onClick={onAction} style={{ flex: 'none' }}>
            {page.action.label}
            <ExternalLink className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginTop: 18,
          paddingTop: 12,
          borderTop: '1px solid var(--border-color)',
        }}
      >
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="h-3.5 w-3.5" />
          Voltar
        </Button>
        {page.conclude ? (
          <Button size="sm" onClick={onNext}>
            Concluir guia
            <Check className="h-3.5 w-3.5" />
          </Button>
        ) : page.bridgeTo ? (
          <Button size="sm" onClick={onNext}>
            {page.bridgeTo === 't2' ? 'Montar sua equipe' : 'Criar suas entregas'}
            <ArrowRight className="h-3.5 w-3.5" />
          </Button>
        ) : (
          <Button variant="outline" size="sm" onClick={onNext}>
            Continuar
            <ArrowRight className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    </div>
  );
}
```

Nota: `X` importado fica sem uso se o `DialogContent` já renderiza o botão de fechar padrão (renderiza). Remova o import de `X` se o linter reclamar.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run apps/crm/src/components/guide/__tests__/GuideDialog.test.tsx`
Expected: PASS (6 testes). Se o Radix Dialog reclamar de `DialogTitle` fora de posição ou falta de `aria-describedby`, seguir o padrão dos dialogs existentes do app (ver `NewWorkflowWizard.tsx:248`).

- [ ] **Step 6: Commit**

```bash
git add apps/crm/src/components/guide
git commit -m "feat(guia): modal com home de trilhas, páginas e Fazer agora

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: GuidePill + GuideNavItem + CSS responsivo

**Files:**
- Create: `apps/crm/src/components/guide/GuidePill.tsx`
- Modify: `apps/crm/style.css` (fim do arquivo)
- Test: `apps/crm/src/components/guide/__tests__/GuidePill.test.tsx`

**Interfaces:**
- Consumes: `useGuide()` (Task 7), `Compass` (lucide).
- Produces:
  - `export function GuidePill()` — botão `.guide-pill`, visível só ≥1101px (CSS), `onClick: open('pill')`, some quando `!showEntryPoint`.
  - `export function GuideNavItem({ source, className }: { source: 'sidebar' | 'mobile_nav'; className?: string })` — botão de reentrada para sidebar drawer e sheet Mais; some quando `!showEntryPoint`.

- [ ] **Step 1: Write the failing test**

```tsx
// apps/crm/src/components/guide/__tests__/GuidePill.test.tsx
import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { GuideContext, type GuideApi } from '../GuideContext';
import { GuidePill, GuideNavItem } from '../GuidePill';

function api(overrides: Partial<GuideApi>): GuideApi {
  return {
    trails: [],
    doneIds: new Set(),
    totals: { done: 7, total: 15 },
    isConcluded: false,
    signalsSatisfied: false,
    progress: { pagesSeen: [], pagesDone: [], trailsCompleted: [] },
    markSeen: vi.fn(),
    setLastPage: vi.fn(),
    dismiss: vi.fn(),
    conclude: vi.fn(),
    recordAutoOpen: vi.fn(),
    recordTrailCompleted: vi.fn(),
    isOpen: false,
    currentPageId: null,
    latestClienteId: null,
    signalValues: {},
    showEntryPoint: true,
    open: vi.fn(),
    close: vi.fn(),
    closeForAction: vi.fn(),
    goTo: vi.fn(),
    concludeGuide: vi.fn(),
    ...overrides,
  } as GuideApi;
}

describe('GuidePill / GuideNavItem', () => {
  it('pill mostra o contador e abre com source pill', async () => {
    const a = api({});
    render(
      <GuideContext.Provider value={a}>
        <GuidePill />
      </GuideContext.Provider>,
    );
    expect(screen.getByText('7 de 15')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Guia/ }));
    expect(a.open).toHaveBeenCalledWith('pill');
  });

  it('some quando showEntryPoint é false', () => {
    render(
      <GuideContext.Provider value={api({ showEntryPoint: false })}>
        <GuidePill />
        <GuideNavItem source="mobile_nav" />
      </GuideContext.Provider>,
    );
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('nav item abre com o source recebido', async () => {
    const a = api({});
    render(
      <GuideContext.Provider value={a}>
        <GuideNavItem source="mobile_nav" />
      </GuideContext.Provider>,
    );
    await userEvent.click(screen.getByRole('button'));
    expect(a.open).toHaveBeenCalledWith('mobile_nav');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/crm/src/components/guide/__tests__/GuidePill.test.tsx`
Expected: FAIL

- [ ] **Step 3: Write component + CSS**

```tsx
// apps/crm/src/components/guide/GuidePill.tsx
import { Compass } from 'lucide-react';
import { useGuide, type GuideOpenSource } from './GuideContext';

/** Reentrada fixa do guia. Visibilidade responsiva 100% via CSS (.guide-pill):
 *  display none por padrão, visível só >=1101px. jsdom não avalia media
 *  queries: a visibilidade responsiva se verifica no browser, não em teste. */
export function GuidePill() {
  const g = useGuide();
  if (!g || !g.showEntryPoint) return null;
  return (
    <button type="button" className="guide-pill" onClick={() => g.open('pill')}>
      <Compass className="h-4 w-4" aria-hidden="true" />
      <span style={{ fontWeight: 600 }}>Guia</span>
      <span style={{ color: 'var(--text-muted)' }}>
        {g.totals.done} de {g.totals.total}
      </span>
      <span className="guide-pill-dot" aria-hidden="true" />
    </button>
  );
}

/** Reentrada em navegação: sidebar em modo drawer (tablet) e sheet Mais do
 *  MobileNav (telefone). */
export function GuideNavItem({
  source,
  className,
}: {
  source: Extract<GuideOpenSource, 'sidebar' | 'mobile_nav'>;
  className?: string;
}) {
  const g = useGuide();
  if (!g || !g.showEntryPoint) return null;
  return (
    <button type="button" className={className} onClick={() => g.open(source)}>
      <Compass size={18} aria-hidden="true" />
      <span>
        Guia de primeiros passos · {g.totals.done} de {g.totals.total}
      </span>
    </button>
  );
}
```

No fim de `apps/crm/style.css`:

```css
/* ── Guia de primeiros passos ─────────────────────────────── */
/* UI fixa ancorada: display none por padrão, só existe >=1101px
   (abaixo disso a sidebar vira drawer e o canto é do MobileNav). */
.guide-pill {
  display: none;
}
@media (min-width: 1101px) {
  .guide-pill {
    position: fixed;
    right: 20px;
    bottom: 20px;
    z-index: 40;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    background: var(--card-bg);
    border: 1px solid var(--border-color);
    border-radius: 999px;
    padding: 9px 14px;
    font-size: 0.8rem;
    color: var(--text-main);
    cursor: pointer;
    box-shadow: var(--shadow);
  }
  .guide-pill:hover {
    background: var(--surface-hover);
  }
}
.guide-pill-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--primary-color);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run apps/crm/src/components/guide/__tests__/GuidePill.test.tsx`
Expected: PASS (3 testes)

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/components/guide apps/crm/style.css
git commit -m "feat(guia): pill de reentrada e item de navegação

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 10: useOpenParam (hook de deep link reativo)

**Files:**
- Create: `apps/crm/src/hooks/useOpenParam.ts`
- Test: `apps/crm/src/hooks/__tests__/useOpenParam.test.tsx`

**Interfaces:**
- Consumes: `useSearchParams` (react-router-dom).
- Produces: `useOpenParam(param: string, onOpen: () => void): void` — reativo ao parâmetro (não on-mount), dispara `onOpen` quando `?{param}=1` aparece, remove SÓ esse param preservando o resto da query, `{ replace: true }`.

- [ ] **Step 1: Write the failing test**

```tsx
// apps/crm/src/hooks/__tests__/useOpenParam.test.tsx
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useNavigate, useSearchParams } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { useOpenParam } from '../useOpenParam';

function Page({ onOpen }: { onOpen: () => void }) {
  useOpenParam('novo', onOpen);
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  return (
    <div>
      <span data-testid="qs">{searchParams.toString()}</span>
      <button onClick={() => navigate('/page?novo=1&filtro=ativos')}>self-nav</button>
    </div>
  );
}

describe('useOpenParam', () => {
  it('dispara no mount com o param presente e o remove preservando o resto', async () => {
    const onOpen = vi.fn();
    render(
      <MemoryRouter initialEntries={['/page?novo=1&filtro=ativos']}>
        <Page onOpen={onOpen} />
      </MemoryRouter>,
    );
    await waitFor(() => expect(onOpen).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId('qs').textContent).toBe('filtro=ativos');
  });

  it('dispara de novo quando o param REAPARECE sem remontar a página', async () => {
    const onOpen = vi.fn();
    render(
      <MemoryRouter initialEntries={['/page']}>
        <Page onOpen={onOpen} />
      </MemoryRouter>,
    );
    expect(onOpen).not.toHaveBeenCalled();
    await userEvent.click(screen.getByText('self-nav'));
    await waitFor(() => expect(onOpen).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId('qs').textContent).toBe('filtro=ativos');
  });

  it('não dispara sem o param', () => {
    const onOpen = vi.fn();
    render(
      <MemoryRouter initialEntries={['/page?filtro=ativos']}>
        <Page onOpen={onOpen} />
      </MemoryRouter>,
    );
    expect(onOpen).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/crm/src/hooks/__tests__/useOpenParam.test.tsx`
Expected: FAIL

- [ ] **Step 3: Write implementation**

```ts
// apps/crm/src/hooks/useOpenParam.ts
import { useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * Deep link de abertura de dialog via query param (?param=1).
 *
 * Reativo ao PARÂMETRO, não ao mount: navegar para a mesma rota trocando só a
 * query não remonta a página (spec do guia, revisão externa P1). Remove só o
 * próprio param, preservando o resto da query, com replace (sem entrada de
 * histórico).
 */
export function useOpenParam(param: string, onOpen: () => void): void {
  const [searchParams, setSearchParams] = useSearchParams();
  const present = searchParams.get(param) === '1';
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;

  useEffect(() => {
    if (!present) return;
    onOpenRef.current();
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete(param);
        return next;
      },
      { replace: true },
    );
  }, [present, param, setSearchParams]);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run apps/crm/src/hooks/__tests__/useOpenParam.test.tsx`
Expected: PASS (3 testes)

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/hooks
git commit -m "feat(guia): hook useOpenParam para deep links reativos

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 11: deep links em ClientesPage e EquipePage

**Files:**
- Modify: `apps/crm/src/pages/clientes/ClientesPage.tsx` (estado do dialog: `modalOpen`/`setModalOpen`, linha ~149; form reset de criação já existe no handler do botão "Adicionar")
- Modify: `apps/crm/src/pages/equipe/EquipePage.tsx` (`setModalOpen`, linha ~123; o fluxo de criação usa `form.reset(MEMBRO_FORM_DEFAULTS)` + `setModalOpen(true)`, linhas ~194-195)

**Interfaces:**
- Consumes: `useOpenParam` (Task 10).
- Produces: `/clientes?novo=1` abre o dialog de novo cliente; `/equipe?novo=1` abre o dialog de novo membro. Sem teste de página inteira (render pesado): o comportamento reativo já está coberto pelo teste do hook; aqui a verificação é typecheck + browser (Task 16).

- [ ] **Step 1: ClientesPage**

Em `ClientesPage.tsx`, importar o hook e ligar ao fluxo de criação. Localize o handler do botão "Adicionar" (o que faz `setEditing(null)`, reseta o form para os defaults de criação e chama `setModalOpen(true)`) e extraia-o para `const openCreate = () => { ... }` se ainda for inline. Depois:

```ts
import { useOpenParam } from '../../hooks/useOpenParam';
// dentro do componente, após os useState:
useOpenParam('novo', openCreate);
```

Regra: `useOpenParam` deve chamar EXATAMENTE o mesmo caminho do clique manual (mesmo reset de form), nunca um `setModalOpen(true)` cru — senão o dialog abre com estado de edição sujo.

- [ ] **Step 2: EquipePage**

Mesmo padrão em `EquipePage.tsx`: localizar o handler de "Adicionar Membro" (faz `form.reset(MEMBRO_FORM_DEFAULTS)` e `setModalOpen(true)`, ~linhas 193-195), garantir que é uma função nomeada (ex.: `openCreate`) e ligar:

```ts
import { useOpenParam } from '../../hooks/useOpenParam';
useOpenParam('novo', openCreate);
```

Atenção ao guard existente `if (canSeeFinancials !== true) setModalOpen(false)` (linha ~175): não mexer.

- [ ] **Step 3: Typecheck e suíte**

Run: `npx tsc -p apps/crm/tsconfig.json --noEmit && npx vitest run apps/crm/src/pages/clientes apps/crm/src/pages/equipe`
Expected: sem erros; testes existentes das páginas continuam verdes.

- [ ] **Step 4: Commit**

```bash
git add apps/crm/src/pages/clientes/ClientesPage.tsx apps/crm/src/pages/equipe/EquipePage.tsx
git commit -m "feat(guia): deep links ?novo=1 em clientes e equipe

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 12: deep link ?novo-fluxo=1 nas Entregas + supressão do tour

**Files:**
- Create: `apps/crm/src/pages/entregas/tour/tourGating.ts`
- Modify: `apps/crm/src/pages/entregas/EntregasPage.tsx` (efeito de auto-start do tour, ~linhas 158-164; adicionar `useOpenParam`)
- Test: `apps/crm/src/pages/entregas/__tests__/tourGating.test.ts`

**Interfaces:**
- Consumes: `useOpenParam` (Task 10), `setNewWorkflowOpen` (estado existente da página, linha ~66).
- Produces: `shouldAutoStartTour(i: { isLoading: boolean; alreadyStarted: boolean; tourDone: boolean; showExample: boolean; wizardOpen: boolean }): boolean`

- [ ] **Step 1: Write the failing test**

```ts
// apps/crm/src/pages/entregas/__tests__/tourGating.test.ts
import { describe, expect, it } from 'vitest';
import { shouldAutoStartTour } from '../tour/tourGating';

const BASE = {
  isLoading: false,
  alreadyStarted: false,
  tourDone: false,
  showExample: true,
  wizardOpen: false,
};

describe('shouldAutoStartTour', () => {
  it('inicia no primeiro board de exemplo', () => {
    expect(shouldAutoStartTour(BASE)).toBe(true);
  });

  it('NUNCA inicia com o wizard de novo fluxo aberto (deep link do guia)', () => {
    // Regression: ?novo-fluxo=1 em workspace vazio abria dois overlays.
    expect(shouldAutoStartTour({ ...BASE, wizardOpen: true })).toBe(false);
  });

  it('não inicia carregando, repetido, feito ou sem board de exemplo', () => {
    expect(shouldAutoStartTour({ ...BASE, isLoading: true })).toBe(false);
    expect(shouldAutoStartTour({ ...BASE, alreadyStarted: true })).toBe(false);
    expect(shouldAutoStartTour({ ...BASE, tourDone: true })).toBe(false);
    expect(shouldAutoStartTour({ ...BASE, showExample: false })).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/crm/src/pages/entregas/__tests__/tourGating.test.ts`
Expected: FAIL

- [ ] **Step 3: Write `tourGating.ts` and rewire the page**

```ts
// apps/crm/src/pages/entregas/tour/tourGating.ts
/**
 * Auto-start do tour driver.js. wizardOpen: o deep link do guia
 * (?novo-fluxo=1) chega exatamente no estado que dispararia o tour; dois
 * overlays de onboarding ao mesmo tempo é proibido (spec do guia).
 */
export function shouldAutoStartTour(i: {
  isLoading: boolean;
  alreadyStarted: boolean;
  tourDone: boolean;
  showExample: boolean;
  wizardOpen: boolean;
}): boolean {
  return !i.isLoading && !i.alreadyStarted && !i.tourDone && i.showExample && !i.wizardOpen;
}
```

Em `EntregasPage.tsx`:

1. Importar: `import { shouldAutoStartTour } from './tour/tourGating';` e `import { useOpenParam } from '../../hooks/useOpenParam';`
2. Consumir o param (junto dos outros hooks, DEPOIS da declaração de `setNewWorkflowOpen`):

```ts
useOpenParam('novo-fluxo', () => setNewWorkflowOpen(true));
```

3. Substituir o corpo do efeito de auto-start (~linha 159):

```ts
useEffect(() => {
  if (
    !shouldAutoStartTour({
      isLoading,
      alreadyStarted: autoStarted.current,
      tourDone,
      showExample,
      wizardOpen: newWorkflowOpen,
    })
  )
    return;
  autoStarted.current = true;
  launchTour();
}, [isLoading, tourDone, showExample, newWorkflowOpen, launchTour]);
```

Nota de ordem: `useOpenParam` remove o param via `setSearchParams` funcional com `replace`, o mesmo mecanismo do efeito `?drawer=`/`?post=` (linha ~183); o serializador de URL (linha ~215) roda depois e não re-adiciona o que já foi consumido.

- [ ] **Step 4: Run tests**

Run: `npx vitest run apps/crm/src/pages/entregas`
Expected: PASS (novo teste + suíte existente das entregas intacta)

- [ ] **Step 5: Typecheck**

Run: `npx tsc -p apps/crm/tsconfig.json --noEmit`
Expected: sem erros

- [ ] **Step 6: Commit**

```bash
git add apps/crm/src/pages/entregas
git commit -m "feat(guia): deep link novo-fluxo com supressão do tour das entregas

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 13: montagem no AppLayout + Sidebar + MobileNav

**Files:**
- Modify: `apps/crm/src/components/layout/AppLayout.tsx` (~linhas 100-136, bloco de return)
- Modify: `apps/crm/src/components/layout/Sidebar.tsx` (bloco `.sidebar-bottom`, ~linha 175)
- Modify: `apps/crm/src/components/layout/MobileNav.tsx` (sheet Mais, após o botão "Buscar", ~linha 168)

**Interfaces:**
- Consumes: `GuideProvider` (Task 7), `GuideDialog` (Task 8), `GuidePill`/`GuideNavItem` (Task 9).
- Produces: guia disponível em toda página autenticada; reentrada nos três mundos responsivos.

- [ ] **Step 1: AppLayout**

```tsx
import { GuideProvider } from '../guide/GuideContext';
const GuideDialog = lazy(() => import('../guide/GuideDialog'));
import { GuidePill } from '../guide/GuidePill';
```

Envolver TODO o conteúdo do return com `<GuideProvider>` (o provider precisa englobar Sidebar e MobileNav, que consomem `useGuide`), e adicionar como irmãos de `<main>`:

```tsx
return (
  <GuideProvider>
    <div className="app-container">
      {/* ...conteúdo existente inalterado... */}
      <MobileNav />
      <GuidePill />
      <Suspense fallback={null}>
        <GuideDialog />
      </Suspense>
    </div>
  </GuideProvider>
);
```

- [ ] **Step 2: Sidebar (modo drawer)**

Em `Sidebar.tsx`, importar `GuideNavItem` e renderizar no TOPO do bloco `.sidebar-bottom` (antes de `.sidebar-user-menu`), só em modo drawer:

```tsx
import { GuideNavItem } from '../guide/GuidePill';
// dentro de .sidebar-bottom:
{isDrawer && <GuideNavItem source="sidebar" className="sidebar-guide-item" />}
```

E no `style.css` (junto do bloco `.guide-pill`):

```css
.sidebar-guide-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 0.5rem 0.75rem;
  margin-bottom: 0.5rem;
  border: 1px solid var(--border-color);
  border-radius: 10px;
  background: transparent;
  color: var(--text-main);
  font-size: 0.8rem;
  cursor: pointer;
}
```

- [ ] **Step 3: MobileNav (sheet Mais)**

Em `MobileNav.tsx`, importar `GuideNavItem` e adicionar após o botão "Buscar" (~linha 168), seguindo o padrão `mobile-more-item` (fechar o sheet antes de abrir o guia):

```tsx
import { GuideNavItem } from '../guide/GuidePill';
import { useGuide } from '../guide/GuideContext';
```

O item precisa fechar o sheet, então NÃO usar `GuideNavItem` cru; replicar o padrão local:

```tsx
{guide?.showEntryPoint && (
  <button
    className="mobile-more-item"
    type="button"
    onClick={() => {
      setMoreOpen(false);
      guide.open('mobile_nav');
    }}
  >
    <div className="mobile-more-item-icon">
      <Compass size={18} />
    </div>
    <span>Guia de primeiros passos</span>
  </button>
)}
```

com `const guide = useGuide();` no corpo do componente e `Compass` vindo de lucide (o arquivo já importa ícones de lucide; adicionar ao import existente).

- [ ] **Step 4: Typecheck + suíte de layout**

Run: `npx tsc -p apps/crm/tsconfig.json --noEmit && npx vitest run apps/crm/src/components/layout`
Expected: sem erros; testes de nav existentes verdes. `useGuide()` retorna null fora do provider, então `guide?.` nunca quebra testes que renderizam MobileNav isolado.

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/components/layout apps/crm/style.css
git commit -m "feat(guia): montagem global com reentrada em pill, sidebar e MobileNav

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 14: aposentar o OnboardingBanner

**Files:**
- Modify: `apps/crm/src/pages/dashboard/DashboardPage.tsx` (import ~linha 18, uso ~linhas 107-115, query `['leads']` ~linha 75)
- Delete: `apps/crm/src/components/OnboardingBanner.tsx`
- Delete: `apps/crm/src/components/__tests__/OnboardingBanner.test.tsx`

- [ ] **Step 1: DashboardPage**

1. Remover o import de `OnboardingBanner` (linha 18) e o bloco `{!isAgent && (<OnboardingBanner ... />)}` (linhas ~107-115).
2. A query `['leads']`/`getLeads` (linha ~75) e as variáveis `leadsRes`/`leads` (linhas ~84, ~89) alimentavam SÓ o banner neste arquivo: remover query, destructure e variável, e o import de `getLeads`/`Lead` se ficarem órfãos. Antes de remover, confirmar: `grep -n "leads" apps/crm/src/pages/dashboard/DashboardPage.tsx` não pode sobrar nenhum uso.
3. `portfolio`/`getPortfolioSummary` continuam (outros cards usam? confirmar com grep; se o único uso era o banner, remover também — o guia tem a própria query com a MESMA key, então não há perda).

- [ ] **Step 2: Delete the component and its test**

```bash
git rm apps/crm/src/components/OnboardingBanner.tsx apps/crm/src/components/__tests__/OnboardingBanner.test.tsx
```

Depois: `grep -rn "OnboardingBanner" apps/` deve retornar vazio.

- [ ] **Step 3: Typecheck + suíte**

Run: `npx tsc -p apps/crm/tsconfig.json --noEmit && npx vitest run apps/crm/src/pages/dashboard apps/crm/src/components`
Expected: sem erros, sem referências órfãs.

- [ ] **Step 4: Commit**

```bash
git add -A apps/crm/src
git commit -m "feat(guia): aposenta o OnboardingBanner do dashboard

O guia de primeiros passos cobre os mesmos passos com deep links e
auto-conclusão; dois checklists concorrentes confundem.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 15: glossário fixo no StepTemplate + modelo em vez de template

**Files:**
- Modify: `apps/crm/src/pages/entregas/wizard/steps/StepTemplate.tsx` (tip box linhas ~20-32; heading "Seus templates" ~linha 103)
- Modify: `apps/crm/src/pages/entregas/wizard/steps/StepReview.tsx` (label ~linha 106, "Nome do template" ~linha 117, alerta ~linha 125)

- [ ] **Step 1: Replace the StepTemplate tip box with the permanent glossary**

Substituir o `<p>` de dica (linhas ~20-32) por:

```tsx
<div
  style={{
    fontSize: '0.8rem',
    color: 'var(--text-muted)',
    background: 'var(--surface-2, #f8fafc)',
    border: '1px solid var(--border-color)',
    borderRadius: 10,
    padding: '0.6rem 0.85rem',
    marginBottom: '1rem',
    lineHeight: 1.7,
  }}
>
  <b>Fluxo</b> · o ciclo de trabalho de um cliente (ex.: posts de agosto)
  <br />
  <b>Modelo</b> · a receita reutilizável de etapas que cria fluxos
  <br />
  <b>Post</b> · o conteúdo dentro do fluxo, cada um com o próprio status
</div>
```

E trocar o heading `Seus templates` por `Seus modelos`.

- [ ] **Step 2: StepReview copy**

Trocar as três strings visíveis (identificadores `saveAsTemplate`/`templateName` NÃO mudam):
- `Salvar estas etapas como template` → `Salvar estas etapas como modelo`
- `Nome do template` → `Nome do modelo`
- `Dê um nome ao template — sem nome, o fluxo é criado mas o template não é salvo.` → `Dê um nome ao modelo: sem nome, o fluxo é criado mas o modelo não é salvo.` (também elimina o em-dash)

- [ ] **Step 3: Sweep for copy assertions**

Run: `grep -rn "como template\|Seus templates\|Nome do template" apps/crm/src`
Expected: vazio. Se algum teste assertar a cópia antiga, atualizar o teste junto.

- [ ] **Step 4: Tests + typecheck**

Run: `npx vitest run apps/crm/src/pages/entregas && npx tsc -p apps/crm/tsconfig.json --noEmit`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/pages/entregas
git commit -m "feat(entregas): glossário fixo fluxo/modelo/post e padronização de modelo

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 16: verificação final (CI local + browser)

**Files:** nenhum novo; correções pontuais do que a bateria apontar.

- [ ] **Step 1: Bateria completa de CI local**

```bash
npm run lint
npm run format:check
npx tsc -p apps/crm/tsconfig.json --noEmit
npx tsc -p apps/hub/tsconfig.json --noEmit
npx tsc -p apps/admin/tsconfig.json --noEmit
npx tsc -p tsconfig.scripts.json
npm run test
```

Expected: tudo verde. `npm run format` auto-corrige se o format:check falhar. Se algum comando falhar, corrigir e re-rodar ANTES de seguir. Atenção ao gotcha de `node_modules` poluído por Deno: se prettier/tsc derem resultados estranhos, `ls node_modules/.deno` e, se existir, `npm ci` DENTRO do worktree.

- [ ] **Step 2: Verificação no browser (staging)**

Copiar `.env.staging` do repo principal para o worktree se ainda não existir (worktrees não o têm; sem ele o `:staging` cai em PROD). Subir `npm run dev:staging` via preview e verificar:

1. Workspace novo (ou localStorage limpo + workspace vazio): guia auto-abre no dashboard.
2. Fechar; pill "Guia · N de M" no canto inferior direito (>=1101px); reabrir volta onde parou.
3. "Fazer agora" da página t1p2 abre o dialog de novo cliente; criar um cliente; voltar pelo pill: t1p2 com check.
4. `?novo-fluxo=1` nas Entregas com board vazio: abre SÓ o wizard, sem tour por cima.
5. Responsivo: <1101px o pill some; drawer da sidebar mostra o item; <768px o sheet Mais mostra "Guia de primeiros passos".
6. Dark mode (`data-theme="dark"`): modal e pill legíveis.
7. Passo 1 do wizard de entregas: glossário fixo visível, "Seus modelos".

- [ ] **Step 3: Commit de eventuais ajustes**

```bash
git add -A
git commit -m "fix(guia): ajustes da verificação em browser

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

(Sem push nem PR nesta task: a decisão de integração é da skill finishing-a-development-branch, com o usuário.)

---

## Self-review notes

- Spec coverage: trilhas/páginas (T3), contadores derivados (T3/T5/T8), sinais + erro inconclusivo (T4), hub-token-any + invalidação (T2), gating success-only e uma-vez (T6/T7), analytics union (T6), lastPage/reabertura (T7/T8), pill/sidebar/MobileNav (T9/T13), deep links reativos (T10/T11/T12), supressão do tour (T12), aposentadoria do banner (T14), glossário + modelo (T15), verificação (T16). Sem tarefa para `vercel.json` porque não há rota nova (spec).
- Tipos cruzados conferidos: `GuideApi` (T7+T8 patch `closeForAction`), `GuideSignals` (T4→T5/T7), `GuideProgress.trailsCompleted` (T1→T5/T7).
- Cópia sem em-dash garantida por teste (T3) e revisão manual nas strings de T15.
