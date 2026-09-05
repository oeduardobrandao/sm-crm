# Atualizações silenciosas entre deploys: plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** o usuário nunca vê aviso de versão; o app troca de versão sozinho em momentos invisíveis e a aba antiga continua funcionando enquanto espera.

**Architecture:** tudo entra em `packages/app-lifecycle` (sem dependências; o hook importa `react`). Um registro de trabalho não salvo mais uma heurística de DOM decidem quando recarregar é seguro. `installSilentUpdate` detecta o deploy pelo HTML e troca de versão na próxima navegação PUSH com pathname novo, com a aba oculta ou em inatividade. `prefetchBuildAssets` aquece o cache HTTP com os chunks do build a partir do manifest do Vite, só para usuário logado, no CRM e no Admin.

**Tech Stack:** TypeScript, React 19, React Router 7.18 (data router, `router.getBlocker`), Vite 6.4 (`build.manifest`), Vitest + jsdom + @testing-library/react.

**Spec:** `docs/superpowers/specs/2026-09-05-seamless-updates-design.md`. Leia antes de começar qualquer tarefa.

## Global Constraints

- Ordem de entrada é um gate (spec §3.6): registro e hook (Tasks 1 e 2), pontos de registro (3 e 4) e uploads (5) entram ANTES de `installSilentUpdate` ser ligado nos apps (Tasks 8 e 9). Não reordene.
- Sem em-dash em copy ou comentário voltado ao usuário. Não há copy nova nesta feature; se precisar, use ponto ou dois-pontos.
- Prettier: `singleQuote`, `printWidth: 100`, `trailingComma: 'all'`, `semi: true`. Rode `npm run format` antes de cada commit.
- Imports do pacote nos apps sempre via alias `@mesaas/app-lifecycle` (existe no tsconfig e no vite.config dos três apps e no vitest.config).
- Vitest roda da raiz com jsdom e `globals: true`; o setup limpa `vi.restoreAllMocks()` e `vi.unstubAllGlobals()` depois de cada teste. Testes do pacote ficam em `packages/app-lifecycle/__tests__/`.
- `packages/app-lifecycle` não ganha dependência nova. `use-unsaved-work.ts` importa `react`; `silent-update.ts` tipa o router estruturalmente e NÃO importa `react-router`.
- Mensagens de commit em português, no formato `tipo(escopo): resumo`, terminando com a linha `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Antes de qualquer commit: `npm run format`, `npm run lint`, `npx tsc -p apps/crm/tsconfig.json --noEmit`, `npx tsc -p apps/hub/tsconfig.json --noEmit`, `npx tsc -p apps/admin/tsconfig.json --noEmit`, `npx tsc -p tsconfig.scripts.json`, `npm run test`. Se `ls node_modules/.deno` existir, rode `npm ci` antes (node_modules poluído por runs do Deno).
- Nunca use `git stash` sem `-u -m "<tag>"` (stack compartilhado entre worktrees).

---

## Mapa de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `packages/app-lifecycle/src/unsaved-work.ts` (novo) | Registro de trabalho não salvo, `trackUnsavedWork`, heurística `isDocumentBusy` |
| `packages/app-lifecycle/src/use-unsaved-work.ts` (novo) | Hook React sobre o registro |
| `packages/app-lifecycle/src/new-version.ts` | Detector; passa a devolver `{ stop, check }` |
| `packages/app-lifecycle/src/deploy-recovery.ts` | Exporta `RELOAD_STAMP_KEY`; nada mais muda |
| `packages/app-lifecycle/src/silent-update.ts` (novo) | Gatilhos e troca de versão |
| `packages/app-lifecycle/src/prefetch-build.ts` (novo) | Pré-busca dos chunks a partir do manifest |
| `packages/app-lifecycle/index.ts` | Exports públicos |
| `apps/crm/src/components/ui/dialog.tsx` | Registra `confirmClose` |
| `apps/crm/src/pages/relatorio-editor/useLayoutAutosave.ts` | Registra save em voo |
| `apps/crm/src/pages/entregas/components/WorkflowDrawer.tsx` | Registra `savingIds` |
| `apps/crm/src/pages/entregas/components/StandalonePostDrawer.tsx` | Registra `isSaving` |
| `apps/crm/src/pages/contratos/ContratosPage.tsx` | Registra `saving` |
| `apps/hub/src/pages/BriefingPage.tsx` | Registra texto sujo, save e áudio |
| `apps/hub/src/pages/IdeiasPage.tsx` | Registra modal montado |
| 9 funções de upload (CRM, Hub, Admin) | `trackUnsavedWork` |
| `apps/crm/src/main.tsx`, `apps/admin/src/main.tsx`, `apps/hub/src/main.tsx` | Ligação de `installSilentUpdate`; saem toast e banner |
| `apps/crm/src/lib/new-version-toast.ts`, `apps/admin/src/lib/new-version-toast.ts`, `apps/hub/src/components/NewVersionBanner.tsx` (+ teste) | Removidos |
| `packages/i18n/locales/{pt,en}/common.json` | Saem `hub.newVersion` e `hub.refresh` |
| `apps/crm/vite.config.ts`, `apps/admin/vite.config.ts` | `build.manifest: 'build-manifest.json'` |
| `apps/crm/src/components/BuildPrefetch.tsx`, `apps/admin/src/components/BuildPrefetch.tsx` (novos) | Pré-busca depois do login |
| `CLAUDE.md` | Gotcha: editores novos registram `useUnsavedWork` |

---

### Task 1: registro de trabalho não salvo e heurística de DOM

**Files:**
- Create: `packages/app-lifecycle/src/unsaved-work.ts`
- Modify: `packages/app-lifecycle/index.ts`
- Test: `packages/app-lifecycle/__tests__/unsaved-work.test.ts`

**Interfaces:**
- Produces: `holdUnsavedWork(): () => void`, `hasUnsavedWork(): boolean`, `trackUnsavedWork<T>(work: Promise<T>): Promise<T>`, `isDocumentBusy(doc?: Document): boolean`, `resetUnsavedWorkForTests(): void`.

- [ ] **Step 1: Escrever o teste que falha**

```ts
// packages/app-lifecycle/__tests__/unsaved-work.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import {
  hasUnsavedWork,
  holdUnsavedWork,
  isDocumentBusy,
  resetUnsavedWorkForTests,
  trackUnsavedWork,
} from '../src/unsaved-work';

beforeEach(() => {
  resetUnsavedWorkForTests();
  document.body.innerHTML = '';
});

describe('holdUnsavedWork', () => {
  it('is clean with no holds', () => {
    expect(hasUnsavedWork()).toBe(false);
  });

  it('holds until released', () => {
    const release = holdUnsavedWork();
    expect(hasUnsavedWork()).toBe(true);
    release();
    expect(hasUnsavedWork()).toBe(false);
  });

  it('stays held while any hold remains', () => {
    const a = holdUnsavedWork();
    const b = holdUnsavedWork();
    a();
    expect(hasUnsavedWork()).toBe(true);
    b();
    expect(hasUnsavedWork()).toBe(false);
  });

  it('ignores a second release of the same hold', () => {
    const a = holdUnsavedWork();
    const b = holdUnsavedWork();
    a();
    a();
    expect(hasUnsavedWork()).toBe(true);
    b();
    expect(hasUnsavedWork()).toBe(false);
  });
});

describe('trackUnsavedWork', () => {
  it('holds until the promise resolves and passes the value through', async () => {
    let resolve!: (value: string) => void;
    const work = new Promise<string>((r) => (resolve = r));
    const tracked = trackUnsavedWork(work);
    expect(hasUnsavedWork()).toBe(true);
    resolve('ok');
    await expect(tracked).resolves.toBe('ok');
    expect(hasUnsavedWork()).toBe(false);
  });

  it('releases when the promise rejects', async () => {
    const tracked = trackUnsavedWork(Promise.reject(new Error('upload failed')));
    expect(hasUnsavedWork()).toBe(true);
    await expect(tracked).rejects.toThrow('upload failed');
    expect(hasUnsavedWork()).toBe(false);
  });
});

