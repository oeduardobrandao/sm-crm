# CTA por página nos popups: plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cada página de um popup pode ter um CTA próprio (label + URL) que sobrescreve o CTA global naquela página; o CTA global continua aparecendo só na última página.

**Architecture:** Nenhuma coluna nova: `pages[i]` ganha `cta_label`/`cta_url` opcionais no jsonb, validados no `platform-admin`. O CHECK de `until_cta` passa a aceitar CTA global ou em alguma página. `PopupCard` calcula o CTA efetivo por página e chama `onCta(pageIndex)`; o admin e o CRM passam o label por página. Spec: adendo "CTA por página" em `docs/superpowers/specs/2026-09-04-global-popups-design.md`.

**Tech Stack:** igual ao plano original (`docs/superpowers/plans/2026-09-04-global-popups.md`): Postgres/RLS, Deno, React 19, Vitest, `deno test`, psql suites.

## Global Constraints

- Branch `feat/popups-cta-por-pagina` a partir de `origin/main` (c3a30c75, já com os popups). A branch `fix/sanitize-url-backslash` (PR #455) altera a linha `CTA_URL_RE` nos mesmos arquivos; **não edite essa linha** aqui, só a reutilize, para o merge não conflitar.
- Migration `supabase/migrations/20260907000020_popups_page_cta.sql` (acima da cauda `20260907000010`; reconferir com `git ls-tree --name-only origin/main:supabase/migrations | tail` antes do PR).
- Regras do CTA de página iguais às do global: label até 40, URL até 2048, `CTA_URL_RE`, sem `\t\r\n`; par completo ou nenhum; `""` normaliza para `null`.
- Copy do admin em inglês, do CRM em pt-BR; sem em-dash. Prettier singleQuote / trailingComma all / printWidth 100; `npm run format` antes de commitar. `npm run test:functions` suja `deno.lock` (`git checkout deno.lock`) e `node_modules/.deno` (`npm ci` antes de vitest/tsc).
- Verificação final: `npm run lint`, `npm run format:check`, 4x `tsc`, `npm run test`, `npm run test:functions`, `npm run check:functions`.

---

### Task 1: Migration do CHECK + suíte SQL

**Files:**
- Create: `supabase/migrations/20260907000020_popups_page_cta.sql`
- Modify: `supabase/tests/entitlements/77_global_popups.sql` (seção `(d)`)

**Interfaces:** o CHECK `global_popups_until_cta_needs_cta_check` passa a ser `frequency <> 'until_cta' OR cta_url IS NOT NULL OR jsonb_path_exists(pages, '$[*].cta_url ? (@ != null)')`.

- [ ] **Step 1: Casos novos na suíte (falham no stack atual)**

Após o bloco `assert v_rejected, 'require_ack + until_cta foi aceito';` em `77_global_popups.sql`, acrescente:

```sql
  -- CTA por pagina: until_cta sem CTA global mas com CTA em alguma pagina e aceito
  insert into global_popups (pages, target_mode, frequency)
    values ('[{"title":"T","body":"B","cta_label":"Ver","cta_url":"/x"}]'::jsonb, 'all', 'until_cta');

  -- ... e sem CTA em lugar nenhum continua rejeitado
  v_rejected := false;
  begin
    insert into global_popups (pages, target_mode, frequency)
      values ('[{"title":"T","body":"B","cta_url":null}]'::jsonb, 'all', 'until_cta');
  exception when check_violation then
    v_rejected := true;
  end;
  assert v_rejected, 'until_cta sem CTA global nem de pagina foi aceito';
```

Atualize o comentário de cabeçalho `(d)` para citar o CTA por página.

- [ ] **Step 2: Rodar a suíte no stack local e ver o primeiro insert falhar** (recipe: `cp supabase/config.toml /tmp/config.toml.cta-backup`; anexar as portas `[api] 54421 / [db] 54422 / [inbucket] 54424 / [studio] 54425` ao fim do `config.toml`; `npx supabase start`; `npx supabase db reset`; `SUPABASE_DB_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres bash scripts/test-entitlements.sh`). Esperado: `77_global_popups.sql` FAIL com `check_violation` no insert de `until_cta` com CTA só na página.

- [ ] **Step 3: Migration**

```sql
-- CTA por página (adendo da spec 2026-09-04): until_cta vale com CTA global OU em
-- alguma página. jsonb_path_exists é IMMUTABLE, então serve em CHECK.
alter table global_popups
  drop constraint global_popups_until_cta_needs_cta_check;

alter table global_popups
  add constraint global_popups_until_cta_needs_cta_check
  check (
    frequency <> 'until_cta'
    or cta_url is not null
    or jsonb_path_exists(pages, '$[*].cta_url ? (@ != null)')
  );
```

- [ ] **Step 4: `npx supabase db reset` + suíte de novo: 57/57 PASS.** Depois `npx supabase stop --no-backup`, restaurar `config.toml`, `git status --short` só com os dois arquivos.

- [ ] **Step 5: Commit** `feat(popups): until_cta aceita CTA global ou em página (CHECK com jsonb_path_exists)`.

---

### Task 2: `validatePages` aceita CTA por página; `until_cta` olha as páginas

**Files:**
- Modify: `supabase/functions/platform-admin/popups.ts`
- Modify: `supabase/functions/__tests__/platform-admin-popups_test.ts`

**Interfaces:**
- `PopupPage` ganha `cta_label: string | null; cta_url: string | null`.
- `PAGE_KEYS` ganha `cta_label`, `cta_url`.
- `validatePages` normaliza e valida o par por página; erros: `page ${i}: cta_label max 40`, `page ${i}: cta_url max 2048`, `page ${i}: cta_label and cta_url go together`, `page ${i}: cta_url must start with / or http(s)://`.
- `validatePopupFields`: `until_cta` aceito se `cta_url` global ou `pagesHaveCta(row.pages)`.

- [ ] **Step 1: Testes (falham)**

```ts
Deno.test("validatePages: CTA por página normaliza, exige par e aplica as regras de URL", () => {
  const ok = validatePages([{ title: "T", body: "B", cta_label: " Ver ", cta_url: "/x" }]);
  assert(ok.ok);
  assertEquals(ok.pages[0].cta_label, "Ver");
  assertEquals(ok.pages[0].cta_url, "/x");
  const none = validatePages([{ title: "T", body: "B", cta_label: "", cta_url: "" }]);
  assert(none.ok);
  assertEquals(none.pages[0].cta_label, null);
  assertEquals(none.pages[0].cta_url, null);
  assertEquals(validatePages([{ title: "T", body: "B", cta_label: "Ver" }]).ok, false);
  assertEquals(validatePages([{ title: "T", body: "B", cta_url: "/x" }]).ok, false);
  assertEquals(validatePages([{ title: "T", body: "B", cta_label: "x".repeat(41), cta_url: "/x" }]).ok, false);
  assertEquals(validatePages([{ title: "T", body: "B", cta_label: "Ver", cta_url: "javascript:alert(1)" }]).ok, false);
  assertEquals(validatePages([{ title: "T", body: "B", cta_label: "Ver", cta_url: "//evil.com" }]).ok, false);
  assertEquals(validatePages([{ title: "T", body: "B", cta_label: "Ver", cta_url: "/\t/evil.com" }]).ok, false);
});

Deno.test("validatePopupFields: until_cta aceita CTA só em página", () => {
  const base = { cta_label: null, cta_url: null, secondary_label: null, frequency: "until_cta", require_ack: false, target_mode: "all" };
  const withPageCta = [{ title: "T", eyebrow: null, body: "B", image_key: null, cta_label: "Ver", cta_url: "/x" }];
  const noCta = [{ title: "T", eyebrow: null, body: "B", image_key: null, cta_label: null, cta_url: null }];
  assertEquals(validatePopupFields({ ...base, pages: withPageCta }), null);
  assert(validatePopupFields({ ...base, pages: noCta }) !== null, "until_cta sem CTA algum");
  assert(validatePopupFields({ ...base }) !== null, "until_cta sem pages nem CTA");
});
```
Ajuste o `ROW` e os `PAGES` existentes se algum teste passar a exigir os campos novos (os handlers devolvem o que `validatePages` normaliza, então `payload.pages[0]` agora tem `cta_label: null, cta_url: null`; corrija asserts `toEqual`/`assertEquals` sobre páginas).

- [ ] **Step 2: Rodar `deno test ... platform-admin-popups_test.ts` e ver falhar.**

- [ ] **Step 3: Implementar**

```ts
export interface PopupPage {
  title: string;
  eyebrow: string | null;
  body: string;
  image_key: string | null;
  cta_label: string | null;
  cta_url: string | null;
}
const PAGE_KEYS = new Set(["title", "eyebrow", "body", "image_key", "cta_label", "cta_url"]);
```
Dentro do loop de `validatePages`, após a checagem de `image_key`:
```ts
    const pageCtaLabel = optionalText(r.cta_label, 40);
    if (!pageCtaLabel.ok) return { ok: false, error: `page ${i}: cta_label max 40` };
    const pageCtaUrl = optionalText(r.cta_url, 2048);
    if (!pageCtaUrl.ok) return { ok: false, error: `page ${i}: cta_url max 2048` };
    if ((pageCtaLabel.value === null) !== (pageCtaUrl.value === null)) {
      return { ok: false, error: `page ${i}: cta_label and cta_url go together` };
    }
    if (
      pageCtaUrl.value !== null &&
      (!CTA_URL_RE.test(pageCtaUrl.value) || /[\t\r\n]/.test(pageCtaUrl.value))
    ) {
      return { ok: false, error: `page ${i}: cta_url must start with / or http(s)://` };
    }
    pages.push({
      title, eyebrow: eyebrow.value, body, image_key: image.value,
      cta_label: pageCtaLabel.value, cta_url: pageCtaUrl.value,
    });
