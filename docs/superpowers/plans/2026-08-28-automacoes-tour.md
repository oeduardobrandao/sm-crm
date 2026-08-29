# Tour guiado de criação de automação — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Visita guiada passiva em 8 passos (coach marks) que ensina a criar uma automação de comentário para DM na página /automacoes do CRM.

**Architecture:** Implementação própria (sem biblioteca) em `apps/crm/src/pages/automacoes/tour/`: dados declarativos (`tourSteps.ts`), estado + persistência (`useAutomationTour.ts`, dono é a página) e apresentação (`TourOverlay.tsx`, spotlight via box-shadow + card). Passo 1 renderiza `position: fixed` na página; passos 2 a 8 renderizam DENTRO do `DialogContent` com `position: absolute` e coordenadas locais, porque o Content tem `transform` (containing block de `fixed`) e `overflow-hidden` (recorta sombra) — e o recorte é o visual desejado, já que o `DialogOverlay` do Radix escurece o resto.

**Tech Stack:** React 19, TypeScript, Vitest + Testing Library (jsdom), react-i18next, Radix Dialog (shadcn), Tailwind + tokens hex legados do CRM.

**Spec:** `docs/superpowers/specs/2026-08-28-automacoes-tour-design.md` (lê-la antes de resolver qualquer ambiguidade; ela governa).

## Global Constraints

- Sem travessão (em-dash) em NENHUMA string de UI. Ponto, dois-pontos ou "·".
- Toda string de UI em pt E en via i18n: `packages/i18n/locales/{pt,en}/automations.json`.
- Copy dos 8 passos é a da spec, verbatim (tabela "Os 8 passos"). Não reescrever.
- Passo de dialog NUNCA usa `position: fixed` nem portal para fora do dialog (transform/focus-trap; ver spec, "Sistema de coordenadas").
- Passo 2 (índice 1) NÃO tem botão Voltar; `back()` tem piso no índice 1.
- "Concluir" não submete o formulário; encerrar o tour nunca fecha o dialog.
- Encerramento por fechamento do dialog é observado pela transição de `formOpen` para false (cobre salvar via `onSaved`), nunca só por `onOpenChange`.
- `isAgent` da elegibilidade é a derivação existente da página (`role === 'agent'`), não uma nova.
- localStorage sempre em try/catch (best-effort); chave `automacoes_tour_seen:${conta_id}`.
- Testes jsdom não cobrem posicionamento (rects zerados); cobrem conteúdo e comportamento.
- Antes de confiar em lint/tsc locais: `ls node_modules/.deno` — se existir, rodar `npm ci` primeiro (poluição do Deno).
- Commits frequentes, mensagens em português como o restante do repo, com `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

## File Structure

- Create: `apps/crm/src/pages/automacoes/tour/tourSteps.ts` — dados dos 8 passos
- Create: `apps/crm/src/pages/automacoes/tour/useAutomationTour.ts` — estado, auto-início, persistência
- Create: `apps/crm/src/pages/automacoes/tour/TourOverlay.tsx` — spotlight + card
- Create: `apps/crm/src/pages/automacoes/tour/__tests__/{tourSteps,useAutomationTour}.test.ts(x)`, `__tests__/TourOverlay.test.tsx`
- Modify: `packages/i18n/locales/pt/automations.json`, `packages/i18n/locales/en/automations.json` — chaves `tour.*` e `checklist.seeTour`
- Modify: `apps/crm/src/pages/automacoes/AutomationFormDialog.tsx` — atributos `data-tour` + prop `tour`
- Modify: `apps/crm/src/pages/automacoes/AutomacoesPage.tsx` — âncora do botão, hook, overlay de página, efeito de fechamento
- Modify: `apps/crm/src/pages/automacoes/AutomacoesChecklist.tsx` — link "Ver passo a passo"
- Modify testes existentes: `__tests__/AutomacoesPage.test.tsx`, `__tests__/AutomationFormDialog.test.tsx`, `__tests__/AutomacoesChecklist.test.tsx`

---

### Task 1: Dados dos passos + i18n

**Files:**
- Create: `apps/crm/src/pages/automacoes/tour/tourSteps.ts`
- Create: `apps/crm/src/pages/automacoes/tour/__tests__/tourSteps.test.ts`
- Modify: `packages/i18n/locales/pt/automations.json`
- Modify: `packages/i18n/locales/en/automations.json`

**Interfaces:**
- Produces: `TourStep { id: string; surface: 'page' | 'dialog'; anchor: string; titleKey: string; textKey: string; ctaKey?: string }` e `TOUR_STEPS: TourStep[]` (8 itens). Tasks 2 a 5 consomem ambos.

- [ ] **Step 1: Escrever o teste que falha**

```ts
// apps/crm/src/pages/automacoes/tour/__tests__/tourSteps.test.ts
import { describe, it, expect } from 'vitest';
import { TOUR_STEPS } from '../tourSteps';