describe('isDocumentBusy', () => {
  it('is false for a plain page', () => {
    document.body.innerHTML = '<main><h1>Entregas</h1><input type="checkbox" /></main>';
    expect(isDocumentBusy()).toBe(false);
  });

  it('is true with an open dialog', () => {
    document.body.innerHTML = '<div role="dialog">Novo cliente</div>';
    expect(isDocumentBusy()).toBe(true);
  });

  it('is true with an open alert dialog', () => {
    document.body.innerHTML = '<div role="alertdialog">Fechar sem salvar?</div>';
    expect(isDocumentBusy()).toBe(true);
  });

  it('is true while a text input is focused', () => {
    document.body.innerHTML = '<input type="search" />';
    document.querySelector('input')!.focus();
    expect(isDocumentBusy()).toBe(true);
  });

  it('ignores a focused checkbox', () => {
    document.body.innerHTML = '<input type="checkbox" />';
    document.querySelector('input')!.focus();
    expect(isDocumentBusy()).toBe(false);
  });

  it('is true while a contenteditable is focused', () => {
    document.body.innerHTML = '<div contenteditable="true" tabindex="0"></div>';
    document.querySelector<HTMLElement>('[contenteditable]')!.focus();
    expect(isDocumentBusy()).toBe(true);
  });

  it('is true with a textarea that has content', () => {
    document.body.innerHTML = '<textarea></textarea>';
    document.querySelector('textarea')!.value = 'rascunho';
    expect(isDocumentBusy()).toBe(true);
  });

  it('ignores an empty textarea', () => {
    document.body.innerHTML = '<textarea>   </textarea>';
    expect(isDocumentBusy()).toBe(false);
  });

  it('is true with a contenteditable that has content', () => {
    document.body.innerHTML = '<div contenteditable="true"><p>Legenda do post</p></div>';
    expect(isDocumentBusy()).toBe(true);
  });

  it('ignores an empty contenteditable', () => {
    document.body.innerHTML = '<div contenteditable="true"><p></p></div>';
    expect(isDocumentBusy()).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run packages/app-lifecycle/__tests__/unsaved-work.test.ts`
Expected: FAIL, `Failed to resolve import "../src/unsaved-work"`.

- [ ] **Step 3: Implementar**

```ts
// packages/app-lifecycle/src/unsaved-work.ts
/**
 * Work in progress that a silent reload would destroy.
 *
 * Two layers. `holdUnsavedWork` is the explicit one: an editor with unsaved input, a save
 * in flight or an upload holds while that is true. `isDocumentBusy` is the safety net for
 * surfaces nobody registered: it reads the DOM for an open dialog, a focused editable or an
 * editor with content. The passive reload triggers (hidden tab, idle) consult both, so an
 * editor shipped without the hook fails closed. The navigation trigger consults only the
 * registry: leaving an unregistered editor by navigation already discards its content today.
 */

let holds = 0;

/** Hold the registry. Returns the release; releasing twice is a no-op. */
export function holdUnsavedWork(): () => void {
  holds += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holds -= 1;
  };
}

export function hasUnsavedWork(): boolean {
  return holds > 0;
}

/** Hold the registry until `work` settles, resolving or rejecting exactly like it. */
export function trackUnsavedWork<T>(work: Promise<T>): Promise<T> {
  const release = holdUnsavedWork();
  return work.finally(release);
}

const TEXT_INPUT_TYPES = new Set(['text', 'search', 'email', 'url', 'tel', 'number', 'password']);

function isContentEditable(el: Element): boolean {
  // jsdom does not implement `isContentEditable`; the attribute is what TipTap sets anyway.
  return (
    el instanceof HTMLElement &&
    (el.isContentEditable === true || el.getAttribute('contenteditable') === 'true')
  );
}

function isEditable(el: Element | null): boolean {
  if (!el) return false;
  if (el instanceof HTMLTextAreaElement) return true;
  if (el instanceof HTMLInputElement) return TEXT_INPUT_TYPES.has(el.type);
  return isContentEditable(el);
}

/**
 * True when reloading now would plausibly lose something: an open dialog (Radix Dialog,
 * Sheet and AlertDialog all render `role="dialog"` or `role="alertdialog"`), a focused
 * editable, or a textarea / contenteditable with content. Deliberately conservative.
 */
export function isDocumentBusy(doc: Document = document): boolean {
  if (doc.querySelector('[role="dialog"], [role="alertdialog"]')) return true;
  if (isEditable(doc.activeElement)) return true;
  for (const el of doc.querySelectorAll('textarea')) {
    if (el.value.trim() !== '') return true;
  }
  for (const el of doc.querySelectorAll('[contenteditable="true"]')) {
    if ((el.textContent ?? '').trim() !== '') return true;
  }
  return false;
}

/** Test seam: forget every hold. */
export function resetUnsavedWorkForTests(): void {
  holds = 0;
}
```

Em `packages/app-lifecycle/index.ts`, acrescente:

```ts
export {
  hasUnsavedWork,
  holdUnsavedWork,
  isDocumentBusy,
  trackUnsavedWork,
} from './src/unsaved-work';
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run packages/app-lifecycle/__tests__/unsaved-work.test.ts`
Expected: PASS, 15 testes.

- [ ] **Step 5: Commit**

```bash
npm run format >/dev/null
git add packages/app-lifecycle/src/unsaved-work.ts packages/app-lifecycle/index.ts packages/app-lifecycle/__tests__/unsaved-work.test.ts
git commit -m "feat(app-lifecycle): registro de trabalho não salvo e heurística de DOM

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: hook `useUnsavedWork`

**Files:**
- Create: `packages/app-lifecycle/src/use-unsaved-work.ts`
- Modify: `packages/app-lifecycle/index.ts`
- Test: `packages/app-lifecycle/__tests__/use-unsaved-work.test.tsx`

**Interfaces:**
- Consumes: `holdUnsavedWork` (Task 1).
- Produces: `useUnsavedWork(active: boolean): void`.

- [ ] **Step 1: Escrever o teste que falha**

```tsx
// packages/app-lifecycle/__tests__/use-unsaved-work.test.tsx
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { hasUnsavedWork, resetUnsavedWorkForTests } from '../src/unsaved-work';
import { useUnsavedWork } from '../src/use-unsaved-work';

beforeEach(() => resetUnsavedWorkForTests());

describe('useUnsavedWork', () => {
  it('holds only while active', () => {
    const { rerender } = renderHook(({ active }) => useUnsavedWork(active), {
      initialProps: { active: false },
    });
    expect(hasUnsavedWork()).toBe(false);
    rerender({ active: true });
    expect(hasUnsavedWork()).toBe(true);
    rerender({ active: false });
    expect(hasUnsavedWork()).toBe(false);
  });

  it('releases on unmount', () => {
    const { unmount } = renderHook(() => useUnsavedWork(true));
    expect(hasUnsavedWork()).toBe(true);
    unmount();
    expect(hasUnsavedWork()).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run packages/app-lifecycle/__tests__/use-unsaved-work.test.tsx`
Expected: FAIL, import de `../src/use-unsaved-work` não resolve.

- [ ] **Step 3: Implementar**

```ts
// packages/app-lifecycle/src/use-unsaved-work.ts
import { useEffect } from 'react';
import { holdUnsavedWork } from './unsaved-work';

/**
 * Hold the unsaved-work registry while mounted and `active`. Pass the same condition the
 * screen already uses for "there is something unsaved here": a dirty flag, a save in flight.
 */
export function useUnsavedWork(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    return holdUnsavedWork();
  }, [active]);
}
```

Em `packages/app-lifecycle/index.ts`, acrescente:

```ts
export { useUnsavedWork } from './src/use-unsaved-work';
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run packages/app-lifecycle/__tests__/use-unsaved-work.test.tsx`
Expected: PASS, 2 testes.

- [ ] **Step 5: Commit**

```bash
npm run format >/dev/null
git add packages/app-lifecycle/src/use-unsaved-work.ts packages/app-lifecycle/index.ts packages/app-lifecycle/__tests__/use-unsaved-work.test.tsx
git commit -m "feat(app-lifecycle): hook useUnsavedWork

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: pontos de registro no CRM

**Files:**
- Modify: `apps/crm/src/components/ui/dialog.tsx` (import no topo; após a linha `const isDirty = confirmClose === true;`)
- Modify: `apps/crm/src/pages/relatorio-editor/useLayoutAutosave.ts` (antes do `return { layout, applyLayout, title, setTitle, saving };`)
- Modify: `apps/crm/src/pages/entregas/components/WorkflowDrawer.tsx` (após `const [savingIds, setSavingIds] = useState<Set<number>>(new Set());`, linha 178)
- Modify: `apps/crm/src/pages/entregas/components/StandalonePostDrawer.tsx` (após `const [isSaving, setIsSaving] = useState(false);`, linha 226)
- Modify: `apps/crm/src/pages/contratos/ContratosPage.tsx` (após `const [saving, setSaving] = useState(false);`, linha 122)
- Test: `apps/crm/src/components/ui/__tests__/dialog-confirm-close.test.tsx`

**Interfaces:**
- Consumes: `useUnsavedWork` e `hasUnsavedWork` de `@mesaas/app-lifecycle` (Tasks 1 e 2).

- [ ] **Step 1: Escrever o teste do DialogContent que falha**

Acrescente ao final de `apps/crm/src/components/ui/__tests__/dialog-confirm-close.test.tsx`, dentro do `describe` existente, e adicione `import { hasUnsavedWork } from '@mesaas/app-lifecycle';` no topo:

```tsx
  it('holds the unsaved-work registry while confirmClose is set', () => {
    const { unmount } = renderDirty(vi.fn());
    expect(hasUnsavedWork()).toBe(true);
    unmount();
    expect(hasUnsavedWork()).toBe(false);
  });

  it('does not hold the registry for a clean dialog', () => {
    render(
      <Dialog open onOpenChange={() => {}}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Título</DialogTitle>
          </DialogHeader>
        </DialogContent>
      </Dialog>,
    );
    expect(hasUnsavedWork()).toBe(false);
  });
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run apps/crm/src/components/ui/__tests__/dialog-confirm-close.test.tsx`
Expected: FAIL no primeiro teste novo, `expected false to be true`.

- [ ] **Step 3: Registrar no DialogContent**

Em `apps/crm/src/components/ui/dialog.tsx`, após `import { cn } from '@/lib/utils';`:

```ts
import { useUnsavedWork } from '@mesaas/app-lifecycle';
```

E logo após `const isDirty = confirmClose === true;`:

```ts
    // A silent version swap must never run over an open, dirty form.
    useUnsavedWork(isDirty);
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run apps/crm/src/components/ui/__tests__/dialog-confirm-close.test.tsx`
Expected: PASS, todos os testes do arquivo.

- [ ] **Step 5: Registrar os quatro editores fora de modal**

Em cada arquivo, adicione o import `import { useUnsavedWork } from '@mesaas/app-lifecycle';` junto dos demais imports e a chamada no escopo do componente/hook, sempre no topo (regra de hooks: incondicional, mesma ordem em todo render).

`useLayoutAutosave.ts`, imediatamente antes de `return { layout, applyLayout, title, setTitle, saving };`:

```ts
  // A save in flight must finish before any silent version swap. Text still inside the
  // debounce window is covered by the DOM heuristic (the editor is contenteditable with content).
  useUnsavedWork(saving);
```

`WorkflowDrawer.tsx`, após a declaração de `savingIds` (linha 178):

```ts
  useUnsavedWork(savingIds.size > 0);
```

`StandalonePostDrawer.tsx`, após a declaração de `isSaving` (linha 226):

```ts
  useUnsavedWork(isSaving);
```

`ContratosPage.tsx`, após a declaração de `saving` (linha 122):

```ts
  useUnsavedWork(saving);
```

- [ ] **Step 6: Typecheck e suíte do CRM**

Run: `npx tsc -p apps/crm/tsconfig.json --noEmit && npx vitest run apps/crm`
Expected: sem erro de tipo; suíte verde. Se algum teste desses componentes mockar `@mesaas/app-lifecycle` parcialmente (`vi.mock` com factory), acrescente `useUnsavedWork: () => {}` ao mock.

- [ ] **Step 7: Commit**

```bash
npm run format >/dev/null
git add apps/crm/src/components/ui/dialog.tsx apps/crm/src/components/ui/__tests__/dialog-confirm-close.test.tsx apps/crm/src/pages/relatorio-editor/useLayoutAutosave.ts apps/crm/src/pages/entregas/components/WorkflowDrawer.tsx apps/crm/src/pages/entregas/components/StandalonePostDrawer.tsx apps/crm/src/pages/contratos/ContratosPage.tsx
git commit -m "feat(crm): registra trabalho não salvo em modais, drawers de post, contratos e autosave do relatório

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: pontos de registro no Hub

**Files:**
- Modify: `apps/hub/src/pages/BriefingPage.tsx` (função `QuestionItem`, após `const locked = phase !== 'idle' || busyAction !== null;`)
- Modify: `apps/hub/src/pages/IdeiasPage.tsx` (função `IdeiaModal`, após `const qc = useQueryClient();`)

**Interfaces:**
- Consumes: `useUnsavedWork` (Task 2).

- [ ] **Step 1: Registrar em `QuestionItem`**

Adicione `import { useUnsavedWork } from '@mesaas/app-lifecycle';` aos imports de `BriefingPage.tsx` e, após `const locked = ...`:

```ts
  // Typed text not yet saved, a save in flight, or an audio upload / transcription in
  // progress: a silent version swap must wait.
  useUnsavedWork(answer !== (question.answer ?? '') || status === 'saving' || locked);
```

- [ ] **Step 2: Registrar em `IdeiaModal`**

Adicione o mesmo import a `IdeiasPage.tsx` e, após `const qc = useQueryClient();` dentro de `IdeiaModal`:

```ts
  // The modal is a plain portal without role="dialog", so the DOM heuristic cannot see it:
  // hold while it is open.
  useUnsavedWork(true);
```

- [ ] **Step 3: Typecheck e suíte do Hub**

Run: `npx tsc -p apps/hub/tsconfig.json --noEmit && npx vitest run apps/hub`
Expected: sem erro de tipo; suíte verde. Mesma nota da Task 3 sobre mocks parciais de `@mesaas/app-lifecycle`.

- [ ] **Step 4: Commit**

```bash
npm run format >/dev/null
git add apps/hub/src/pages/BriefingPage.tsx apps/hub/src/pages/IdeiasPage.tsx
git commit -m "feat(hub): registra trabalho não salvo no briefing e no modal de ideias

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: uploads seguram o registro

**Files:**
- Modify: `apps/crm/src/services/postMedia.ts` (`uploadPostMedia`, linha 206)
- Modify: `apps/crm/src/services/fileService.ts` (`uploadFile`, linha 143)
- Modify: `apps/crm/src/services/ideiaMedia.ts` (`uploadIdeiaImage`, linha 73)
- Modify: `apps/crm/src/services/inlineImage.ts` (`uploadInlineImage`, linha 58)
- Modify: `apps/crm/src/services/automationMedia.ts` (`uploadAutomationMedia`, linha 39)
- Modify: `apps/crm/src/pages/cliente-detalhe/ClienteAvatarUpload.tsx` (chamada `.upload(path, blob, { contentType: 'image/png' })`, linha 60)
- Modify: `apps/hub/src/services/briefingAudio.ts` (`uploadBriefingAudio`, linha 84)
- Modify: `apps/hub/src/services/ideiaMedia.ts` (`uploadIdeiaImage`, linha 102)
- Modify: `apps/admin/src/lib/inline-image.ts` (`uploadInlineImage`, linha 57)

**Interfaces:**
- Consumes: `trackUnsavedWork` (Task 1).
- Produces: as mesmas funções exportadas, mesmas assinaturas.

- [ ] **Step 1: Aplicar o padrão de wrapper nas oito funções de serviço**

Para cada função `export async function uploadX(...)`, renomeie a existente para `uploadXUnguarded` (sem `export`) e adicione, logo acima dela, o wrapper exportado. Exemplo com `uploadPostMedia`:

```ts
import { trackUnsavedWork } from '@mesaas/app-lifecycle';

/** Holds the unsaved-work registry for the whole upload: a silent version swap must not abort it. */
export function uploadPostMedia(
  ...args: Parameters<typeof uploadPostMediaUnguarded>
): ReturnType<typeof uploadPostMediaUnguarded> {
  return trackUnsavedWork(uploadPostMediaUnguarded(...args));
}

async function uploadPostMediaUnguarded(args: {
  // corpo original, sem mudanças
```

Repita com `uploadFile`, `uploadIdeiaImage` (CRM), `uploadInlineImage` (CRM), `uploadAutomationMedia`, `uploadBriefingAudio`, `uploadIdeiaImage` (Hub) e `uploadInlineImage` (Admin). `Parameters`/`ReturnType` evitam retipar as assinaturas; o wrapper devolve a mesma `Promise`.

- [ ] **Step 2: Envolver o upload do avatar**

Em `ClienteAvatarUpload.tsx`, adicione `import { trackUnsavedWork } from '@mesaas/app-lifecycle';` após `import { toast } from 'sonner';` e troque as linhas 58 a 60:

```ts
      const { error: upErr } = await supabase.storage
        .from('avatars')
        .upload(path, blob, { contentType: 'image/png' });
```

por:

```ts
      const { error: upErr } = await trackUnsavedWork(
        supabase.storage.from('avatars').upload(path, blob, { contentType: 'image/png' }),
      );
```

- [ ] **Step 3: Typecheck dos três apps e suítes dos serviços**

Run: `npx tsc -p apps/crm/tsconfig.json --noEmit && npx tsc -p apps/hub/tsconfig.json --noEmit && npx tsc -p apps/admin/tsconfig.json --noEmit && npx vitest run apps/crm/src/services apps/hub/src/services`
Expected: sem erro; `fileService.test.ts`, `postMedia.test.ts`, `briefingAudio.test.ts` e `ideiaMedia.test.ts` verdes (a API pública não mudou).

- [ ] **Step 4: Commit**

```bash
npm run format >/dev/null
git add apps/crm/src/services/postMedia.ts apps/crm/src/services/fileService.ts apps/crm/src/services/ideiaMedia.ts apps/crm/src/services/inlineImage.ts apps/crm/src/services/automationMedia.ts apps/crm/src/pages/cliente-detalhe/ClienteAvatarUpload.tsx apps/hub/src/services/briefingAudio.ts apps/hub/src/services/ideiaMedia.ts apps/admin/src/lib/inline-image.ts
git commit -m "feat: uploads seguram o registro de trabalho não salvo nos três apps

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: `watchForNewVersion` devolve `{ stop, check }`

**Files:**
- Modify: `packages/app-lifecycle/src/new-version.ts`
- Modify: `packages/app-lifecycle/src/deploy-recovery.ts` (só `export` em `RELOAD_STAMP_KEY`)
- Modify: `packages/app-lifecycle/index.ts`
- Modify: `apps/hub/src/components/NewVersionBanner.tsx` e `apps/hub/src/components/__tests__/NewVersionBanner.test.tsx` (adaptação mínima; ambos saem na Task 9)
- Test: `packages/app-lifecycle/__tests__/new-version.test.ts`

**Interfaces:**
- Produces: `watchForNewVersion(options): NewVersionWatcher` com `NewVersionWatcher = { stop: () => void; check: () => Promise<boolean> }`. `check()` ignora a trava de aba oculta e resolve `true` quando o servidor respondeu com um documento comparável (baseline definida ou fingerprint comparado), `false` em erro, resposta sem assets ou watcher parado. `RELOAD_STAMP_KEY` exportado de `deploy-recovery.ts`.

- [ ] **Step 1: Adaptar o helper do teste e escrever os testes novos**

Em `packages/app-lifecycle/__tests__/new-version.test.ts`, troque o helper:

```ts
function watch(onNewVersion: () => void) {
  const watcher = watchForNewVersion({ documentUrl: '/app.html', intervalMs: 5, onNewVersion });
  stops.push(watcher.stop);
  return watcher;
}
```

e no teste `'stops polling when stopped'` troque `const stop = watch(vi.fn());` por `const { stop } = watch(vi.fn());`. Acrescente ao `describe('watchForNewVersion')`:

```ts
  function setVisibility(state: 'visible' | 'hidden') {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  }

  afterEach(() => {
    // Back to jsdom's own getter.
    delete (document as unknown as { visibilityState?: string }).visibilityState;
  });

  it('check() runs with the tab hidden while the interval does not', async () => {
    setVisibility('hidden');
    const fetchSpy = mockFetch([HTML('aaa')]);
    const watcher = watch(vi.fn());

    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(fetchSpy).not.toHaveBeenCalled();

    await expect(watcher.check()).resolves.toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('check() resolves true on a comparison and false on a failure', async () => {
    mockFetch([HTML('aaa'), HTML('aaa'), new Error('offline')]);
    const watcher = watchForNewVersion({
      documentUrl: '/app.html',
      intervalMs: 60_000,
      onNewVersion: vi.fn(),
    });
    stops.push(watcher.stop);

    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    // Let the install-time check settle so the explicit ones below are calls 2 and 3.
    await new Promise((resolve) => setTimeout(resolve, 10));
    await expect(watcher.check()).resolves.toBe(true);
    await expect(watcher.check()).resolves.toBe(false);
  });

  it('check() resolves false once stopped', async () => {
    mockFetch([HTML('aaa')]);
    const watcher = watch(vi.fn());
    watcher.stop();
    await expect(watcher.check()).resolves.toBe(false);
  });
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run packages/app-lifecycle/__tests__/new-version.test.ts`
Expected: FAIL, `watcher.stop is not a function` ou equivalente.

- [ ] **Step 3: Implementar**

Substitua a função e o tipo em `packages/app-lifecycle/src/new-version.ts` (mantenha `extractBuildFingerprint` e o cabeçalho como estão):

```ts
export interface WatchForNewVersionOptions {
  /** Document to poll. Defaults to the URL this tab was served from. */
  documentUrl?: string;
  intervalMs?: number;
  /** Fired once, when the deployed assets stop matching the ones this tab loaded. */
  onNewVersion: () => void;
}

export interface NewVersionWatcher {
  /** Stop polling and drop the listeners. */
  stop: () => void;
  /**
   * Check now, even with the tab hidden (the interval keeps its hidden gate). Resolves true
   * when the server answered with a comparable document, false on a failure, a document
   * without hashed assets, or once stopped.
   */
  check: () => Promise<boolean>;
}

/**
 * Poll for a new deploy.
 *
 * The first successful poll sets the baseline rather than the current DOM: Vite
 * appends `<link rel="modulepreload">` tags for lazily loaded chunks at runtime, so
 * the live document drifts from the one that was served and would false-positive.
 */
export function watchForNewVersion({
  documentUrl,
  intervalMs = DEFAULT_INTERVAL_MS,
  onNewVersion,
}: WatchForNewVersionOptions): NewVersionWatcher {
  const url = documentUrl ?? window.location.href;
  let baseline: string | null = null;
  let inFlight: Promise<boolean> | null = null;
  let stopped = false;

  // `timer` is initialised below, after the functions that close over it. Nothing
  // can call stop() before then: the first caller is the interval itself.
  function stop() {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    document.removeEventListener('visibilitychange', onVisible);
  }

  async function fetchAndCompare(): Promise<boolean> {
    try {
      const response = await fetch(url, { cache: 'no-store', headers: { Accept: 'text/html' } });
      if (!response.ok) return false;
      const fingerprint = extractBuildFingerprint(await response.text());
      if (fingerprint === null || stopped) return false;
      if (baseline === null) {
        baseline = fingerprint;
        return true;
      }
      if (fingerprint !== baseline) {
        stop();
        onNewVersion();
      }
      return true;
    } catch {
      // Offline or a transient failure. The next tick tries again.
      return false;
    }
  }

  function check(force: boolean): Promise<boolean> {
    if (stopped) return Promise.resolve(false);
    if (inFlight) return inFlight;
    if (!force && document.visibilityState === 'hidden') return Promise.resolve(false);
    inFlight = fetchAndCompare().finally(() => {
      inFlight = null;
    });
    return inFlight;
  }

  function onVisible() {
    if (document.visibilityState === 'visible') void check(false);
  }

  document.addEventListener('visibilitychange', onVisible);
  const timer = setInterval(() => void check(false), intervalMs);
  void check(false);

  return { stop, check: () => check(true) };
}
```

Em `packages/app-lifecycle/src/deploy-recovery.ts`, troque `const RELOAD_STAMP_KEY = 'mesaas:deploy-reload-at';` por `export const RELOAD_STAMP_KEY = 'mesaas:deploy-reload-at';`. Em `index.ts`, acrescente `NewVersionWatcher` ao `export type { ... } from './src/new-version'` e `RELOAD_STAMP_KEY` ao export de `./src/deploy-recovery`.

- [ ] **Step 4: Adaptar o banner do Hub (temporário)**

Em `apps/hub/src/components/NewVersionBanner.tsx`, troque o efeito por:

```ts
  useEffect(() => {
    const watcher = watchForNewVersion({ onNewVersion: () => setVisible(true) });
    return watcher.stop;
  }, []);
```

Em `apps/hub/src/components/__tests__/NewVersionBanner.test.tsx`, no `vi.mock`, troque `return stop;` por `return { stop, check: () => Promise.resolve(true) };`.

- [ ] **Step 5: Rodar e ver passar**

Run: `npx vitest run packages/app-lifecycle apps/hub/src/components/__tests__/NewVersionBanner.test.tsx && npx tsc -p apps/hub/tsconfig.json --noEmit && npx tsc -p apps/crm/tsconfig.json --noEmit && npx tsc -p apps/admin/tsconfig.json --noEmit`
Expected: tudo verde. CRM e Admin ignoram o retorno de `watchForNewVersion`, então não mudam.

- [ ] **Step 6: Commit**

```bash
npm run format >/dev/null
git add packages/app-lifecycle apps/hub/src/components/NewVersionBanner.tsx apps/hub/src/components/__tests__/NewVersionBanner.test.tsx
git commit -m "feat(app-lifecycle): watchForNewVersion devolve { stop, check } com checagem sob demanda

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: `installSilentUpdate`

**Files:**
- Create: `packages/app-lifecycle/src/silent-update.ts`
- Modify: `packages/app-lifecycle/index.ts`
- Test: `packages/app-lifecycle/__tests__/silent-update.test.ts`

**Interfaces:**
- Consumes: `watchForNewVersion` (Task 6), `hasUnsavedWork`, `isDocumentBusy` (Task 1), `RELOAD_STAMP_KEY` (Task 6).
- Produces: `installSilentUpdate(options: InstallSilentUpdateOptions): () => void` e os tipos `SilentUpdateRouter`, `SilentUpdateLocation`, `SilentUpdateBlockerArgs`, `SilentUpdateBlocker`, `SilentUpdateRouterState`. O router do React Router 7 (`createBrowserRouter`) satisfaz `SilentUpdateRouter` sem cast.

- [ ] **Step 1: Escrever os testes que falham**

```ts
// packages/app-lifecycle/__tests__/silent-update.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { installSilentUpdate } from '../src/silent-update';
import type {
  SilentUpdateBlockerArgs,
  SilentUpdateLocation,
  SilentUpdateRouter,
  SilentUpdateRouterState,
} from '../src/silent-update';
import { holdUnsavedWork, resetUnsavedWorkForTests } from '../src/unsaved-work';

const HTML = (hash: string) =>
  `<!DOCTYPE html><html><head><link rel="stylesheet" href="/assets/index-${hash}.css" /></head>
   <body><script type="module" src="/assets/index-${hash}.js"></script></body></html>`;

const DASHBOARD: SilentUpdateLocation = { pathname: '/dashboard', search: '', hash: '' };

class FakeRouter implements SilentUpdateRouter {
  blockerFn: ((args: SilentUpdateBlockerArgs) => boolean) | null = null;
  subscribers = new Set<(state: SilentUpdateRouterState) => void>();
  state: SilentUpdateRouterState = { blockers: new Map() };
  proceed = vi.fn();

  getBlocker(_key: string, fn: (args: SilentUpdateBlockerArgs) => boolean) {
    this.blockerFn = fn;
    return {};
  }

  deleteBlocker() {
    this.blockerFn = null;
  }

  subscribe(fn: (state: SilentUpdateRouterState) => void) {
    this.subscribers.add(fn);
    return () => {
      this.subscribers.delete(fn);
    };
  }

  /** What the data router does on navigate(): ask the blocker; when it blocks, publish the state. */
  navigate(
    next: Partial<SilentUpdateLocation> & { pathname: string },
    historyAction = 'PUSH',
    current = DASHBOARD,
  ): boolean {
    const nextLocation = { search: '', hash: '', ...next };
    const blocked =
      this.blockerFn?.({ currentLocation: current, nextLocation, historyAction }) ?? false;
    if (blocked) {
      this.state.blockers.set('silent-update', {
        state: 'blocked',
        location: nextLocation,
        proceed: this.proceed,
      });
    }
    for (const subscriber of this.subscribers) subscriber(this.state);
    return blocked;
  }
}

const reload = vi.fn();
const assign = vi.fn();
let visibility: 'visible' | 'hidden' = 'visible';
let online = true;
const uninstalls: Array<() => void> = [];

function mockFetch(responses: Array<string | Error>) {
  let call = 0;
  return vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
    const next = responses[Math.min(call++, responses.length - 1)];
    if (next instanceof Error) return Promise.reject(next);
    return Promise.resolve(new Response(next, { status: 200 }));
  });
}

function install(router: FakeRouter, overrides: Partial<Parameters<typeof installSilentUpdate>[0]> = {}) {
  const uninstall = installSilentUpdate({
    router,
    documentUrl: '/app.html',
    intervalMs: 1_000,
    hiddenAfterMs: 5_000,
    idleAfterMs: 10_000,
    swapWatchdogMs: 2_000,
    ...overrides,
  });
  uninstalls.push(uninstall);
  return uninstall;
}

/** Baseline at t=0, new hashes at the first interval tick. */
async function reachPending(router: FakeRouter) {
  mockFetch([HTML('aaa'), HTML('bbb')]);
  install(router);
  await vi.advanceTimersByTimeAsync(1_500);
}

beforeEach(() => {
  vi.useFakeTimers();
  resetUnsavedWorkForTests();
  document.body.innerHTML = '';
  reload.mockClear();
  assign.mockClear();
  visibility = 'visible';
  online = true;
  window.sessionStorage.clear();
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...window.location, reload, assign },
  });
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online });
});

