# Agenda: quick-create card + full-size editor — Implementation Plan

> **For agentic workers:** two independent lanes (A, B) run in parallel worktrees off base
> `c5be338b3`. Steps use checkbox (`- [ ]`) syntax.

**Goal:** creating an event works like Google Calendar. Clicking or dragging on the
week/day grid (or a day in month view) drops a placeholder card on that slot and opens a
compact, non-scrolling quick card next to it. "Mais opções" opens a full-size editor with
everything else (repeat, description, reminders, privacy...). Editing an existing event also
uses the full-size editor.

**Architecture:** the placeholder is a real FullCalendar event built from a draft held in
`AgendaTab` state (not FullCalendar's `selectMirror`, which vanishes on outside clicks and
cannot be retitled). The quick card is a Radix Popover anchored to that draft chip, reusing
the form schema, `QuandoCampos` and `useCriarEvento`. The full-size editor is the existing
`EventoFormDialog`, re-laid out as a full-viewport dialog and able to start from the card's
values.

**Tech stack:** React 19, react-hook-form + zod, Radix Popover/Dialog (shadcn), FullCalendar
6.1.21, Tailwind + `apps/crm/style.css` tokens, Vitest + Testing Library.

## Global Constraints

- Copy is Portuguese. No em-dashes in user-facing copy (use a period or colon).
- Icons: `lucide-react` only. Toasts: `sonner`.
- Colors from CSS vars (`var(--card-bg)`, `var(--text-main)`, `var(--text-muted)`,
  `var(--border-color)`, `var(--surface-1/2)`), so dark mode (`[data-theme='dark']`) works.
- Never `useBlocker`. Unsaved non-modal editors call `useUnsavedWork(cond)` from
  `@mesaas/app-lifecycle`. `DialogContent` with `confirmClose` is already covered.
- The shared `Button` has a base `mb-2`: add `mb-0` wherever a Button sits in a row.
- Popover and Select contents are both `z-[9012]` (portaled); DropdownMenuContent inside a
  dialog needs `MENU_SOBRE_DIALOG_Z` (`z-[9012]`).
- Mobile (`isMobile`, < 768px) keeps today's flow: no quick card, the full editor opens
  directly (FAB and slot select).
- Validation is the existing `eventoFormSchema` (title required: "Informe um título.").
- Gates per lane: `npx eslint apps/crm/src/pages/calendario/`, `npx tsc -p
  apps/crm/tsconfig.json --noEmit`, `npx prettier --check` on touched files, `npx vitest run
  apps/crm/src/pages/calendario`. All 223 current tests keep passing (update, don't delete,
  any that assert old layout details).

## Already on base (do not redo)

- `QuandoCampos.tsx`: `QuandoCampos({ form, fusoDiferente?, rotulo? = true })`. Renders
  start date, start/end time selects, end date when all-day or multi-day, the end error and
  the tz note. Owns start-date/start-time side effects (keeps duration, re-derives the rule).
- `useCriarEvento.ts`: `useCriarEvento({ onCriado })` → TanStack mutation taking
  `EventoFormValues`; invalidates `[AGENDA_QUERY_KEY]`, toasts "Evento criado" (+ the dtstart
  note), toasts the formatted error.
- `eventoFormSchema.ts` exports `hhmm`, `valoresIniciaisCriar({inicio, fim, diaInteiro})`
  (`fim` exclusive for all-day), `montarPayload`, `eventoFormSchema`, `EventoFormValues`.
- `ConteudoDoEvento` (AgendaView) tolerates an event without `extendedProps.ocorrencia`.

## Interface between the lanes (both lanes code against this exactly)

```ts
// EventoFormDialog.tsx (Lane A owns the implementation; Lane B only passes it)
export type EventoFormDialogProps =
  | {
      open: boolean;
      onOpenChange: (open: boolean) => void;
      modo: 'criar';
      inicial: { inicio: Date; fim: Date; diaInteiro: boolean };
      /** Values typed in the quick card. Read once when the dialog opens; the
       *  fields it carries start dirty so closing asks to discard. */
      rascunho?: Partial<EventoFormValues>;
    }
  | { open: boolean; onOpenChange: (open: boolean) => void; modo: 'editar'; ocorrencia: AgendaOcorrencia };
```