describe('TOUR_STEPS', () => {
  it('tem 8 passos na ordem página -> formulário', () => {
    expect(TOUR_STEPS).toHaveLength(8);
    expect(TOUR_STEPS[0].surface).toBe('page');
    expect(TOUR_STEPS.slice(1).every((s) => s.surface === 'dialog')).toBe(true);
  });

  it('só o passo 1 tem ctaKey', () => {
    expect(TOUR_STEPS[0].ctaKey).toBe('tour.step1Cta');
    expect(TOUR_STEPS.slice(1).every((s) => s.ctaKey === undefined)).toBe(true);
  });

  it('âncoras são únicas', () => {
    const anchors = TOUR_STEPS.map((s) => s.anchor);
    expect(new Set(anchors).size).toBe(anchors.length);
  });

  it('a ordem das âncoras segue o formulário', () => {
    expect(TOUR_STEPS.map((s) => s.anchor)).toEqual([
      'nova-automacao',
      'campo-nome',
      'campo-cliente',
      'campo-alvo',
      'campo-palavras',
      'campo-dm',
      'campo-botoes',
      'campo-resposta',
    ]);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run apps/crm/src/pages/automacoes/tour/__tests__/tourSteps.test.ts`
Expected: FAIL (módulo `../tourSteps` não existe)

- [ ] **Step 3: Implementar `tourSteps.ts`**

```ts
// apps/crm/src/pages/automacoes/tour/tourSteps.ts

/** Um passo do tour guiado. `anchor` é o valor do atributo data-tour do
 * elemento alvo; `surface` decide onde o overlay monta e o sistema de
 * coordenadas (página = fixed/viewport, dialog = absolute/local). */
export interface TourStep {
  id: string;
  surface: 'page' | 'dialog';
  anchor: string;
  titleKey: string;
  textKey: string;
  /** Só o passo 1: o CTA que abre o formulário. */
  ctaKey?: string;
}

export const TOUR_STEPS: TourStep[] = [
  {
    id: 'nova-automacao',
    surface: 'page',
    anchor: 'nova-automacao',
    titleKey: 'tour.step1Title',
    textKey: 'tour.step1Text',
    ctaKey: 'tour.step1Cta',
  },
  {
    id: 'campo-nome',
    surface: 'dialog',
    anchor: 'campo-nome',
    titleKey: 'tour.step2Title',
    textKey: 'tour.step2Text',
  },
  {
    id: 'campo-cliente',
    surface: 'dialog',
    anchor: 'campo-cliente',
    titleKey: 'tour.step3Title',
    textKey: 'tour.step3Text',
  },
  {
    id: 'campo-alvo',
    surface: 'dialog',
    anchor: 'campo-alvo',
    titleKey: 'tour.step4Title',
    textKey: 'tour.step4Text',
  },
  {
    id: 'campo-palavras',
    surface: 'dialog',
    anchor: 'campo-palavras',
    titleKey: 'tour.step5Title',
    textKey: 'tour.step5Text',
  },
  {
    id: 'campo-dm',
    surface: 'dialog',
    anchor: 'campo-dm',
    titleKey: 'tour.step6Title',
    textKey: 'tour.step6Text',
  },
  {
    id: 'campo-botoes',
    surface: 'dialog',
    anchor: 'campo-botoes',
    titleKey: 'tour.step7Title',
    textKey: 'tour.step7Text',
  },
  {
    id: 'campo-resposta',
    surface: 'dialog',
    anchor: 'campo-resposta',
    titleKey: 'tour.step8Title',
    textKey: 'tour.step8Text',
  },
];
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run apps/crm/src/pages/automacoes/tour/__tests__/tourSteps.test.ts`
Expected: PASS (4 testes)

- [ ] **Step 5: Adicionar as chaves i18n**

Em `packages/i18n/locales/pt/automations.json`, adicionar ao objeto raiz a
chave `tour` (irmã de `checklist`) e, dentro de `checklist`, a chave
`seeTour`:

```json
"tour": {
  "counter": "{{current}} de {{total}}",
  "skip": "Pular tour",
  "back": "Voltar",
  "next": "Próximo",
  "finish": "Concluir",
  "step1Title": "Comece por aqui",
  "step1Text": "Toda automação nasce neste botão. Vamos abrir o formulário para você e mostrar cada campo.",
  "step1Cta": "Abrir formulário",
  "step2Title": "Dê um nome interno",
  "step2Text": "Esse nome aparece só para a equipe. Use algo que identifique a campanha, como \"Lançamento ebook\".",
  "step3Title": "Escolha o cliente",
  "step3Text": "Só aparecem clientes com Instagram conectado. Se faltar alguém, conecte a conta na aba Redes sociais do cliente.",
  "step4Title": "Defina onde a automação escuta",
  "step4Text": "Todos os posts responde comentários de qualquer publicação. Post específico deixa você escolher um post em produção ou já publicado.",
  "step5Title": "Adicione as palavras-chave",
  "step5Text": "Quando um comentário contém uma delas, a automação dispara. Digite e pressione Enter. Ex.: \"eu quero\", \"link\".",
  "step6Title": "Escreva a mensagem do DM",
  "step6Text": "É o que a pessoa recebe no privado. A prévia ao lado mostra como fica no Instagram.",
  "step7Title": "Inclua botões de link",
  "step7Text": "Opcional: até 3 botões levam a pessoa ao seu site, checkout ou material. Com botões, a mensagem pode ter até 640 caracteres.",
  "step8Title": "Responda no comentário e salve",
  "step8Text": "A resposta pública é opcional e mostra que o perfil é ativo. Pronto: revise e toque em Salvar para ativar."
}
```

E em `checklist` (pt): `"seeTour": "Ver passo a passo"`.

Em `packages/i18n/locales/en/automations.json`:

```json
"tour": {
  "counter": "{{current}} of {{total}}",
  "skip": "Skip tour",
  "back": "Back",
  "next": "Next",
  "finish": "Done",
  "step1Title": "Start here",
  "step1Text": "Every automation starts with this button. We will open the form for you and walk through each field.",
  "step1Cta": "Open the form",
  "step2Title": "Give it an internal name",
  "step2Text": "This name is only visible to your team. Use something that identifies the campaign, like \"Ebook launch\".",
  "step3Title": "Choose the client",
  "step3Text": "Only clients with a connected Instagram account appear here. If someone is missing, connect their account in the client's Social networks tab.",
  "step4Title": "Set where the automation listens",
  "step4Text": "All posts replies to comments on any publication. Specific post lets you pick a post in production or one already published.",
  "step5Title": "Add the keywords",
  "step5Text": "When a comment contains one of them, the automation fires. Type and press Enter. E.g. \"I want it\", \"link\".",
  "step6Title": "Write the DM message",
  "step6Text": "This is what the person receives in their inbox. The preview on the side shows how it looks on Instagram.",
  "step7Title": "Include link buttons",
  "step7Text": "Optional: up to 3 buttons take the person to your site, checkout or material. With buttons, the message can have up to 640 characters.",
  "step8Title": "Reply to the comment and save",
  "step8Text": "The public reply is optional and shows the profile is active. Done: review and tap Save to activate."
}
```

E em `checklist` (en): `"seeTour": "See the walkthrough"`.

Conferir que nenhum valor contém o caractere `—` (em-dash):
`grep -n '—' packages/i18n/locales/pt/automations.json packages/i18n/locales/en/automations.json` deve não retornar nada.

- [ ] **Step 6: Commit**

```bash
git add apps/crm/src/pages/automacoes/tour packages/i18n/locales
git commit -m "feat(automacoes): dados e i18n dos 8 passos do tour guiado"
```

---

### Task 2: Hook de estado `useAutomationTour`

**Files:**
- Create: `apps/crm/src/pages/automacoes/tour/useAutomationTour.ts`
- Create: `apps/crm/src/pages/automacoes/tour/__tests__/useAutomationTour.test.ts`

**Interfaces:**
- Consumes: `TOUR_STEPS`, `TourStep` de `./tourSteps` (Task 1).
- Produces: `tourSeenKey(contaId: string | null): string` e
  `useAutomationTour(opts: { contaId: string | null; eligibleForAutoStart: boolean }): AutomationTourApi`, com
  `AutomationTourApi { activeIndex: number | null; activeStep: TourStep | null; start(): void; next(): void; back(): void; skip(): void; finish(): void; handleDialogClose(): void }`.
  Task 5 consome tudo.

- [ ] **Step 1: Escrever os testes que falham**

```ts
// apps/crm/src/pages/automacoes/tour/__tests__/useAutomationTour.test.ts
import { act, renderHook } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { useAutomationTour, tourSeenKey } from '../useAutomationTour';
import { TOUR_STEPS } from '../tourSteps';

const CONTA = 'conta-1';
const KEY = tourSeenKey(CONTA);

describe('useAutomationTour', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  const render = (eligible: boolean) =>
    renderHook(
      ({ e }: { e: boolean }) =>
        useAutomationTour({ contaId: CONTA, eligibleForAutoStart: e }),
      { initialProps: { e: eligible } },
    );

  it('auto-inicia no passo 1 quando elegível e sem chave, e grava a chave', () => {
    const { result } = render(true);
    expect(result.current.activeIndex).toBe(0);
    expect(localStorage.getItem(KEY)).toBe('1');
  });

  it('não auto-inicia com a chave gravada', () => {
    localStorage.setItem(KEY, '1');
    const { result } = render(true);
    expect(result.current.activeIndex).toBeNull();
  });

  it('não auto-inicia quando inelegível, e dispara quando a elegibilidade chega', () => {
    const { result, rerender } = render(false);
    expect(result.current.activeIndex).toBeNull();
    rerender({ e: true });
    expect(result.current.activeIndex).toBe(0);
  });

  it('start() manual funciona mesmo com a chave gravada', () => {
    localStorage.setItem(KEY, '1');
    const { result } = render(false);
    act(() => result.current.start());
    expect(result.current.activeIndex).toBe(0);
  });

  it('next avança até o teto e back tem piso no passo 2 (índice 1)', () => {
    const { result } = render(true);
    act(() => result.current.next());
    expect(result.current.activeIndex).toBe(1);
    act(() => result.current.back());
    expect(result.current.activeIndex).toBe(1); // piso: nunca volta ao passo 1
    act(() => result.current.next());
    act(() => result.current.back());
    expect(result.current.activeIndex).toBe(1);
    for (let i = 0; i < 20; i++) act(() => result.current.next());
    expect(result.current.activeIndex).toBe(TOUR_STEPS.length - 1); // teto
    expect(result.current.activeStep?.id).toBe('campo-resposta');
  });

  it('skip e finish encerram e persistem', () => {
    localStorage.clear();
    const { result } = render(true);
    act(() => result.current.skip());
    expect(result.current.activeIndex).toBeNull();
    expect(localStorage.getItem(KEY)).toBe('1');
  });

  it('handleDialogClose encerra em passo de dialog e ignora passo de página', () => {
    const { result } = render(true);
    act(() => result.current.handleDialogClose()); // passo 1 = page
    expect(result.current.activeIndex).toBe(0);
    act(() => result.current.next());
    act(() => result.current.handleDialogClose());
    expect(result.current.activeIndex).toBeNull();
  });

  it('localStorage lançando exceção não quebra', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('quota');
    });
    const { result } = render(true);
    expect(result.current.activeIndex).toBe(0); // best-effort: segue funcionando
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run apps/crm/src/pages/automacoes/tour/__tests__/useAutomationTour.test.ts`
Expected: FAIL (módulo não existe)

- [ ] **Step 3: Implementar o hook**

```ts
// apps/crm/src/pages/automacoes/tour/useAutomationTour.ts
import { useCallback, useEffect, useRef, useState } from 'react';
import { TOUR_STEPS, type TourStep } from './tourSteps';

export function tourSeenKey(contaId: string | null): string {
  return `automacoes_tour_seen:${contaId ?? ''}`;
}

// Best-effort como guideStorage.ts: quota estourada ou Safari private mode
// não pode derrubar a página.
function readSeen(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}
function writeSeen(key: string): void {
  try {
    localStorage.setItem(key, '1');
  } catch {
    /* best-effort */
  }
}

export interface AutomationTourApi {
  activeIndex: number | null;
  activeStep: TourStep | null;
  start: () => void;
  next: () => void;
  back: () => void;
  skip: () => void;
  finish: () => void;
  handleDialogClose: () => void;
}

export function useAutomationTour({
  contaId,
  eligibleForAutoStart,
}: {
  contaId: string | null;
  eligibleForAutoStart: boolean;
}): AutomationTourApi {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const key = tourSeenKey(contaId);
  // Uma única chance de auto-início por montagem: a elegibilidade pode oscilar
  // (refetches) e o tour não deve re-disparar depois de dispensado.
  const autoFiredRef = useRef(false);

  useEffect(() => {
    if (!eligibleForAutoStart || autoFiredRef.current) return;
    autoFiredRef.current = true;
    if (readSeen(key)) return;
    // Grava já no auto-início: dispensar sem ler não faz o tour reaparecer.
    writeSeen(key);
    setActiveIndex(0);
  }, [eligibleForAutoStart, key]);

  const start = useCallback(() => {
    writeSeen(key);
    setActiveIndex(0);
  }, [key]);

  const end = useCallback(() => {
    writeSeen(key);
    setActiveIndex(null);
  }, [key]);

  const next = useCallback(
    () => setActiveIndex((i) => (i == null ? i : Math.min(i + 1, TOUR_STEPS.length - 1))),
    [],
  );

  // Piso no índice 1: voltar ao passo 1 exigiria fechar o dialog por baixo do
  // guard de alterações não salvas (decisão do spec).
  const back = useCallback(() => setActiveIndex((i) => (i == null || i <= 1 ? i : i - 1)), []);

  const handleDialogClose = useCallback(() => {
    setActiveIndex((i) => {
      if (i == null || TOUR_STEPS[i].surface !== 'dialog') return i;
      writeSeen(key);
      return null;
    });
  }, [key]);

  return {
    activeIndex,
    activeStep: activeIndex == null ? null : TOUR_STEPS[activeIndex],
    start,
    next,
    back,
    skip: end,
    finish: end,
    handleDialogClose,
  };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run apps/crm/src/pages/automacoes/tour/__tests__/useAutomationTour.test.ts`
Expected: PASS (8 testes)

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/pages/automacoes/tour
git commit -m "feat(automacoes): hook de estado do tour com auto-início e persistência"
```

---

### Task 3: `TourOverlay` (spotlight + card)

**Files:**
- Create: `apps/crm/src/pages/automacoes/tour/TourOverlay.tsx`
- Create: `apps/crm/src/pages/automacoes/tour/__tests__/TourOverlay.test.tsx`

**Interfaces:**
- Consumes: `TourStep` (Task 1).
- Produces: `default TourOverlay(props: TourOverlayProps)` com
  `TourOverlayProps { step: TourStep; index: number; total: number; onNext(): void; onBack(): void; onSkip(): void; onFinish(): void; onCta?(): void }`.
  Tasks 4 e 5 consomem. `data-testid="tour-overlay"` no root e
  `data-testid="tour-card"` no card.

- [ ] **Step 1: Escrever os testes que falham**

```tsx
// apps/crm/src/pages/automacoes/tour/__tests__/TourOverlay.test.tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import TourOverlay from '../TourOverlay';
import { TOUR_STEPS } from '../tourSteps';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) =>
      vars ? `${key}:${JSON.stringify(vars)}` : key,
    i18n: { language: 'pt' },
  }),
}));

const noop = () => {};
const baseProps = {
  total: TOUR_STEPS.length,
  onNext: noop,
  onBack: noop,
  onSkip: noop,
  onFinish: noop,
};

/** Cria a âncora no DOM antes do render; devolve cleanup. */
function mountAnchor(anchor: string): () => void {
  const el = document.createElement('div');
  el.setAttribute('data-tour', anchor);
  document.body.appendChild(el);
  return () => el.remove();
}

describe('TourOverlay', () => {
  let cleanup: (() => void) | null = null;
  beforeEach(() => {
    cleanup?.();
    cleanup = null;
  });

  it('passo 1: título, texto, contador e só o CTA (sem Voltar/Próximo)', () => {
    cleanup = mountAnchor(TOUR_STEPS[0].anchor);
    render(<TourOverlay {...baseProps} step={TOUR_STEPS[0]} index={0} onCta={noop} />);
    expect(screen.getByText('tour.step1Title')).toBeInTheDocument();
    expect(screen.getByText('tour.step1Text')).toBeInTheDocument();
    expect(screen.getByText('tour.counter:{"current":1,"total":8}')).toBeInTheDocument();
    expect(screen.getByText('tour.step1Cta')).toBeInTheDocument();
    expect(screen.queryByText('tour.next')).not.toBeInTheDocument();
    expect(screen.queryByText('tour.back')).not.toBeInTheDocument();
  });

  it('passo 2 (índice 1): Próximo sem Voltar', () => {
    cleanup = mountAnchor(TOUR_STEPS[1].anchor);
    render(<TourOverlay {...baseProps} step={TOUR_STEPS[1]} index={1} />);
    expect(screen.getByText('tour.next')).toBeInTheDocument();
    expect(screen.queryByText('tour.back')).not.toBeInTheDocument();
  });

  it('passo intermediário: Voltar + Próximo, callbacks corretos', () => {
    cleanup = mountAnchor(TOUR_STEPS[4].anchor);
    const onNext = vi.fn();
    const onBack = vi.fn();
    render(
      <TourOverlay {...baseProps} step={TOUR_STEPS[4]} index={4} onNext={onNext} onBack={onBack} />,
    );
    fireEvent.click(screen.getByText('tour.next'));
    fireEvent.click(screen.getByText('tour.back'));
    expect(onNext).toHaveBeenCalledOnce();
    expect(onBack).toHaveBeenCalledOnce();
  });

  it('último passo: Concluir chama onFinish', () => {
    cleanup = mountAnchor(TOUR_STEPS[7].anchor);
    const onFinish = vi.fn();
    render(<TourOverlay {...baseProps} step={TOUR_STEPS[7]} index={7} onFinish={onFinish} />);
    fireEvent.click(screen.getByText('tour.finish'));
    expect(onFinish).toHaveBeenCalledOnce();
    expect(screen.queryByText('tour.next')).not.toBeInTheDocument();
  });

  it('"Pular tour" chama onSkip em qualquer passo', () => {
    cleanup = mountAnchor(TOUR_STEPS[2].anchor);
    const onSkip = vi.fn();
    render(<TourOverlay {...baseProps} step={TOUR_STEPS[2]} index={2} onSkip={onSkip} />);
    fireEvent.click(screen.getByText('tour.skip'));
    expect(onSkip).toHaveBeenCalledOnce();
  });

  it('âncora ausente: não renderiza card nem spotlight', () => {
    render(<TourOverlay {...baseProps} step={TOUR_STEPS[3]} index={3} />);
    expect(screen.queryByTestId('tour-card')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run apps/crm/src/pages/automacoes/tour/__tests__/TourOverlay.test.tsx`
Expected: FAIL (módulo não existe)

- [ ] **Step 3: Implementar `TourOverlay.tsx`**

```tsx
// apps/crm/src/pages/automacoes/tour/TourOverlay.tsx
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import type { TourStep } from './tourSteps';

/** Quanto tempo re-tentar achar a âncora antes do fail-safe encerrar o tour
 * (o dialog pode ainda estar montando quando o passo 2 chega). */
const ANCHOR_RETRY_MS = 1000;
const CARD_WIDTH = 290;
const GAP = 12;
/** Abaixo disso o card vira folha no rodapé (mockup aprovado). */
const SHEET_BREAKPOINT = 640;

export interface TourOverlayProps {
  step: TourStep;
  index: number; // 0-based
  total: number;
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
  onFinish: () => void;
  /** Só usado no passo 1 (índice 0). */
  onCta?: () => void;
}

interface Layout {
  spot: { top: number; left: number; width: number; height: number };
  /** null = folha no rodapé (viewport estreito). */
  card: { top: number; left: number } | null;
}

export default function TourOverlay({
  step,
  index,
  total,
  onNext,
  onBack,
  onSkip,
  onFinish,
  onCta,
}: TourOverlayProps) {
  const { t } = useTranslation('automations');
  const rootRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<Layout | null>(null);
  // Ref para o fail-safe não reiniciar o loop de rAF quando o pai recria o
  // callback a cada render.
  const onSkipRef = useRef(onSkip);
  onSkipRef.current = onSkip;

  const measure = useCallback((): boolean => {
    const anchor = document.querySelector<HTMLElement>(`[data-tour="${step.anchor}"]`);
    if (!anchor) return false;
    const rect = anchor.getBoundingClientRect();
    // Sistema de coordenadas (ver spec): página = viewport; dialog = local ao
    // Radix Content, que tem transform (containing block de fixed) e
    // overflow-hidden (o recorte da sombra é o visual desejado, o
    // DialogOverlay já escurece o resto).
    let originTop = 0;
    let originLeft = 0;
    let boundW = window.innerWidth;
    let boundH = window.innerHeight;
    if (step.surface === 'dialog') {
      const content = rootRef.current?.closest<HTMLElement>('[role="dialog"]');
      if (!content) return false;
      const cRect = content.getBoundingClientRect();
      originTop = cRect.top;
      originLeft = cRect.left;
      boundW = cRect.width;
      boundH = cRect.height;
    }
    const spot = {
      top: rect.top - originTop,
      left: rect.left - originLeft,
      width: rect.width,
      height: rect.height,
    };
    let card: Layout['card'] = null;
    if (window.innerWidth >= SHEET_BREAKPOINT) {
      const cardH = cardRef.current?.offsetHeight ?? 180;
      const below = spot.top + spot.height + GAP;
      const top = below + cardH > boundH ? Math.max(GAP, spot.top - cardH - GAP) : below;
      const left = Math.min(Math.max(GAP, spot.left), Math.max(GAP, boundW - CARD_WIDTH - GAP));
      card = { top, left };
    }
    setLayout({ spot, card });
    return true;
  }, [step]);

  // Localiza a âncora (com retry: o dialog pode estar montando), rola até ela
  // e mede. Se a âncora nunca aparece, encerra o tour em vez de deixar um
  // card órfão (fail-safe do spec).
  useLayoutEffect(() => {
    setLayout(null);
    let raf = 0;
    let scrolled = false;
    const deadline = performance.now() + ANCHOR_RETRY_MS;
    const tick = () => {
      const anchor = document.querySelector<HTMLElement>(`[data-tour="${step.anchor}"]`);
      if (anchor && !scrolled) {
        scrolled = true;
        anchor.scrollIntoView?.({ block: 'center' });
      }
      if (measure()) return;
      if (performance.now() > deadline) {
        onSkipRef.current();
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [step, measure]);

  // Captura pega o scroll interno do dialog, não só o da janela.
  useEffect(() => {
    const handler = () => void measure();
    window.addEventListener('resize', handler);
    document.addEventListener('scroll', handler, true);
    return () => {
      window.removeEventListener('resize', handler);
      document.removeEventListener('scroll', handler, true);
    };
  }, [measure]);

  const isFirst = index === 0;
  const isLast = index === total - 1;

  return (
    // O root existe mesmo sem layout: o measure de passos de dialog precisa
    // dele montado para achar o Content via closest().
    <div
      ref={rootRef}
      data-testid="tour-overlay"
      style={{
        position: step.surface === 'dialog' ? 'absolute' : 'fixed',
        inset: 0,
        zIndex: step.surface === 'page' ? 8990 : 20,
        pointerEvents: 'none',
      }}
    >
      {layout && (
        <>
          <div
            aria-hidden="true"
            style={{
              position: 'absolute',
              top: layout.spot.top,
              left: layout.spot.left,
              width: layout.spot.width,
              height: layout.spot.height,
              borderRadius: 10,
              pointerEvents: 'none',
              boxShadow:
                '0 0 0 4px var(--card-bg), 0 0 0 6px var(--primary-color), 0 0 0 9999px rgba(10, 12, 15, 0.6)',
            }}
          />
          <div
            ref={cardRef}
            data-testid="tour-card"
            role="dialog"
            aria-label={t(step.titleKey)}
            style={{
              position: 'absolute',
              pointerEvents: 'auto',
              background: 'var(--card-bg)',
              border: '1px solid var(--border-color)',
              borderRadius: layout.card ? 12 : '12px 12px 0 0',
              padding: '0.9rem 1rem 0.8rem',
              boxShadow: '0 12px 32px rgba(10, 12, 15, 0.25)',
              ...(layout.card
                ? { top: layout.card.top, left: layout.card.left, width: CARD_WIDTH }
                : { bottom: 0, left: 0, right: 0 }),
            }}
          >
            <div
              className="flex items-baseline justify-between"
              style={{ marginBottom: '0.25rem' }}
            >
              <span
                style={{
                  fontSize: '0.65rem',
                  fontWeight: 600,
                  color: 'var(--text-muted)',
                  letterSpacing: '0.04em',
                }}
              >
                {t('tour.counter', { current: index + 1, total })}
              </span>
              <button
                type="button"
                className="text-xs underline"
                style={{ color: 'var(--text-muted)' }}
                onClick={onSkip}
              >
                {t('tour.skip')}
              </button>
            </div>
            <p style={{ fontWeight: 700, fontSize: '0.85rem', margin: '0 0 0.25rem' }}>
              {t(step.titleKey)}
            </p>
            <p
              style={{
                fontSize: '0.75rem',
                color: 'var(--text-muted)',
                margin: '0 0 0.7rem',
                lineHeight: 1.45,
              }}
            >
              {t(step.textKey)}
            </p>
            <div className="flex items-center justify-between">
              <span className="flex" style={{ gap: 4 }} aria-hidden="true">
                {Array.from({ length: total }, (_, i) => (
                  <span
                    key={i}
                    style={{
                      width: 5,
                      height: 5,
                      borderRadius: '50%',
                      background: i === index ? 'var(--primary-color)' : 'var(--border-color)',
                    }}
                  />
                ))}
              </span>
              <span className="flex items-center" style={{ gap: '0.4rem' }}>
                {index >= 2 && (
                  <Button type="button" variant="ghost" size="sm" onClick={onBack}>
                    {t('tour.back')}
                  </Button>
                )}
                {isFirst ? (
                  <Button type="button" size="sm" onClick={onCta}>
                    {t(step.ctaKey ?? 'tour.next')}
                  </Button>
                ) : isLast ? (
                  <Button type="button" size="sm" onClick={onFinish}>
                    {t('tour.finish')}
                  </Button>
                ) : (
                  <Button type="button" size="sm" onClick={onNext}>
                    {t('tour.next')}
                  </Button>
                )}
              </span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
```

Nota jsdom: `getBoundingClientRect` devolve zeros e `innerWidth` é 1024, então
`measure()` acha a âncora e monta o card em coordenadas (0,0). Os testes
cobrem conteúdo e callbacks; posicionamento real é verificação de browser. O
fail-safe de 1s não tem teste jsdom (rAF + performance.now sob fake timers é
frágil); é coberto pela verificação manual.

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run apps/crm/src/pages/automacoes/tour/__tests__/TourOverlay.test.tsx`
Expected: PASS (6 testes)

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/pages/automacoes/tour
git commit -m "feat(automacoes): overlay do tour com spotlight e card"
```

---

### Task 4: Âncoras + prop `tour` no `AutomationFormDialog`

**Files:**
- Modify: `apps/crm/src/pages/automacoes/AutomationFormDialog.tsx`
- Modify: `apps/crm/src/pages/automacoes/__tests__/AutomationFormDialog.test.tsx`

**Interfaces:**
- Consumes: `TourOverlay`, `TourOverlayProps` (Task 3); `TourStep` (Task 1).
- Produces: prop opcional no dialog:
  `tour?: Omit<TourOverlayProps, 'onCta'>` (o CTA é exclusivo do passo 1, que
  vive na página). Task 5 consome.

- [ ] **Step 1: Escrever os testes que falham**

No arquivo de teste existente do dialog, seguir o setup de mocks que já está
lá (i18n devolvendo chaves, store mockado etc.) e adicionar um `describe`
novo. Se o teste existente tiver um helper de render, reutilizar; senão,
renderizar como os casos existentes fazem, com `open` true e `editing` null:

```tsx
describe('tour', () => {
  it('expõe as âncoras data-tour dos 7 campos', async () => {
    renderDialog(); // helper/padrão existente do arquivo, dialog aberto
    for (const anchor of [
      'campo-nome',
      'campo-cliente',
      'campo-alvo',
      'campo-palavras',
      'campo-dm',
      'campo-botoes',
      'campo-resposta',
    ]) {
      expect(document.querySelector(`[data-tour="${anchor}"]`)).not.toBeNull();
    }
  });

  it('renderiza o TourOverlay quando a prop tour está presente', async () => {
    const step = TOUR_STEPS[1]; // campo-nome
    renderDialog({
      tour: {
        step,
        index: 1,
        total: TOUR_STEPS.length,
        onNext: vi.fn(),
        onBack: vi.fn(),
        onSkip: vi.fn(),
        onFinish: vi.fn(),
      },
    });
    expect(await screen.findByTestId('tour-overlay')).toBeInTheDocument();
    expect(screen.getByText('tour.step2Title')).toBeInTheDocument();
  });

  it('sem a prop tour, nenhum overlay', async () => {
    renderDialog();
    expect(screen.queryByTestId('tour-overlay')).not.toBeInTheDocument();
  });
});
```

(Importar `TOUR_STEPS` de `../tour/tourSteps` no topo do arquivo de teste.)

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run apps/crm/src/pages/automacoes/__tests__/AutomationFormDialog.test.tsx`
Expected: FAIL nos 3 casos novos (âncoras ausentes, prop inexistente); os
casos antigos seguem passando.

- [ ] **Step 3: Implementar no dialog**

1. Imports novos:

```tsx
import TourOverlay, { type TourOverlayProps } from './tour/TourOverlay';
```

2. Na assinatura do componente, adicionar a prop (depois de `onSaved`):

```tsx
/** Passo ativo do tour guiado quando ele está num passo interno (2 a 8).
 * A página é dona do estado; o dialog só monta o overlay dentro do
 * DialogContent, onde o focus-trap e o stacking do Radix o enxergam como
 * conteúdo próprio. */
tour?: Omit<TourOverlayProps, 'onCta'>;
```

3. Atributos `data-tour` nos wrappers já existentes dos campos (o `<div>`
   externo de cada bloco, o mesmo que contém o `<label>`):

- `<div data-tour="campo-nome">` no bloco do nome (label `form.nameLabel`)
- `<div data-tour="campo-cliente">` no bloco do cliente (label `form.clientLabel`)
- `<div data-tour="campo-alvo">` no bloco do alvo (label `form.targetLabel`)
- `<div data-tour="campo-palavras">` no bloco de palavras-chave (label `form.keywordsLabel`)
- `<div data-tour="campo-dm">` no bloco da mensagem (label `form.dmLabel`)
- `<div data-tour="campo-botoes">` no bloco de botões (span `form.buttonsLabel`)
- `<div data-tour="campo-resposta">` no bloco da resposta pública (label `form.replyLabel`)

4. Renderizar o overlay como ÚLTIMO filho do `DialogContent` (depois do
   `<DialogFooter>`, ainda dentro do `DialogContent`):

```tsx
{tour && <TourOverlay {...tour} />}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run apps/crm/src/pages/automacoes/__tests__/AutomationFormDialog.test.tsx`
Expected: PASS (casos novos e antigos)

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/pages/automacoes
git commit -m "feat(automacoes): âncoras data-tour e overlay do tour no formulário"
```

---

### Task 5: Wiring na página (auto-início, CTA, encerramento)

**Files:**
- Modify: `apps/crm/src/pages/automacoes/AutomacoesPage.tsx`
- Modify: `apps/crm/src/pages/automacoes/__tests__/AutomacoesPage.test.tsx`

**Interfaces:**
- Consumes: `useAutomationTour`, `tourSeenKey` (Task 2); `TourOverlay` (Task 3);
  `TOUR_STEPS` (Task 1); prop `tour` do dialog (Task 4).
- Produces: comportamento integrado; nada novo exportado.

- [ ] **Step 1: Atualizar o mock do dialog e escrever os testes que falham**

No `AutomacoesPage.test.tsx`, substituir o mock existente de
`../AutomationFormDialog` por uma versão que expõe a prop `tour` e o caminho
`onSaved` (compatível com os casos antigos, que só leem `open`):

```tsx
vi.mock('../AutomationFormDialog', () => ({
  default: ({
    open,
    onSaved,
    tour,
  }: {
    open: boolean;
    onSaved: () => void;
    tour?: { step: { id: string } };
  }) =>
    open ? (
      <div data-testid="automation-dialog" data-tour-step={tour?.step.id ?? ''}>
        <button onClick={onSaved}>salvar-mock</button>
      </div>
    ) : null,
}));
```

Adicionar `localStorage.clear()` no `beforeEach` existente (o tour persiste
em localStorage e os testes não podem vazar estado entre si). Conferir qual
`conta_id` o `mockUseAuth` devolve no setup existente e usar o mesmo valor em
`tourSeenKey(...)` nos asserts (abaixo assumido `'conta-1'`; ajustar ao
setup real).

Casos novos (seguir o padrão de render/waits do arquivo):

```tsx
import { TOUR_STEPS } from '../tour/tourSteps';
import { tourSeenKey } from '../tour/useAutomationTour';

describe('tour guiado', () => {
  beforeEach(() => {
    mockGetAutomations.mockResolvedValue([]);
    mockGetClientes.mockResolvedValue([]);
    mockHasReadyAccount.mockResolvedValue(true);
  });

  it('auto-inicia no passo 1 na visita elegível e grava a chave', async () => {
    renderPage();
    expect(await screen.findByText('tour.step1Title')).toBeInTheDocument();
    expect(localStorage.getItem(tourSeenKey('conta-1'))).toBe('1');
  });

  it('não auto-inicia com a chave gravada', async () => {
    localStorage.setItem(tourSeenKey('conta-1'), '1');
    renderPage();
    // Espera a página assentar (checklist visível) antes do assert negativo.
    expect(await screen.findByTestId('automacoes-checklist')).toBeInTheDocument();
    expect(screen.queryByText('tour.step1Title')).not.toBeInTheDocument();
  });

  it('não auto-inicia com automações existentes', async () => {
    // Reutilizar a fixture de automação que os testes de listagem existentes
    // do arquivo já usam (e assertar pelo name dela). Se o arquivo não tiver
    // uma fixture nomeada, usar este objeto mínimo:
    mockGetAutomations.mockResolvedValue([
      {
        id: 'a1',
        name: 'Minha automação',
        client_id: 1,
        keywords: ['link'],
        dm_message: 'oi',
        dm_buttons: [],
        public_reply: null,
        ativo: true,
        dms_sent_count: 0,
        last_triggered_at: null,
        ig_media_id: null,
        media_permalink: null,
        media_caption: null,
        workflow_post_id: null,
        pending_post_deleted_at: null,
      },
    ] as never);
    renderPage();
    expect(await screen.findByText('Minha automação')).toBeInTheDocument();
    expect(screen.queryByText('tour.step1Title')).not.toBeInTheDocument();
  });

  it('agente não vê o tour', async () => {
    mockUseAuth.mockReturnValue({ role: 'agent', profile: { conta_id: 'conta-1' } });
    renderPage();
    expect(await screen.findByTestId('automacoes-checklist')).toBeInTheDocument();
    expect(screen.queryByText('tour.step1Title')).not.toBeInTheDocument();
  });

  it('CTA do passo 1 abre o dialog e avança para o passo 2', async () => {
    renderPage();
    fireEvent.click(await screen.findByText('tour.step1Cta'));
    const dialog = await screen.findByTestId('automation-dialog');
    expect(dialog).toHaveAttribute('data-tour-step', TOUR_STEPS[1].id);
    expect(screen.queryByText('tour.step1Title')).not.toBeInTheDocument();
  });

  it('salvar com sucesso (onSaved) encerra o tour', async () => {
    renderPage();
    fireEvent.click(await screen.findByText('tour.step1Cta'));
    fireEvent.click(await screen.findByText('salvar-mock'));
    await waitFor(() =>
      expect(screen.queryByTestId('automation-dialog')).not.toBeInTheDocument(),
    );
    // Reabrir pelo botão da página: o tour NÃO volta.
    fireEvent.click(screen.getByText('newAutomation'));
    expect(screen.getByTestId('automation-dialog')).toHaveAttribute('data-tour-step', '');
  });
});
```

Nota: o botão da página renderiza `t('newAutomation')`; com o mock de i18n do
arquivo, o texto acessível é a própria chave. Se o assert do clique conflitar
com o ícone, usar `screen.getByRole('button', { name: /newAutomation/ })`.

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run apps/crm/src/pages/automacoes/__tests__/AutomacoesPage.test.tsx`
Expected: FAIL nos casos novos; antigos passam.

- [ ] **Step 3: Implementar o wiring na página**

1. Imports:

```tsx
import { useRef } from 'react'; // juntar ao import existente de react
import TourOverlay from './tour/TourOverlay';
import { useAutomationTour } from './tour/useAutomationTour';
import { TOUR_STEPS } from './tour/tourSteps';
```

2. Depois do bloco do `dismissKey`/checklist (antes dos early returns do
   gate!), montar o hook. IMPORTANTE: hooks sempre antes de qualquer
   `return` condicional (Rules of Hooks; o gate de paywall da página tem
   três returns):

```tsx
const tour = useAutomationTour({
  contaId: profile?.conta_id ?? null,
  eligibleForAutoStart:
    automationsQuery.isSuccess &&
    readyQuery.isSuccess &&
    readyQuery.data === true &&
    automations.length === 0 &&
    canCreate &&
    !isAgent,
});

// Encerramento por fechamento do dialog: observa a TRANSIÇÃO de formOpen,
// não onOpenChange, porque salvar fecha via onSaved -> setFormOpen(false)
// sem passar por onOpenChange (decisão do spec).
const prevFormOpenRef = useRef(formOpen);
useEffect(() => {
  if (prevFormOpenRef.current && !formOpen) tour.handleDialogClose();
  prevFormOpenRef.current = formOpen;
}, [formOpen, tour]);
```

3. `data-tour` no botão de criar (o `<Button onClick={openCreate}>` dentro do
   `FeatureGate` do header):

```tsx
<Button onClick={openCreate} data-tour="nova-automacao">
```

4. Renderizar o overlay de página no fim do JSX principal (irmão do
   `<AutomationFormDialog>`):

```tsx
{tour.activeStep?.surface === 'page' && (
  <TourOverlay
    step={tour.activeStep}
    index={tour.activeIndex ?? 0}
    total={TOUR_STEPS.length}
    onNext={tour.next}
    onBack={tour.back}
    onSkip={tour.skip}
    onFinish={tour.finish}
    onCta={() => {
      openCreate();
      tour.next();
    }}
  />
)}
```

5. Passar a prop `tour` ao dialog:

```tsx
<AutomationFormDialog
  open={formOpen}
  onOpenChange={setFormOpen}
  editing={editing}
  tour={
    tour.activeStep?.surface === 'dialog'
      ? {
          step: tour.activeStep,
          index: tour.activeIndex ?? 0,
          total: TOUR_STEPS.length,
          onNext: tour.next,
          onBack: tour.back,
          onSkip: tour.skip,
          onFinish: tour.finish,
        }
      : undefined
  }
  onSaved={() => {
    setFormOpen(false);
    invalidate();
  }}
/>
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run apps/crm/src/pages/automacoes/__tests__/AutomacoesPage.test.tsx`
Expected: PASS (novos e antigos)

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/pages/automacoes
git commit -m "feat(automacoes): wiring do tour na página (auto-início, CTA e encerramento)"
```

---

### Task 6: Link "Ver passo a passo" na checklist + verificação final

**Files:**
- Modify: `apps/crm/src/pages/automacoes/AutomacoesChecklist.tsx`
- Modify: `apps/crm/src/pages/automacoes/__tests__/AutomacoesChecklist.test.tsx`
- Modify: `apps/crm/src/pages/automacoes/AutomacoesPage.tsx` (passar a prop)
- Modify: `apps/crm/src/pages/automacoes/__tests__/AutomacoesPage.test.tsx` (1 caso)

**Interfaces:**
- Consumes: `AutomacoesChecklistProps` existente; `tour.start` (Task 2/5).
- Produces: prop nova `onStartTour?: () => void` na checklist.

- [ ] **Step 1: Escrever os testes que falham**

Na suíte da checklist (seguir o padrão de props default do arquivo):

```tsx
it('mostra "Ver passo a passo" quando onStartTour é passado e chama ao clicar', () => {
  const onStartTour = vi.fn();
  renderChecklist({ onStartTour }); // helper/padrão existente
  fireEvent.click(screen.getByText('checklist.seeTour'));
  expect(onStartTour).toHaveBeenCalledOnce();
});

it('sem onStartTour, o link não renderiza', () => {
  renderChecklist();
  expect(screen.queryByText('checklist.seeTour')).not.toBeInTheDocument();
});
```

Na suíte da página (dentro do describe do tour da Task 5):

```tsx
it('link da checklist reinicia o tour mesmo com a chave gravada', async () => {
  localStorage.setItem(tourSeenKey('conta-1'), '1');
  renderPage();
  fireEvent.click(await screen.findByText('checklist.seeTour'));
  expect(await screen.findByText('tour.step1Title')).toBeInTheDocument();
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run apps/crm/src/pages/automacoes/__tests__/AutomacoesChecklist.test.tsx apps/crm/src/pages/automacoes/__tests__/AutomacoesPage.test.tsx`
Expected: FAIL nos casos novos.

- [ ] **Step 3: Implementar**

1. Na checklist, adicionar à interface:

```tsx
/** Quando presente, mostra "Ver passo a passo" no cabeçalho. A página só
 * passa quando canCreate && !isAgent (o tour precisa do botão-âncora). */
onStartTour?: () => void;
```

2. No cabeçalho, transformar o botão "Dispensar" num grupo com o link antes
   dele (substituir o `<button>` de dismiss existente por):

```tsx
<div className="flex items-center gap-3">
  {onStartTour && (
    <button
      type="button"
      className="text-xs underline"
      style={{ color: 'var(--text-muted)' }}
      onClick={onStartTour}
    >
      {t('checklist.seeTour')}
    </button>
  )}
  <button
    type="button"
    className="text-xs underline"
    style={{ color: 'var(--text-muted)' }}
    onClick={onDismiss}
  >
    {t('checklist.dismiss')}
  </button>
</div>
```

3. Na página, no render da `<AutomacoesChecklist>`:

```tsx
onStartTour={canCreate && !isAgent ? tour.start : undefined}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run apps/crm/src/pages/automacoes/__tests__/AutomacoesChecklist.test.tsx apps/crm/src/pages/automacoes/__tests__/AutomacoesPage.test.tsx`
Expected: PASS.

- [ ] **Step 5: Verificação final (o que o CI roda)**

```bash
ls node_modules/.deno 2>/dev/null && npm ci   # só se poluído
npm run lint
npm run format:check   # se falhar: npm run format e re-checar
npx tsc -p apps/crm/tsconfig.json --noEmit
npx tsc -p apps/hub/tsconfig.json --noEmit
npx tsc -p apps/admin/tsconfig.json --noEmit
npx tsc -p tsconfig.scripts.json
npm run test
```

Expected: tudo verde (test:functions não é preciso: nada de edge functions
mudou, mas rodar não custa se houver dúvida).

- [ ] **Step 6: Commit**

```bash
git add apps/crm/src/pages/automacoes
git commit -m "feat(automacoes): link Ver passo a passo na checklist reabre o tour"
```

---

## Verificação manual no browser (pós-implementação, pelo controlador)

jsdom não cobre posicionamento. Antes do PR, com `npm run dev` num workspace
com a feature: (1) primeira visita com conta pronta e zero automações
auto-inicia no passo 1 com spotlight no botão; (2) "Abrir formulário" abre o
dialog e o passo 2 destaca o nome DENTRO do dialog, com o interior escurecido
e o resto da tela sob o overlay do próprio Radix; (3) navegar até o passo 8 e
voltar: spotlight rola o dialog até cada campo; (4) "Pular tour" e fechar no
meio encerram e não voltam; (5) viewport estreito: card vira folha no rodapé;
(6) dark mode.