afterEach(() => {
  uninstalls.splice(0).forEach((uninstall) => uninstall());
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete (document as unknown as { visibilityState?: string }).visibilityState;
  delete (navigator as unknown as { onLine?: boolean }).onLine;
});

function setVisibility(state: 'visible' | 'hidden') {
  visibility = state;
  document.dispatchEvent(new Event('visibilitychange'));
}

describe('installSilentUpdate: navigation', () => {
  it('lets navigation through before a new version is seen', async () => {
    const router = new FakeRouter();
    mockFetch([HTML('aaa')]);
    install(router);
    await vi.advanceTimersByTimeAsync(2_500);

    expect(router.navigate({ pathname: '/clientes' })).toBe(false);
    expect(assign).not.toHaveBeenCalled();
  });

  it('turns a PUSH to a new pathname into a full navigation, keeping search and hash', async () => {
    const router = new FakeRouter();
    await reachPending(router);

    expect(router.navigate({ pathname: '/clientes', search: '?novo=1', hash: '#top' })).toBe(true);
    expect(assign).toHaveBeenCalledWith('/clientes?novo=1#top');
    expect(window.sessionStorage.getItem('mesaas:deploy-reload-at')).not.toBeNull();
  });

  it('lets a PUSH on the same pathname, a REPLACE and a POP through', async () => {
    const router = new FakeRouter();
    await reachPending(router);

    expect(router.navigate({ pathname: '/dashboard', search: '?tab=2' })).toBe(false);
    expect(router.navigate({ pathname: '/clientes' }, 'REPLACE')).toBe(false);
    expect(router.navigate({ pathname: '/clientes' }, 'POP')).toBe(false);
    expect(assign).not.toHaveBeenCalled();
  });

  it('does not swap while offline', async () => {
    const router = new FakeRouter();
    await reachPending(router);
    online = false;

    expect(router.navigate({ pathname: '/clientes' })).toBe(false);
    expect(assign).not.toHaveBeenCalled();
  });

  it('does not swap while unsaved work is held, and does once released', async () => {
    const router = new FakeRouter();
    await reachPending(router);
    const release = holdUnsavedWork();

    expect(router.navigate({ pathname: '/clientes' })).toBe(false);
    release();
    expect(router.navigate({ pathname: '/clientes' })).toBe(true);
  });

  it('swaps even when the document looks busy (navigation already discards that today)', async () => {
    const router = new FakeRouter();
    await reachPending(router);
    document.body.innerHTML = '<textarea>rascunho</textarea>';

    expect(router.navigate({ pathname: '/clientes' })).toBe(true);
  });

  it('hands the navigation back to the router when the page survives the watchdog, then never swaps again', async () => {
    const router = new FakeRouter();
    await reachPending(router);

    router.navigate({ pathname: '/clientes' });
    expect(assign).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(router.proceed).toHaveBeenCalledTimes(1);

    router.state.blockers.clear();
    expect(router.navigate({ pathname: '/equipe' })).toBe(false);
    expect(assign).toHaveBeenCalledTimes(1);
  });
});