---

### Lane A: full-size editor (`EventoFormDialog`)

**Files:** modify `apps/crm/src/pages/calendario/agenda/EventoFormDialog.tsx`,
`apps/crm/src/pages/calendario/agenda/__tests__/EventoFormDialog.test.tsx`.

- [ ] **A1. `rascunho` prop.** In the open/reset effect, create mode: `form.reset(
  valoresIniciaisCriar(...))`, take `base.current` from those reset values, then for each key
  of `rascunho` call `form.setValue(key, value, { shouldDirty: true })`. Read `rascunho`
  through a ref updated every render so a new object identity never re-runs the effect (the
  effect's deps stay `[open, ocorrenciaId, inicioMs, fimMs, diaInteiroInicial, form]`). The
  `useForm` `defaultValues` for create mode also merge `rascunho` so the first paint already
  shows it. Test: render `modo="criar"` with `rascunho={{ titulo: 'Pauta', participantes:
  ['u1'] }}` → title input shows "Pauta"; clicking Cancelar opens the discard confirm (dirty);
  Salvar submits `criarEvento` with `titulo: 'Pauta'` and participants `['u1']`.
- [ ] **A2. Full-viewport layout (desktop ≥ 768px).** `DialogContent` covers the viewport:
  override the centered/translate classes so it is `inset-0`, `h-[100dvh]`, `w-screen`,
  `max-w-none`, `rounded-none`, `p-0`, `translate-x-0 translate-y-0`, with
  `background: var(--bg-color)`. Read `components/ui/dialog.tsx` to see which base classes to
  override (tailwind-merge resolves conflicts). Structure, top to bottom:
  1. **Top bar** (sticky, no scroll): close button (`X` icon, `aria-label="Fechar"`, calls
     the same path as Cancelar, so a dirty form confirms), the title input as a large
     underlined field (`aria-label="Título"`, placeholder "Adicionar título", font ~22px,
     `autoFocus`, `maxLength={200}`, error under it), and the primary "Salvar" button.
     `DialogTitle` stays in the DOM ("Novo evento" / "Editar evento") but visually hidden
     (`sr-only`), so tests and screen readers still find it.
  2. **Quando block** under the title: `<QuandoCampos form={form} fusoDiferente=… rotulo={false} />`,
     then the "Dia inteiro" switch and `RepetirSelect` row (unchanged behaviour).
  3. **Body**, scrolls on its own (`overflow-y-auto`, flex-1), content centered with
     `max-w-[1120px] mx-auto`, padding `clamp(1rem,3vw,2.5rem)`. Two columns at `lg`
     (`grid-cols-[minmax(0,1fr)_360px]`, gap 32px), one column below:
     - Left card "Detalhes do evento" (`var(--card-bg)`, radius 12, border
       `var(--border-color)`, padding 20–24): Tipo + Cliente (2-col), Local + Link da reunião
       (2-col), Lembretes, Evento privado, Descrição (`rows={8}`). Each row may lead with a
       muted 18px lucide icon column like Google (MapPin, Video, Bell, Lock, AlignLeft,
       Building2, Tag) — labels stay as `FormLabel`s so `getByLabelText` keeps working.
     - Right column "Participantes": the `PessoasCombobox` and its helper line.
  4. Remove the old `DialogFooter` (Salvar lives in the top bar). Keep Cancelar reachable via
     the X button; keep the discard `AlertDialog`, `RecorrenciaPersonalizadaDialog` and
     `EscopoEventoDialog` nested where they are.
- [ ] **A3. Mobile (< 768px).** Same component, single column, the whole dialog scrolls; top
  bar stays sticky. No horizontal scroll at 375px.
- [ ] **A4. Tests.** Update `EventoFormDialog.test.tsx` only where it asserted the old
  footer/labels; add the A1 tests. All other behaviour (payloads, scope dialog, reminders,
  errors) is unchanged and its tests must still pass untouched.
- [ ] **A5. Commit** `feat(agenda): full-size event editor that can start from a draft`.

### Lane B: draft chip + quick card

**Files:** create `apps/crm/src/pages/calendario/agenda/EventoRapidoCard.tsx`,
`apps/crm/src/pages/calendario/agenda/__tests__/EventoRapidoCard.test.tsx`; modify
`AgendaTab.tsx`, `AgendaView.tsx`, `__tests__/AgendaTab.test.tsx`, and the `.agenda-*` block
of `apps/crm/style.css` (only new `.agenda-rapido*` / `.agenda-ev--rascunho` rules).

- [ ] **B1. Draft state in `AgendaTab`.**
  ```ts
  interface Rascunho { inicio: Date; fim: Date; diaInteiro: boolean; titulo: string; tipo: AgendaTipo }
  const RASCUNHO_ID = 'rascunho';
  ```
  - `onSelect` (desktop): `calRef.current?.getApi().unselect()`, close the event popover,
    set `rascunho = { inicio, fim, diaInteiro, titulo: '', tipo: <form default tipo> }`.
    Mobile keeps `abrirCriar(inicio, fim, diaInteiro)`.
  - `eventos` passed to `AgendaView` = the occurrence events plus, when a draft exists, one
    EventInput: `{ id: RASCUNHO_ID, title: titulo.trim() || '(Sem título)', start, end,
    allDay, editable: false, classNames: ['agenda-ev--rascunho'], backgroundColor/borderColor
    = TIPO_COR[tipo] }` (match how occurrence events get colors; read
    `agendaLogic.ts`). No `extendedProps.ocorrencia`.
  - `eventClick` on the draft chip does nothing (guard in AgendaView: no `ocorrencia` → return).
    `eventAllow`/drag: draft is not editable.
  - `unselectAuto={false}` on `FullCalendar` (AgendaView). Keep `selectMirror` for the
    drag-in-progress feedback.
  - Anchor: the draft chip, found with the existing `[data-ocorrencia-id="…"]` lookup
    (`eventDidMount` already stamps `event.id`); generalize `resolverAnchor` to take
    `number | string`. Re-resolve after re-renders the same way the event popover does. Until
    the chip mounts (first frame), anchor to the container.
- [ ] **B2. `EventoRapidoCard`.**
  ```ts
  export interface EventoRapidoCardProps {
    inicial: { inicio: Date; fim: Date; diaInteiro: boolean };
    anchor: HTMLElement;
    /** Live title/time/tipo so the draft chip follows the card. */
    onRascunhoChange: (r: { inicio: Date; fim: Date; diaInteiro: boolean; titulo: string; tipo: AgendaTipo }) => void;
    onClose: () => void;                 // discard, no confirm (Google behaviour)
    onMaisOpcoes: (valores: EventoFormValues) => void;
  }
  ```
  - Own `useForm<EventoFormValues>` with `zodResolver(eventoFormSchema)` and
    `defaultValues: valoresIniciaisCriar(inicial)`.
  - Radix `Popover` (open while mounted) + `PopoverAnchor virtualRef` over `anchor` (copy the
    `ancoraVirtual` helper pattern from `EventoPopover.tsx`, or export it from there and
    import). `side="right"`, `align="start"`, `sideOffset={8}`, `collisionPadding={16}`
    (Radix flips to the left near the right edge). Width 448px, `max-w-[calc(100vw-32px)]`.
    NO internal scroll: no `overflow-y-auto`, no max-height; the content is short by design.
    Styling as `EventoPopover` (card bg, radius 12, popover shadow). Root class `agenda-rapido`.
  - Content, top to bottom (Google's quick card, Mesaas tokens):
    1. Top-right X (`aria-label="Fechar"`) → `onClose`.
    2. Title: large underlined input, `aria-label="Título"`, placeholder "Adicionar título",
       `autoFocus`, `maxLength={200}`, inline `FormMessage`. Enter submits.
    3. Tipo pills: a single-select `ToggleGroup` (`@/components/ui/toggle-group`) of the six
       `TIPO_LABEL`s, each with its `TIPO_COR` dot; wraps to two rows if needed; never empty
       (ignore deselect).
    4. Clock icon row: `<QuandoCampos form={form} rotulo={false} />`, then one muted line
       "Não se repete" (or the `RepetirSelect` label if the user already picked a rule in the
       full form; here it is always "Não se repete") as a link-style button that calls
       `onMaisOpcoes(form.getValues())`.
    5. People icon row: `PessoasCombobox` (roster via `useQuery(['workspace-users'],
       getWorkspaceUsers)` mapped like `EventoFormDialog`: flattened `{id, nome, avatar_url}`,
       organizer excluded).
    6. MapPin icon row: plain `Input` placeholder "Adicionar local", `maxLength={300}`.
    7. Footer (right-aligned): ghost "Mais opções" → `onMaisOpcoes(form.getValues())`;
       primary "Salvar" (submit). Both `mb-0`.
  - Submit: `form.handleSubmit((v) => criar.mutate(v))` with `useCriarEvento({ onCriado:
    onClose })`. Disable both buttons while pending.
  - `useUnsavedWork(form.formState.isDirty || criar.isPending)`.
  - Live draft: watch `titulo`, `tipo`, `data_inicio`, `hora_inicio`, `data_fim`, `hora_fim`,
    `dia_inteiro`; in an effect keyed on those primitives (dates via `getTime()`), compute
    `inicio = combinarDataHora(data_inicio, hora_inicio)`, `fim` = timed:
    `combinarDataHora(data_fim, hora_fim)`, all-day: `addDays(startOfDay(data_fim), 1)`
    (exclusive), and call `onRascunhoChange`. Skip invalid ranges (fim ≤ inicio).
  - Popover `onOpenChange(false)` (Escape, outside click) → `onClose`. Outside click on the
    grid that starts a new selection simply replaces the draft (AgendaTab's onSelect runs).
    Clicks inside nested portaled popovers (date picker, selects, people combobox) must NOT
    close the card: they are React children of the card, which Radix already treats as inside;
    verify with a test that opening the people combobox keeps the card open.
- [ ] **B3. Wiring in `AgendaTab`.** Render `EventoRapidoCard` when `rascunho && !isMobile`,
  keyed by the draft's initial `inicio.getTime()` + `fim.getTime()` + `diaInteiro` (a new
  selection remounts it; the live `onRascunhoChange` updates must NOT change the key — keep
  the initial range in a separate `rascunhoInicial` state). `onClose` → clear both.
  `onMaisOpcoes(v)` → clear the draft, `setForm({ modo: 'criar', inicial: <current range>,
  rascunho: v })`, and pass `rascunho={form.rascunho}` to `EventoFormDialog` (extend the
  `form` state union with optional `rascunho`). The "Criar" button / FAB keep opening the
  full editor directly.
- [ ] **B4. Styles.** `.agenda-ev--rascunho`: the chip looks like a real event with a soft
  elevation (`box-shadow: 0 6px 16px rgba(0,0,0,.18)`) and stays above siblings (`z-index:
  5` on its harness). Dark mode via tokens.
- [ ] **B5. Tests.**
  - `EventoRapidoCard.test.tsx` (mock `@/store/agenda` `criarEvento`, `@/store/workspace`,
    `@/context/AuthContext`, `sonner`, like `EventoFormDialog.test.tsx`): renders title input
    focused, no "Repetir"/"Descrição" fields; Salvar with empty title shows "Informe um
    título." and does not call `criarEvento`; typing a title + Salvar calls `criarEvento` with
    the selected range and `onClose`; "Mais opções" calls `onMaisOpcoes` with the typed title;
    typing a title calls `onRascunhoChange` with that title; picking a tipo pill changes the
    payload `tipo`.
  - `AgendaTab.test.tsx`: mock `../EventoRapidoCard` like `../EventoFormDialog` is mocked.
    Desktop select → the card renders (not the dialog); mobile select → the dialog renders;
    card `onMaisOpcoes` → dialog renders with `modo="criar"` and the `rascunho`; card
    `onClose` → card gone.
- [ ] **B6. Commit** `feat(agenda): Google-style quick-create card on the selected slot`.

### Integration (controller, after both lanes)

- [ ] Cherry-pick / merge lanes onto the branch, run all gates plus `npm run test` for the CRM.
- [ ] Browser check (local stack, desktop + 375px + dark): click a slot → chip + card, no card
  scroll, type title (chip follows), change time (chip moves), Salvar creates; "Mais opções"
  → full-size editor carrying the values; X with changes asks to discard; edit an existing
  event → full-size editor; month view day click → all-day chip + card.