```
Helper ao lado de `pagesHaveImages`:
```ts
function pagesHaveCta(pages: unknown): boolean {
  return Array.isArray(pages) &&
    pages.some((p) => typeof (p as { cta_url?: unknown })?.cta_url === "string" && (p as { cta_url: string }).cta_url);
}
```
Em `validatePopupFields`: `if (frequency === "until_cta" && ctaUrl.value === null && !pagesHaveCta(row.pages)) return "until_cta requires a CTA";`.

- [ ] **Step 4: Rodar o arquivo de teste (todos verdes), `npm run check:functions`, `git checkout deno.lock`, `npm ci`.**

- [ ] **Step 5: Commit** `feat(popups): CTA por página validado no platform-admin; until_cta aceita CTA em página`.

---

### Task 3: `PopupCard` com CTA efetivo por página

**Files:**
- Modify: `packages/ui/PopupCard.tsx`
- Modify: `packages/ui/__tests__/PopupCard.test.tsx`

**Interfaces:**
- `PopupCardPage` ganha `ctaLabel?: string | null`.
- `onCta?: (pageIndex: number) => void`.
- CTA efetivo da página: `current.ctaLabel ?? (isLast ? ctaLabel : null)`. Página não última com CTA: linha do CTA (largura total, estilo do popup) acima da navegação; "Próximo" vira `ghost`. Última: CTA efetivo + secundário. `onCta(index)` em todos os casos.

- [ ] **Step 1: Testes (falham)**

Ajuste os testes existentes: `expect(props.onCta).toHaveBeenCalledWith(2)` no caso da última página. Acrescente:

```tsx
  it('CTA de página no meio: botão principal acima da navegação e Próximo vira outline', () => {
    const { props } = renderCard({
      page: 1,
      pages: [pages[0], { ...pages[1], ctaLabel: 'Ver só aqui' }, pages[2]],
    });
    const cta = screen.getByRole('button', { name: 'Ver só aqui' });
    fireEvent.click(cta);
    expect(props.onCta).toHaveBeenCalledWith(1);
    const next = screen.getByRole('button', { name: 'Próximo' });
    expect(next.getAttribute('style')).toContain('transparent');
    expect(cta.getAttribute('style')).not.toContain('transparent');
  });

  it('última página com CTA próprio substitui o global; sem CTA efetivo só o secundário', () => {
    const { props, unmount } = renderCard({
      page: 2,
      pages: [pages[0], pages[1], { ...pages[2], ctaLabel: 'Sobrescrito' }],
    });
    expect(screen.queryByRole('button', { name: 'Ver' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Sobrescrito' }));
    expect(props.onCta).toHaveBeenCalledWith(2);
    unmount();
    renderCard({ page: 2, ctaLabel: null });
    expect(screen.queryByRole('button', { name: 'Ver' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Agora não' })).toBeInTheDocument();
  });

  it('primeira página sem CTA próprio não mostra o CTA global', () => {
    renderCard({ page: 0 });
    expect(screen.queryByRole('button', { name: 'Ver' })).toBeNull();
  });
```

- [ ] **Step 2: `npx vitest run packages/ui/__tests__/PopupCard.test.tsx` e ver falhar.**

- [ ] **Step 3: Implementar**

```tsx
export interface PopupCardPage {
  title: string;
  eyebrow?: string | null;
  body: string;
  imageUrl?: string | null;
  /** CTA próprio da página; sobrescreve o CTA global (que só aparece na última). */
  ctaLabel?: string | null;
}
// props: onCta?: (pageIndex: number) => void;
```
No corpo, troque `const hasCta = Boolean(ctaLabel && onCta);` por:
```tsx
  const pageCtaLabel = current.ctaLabel ?? (isLast ? ctaLabel : null);
  const hasCta = Boolean(pageCtaLabel && onCta);
  const fireCta = () => onCta?.(index);
```
Bloco `{multi && !isLast && (...)}` passa a:
```tsx
        {multi && !isLast && (
          <div className="mt-[18px] flex flex-col gap-2.5">
            {hasCta && (
              <Btn kind={ctaStyle} onClick={fireCta} className="w-full">
                {pageCtaLabel}
              </Btn>
            )}
            <div className="flex items-center justify-between gap-2.5">
              {isFirst ? (
                <span />
              ) : (
                <Btn kind="link" onClick={() => onPageChange(index - 1)}>
                  Voltar
                </Btn>
              )}
              {dots}
              <Btn kind={hasCta ? 'ghost' : ctaStyle} onClick={() => onPageChange(index + 1)}>
                Próximo
              </Btn>
            </div>
          </div>
        )}
```
No bloco `{isLast && (...)}`: `{hasCta && (<Btn kind={ctaStyle} onClick={fireCta} className="flex-1">{pageCtaLabel}</Btn>)}`.

- [ ] **Step 4: Testes verdes; `npx tsc -p apps/crm/tsconfig.json --noEmit` e `npx tsc -p apps/admin/tsconfig.json --noEmit` vão acusar `onCta` nos dois consumidores: ajuste mínimo agora** (`apps/admin/src/pages/PopupsPage.tsx`: `onCta={hasCta ? () => {} : undefined}` continua válido porque `() => {}` aceita um argumento ignorado; `apps/crm/src/components/layout/GlobalPopupHost.tsx`: `handleCta` ainda sem parâmetro também é atribuível). Se `tsc` passar sem mudanças, siga.

- [ ] **Step 5: `npm run format`; commit** `feat(popups): PopupCard com CTA efetivo por página`.

---

### Task 4: Admin: CTA por página no formulário e no editor

**Files:**
- Modify: `apps/admin/src/pages/popup-form.ts`
- Modify: `apps/admin/src/pages/__tests__/popup-form.test.ts`
- Modify: `apps/admin/src/pages/PopupsPage.tsx`
- Modify: `apps/admin/src/pages/__tests__/PopupsPage.test.tsx`
- Modify: `apps/admin/src/lib/api.ts` (`PopupPage` ganha `cta_label: string | null; cta_url: string | null`)

**Interfaces:**
- `PageForm` ganha `cta_label: string; cta_url: string` (init `''`).
- `PopupFormErrors.pages[i]` ganha `cta?: string`.
- `validateForm`: par por página com as mensagens do CTA global (`CTA needs both a label and a URL`, `CTA label max 40 characters`, `CTA URL must start with / or http(s)://`, `CTA URL max 2048 characters`); `until_cta` sem CTA global nem de página → `'"Until CTA" needs a CTA on the popup or on at least one page'`.
- `formToPayload` emite `cta_label`/`cta_url` por página (via `orNull`).
- `pageHasContent` considera os dois campos.
- `PopupsPage`: no bloco da página, após Body, um sub-bloco "Page CTA (optional)" com `popup-page-cta-label` e `popup-page-cta-url` (labels `Page CTA label` / `Page CTA URL`), nota `Overrides the popup CTA on this page.`, erro inline `errors.pages[i].cta`; o preview mapeia `ctaLabel` por página; `onCta` passado quando há CTA global ou em alguma página.

- [ ] **Step 1: Testes (falham)**

`popup-form.test.ts`:
```ts
  it('CTA por página: par completo, limites, e until_cta aceito com CTA só em página', () => {
    const f = valid();
    f.pages[0].cta_label = 'Ver';
    expect(validateForm(f)!.pages[0].cta).toBe('CTA needs both a label and a URL');
    f.pages[0].cta_url = 'ajuda';
    expect(validateForm(f)!.pages[0].cta).toBe('CTA URL must start with / or http(s)://');
    f.pages[0].cta_url = '/ajuda';
    expect(validateForm(f)).toBeNull();
    const g = { ...f, frequency: 'until_cta' as const };
    expect(validateForm(g)).toBeNull();
    const h = { ...valid(), frequency: 'until_cta' as const };
    expect(validateForm(h)!.frequency).toBe('"Until CTA" needs a CTA on the popup or on at least one page');
    expect(formToPayload(f).pages).toEqual([
      { title: 'T', eyebrow: null, body: 'B', image_key: null, cta_label: 'Ver', cta_url: '/ajuda' },
    ]);
    expect(pageHasContent({ ...newPage(), cta_url: '/x' })).toBe(true);
  });
```
Ajuste o teste de round-trip existente: o fixture `popup.pages[*]` ganha `cta_label`/`cta_url` (um com `'Ver aqui'`/`'/p1'`, outro `null`/`null`) e o `toEqual` do payload inclui os campos.

`PopupsPage.test.tsx`:
```tsx
  it('CTA por página vai no payload da página, não no global', async () => {
    renderPage();
    await screen.findByText('Analytics de Stories');
    fireEvent.click(screen.getByRole('button', { name: /New Popup/ }));
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'P1' } });
    fireEvent.change(screen.getByLabelText('Body (Markdown)'), { target: { value: 'b' } });
    fireEvent.change(screen.getByLabelText('Page CTA label'), { target: { value: 'Ver só aqui' } });
    fireEvent.change(screen.getByLabelText('Page CTA URL'), { target: { value: '/so-aqui' } });
    expect(screen.getByRole('button', { name: 'Ver só aqui' })).toBeInTheDocument(); // preview
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(createPopup).toHaveBeenCalledTimes(1));
    const payload = vi.mocked(createPopup).mock.calls[0][0] as { pages: Array<Record<string, unknown>>; cta_url: unknown };
    expect(payload.pages[0].cta_label).toBe('Ver só aqui');
    expect(payload.pages[0].cta_url).toBe('/so-aqui');
    expect(payload.cta_url).toBeNull();
  });
```
O fixture `popup.pages[*]` do teste da página também ganha `cta_label: null, cta_url: null`.

- [ ] **Step 2: Rodar os dois arquivos e ver falhar.**

- [ ] **Step 3: Implementar** (`popup-form.ts`):

```ts
export interface PageForm {
  key: string; title: string; eyebrow: string; body: string; image_key: string;
  cta_label: string; cta_url: string;
}
// newPage: ..., cta_label: '', cta_url: ''
// popupToForm: cta_label: pg.cta_label ?? '', cta_url: pg.cta_url ?? ''
// formToPayload pages: cta_label: orNull(pg.cta_label), cta_url: orNull(pg.cta_url)
// PopupFormErrors.pages: Record<number, { title?: string; eyebrow?: string; body?: string; cta?: string }>
```
Em `validateForm`, dentro do `forEach`, após o eyebrow:
```ts
    const pl = pg.cta_label.trim();
    const pu = pg.cta_url.trim();
    if ((pl === '') !== (pu === '')) e.cta = 'CTA needs both a label and a URL';
    else if (pl.length > MAX_LABEL) e.cta = `CTA label max ${MAX_LABEL} characters`;
    else if (pu && !CTA_URL_RE.test(pu)) e.cta = 'CTA URL must start with / or http(s)://';
    else if (pu.length > MAX_URL) e.cta = `CTA URL max ${MAX_URL} characters`;
    if (e.title || e.body || e.eyebrow || e.cta) { ... }
```
Regra de frequência:
```ts
  const anyPageCta = f.pages.some((pg) => pg.cta_url.trim());
  if (f.frequency === 'until_cta' && !url && !anyPageCta) {
    errors.frequency = '"Until CTA" needs a CTA on the popup or on at least one page';
    any = true;
  }
```
`pageHasContent`: inclui `p.cta_label.trim() || p.cta_url.trim()`.

`PopupsPage.tsx`: após o bloco do Body, dentro do bloco da página:
```tsx
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="popup-page-cta-label" className={LABEL}>Page CTA label</label>
                <input id="popup-page-cta-label" className={INPUT} maxLength={40} value={page.cta_label}
                  onChange={(e) => updatePage({ cta_label: e.target.value })} />
              </div>
              <div>
                <label htmlFor="popup-page-cta-url" className={LABEL}>Page CTA URL</label>
                <input id="popup-page-cta-url" className={INPUT} placeholder="/ajuda/... or https://..." value={page.cta_url}
                  onChange={(e) => updatePage({ cta_url: e.target.value })} />
              </div>
            </div>
            <p className="text-xs text-muted-foreground -mt-3">Overrides the popup CTA on this page.</p>
            {errors?.pages[pageIndex]?.cta && (
              <p className="text-xs text-destructive -mt-3">{errors.pages[pageIndex].cta}</p>
            )}
```
Preview: `const anyCta = hasCta || form.pages.some((p) => p.cta_label.trim() && p.cta_url.trim());` e no `<PopupCard>`: pages mapeadas com `ctaLabel: p.cta_label.trim() && p.cta_url.trim() ? p.cta_label : null`, `onCta={anyCta ? () => {} : undefined}`. O default do secundário passa a olhar o CTA **efetivo da última página**: `const last = form.pages[form.pages.length - 1]; const lastHasCta = Boolean((last.cta_label.trim() && last.cta_url.trim()) || hasCta); const secondaryLabel = form.secondary_label.trim() || defaultSecondaryLabel(form.require_ack, lastHasCta);` (o placeholder do input "Secondary label" usa o mesmo `lastHasCta`). Teste: página única com CTA só na página e sem CTA global → o preview mostra "Agora não", não "Fechar".

- [ ] **Step 4: `npx vitest run apps/admin`, `npx tsc -p apps/admin/tsconfig.json --noEmit`, `npm run lint`, `npm run format`.**

- [ ] **Step 5: Commit** `feat(popups): CTA por página no editor do admin`.

---

### Task 5: CRM: store e host com CTA por página

**Files:**
- Modify: `apps/crm/src/store/popups.ts` (`PopupPage` ganha `cta_label?: string | null; cta_url?: string | null`)
- Modify: `apps/crm/src/components/layout/GlobalPopupHost.tsx`
- Modify: `apps/crm/src/components/layout/__tests__/GlobalPopupHost.test.tsx`

**Interfaces:** `handleCta(pageIndex)` resolve `url = popup.pages[pageIndex].cta_url ?? (pageIndex === último ? popup.cta_url : null)`; grava `cta`, captura `popup_cta` com `{ popup_id, page }`, fecha, navega. `onCta` passado quando há CTA global ou em alguma página; `pages` mapeadas com `ctaLabel: p.cta_label ?? null`.

- [ ] **Step 1: Testes (falham)**

Ajuste os testes de CTA existentes para `captureEventMock` com `{ popup_id: 'p1', page: <índice> }`. Acrescente:

```tsx
  it('CTA próprio da página do meio navega para a URL da página e grava cta com o índice', async () => {
    getActivePopupsMock.mockResolvedValue([
      { ...popup, pages: [{ ...popup.pages[0], cta_label: 'Ver um', cta_url: '/pagina-um' }, popup.pages[1]] },
    ]);
    renderHost();
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('button', { name: 'Ver um' }));
    await waitFor(() => expect(recordPopupInteractionMock).toHaveBeenCalledWith('p1', 'cta'));
    expect(captureEventMock).toHaveBeenCalledWith('popup_cta', { popup_id: 'p1', page: 0 });
    expect(navigateMock).toHaveBeenCalledWith('/pagina-um');
  });

  it('última página com CTA próprio usa a URL da página, não a global', async () => {
    getActivePopupsMock.mockResolvedValue([
      { ...popup, pages: [popup.pages[0], { ...popup.pages[1], cta_label: 'Ver dois', cta_url: '/pagina-dois' }] },
    ]);
    renderHost();
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('button', { name: 'Próximo' }));
    fireEvent.click(screen.getByRole('button', { name: 'Ver dois' }));
    expect(navigateMock).toHaveBeenCalledWith('/pagina-dois');
    expect(navigateMock).not.toHaveBeenCalledWith('/ajuda/x');
  });
```

- [ ] **Step 2: Rodar o arquivo e ver falhar.**

- [ ] **Step 3: Implementar**

```ts
// store/popups.ts
export interface PopupPage {
  title: string; eyebrow: string | null; body: string; image_key: string | null;
  cta_label?: string | null; cta_url?: string | null;
}
```
`GlobalPopupHost.tsx`:
```tsx
  const effectiveCtaUrl = useCallback(
    (pageIndex: number): string | null => {
      if (!popup) return null;
      const pg = popup.pages[pageIndex];
      const own = pg?.cta_label && pg?.cta_url ? pg.cta_url : null;
      if (own) return own;
      return pageIndex === popup.pages.length - 1 ? (popup.cta_url ?? null) : null;
    },
    [popup],
  );

  const handleCta = useCallback(
    (pageIndex: number) => {
      const url = effectiveCtaUrl(pageIndex);
      if (!popup || !url) return;
      record(popup.id, 'cta');
      captureEvent('popup_cta', { popup_id: popup.id, page: pageIndex });
      setOpen(false);
      const safe = sanitizeUrl(url);
      if (safe.startsWith('/')) navigate(safe);
      else openExternalUrl(url);
    },
    [popup, effectiveCtaUrl, record, navigate],
  );
```
`const anyCta = Boolean(popup.cta_label && popup.cta_url) || popup.pages.some((p) => p.cta_label && p.cta_url);`. O default do secundário olha o CTA efetivo da última página: `const lastHasCta = effectiveCtaUrl(popup.pages.length - 1) !== null; const secondaryLabel = popup.secondary_label ?? defaultSecondaryLabel(requireAck, lastHasCta);` (teste: popup sem CTA global e com CTA só na última página mostra "Agora não"). No `<PopupCard>`: `pages={popup.pages.map((p) => ({ ..., ctaLabel: p.cta_label && p.cta_url ? p.cta_label : null }))}`, `ctaLabel={hasCta ? popup.cta_label : null}`, `onCta={anyCta ? handleCta : undefined}`.

- [ ] **Step 4: `npx vitest run apps/crm/src/components/layout apps/crm/src/store`, `npx tsc -p apps/crm/tsconfig.json --noEmit`, `npm run lint`, `npm run format`.**

- [ ] **Step 5: Commit** `feat(popups): host do CRM usa o CTA da página quando existe`.

---

### Task 6: Verificação, rollout e PR

- [ ] **Step 1: Bateria completa** (`npm run lint`, `npm run format:check`, 4x `tsc`, `npm run test`, `npm run test:functions`, `npm run check:functions`; `git checkout deno.lock`; `npm ci` se `node_modules/.deno` existir). Guard de migrations: `ls supabase/migrations | sed 's/_.*//' | sort | uniq -d` vazio; `20260907000020` acima da cauda de `origin/main`.
- [ ] **Step 2: PR** contra `main` com o corpo: o que muda, rollout (migration em prod, deploy `platform-admin`, merge), verificação. Rollout e merge só com o ok do usuário.