describe('installSilentUpdate: hidden tab', () => {
  it('checks the server after hiddenAfterMs and reloads when a new version landed', async () => {
    const router = new FakeRouter();
    // Baseline at install; the deploy is only visible to the forced check while hidden.
    mockFetch([HTML('aaa'), HTML('bbb')]);
    install(router, { intervalMs: 60_000 });
    await vi.advanceTimersByTimeAsync(0);

    setVisibility('hidden');
    await vi.advanceTimersByTimeAsync(4_999);
    expect(reload).not.toHaveBeenCalled();
    // The timer fires at 5 s; the extra ticks flush the check() and the reload that follow it.
    await vi.advanceTimersByTimeAsync(50);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('disarms when the tab becomes visible again', async () => {
    const router = new FakeRouter();
    mockFetch([HTML('aaa'), HTML('bbb')]);
    // Becoming visible re-polls (and finds the deploy); a long idleAfterMs keeps the idle
    // trigger out of this test.
    install(router, { intervalMs: 60_000, idleAfterMs: 60_000 });
    await vi.advanceTimersByTimeAsync(0);

    setVisibility('hidden');
    await vi.advanceTimersByTimeAsync(3_000);
    setVisibility('visible');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(reload).not.toHaveBeenCalled();
  });

  it('does not reload a busy document', async () => {
    const router = new FakeRouter();
    mockFetch([HTML('aaa'), HTML('bbb')]);
    install(router, { intervalMs: 60_000 });
    await vi.advanceTimersByTimeAsync(0);
    document.body.innerHTML = '<div role="dialog">Novo post</div>';

    setVisibility('hidden');
    await vi.advanceTimersByTimeAsync(5_001);
    expect(reload).not.toHaveBeenCalled();
  });

  it('does not reload when the server does not answer', async () => {
    const router = new FakeRouter();
    await reachPending(router);
    vi.mocked(fetch).mockRejectedValue(new Error('offline'));

    setVisibility('hidden');
    await vi.advanceTimersByTimeAsync(5_001);
    expect(reload).not.toHaveBeenCalled();
  });
});

describe('installSilentUpdate: idle', () => {
  it('reloads after idleAfterMs without input, once the server answers', async () => {
    const router = new FakeRouter();
    await reachPending(router);

    await vi.advanceTimersByTimeAsync(10_500);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('input restarts the idle countdown', async () => {
    const router = new FakeRouter();
    await reachPending(router);

    await vi.advanceTimersByTimeAsync(8_000);
    window.dispatchEvent(new Event('keydown'));
    await vi.advanceTimersByTimeAsync(5_000);
    expect(reload).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(6_000);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('does not count while the tab is hidden', async () => {
    const router = new FakeRouter();
    await reachPending(router);
    visibility = 'hidden';

    await vi.advanceTimersByTimeAsync(12_000);
    expect(reload).not.toHaveBeenCalled();
  });

  it('does not reload while unsaved work is held or the document is busy', async () => {
    const router = new FakeRouter();
    await reachPending(router);
    const release = holdUnsavedWork();
    await vi.advanceTimersByTimeAsync(10_500);
    expect(reload).not.toHaveBeenCalled();
    release();

    document.body.innerHTML = '<div contenteditable="true">Legenda</div>';
    await vi.advanceTimersByTimeAsync(10_500);
    expect(reload).not.toHaveBeenCalled();
  });

  it('does not reload when the server does not answer', async () => {
    const router = new FakeRouter();
    await reachPending(router);
    vi.mocked(fetch).mockRejectedValue(new Error('offline'));

    await vi.advanceTimersByTimeAsync(10_500);
    expect(reload).not.toHaveBeenCalled();
  });
});

describe('installSilentUpdate: uninstall', () => {
  it('removes the blocker, the listeners and the timers', async () => {
    const router = new FakeRouter();
    await reachPending(router);
    const uninstall = uninstalls.pop()!;
    uninstall();

    expect(router.blockerFn).toBeNull();
    expect(router.subscribers.size).toBe(0);
    setVisibility('hidden');
    await vi.advanceTimersByTimeAsync(20_000);
    expect(reload).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run packages/app-lifecycle/__tests__/silent-update.test.ts`
Expected: FAIL, import de `../src/silent-update` não resolve.

- [ ] **Step 3: Implementar**

```ts
// packages/app-lifecycle/src/silent-update.ts
/**
 * Silent version swap for a tab that outlives a deploy.
 *
 * `watchForNewVersion` notices the deploy. From then on the tab is "pending" and moves to
 * the new build at the first moment the user would not notice:
 *
 * - the next client-side navigation to another pathname becomes a full document
 *   navigation to the same destination (a PUSH only; REPLACE and same-path PUSHes are
 *   query housekeeping that carries in-memory state the URL does not);
 * - the tab has been hidden for `hiddenAfterMs`;
 * - the tab is visible but has had no input for `idleAfterMs`.
 *
 * Every trigger defers to the unsaved-work registry. The two passive ones also defer to the
 * DOM heuristic (`isDocumentBusy`) and only reload after the server answered, since nobody
 * is there to notice a network error page.
 */

import { RELOAD_STAMP_KEY } from './deploy-recovery';
import { watchForNewVersion } from './new-version';
import { hasUnsavedWork, isDocumentBusy } from './unsaved-work';

const BLOCKER_KEY = 'silent-update';
const DEFAULT_HIDDEN_AFTER_MS = 5 * 60_000;
const DEFAULT_IDLE_AFTER_MS = 10 * 60_000;
/** A full navigation that has not unloaded the page by then is treated as failed. */
const DEFAULT_SWAP_WATCHDOG_MS = 8_000;
const IDLE_TICK_MS = 30_000;
const INPUT_EVENTS = ['pointerdown', 'keydown', 'wheel', 'scroll', 'touchstart'] as const;

export interface SilentUpdateLocation {
  pathname: string;
  search: string;
  hash: string;
}

export interface SilentUpdateBlockerArgs {
  currentLocation: SilentUpdateLocation;
  nextLocation: SilentUpdateLocation;
  /** 'PUSH' | 'REPLACE' | 'POP'. Typed as string so React Router's enum is assignable. */
  historyAction: string;
}

export interface SilentUpdateBlocker {
  state: string;
  location?: SilentUpdateLocation;
  proceed?: () => void;
}

export interface SilentUpdateRouterState {
  blockers: Map<string, SilentUpdateBlocker>;
}

/** The slice of a React Router data router this module needs. `createBrowserRouter` satisfies it. */
export interface SilentUpdateRouter {
  getBlocker(key: string, fn: (args: SilentUpdateBlockerArgs) => boolean): unknown;
  deleteBlocker(key: string): void;
  subscribe(fn: (state: SilentUpdateRouterState) => void): () => void;
}

export interface InstallSilentUpdateOptions {
  router: SilentUpdateRouter;
  /** Hidden for this long, and the tab reloads in the background. Default 5 min. */
  hiddenAfterMs?: number;
  /** Visible with no input for this long, and the tab reloads. Default 10 min. */
  idleAfterMs?: number;
  /** Page still alive this long after `location.assign`, and the swap is given up. Default 8 s. */
  swapWatchdogMs?: number;
  /** Passed to `watchForNewVersion`. */
  documentUrl?: string;
  intervalMs?: number;
}

function stampReload(): void {
  try {
    window.sessionStorage.setItem(RELOAD_STAMP_KEY, String(Date.now()));
  } catch {
    // No storage (private mode). The trigger is a verified fingerprint change, not an
    // error, so there is no loop to guard against: reload anyway.
  }
}

async function serverAnswers(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { cache: 'no-store', headers: { Accept: 'text/html' } });
    return response.ok;
  } catch {
    return false;
  }
}

/** Wire the silent swap. Returns the uninstall function. */
export function installSilentUpdate(options: InstallSilentUpdateOptions): () => void {
  const {
    router,
    hiddenAfterMs = DEFAULT_HIDDEN_AFTER_MS,
    idleAfterMs = DEFAULT_IDLE_AFTER_MS,
    swapWatchdogMs = DEFAULT_SWAP_WATCHDOG_MS,
  } = options;
  const documentUrl = options.documentUrl ?? window.location.href;

  let pending = false;
  let reloading = false;
  // One full-navigation attempt per tab: a failed one must not repeat on every click.
  let navigationSwapEnabled = true;
  let lastInputAt = Date.now();
  let hiddenTimer: ReturnType<typeof setTimeout> | null = null;
  let watchdog: ReturnType<typeof setTimeout> | null = null;

  const watcher = watchForNewVersion({
    documentUrl,
    intervalMs: options.intervalMs,
    onNewVersion: () => {
      pending = true;
    },
  });

  function reloadNow(): void {
    reloading = true;
    stampReload();
    window.location.reload();
  }

  /** Passive reload: registry, DOM heuristic, then a live answer from the server. */
  async function reloadIfQuiet(alreadyAnswered = false): Promise<void> {
    if (!pending || reloading || hasUnsavedWork() || isDocumentBusy()) return;
    if (!alreadyAnswered && !(await serverAnswers(documentUrl))) return;
    if (!pending || reloading || hasUnsavedWork() || isDocumentBusy()) return;
    reloadNow();
  }

  // Navigation. React Router consults only the most recently registered blocker; nothing
  // else registers one today (see apps/crm/src/main.tsx).
  router.getBlocker(
    BLOCKER_KEY,
    ({ currentLocation, nextLocation, historyAction }) =>
      pending &&
      navigationSwapEnabled &&
      !reloading &&
      navigator.onLine !== false &&
      historyAction === 'PUSH' &&
      nextLocation.pathname !== currentLocation.pathname &&
      !hasUnsavedWork(),
  );
  const unsubscribe = router.subscribe((state) => {
    const blocker = state.blockers.get(BLOCKER_KEY);
    if (!blocker || blocker.state !== 'blocked' || !blocker.location || reloading) return;
    reloading = true;
    navigationSwapEnabled = false;
    const { pathname, search, hash } = blocker.location;
    stampReload();
    watchdog = setTimeout(() => {
      // Still here: the document request did not replace this page. Let the navigation the
      // user asked for go on client-side; the passive triggers keep the swap alive.
      watchdog = null;
      reloading = false;
      blocker.proceed?.();
    }, swapWatchdogMs);
    window.location.assign(pathname + search + hash);
  });

  // Hidden tab.
  function onVisibilityChange(): void {
    if (document.visibilityState === 'hidden') {
      if (hiddenTimer !== null) clearTimeout(hiddenTimer);
      hiddenTimer = setTimeout(() => {
        hiddenTimer = null;
        void (async () => {
          if (document.visibilityState !== 'hidden') return;
          // The interval pauses while hidden, so ask now; a comparison doubles as proof
          // that the server answers.
          const answered = await watcher.check();
          if (document.visibilityState !== 'hidden') return;
          await reloadIfQuiet(answered);
        })();
      }, hiddenAfterMs);
    } else if (hiddenTimer !== null) {
      clearTimeout(hiddenTimer);
      hiddenTimer = null;
    }
  }
  document.addEventListener('visibilitychange', onVisibilityChange);

  // Idle. Capture phase so `scroll` on any element counts; `scroll` does not bubble.
  function onInput(): void {
    lastInputAt = Date.now();
  }
  for (const type of INPUT_EVENTS) {
    window.addEventListener(type, onInput, { passive: true, capture: true });
  }
  // Tick at most every 30 s; a shorter idleAfterMs (tests) ticks at that period instead.
  const idleTimer = setInterval(
    () => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - lastInputAt < idleAfterMs) return;
      void reloadIfQuiet();
    },
    Math.min(IDLE_TICK_MS, idleAfterMs),
  );

  return function uninstall() {
    watcher.stop();
    unsubscribe();
    router.deleteBlocker(BLOCKER_KEY);
    document.removeEventListener('visibilitychange', onVisibilityChange);
    for (const type of INPUT_EVENTS) {
      window.removeEventListener(type, onInput, { capture: true });
    }
    clearInterval(idleTimer);
    if (hiddenTimer !== null) clearTimeout(hiddenTimer);
    if (watchdog !== null) clearTimeout(watchdog);
  };
}
```

Em `packages/app-lifecycle/index.ts`, acrescente:

```ts
export { installSilentUpdate } from './src/silent-update';
export type {
  InstallSilentUpdateOptions,
  SilentUpdateBlocker,
  SilentUpdateBlockerArgs,
  SilentUpdateLocation,
  SilentUpdateRouter,
  SilentUpdateRouterState,
} from './src/silent-update';
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run packages/app-lifecycle/__tests__/silent-update.test.ts`
Expected: PASS, 17 testes. O tick de inatividade é `min(30 s, idleAfterMs)`, então com `idleAfterMs: 10_000` os testes veem um tick a cada 10 s contados do install.

- [ ] **Step 5: Commit**

```bash
npm run format >/dev/null
git add packages/app-lifecycle/src/silent-update.ts packages/app-lifecycle/index.ts packages/app-lifecycle/__tests__/silent-update.test.ts
git commit -m "feat(app-lifecycle): installSilentUpdate com troca na navegação, aba oculta e inatividade

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: ligar no CRM e no Admin, remover os toasts

**Files:**
- Modify: `apps/crm/src/main.tsx`
- Modify: `apps/admin/src/main.tsx`
- Delete: `apps/crm/src/lib/new-version-toast.ts`, `apps/admin/src/lib/new-version-toast.ts`

**Interfaces:**
- Consumes: `installSilentUpdate` (Task 7).

- [ ] **Step 1: CRM**

Em `apps/crm/src/main.tsx`:

1. Troque `import { installDeployRecovery, watchForNewVersion } from '@mesaas/app-lifecycle';` por `import { installDeployRecovery, installSilentUpdate } from '@mesaas/app-lifecycle';`.
2. Remova `import { showNewVersionToast } from './lib/new-version-toast';`.
3. Remova a linha `watchForNewVersion({ onNewVersion: showNewVersionToast });`.
4. Troque o bloco do router (comentário e criação) por:

```tsx
// Minimal DATA router (single splat route; App keeps its own descendant <Routes>). It was
// introduced because `useBlocker` needs data-router context, for the Estúdio autosave's
// dirty-navigation blocker. Estúdio is retired; today the data router is what lets
// `installSilentUpdate` register its navigation blocker. Route matching/links are unchanged:
// every internal link navigates by absolute path.
const router = createBrowserRouter([{ path: '*', element: <App /> }]);

// A deploy while this tab is open: move to the new build at the next route change, or once
// the tab has been hidden or idle for a while, never over unsaved work.
installSilentUpdate({ router });
```

- [ ] **Step 2: Admin**

Em `apps/admin/src/main.tsx`:

1. Troque `import { installDeployRecovery, watchForNewVersion } from '@mesaas/app-lifecycle';` por `import { installDeployRecovery, installSilentUpdate } from '@mesaas/app-lifecycle';`.
2. Remova `import { showNewVersionToast } from './lib/new-version-toast';`.
3. Troque `watchForNewVersion({ onNewVersion: showNewVersionToast });` por:

```ts
// A deploy while this tab is open: move to the new build at the next route change, or once
// the tab has been hidden or idle for a while, never over unsaved work.
installSilentUpdate({ router });
```

- [ ] **Step 3: Apagar os toasts**

```bash
git rm apps/crm/src/lib/new-version-toast.ts apps/admin/src/lib/new-version-toast.ts
grep -rn "new-version-toast\|showNewVersionToast" apps/ && echo "AINDA REFERENCIADO" || echo "limpo"
```

Expected: `limpo`.

- [ ] **Step 4: Typecheck**

Run: `npx tsc -p apps/crm/tsconfig.json --noEmit && npx tsc -p apps/admin/tsconfig.json --noEmit`
Expected: sem erro. Se `installSilentUpdate({ router })` reclamar do tipo do router, o problema está em `SilentUpdateRouter` (Task 7) e não aqui: `historyAction` precisa ser `string` e `getBlocker` precisa devolver `unknown`.

- [ ] **Step 5: Commit**

```bash
npm run format >/dev/null
git add apps/crm/src/main.tsx apps/admin/src/main.tsx
git commit -m "feat(crm,admin): troca silenciosa de versão no lugar do toast

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: ligar no Hub, remover o banner e as chaves i18n

**Files:**
- Modify: `apps/hub/src/main.tsx`
- Delete: `apps/hub/src/components/NewVersionBanner.tsx`, `apps/hub/src/components/__tests__/NewVersionBanner.test.tsx`
- Modify: `packages/i18n/locales/pt/common.json` (linhas 134 e 135), `packages/i18n/locales/en/common.json` (linhas 134 e 135)

**Interfaces:**
- Consumes: `installSilentUpdate` (Task 7).

- [ ] **Step 1: Hub `main.tsx`**

1. Troque `import { installDeployRecovery } from '@mesaas/app-lifecycle';` por `import { installDeployRecovery, installSilentUpdate } from '@mesaas/app-lifecycle';`.
2. Remova `import { NewVersionBanner } from './components/NewVersionBanner';` e a linha `<NewVersionBanner />` do JSX.
3. Após `installDeployRecovery();` e o `initI18n({...})`, antes de `const queryClient = new QueryClient();`, acrescente:

```ts
// A deploy while this tab is open: move to the new build at the next route change, or once
// the tab has been hidden or idle for a while, never over unsaved work.
installSilentUpdate({ router });
```

- [ ] **Step 2: Apagar o banner e as chaves**

```bash
git rm apps/hub/src/components/NewVersionBanner.tsx apps/hub/src/components/__tests__/NewVersionBanner.test.tsx
```

Em `packages/i18n/locales/pt/common.json`, remova as duas linhas:

```json
    "newVersion": "Nova versão disponível",
    "refresh": "Atualizar",
```

Em `packages/i18n/locales/en/common.json`, remova:

```json
    "newVersion": "New version available",
    "refresh": "Refresh",
```

A linha anterior (`"contactAgency"`) já termina com vírgula e a seguinte (`"somethingWentWrong"`) continua, então o JSON segue válido.

```bash
node -e "require('./packages/i18n/locales/pt/common.json'); require('./packages/i18n/locales/en/common.json'); console.log('json ok')"
grep -rn "hub.newVersion\|hub.refresh\|NewVersionBanner" apps/ packages/ && echo "AINDA REFERENCIADO" || echo "limpo"
```

Expected: `json ok` e `limpo`.

- [ ] **Step 3: Typecheck e suíte**

Run: `npx tsc -p apps/hub/tsconfig.json --noEmit && npm run test`
Expected: sem erro; suíte inteira verde.

- [ ] **Step 4: Commit**

```bash
npm run format >/dev/null
git add apps/hub/src/main.tsx packages/i18n/locales/pt/common.json packages/i18n/locales/en/common.json
git commit -m "feat(hub): troca silenciosa de versão no lugar do banner

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: `prefetchBuildAssets`

**Files:**
- Create: `packages/app-lifecycle/src/prefetch-build.ts`
- Modify: `packages/app-lifecycle/index.ts`
- Test: `packages/app-lifecycle/__tests__/prefetch-build.test.ts`

**Interfaces:**
- Produces: `prefetchBuildAssets(options: PrefetchBuildOptions): () => void` com `PrefetchBuildOptions = { manifestUrl: string; concurrency?: number; fetchFn?: (input: string, init?: RequestInit) => Promise<Response> }`. Devolve a função de cancelamento.

- [ ] **Step 1: Escrever os testes que falham**

```ts
// packages/app-lifecycle/__tests__/prefetch-build.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { prefetchBuildAssets } from '../src/prefetch-build';

type Manifest = Record<string, { file: string; css?: string[]; isEntry?: boolean }>;

const MANIFEST: Manifest = {
  'index.html': { file: 'assets/index-abc.js', css: ['assets/index-abc.css'], isEntry: true },
  'src/pages/EntregasPage.tsx': { file: 'assets/EntregasPage-def.js', css: ['assets/EntregasPage-def.css'] },
  'src/pages/ClientesPage.tsx': { file: 'assets/ClientesPage-ghi.js' },
};

function setDocument(base: '/' | '/admin/', entryHash = 'abc') {
  document.head.innerHTML = `<link rel="stylesheet" href="${base}assets/index-${entryHash}.css" />`;
  document.body.innerHTML = `<script type="module" src="${base}assets/index-${entryHash}.js"></script>`;
}

/** fetchFn that records URLs and resolves immediately, unless `pending` holds a URL back. */
function makeFetch(manifest: Manifest = MANIFEST, failing: string[] = []) {
  const calls: string[] = [];
  const fetchFn = vi.fn(async (input: string) => {
    calls.push(input);
    if (input.endsWith('build-manifest.json')) return new Response(JSON.stringify(manifest));
    if (failing.includes(input)) throw new Error('404');
    return new Response('');
  });
  return { fetchFn, calls };
}

function setConnection(value: { saveData?: boolean; effectiveType?: string } | undefined) {
  Object.defineProperty(navigator, 'connection', { configurable: true, value });
}

const cancels: Array<() => void> = [];

function run(options: Parameters<typeof prefetchBuildAssets>[0]) {
  const cancel = prefetchBuildAssets(options);
  cancels.push(cancel);
  return cancel;
}

beforeEach(() => {
  vi.useFakeTimers();
  setDocument('/');
});

afterEach(() => {
  cancels.splice(0).forEach((cancel) => cancel());
  vi.useRealTimers();
  delete (navigator as unknown as { connection?: unknown }).connection;
});

describe('prefetchBuildAssets', () => {
  it('resolves manifest files against the manifest URL and skips what the document already loads', async () => {
    const { fetchFn, calls } = makeFetch();
    run({ manifestUrl: '/build-manifest.json', fetchFn });
    await vi.advanceTimersByTimeAsync(2_000);

    expect(calls).toEqual([
      '/build-manifest.json',
      '/assets/EntregasPage-def.js',
      '/assets/EntregasPage-def.css',
      '/assets/ClientesPage-ghi.js',
    ]);
    expect((fetchFn.mock.calls[1] as unknown[])[1]).toMatchObject({ priority: 'low' });
  });

  it('honours a base path such as /admin/', async () => {
    setDocument('/admin/');
    const { fetchFn, calls } = makeFetch();
    run({ manifestUrl: '/admin/build-manifest.json', fetchFn });
    await vi.advanceTimersByTimeAsync(2_000);

    expect(calls).toEqual([
      '/admin/build-manifest.json',
      '/admin/assets/EntregasPage-def.js',
      '/admin/assets/EntregasPage-def.css',
      '/admin/assets/ClientesPage-ghi.js',
    ]);
  });

  it('aborts when the manifest entry is not the script the document loaded', async () => {
    setDocument('/', 'zzz');
    const { fetchFn, calls } = makeFetch();
    run({ manifestUrl: '/build-manifest.json', fetchFn });
    await vi.advanceTimersByTimeAsync(2_000);

    expect(calls).toEqual(['/build-manifest.json']);
  });

  it('does nothing on a data-saver or slow connection', async () => {
    setConnection({ saveData: true });
    const saver = makeFetch();
    run({ manifestUrl: '/build-manifest.json', fetchFn: saver.fetchFn });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(saver.calls).toEqual([]);

    setConnection({ effectiveType: '2g' });
    const slow = makeFetch();
    run({ manifestUrl: '/build-manifest.json', fetchFn: slow.fetchFn });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(slow.calls).toEqual([]);
  });

  it('keeps at most `concurrency` requests in flight', async () => {
    let inFlight = 0;
    let peak = 0;
    const resolvers: Array<() => void> = [];
    const fetchFn = vi.fn(async (input: string) => {
      if (input.endsWith('build-manifest.json')) return new Response(JSON.stringify(MANIFEST));
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise<void>((resolve) => resolvers.push(resolve));
      inFlight -= 1;
      return new Response('');
    });
    run({ manifestUrl: '/build-manifest.json', fetchFn, concurrency: 2 });
    await vi.advanceTimersByTimeAsync(2_000);

    expect(peak).toBe(2);
    resolvers.splice(0).forEach((resolve) => resolve());
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchFn).toHaveBeenCalledTimes(4);
  });

  it('keeps going when one file fails', async () => {
    const { fetchFn, calls } = makeFetch(MANIFEST, ['/assets/EntregasPage-def.js']);
    run({ manifestUrl: '/build-manifest.json', fetchFn });
    await vi.advanceTimersByTimeAsync(2_000);

    expect(calls).toContain('/assets/ClientesPage-ghi.js');
  });

  it('gives up silently when the manifest cannot be read', async () => {
    const fetchFn = vi.fn(async () => new Response('not json', { status: 500 }));
    run({ manifestUrl: '/build-manifest.json', fetchFn });
    await vi.advanceTimersByTimeAsync(2_000);

    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('does nothing once cancelled', async () => {
    const { fetchFn } = makeFetch();
    const cancel = run({ manifestUrl: '/build-manifest.json', fetchFn });
    cancel();
    await vi.advanceTimersByTimeAsync(2_000);

    expect(fetchFn).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run packages/app-lifecycle/__tests__/prefetch-build.test.ts`
Expected: FAIL, import de `../src/prefetch-build` não resolve.

- [ ] **Step 3: Implementar**

```ts
// packages/app-lifecycle/src/prefetch-build.ts
/**
 * Warm the HTTP cache with every chunk of the running build.
 *
 * Assets under `/assets/` are content-hashed and served `immutable`, so once a chunk is in
 * the cache a tab keeps finding it there after the next deploy stops serving that build.
 * The list comes from Vite's manifest (`build.manifest: 'build-manifest.json'`), whose
 * `file` paths are relative to the build's outDir and carry no `base`: they are resolved
 * against the manifest URL, which yields `/assets/...` for the CRM and `/admin/assets/...`
 * for the Admin.
 *
 * Runs on idle, only on a decent connection, and only when the manifest describes the build
 * this document loaded (a deploy can land between the two requests).
 */

const DEFAULT_CONCURRENCY = 3;
const IDLE_FALLBACK_MS = 2_000;

interface ManifestChunk {
  file: string;
  css?: string[];
  isEntry?: boolean;
}

type Manifest = Record<string, ManifestChunk>;

interface NetworkInformationLike {
  saveData?: boolean;
  effectiveType?: string;
}

export interface PrefetchBuildOptions {
  /** '/build-manifest.json' for the CRM, '/admin/build-manifest.json' for the Admin. */
  manifestUrl: string;
  concurrency?: number;
  /** Test seam. Defaults to `fetch`. */
  fetchFn?: (input: string, init?: RequestInit) => Promise<Response>;
}

function isConstrainedConnection(): boolean {
  const connection = (navigator as Navigator & { connection?: NetworkInformationLike })
    .connection;
  if (!connection) return false;
  return connection.saveData === true || /^(slow-)?[23]g$/.test(connection.effectiveType ?? '');
}

function documentEntryPath(doc: Document): string | null {
  const script = doc.querySelector<HTMLScriptElement>('script[type="module"][src]');
  return script ? new URL(script.getAttribute('src')!, doc.baseURI).pathname : null;
}

function referencedPaths(doc: Document): Set<string> {
  const paths = new Set<string>();
  for (const el of doc.querySelectorAll('script[src], link[href]')) {
    const raw = el.getAttribute('src') ?? el.getAttribute('href');
    if (raw) paths.add(new URL(raw, doc.baseURI).pathname);
  }
  return paths;
}

function scheduleOnIdle(callback: () => void): void {
  if ('requestIdleCallback' in window) {
    window.requestIdleCallback(() => callback(), { timeout: 5_000 });
  } else {
    setTimeout(callback, IDLE_FALLBACK_MS);
  }
}

/** Start the prefetch on idle. Returns a cancel function. */
export function prefetchBuildAssets(options: PrefetchBuildOptions): () => void {
  const { manifestUrl, concurrency = DEFAULT_CONCURRENCY } = options;
  const fetchFn = options.fetchFn ?? ((input, init) => fetch(input, init));
  const controller = new AbortController();
  const { signal } = controller;

  async function run(): Promise<void> {
    if (signal.aborted || isConstrainedConnection()) return;

    let manifest: Manifest;
    try {
      const response = await fetchFn(manifestUrl, { cache: 'no-store', signal });
      if (!response.ok) return;
      manifest = (await response.json()) as Manifest;
    } catch {
      return;
    }
    if (signal.aborted) return;

    const manifestBase = new URL(manifestUrl, window.location.origin);
    const toPath = (file: string) => new URL(file, manifestBase).pathname;
    const chunks = Object.values(manifest);
    const entry = chunks.find((chunk) => chunk.isEntry);
    if (!entry || documentEntryPath(document) !== toPath(entry.file)) return;

    const loaded = referencedPaths(document);
    const queue: string[] = [];
    const seen = new Set<string>();
    for (const chunk of chunks) {
      for (const file of [chunk.file, ...(chunk.css ?? [])]) {
        const path = toPath(file);
        if (seen.has(path) || loaded.has(path)) continue;
        seen.add(path);
        queue.push(path);
      }
    }

    const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
      while (queue.length > 0 && !signal.aborted) {
        const path = queue.shift()!;
        try {
          await fetchFn(path, { signal, priority: 'low' });
        } catch {
          // One miss does not stop the queue.
        }
      }
    });
    await Promise.all(workers);
  }

  scheduleOnIdle(() => {
    void run();
  });

  return () => controller.abort();
}
```

Em `packages/app-lifecycle/index.ts`, acrescente:

```ts
export { prefetchBuildAssets } from './src/prefetch-build';
export type { PrefetchBuildOptions } from './src/prefetch-build';
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run packages/app-lifecycle/__tests__/prefetch-build.test.ts`
Expected: PASS, 8 testes. Nota: jsdom não tem `requestIdleCallback`, então o fallback de 2 s é o caminho testado; o `advanceTimersByTimeAsync(2_000)` dos testes existe por isso.

- [ ] **Step 5: Commit**

```bash
npm run format >/dev/null
git add packages/app-lifecycle/src/prefetch-build.ts packages/app-lifecycle/index.ts packages/app-lifecycle/__tests__/prefetch-build.test.ts
git commit -m "feat(app-lifecycle): prefetchBuildAssets aquece o cache com os chunks do manifest

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: manifest no build e pré-busca depois do login (CRM e Admin)

**Files:**
- Modify: `apps/crm/vite.config.ts` (bloco `build`)
- Modify: `apps/admin/vite.config.ts` (bloco `build`)
- Create: `apps/crm/src/components/BuildPrefetch.tsx`
- Create: `apps/admin/src/components/BuildPrefetch.tsx`
- Modify: `apps/crm/src/App.tsx` (dentro de `<AuthProvider>`, antes de `<Toaster />`)
- Modify: `apps/admin/src/layouts/AdminLayout.tsx` (primeiro filho do `<div className="flex min-h-screen">`)
- Test: `apps/crm/src/components/__tests__/BuildPrefetch.test.tsx`, `apps/admin/src/components/__tests__/BuildPrefetch.test.tsx`

**Interfaces:**
- Consumes: `prefetchBuildAssets` (Task 10); `useAuth().user` (CRM); `useAdminAuth().isAdmin` (Admin).

- [ ] **Step 1: Escrever os testes que falham**

```tsx
// apps/crm/src/components/__tests__/BuildPrefetch.test.tsx
import { render } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { BuildPrefetch } from '../BuildPrefetch';

const cancel = vi.fn();
const prefetchBuildAssets = vi.fn(() => cancel);
let user: { id: string } | null = null;

vi.mock('@mesaas/app-lifecycle', () => ({
  prefetchBuildAssets: (...args: unknown[]) => prefetchBuildAssets(...args),
}));
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user }),
}));

beforeEach(() => {
  cancel.mockClear();
  prefetchBuildAssets.mockClear();
  user = null;
});

describe('BuildPrefetch', () => {
  it('does nothing while signed out', () => {
    render(<BuildPrefetch />);
    expect(prefetchBuildAssets).not.toHaveBeenCalled();
  });

  it('prefetches once signed in and cancels on unmount', () => {
    user = { id: 'u1' };
    const { unmount } = render(<BuildPrefetch />);
    expect(prefetchBuildAssets).toHaveBeenCalledTimes(1);
    expect(prefetchBuildAssets).toHaveBeenCalledWith({ manifestUrl: '/build-manifest.json' });
    unmount();
    expect(cancel).toHaveBeenCalledTimes(1);
  });
});
```

```tsx
// apps/admin/src/components/__tests__/BuildPrefetch.test.tsx
import { render } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { BuildPrefetch } from '../BuildPrefetch';

const cancel = vi.fn();
const prefetchBuildAssets = vi.fn(() => cancel);
let isAdmin = false;

vi.mock('@mesaas/app-lifecycle', () => ({
  prefetchBuildAssets: (...args: unknown[]) => prefetchBuildAssets(...args),
}));
vi.mock('../../context/AdminAuthContext', () => ({
  useAdminAuth: () => ({ isAdmin }),
}));

beforeEach(() => {
  cancel.mockClear();
  prefetchBuildAssets.mockClear();
  isAdmin = false;
});

describe('BuildPrefetch (admin)', () => {
  it('does nothing before the admin check passes', () => {
    render(<BuildPrefetch />);
    expect(prefetchBuildAssets).not.toHaveBeenCalled();
  });

  it('prefetches for a confirmed admin and cancels on unmount', () => {
    isAdmin = true;
    const { unmount } = render(<BuildPrefetch />);
    expect(prefetchBuildAssets).toHaveBeenCalledWith({ manifestUrl: '/admin/build-manifest.json' });
    unmount();
    expect(cancel).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run apps/crm/src/components/__tests__/BuildPrefetch.test.tsx apps/admin/src/components/__tests__/BuildPrefetch.test.tsx`
Expected: FAIL, os componentes não existem.

- [ ] **Step 3: Implementar os componentes**

```tsx
// apps/crm/src/components/BuildPrefetch.tsx
import { useEffect } from 'react';
import { prefetchBuildAssets } from '@mesaas/app-lifecycle';
import { useAuth } from '@/context/AuthContext';

/**
 * Warms the HTTP cache with every chunk of the running build once the user is signed in, so a
 * tab that outlives the next deploy still finds its lazy routes locally. Signed-out visitors
 * (landing, pricing, blog) never pay for it.
 */
export function BuildPrefetch() {
  const { user } = useAuth();
  const signedIn = user !== null;

  useEffect(() => {
    if (!signedIn) return;
    return prefetchBuildAssets({ manifestUrl: '/build-manifest.json' });
  }, [signedIn]);

  return null;
}
```

```tsx
// apps/admin/src/components/BuildPrefetch.tsx
import { useEffect } from 'react';
import { prefetchBuildAssets } from '@mesaas/app-lifecycle';
import { useAdminAuth } from '../context/AdminAuthContext';

/** Same idea as the CRM's BuildPrefetch: warm the cache for a confirmed admin only. */
export function BuildPrefetch() {
  const { isAdmin } = useAdminAuth();

  useEffect(() => {
    if (!isAdmin) return;
    return prefetchBuildAssets({ manifestUrl: '/admin/build-manifest.json' });
  }, [isAdmin]);

  return null;
}
```

- [ ] **Step 4: Montar**

Em `apps/crm/src/App.tsx`, adicione `import { BuildPrefetch } from './components/BuildPrefetch';` e, dentro de `<AuthProvider>`, imediatamente antes de `<Toaster />`, a linha `<BuildPrefetch />`.

Em `apps/admin/src/layouts/AdminLayout.tsx`, adicione `import { BuildPrefetch } from '../components/BuildPrefetch';` e, dentro de `<div className="flex min-h-screen">`, antes de `<LiquidBackdrop />`, a linha `<BuildPrefetch />`.

- [ ] **Step 5: Gerar o manifest no build**

`apps/crm/vite.config.ts`:

```ts
    build: {
      outDir: '../../dist',
      // Read at runtime by prefetchBuildAssets. Outside /assets/ on purpose: it must not be
      // cached as immutable.
      manifest: 'build-manifest.json',
    },
```

`apps/admin/vite.config.ts`:

```ts
  build: {
    outDir: '../../dist/admin',
    manifest: 'build-manifest.json',
  },
```

- [ ] **Step 6: Rodar testes, typecheck e o build real**

Run:

```bash
npx vitest run apps/crm/src/components/__tests__/BuildPrefetch.test.tsx apps/admin/src/components/__tests__/BuildPrefetch.test.tsx
npx tsc -p apps/crm/tsconfig.json --noEmit && npx tsc -p apps/admin/tsconfig.json --noEmit
npm run build >/dev/null && npm run build:admin >/dev/null
node -e "
const fs = require('fs');
for (const [manifestPath, htmlPath, base] of [
  ['dist/build-manifest.json', 'dist/index.html', '/'],
  ['dist/admin/build-manifest.json', 'dist/admin/index.html', '/admin/'],
]) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const entry = Object.values(manifest).find((c) => c.isEntry);
  const html = fs.readFileSync(htmlPath, 'utf8');
  const ok = html.includes('src=\"' + base + entry.file + '\"');
  console.log(manifestPath, Object.keys(manifest).length, 'entries;', ok ? 'entry matches index.html' : 'ENTRY MISMATCH');
  if (!ok) process.exit(1);
}"
```

Expected: testes verdes, sem erro de tipo, e as duas linhas `entry matches index.html`. O número de entradas do CRM fica perto de 220.

- [ ] **Step 7: Commit**

```bash
npm run format >/dev/null
git add apps/crm/vite.config.ts apps/admin/vite.config.ts apps/crm/src/components/BuildPrefetch.tsx apps/admin/src/components/BuildPrefetch.tsx apps/crm/src/App.tsx apps/admin/src/layouts/AdminLayout.tsx apps/crm/src/components/__tests__/BuildPrefetch.test.tsx apps/admin/src/components/__tests__/BuildPrefetch.test.tsx
git commit -m "feat(crm,admin): manifest de build e pré-busca dos chunks depois do login

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 12: gotcha no CLAUDE.md, gates de CI e smoke no browser

**Files:**
- Modify: `CLAUDE.md` (seção `## Gotchas`, ao final da lista)

- [ ] **Step 1: Documentar a regra para editores novos**

Acrescente ao final da lista em `## Gotchas` do `CLAUDE.md`:

```markdown
- Deploys trocam de versão em silêncio (`installSilentUpdate` em `packages/app-lifecycle`). Todo editor fora de modal com conteúdo não persistido ou save em voo chama `useUnsavedWork(condição)`, e toda função de upload envolve a promise em `trackUnsavedWork`. Modais com `confirmClose` já estão cobertos pelo `DialogContent`. Sem isso, um recarregamento em aba oculta ou inativa pode descartar o que o usuário digitou. Spec: `docs/superpowers/specs/2026-09-05-seamless-updates-design.md`
```

- [ ] **Step 2: Rodar os gates que o CI roda**

```bash
ls node_modules/.deno >/dev/null 2>&1 && npm ci
npm run lint
npm run format:check
npx tsc -p apps/crm/tsconfig.json --noEmit
npx tsc -p apps/hub/tsconfig.json --noEmit
npx tsc -p apps/admin/tsconfig.json --noEmit
npx tsc -p tsconfig.scripts.json
npm run test
npm run test:functions
git status --porcelain
```

Expected: tudo verde. `test:functions` suja `deno.lock` na raiz: se `git status` mostrar `deno.lock`, descarte com `git checkout -- deno.lock`.

- [ ] **Step 3: Smoke no browser com deploy simulado**

O dev server não serve `/assets/` com hash, então o detector nunca dispara nele. Use o build de produção servido pelo `vite preview` e simule o deploy com um segundo build.

1. Temporariamente, em `apps/crm/src/main.tsx`, troque `installSilentUpdate({ router });` por `installSilentUpdate({ router, intervalMs: 10_000, hiddenAfterMs: 15_000, idleAfterMs: 20_000 });`. NÃO comite.
2. `npm run build:staging` (usa `.env.staging`; se a worktree não tiver o arquivo, copie do checkout principal) e `npx vite preview --config apps/crm/vite.config.ts --port 4173`.
3. No Browser pane, abra `http://localhost:4173/login`, faça login com a conta seed (memória `reference_seed_login_browser_verification`) e vá para `/dashboard`.
4. Na aba Network, confirme as requisições de baixa prioridade para `/build-manifest.json` e para dezenas de `/assets/*.js` logo depois do login, sem erro no console.
5. Em outro terminal, altere um comentário em `apps/crm/src/App.tsx` e rode `npm run build:staging` de novo (muda os hashes). Aguarde 10 s.
6. Clique em "Clientes" na sidebar: a navegação deve ser um carregamento completo em `/clientes` (a aba Network mostra um documento novo), sem toast e sem tela de erro.
7. Repita o passo 5, abra um modal (por exemplo "Novo cliente") e deixe a aba oculta por mais de 15 s: nada recarrega. Feche o modal, deixe oculta por 15 s: a aba recarrega sozinha.
8. Reverta o passo 1 (`git checkout -- apps/crm/src/main.tsx apps/crm/src/App.tsx`).

Expected: os três comportamentos acima observados; screenshot da aba Network do passo 4 e do passo 6 anexados ao PR.

- [ ] **Step 4: Commit e branch pronta**

```bash
git add CLAUDE.md
git commit -m "docs: gotcha sobre useUnsavedWork e trackUnsavedWork para editores e uploads

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git log --oneline origin/main..HEAD
```

Expected: 12 commits de implementação mais os commits da spec e do plano. Depois disso, siga `superpowers:finishing-a-development-branch`. Antes de `gh pr create`, rode `git ls-tree origin/main:supabase/migrations | tail -3` só para confirmar que nada mudou nesse diretório (esta feature não tem migration).
