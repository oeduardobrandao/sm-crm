import { test, expect, type Locator } from '@playwright/test';
import { installSafetyNet, assertNoViolations } from './safety';
import { shoot } from './capture';

const SLUG = 'como-criar-e-gerenciar-fluxos';

// Existing prod workflow used to represent Step 6 ("Salve e acompanhe a execução").
// Chosen instead of creating a throwaway fluxo: it belongs to the same client used for
// steps 3-5 (Studio Bem-Estar) and already has three real posts, so the drawer renders
// a populated "Posts" list rather than the "Nenhum post ainda" empty state. Verified via
// a read-only REST query against prod before writing this spec (2026-07-17):
// workflow 217 = "Estúdio - Studio Bem-Estar - 03/07/2026", posts 1113/1114/1115.
// NOTE: there is a second, unrelated workflow (id 200) with the exact same title --
// hence targeting by id via the `?drawer=` deep link (EntregasPage.tsx's
// `pendingDrawerId` effect) rather than by clicking a card matched by title text, which
// would be ambiguous.
const EXISTING_WORKFLOW_ID_FOR_EXECUTION_VIEW = 217;

/**
 * Sum a strided sample of a <canvas>'s pixel bytes. Used to detect when Chart.js's
 * doughnut-reveal animation (ChartView.tsx, default ~1000ms duration, no onComplete
 * hook wired up) has settled, without guessing a fixed delay: poll this until two
 * consecutive samples agree (see the Gráfico step below). Stride keeps the poll cheap
 * on a devicePixelRatio-scaled canvas (this project runs deviceScaleFactor: 2).
 */
async function canvasPixelSample(canvas: Locator): Promise<number> {
  return canvas.evaluate((el) => {
    const c = el as HTMLCanvasElement;
    const ctx = c.getContext('2d');
    if (!ctx || c.width === 0 || c.height === 0) return 0;
    const data = ctx.getImageData(0, 0, c.width, c.height).data;
    let sum = 0;
    for (let i = 0; i < data.length; i += 97) sum += data[i];
    return sum;
  });
}

/**
 * Every one of the 5 view components (KanbanView, ChartView, CalendarView, ListView,
 * ConcludedView) wraps its content in a `.animate-up` div (style.css: `animation:
 * fadeInUp 0.4s ease-out forwards`, opacity 0 -> 1). Switching tabs fully
 * unmounts/remounts the view component, re-triggering this fade every time. A first run
 * of this spec proved this isn't hypothetical: the Calendário and Lista screenshots came
 * back visibly washed out (~mid-fade opacity) because their waits only checked that
 * content had *attached*, not that the animation had *finished*. Kanban/Gráfico's own
 * shots happened to clear 0.4s incidentally (longer wait chains), which is exactly the
 * kind of luck not to rely on -- so this guard is applied before every view-tab shot.
 * `.last()` because the always-mounted header (EntregasPage.tsx) also carries
 * `.animate-up` and sits earlier in the DOM; the per-view content is the one appended
 * most recently on every tab switch.
 */
async function waitForFadeIn(page: import('@playwright/test').Page): Promise<void> {
  const target = page.locator('.animate-up').last();
  await target.waitFor();
  await expect
    .poll(async () => target.evaluate((el) => getComputedStyle(el).opacity))
    .toBe('1');
}

test.describe.configure({ mode: 'serial' });

test('criar fluxo + visualizações walkthrough', async ({ page }) => {
  const violations = await installSafetyNet(page);

  // ── Group A: "Criando um fluxo" (6-step ordered list) ──────────────────────

  // Step 1 -- 'Acesse Entregas'
  await page.goto('/entregas');
  await page.getByRole('heading', { name: 'Entregas', exact: true }).waitFor();
  // Default view is Kanban; wait for at least one card so this isn't a blank board.
  await page.locator('.board-card').first().waitFor();
  await shoot(page, SLUG, 1, 'step-acessar-entregas');

  // Step 2 -- 'Clique em Novo Fluxo'
  // Capture the modal in its pristine, pre-fill state.
  await page.getByRole('button', { name: 'Novo Fluxo' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByText('Novo Fluxo de Entrega').waitFor();
  await shoot(page, SLUG, 2, 'step-novo-fluxo');

  // Step 3 -- 'Selecione o cliente e, se fizer sentido, um template'
  await page.getByPlaceholder('Ex: Posts Instagram — Março 2026').fill('Campanha de Conteúdo — Agosto 2026');
  // Cliente and Template are Radix comboboxes (not native <select>), so open + click
  // the option -- their popovers render into the page's own DOM via a portal, not OS
  // chrome, so they ARE capturable by page.screenshot(), unlike Post Express's native
  // <select> (see that spec's Step 2 comment).
  // Radix's SelectTrigger doesn't surface its rendered placeholder text as the
  // combobox's accessible name (confirmed via a failed run's accessibility snapshot --
  // `getByRole('combobox', { name: ... })` timed out even though the text is visibly
  // there), so these are targeted by fixed DOM position instead: within this dialog,
  // before any etapas render, the combobox order is Cliente(0), Template(1), Modo de
  // Prazo(2) -- see the "Combobox order" comment on Step 4 below for the full ordering.
  const comboboxes = dialog.locator('[role="combobox"]');
  await comboboxes.nth(0).click();
  await page.getByRole('listbox').getByRole('option', { name: 'Studio Bem-Estar', exact: true }).click();
  await comboboxes.nth(1).click();
  await page.getByRole('listbox').getByRole('option', { name: /Produção de Conteúdo/ }).click();
  // Selecting the template synchronously replaces the etapas list (handleTemplateChange
  // in WorkflowModals.tsx) -- wait for its first stage to actually land in the form.
  const etapaNomeInputs = page.getByPlaceholder('Nome da etapa');
  await expect(etapaNomeInputs.first()).toHaveValue('Briefing');
  await shoot(page, SLUG, 3, 'step-selecionar-cliente-template');

  // Step 4 -- 'Revise etapas, responsáveis e prazos'
  // The template (id 5, "Produção de Conteúdo") carries prazo/tipo_prazo per etapa but
  // NO responsavel_id (verified via REST: workflow_templates.etapas has no such field)
  // -- every row lands on "Sem responsável". Assign the first etapa's responsible to
  // make this screenshot show an actual revision, not just the template's defaults.
  // Combobox order inside the dialog is fixed by WorkflowModals.tsx's JSX: Cliente(0),
  // Template(1), Modo de Prazo(2), then per etapa row [tipoPrazo, responsavel] in that
  // order (SortableEtapaRow, lines ~195-247) -- so the first etapa's responsavel select
  // is combobox index 4.
  const firstEtapaResponsavel = comboboxes.nth(4);
  await firstEtapaResponsavel.scrollIntoViewIfNeeded();
  await firstEtapaResponsavel.click();
  await page.getByRole('listbox').getByRole('option', { name: 'Débora Kristin', exact: true }).click();
  await shoot(page, SLUG, 4, 'step-revisar-etapas');

  // Step 5 -- 'Defina se o fluxo é recorrente'
  const recorrenteCheckbox = page.locator('#recorrente-new');
  await recorrenteCheckbox.scrollIntoViewIfNeeded();
  await recorrenteCheckbox.click();
  await expect(recorrenteCheckbox).toHaveAttribute('data-state', 'checked');
  await shoot(page, SLUG, 5, 'step-fluxo-recorrente');

  // Close WITHOUT saving -- Criar Fluxo is never clicked, so this modal makes zero
  // writes. Cancelar resets local state and calls onClose(); NewWorkflowModal doesn't
  // pass `confirmClose` to DialogContent, so no "close without saving?" prompt appears.
  await page.getByRole('button', { name: 'Cancelar' }).click();
  await expect(dialog).toBeHidden();

  // Step 6 -- 'Salve e acompanhe a execução pela visualização escolhida'
  // Represented by an EXISTING fluxo's drawer (see the constant + comment above) rather
  // than the one just configured above, which was never saved. EntregasPage.tsx reads
  // ?drawer=<id> and opens that workflow's WorkflowDrawer once its data loads -- a
  // deterministic deep link, avoiding the need to find/click a specific card in a
  // grouped Kanban board (also two workflows share this one's exact title).
  await page.goto(`/entregas?drawer=${EXISTING_WORKFLOW_ID_FOR_EXECUTION_VIEW}`);
  const drawerTitle = page.locator('.drawer-header-title');
  await expect(drawerTitle).toHaveText('Estúdio - Studio Bem-Estar - 03/07/2026');
  // Posts render collapsed by default (no initialPostId on this navigation path) as
  // plain text rows with an icon *badge*, not an <img> -- no image-decode wait needed.
  await page.locator('.drawer-post-titulo', { hasText: 'Post 2' }).waitFor();
  await shoot(page, SLUG, 6, 'step-acompanhar-execucao');

  // ── Group B: "Visualizações disponíveis" (5-item bullet list) ──────────────
  // Reused from the existing fluxos already in the workspace -- no writes at all.

  await page.goto('/entregas');
  await page.getByRole('heading', { name: 'Entregas', exact: true }).waitFor();

  // View 1 -- Kanban (default tab on load)
  await page.locator('.board-card').first().waitFor();
  await waitForFadeIn(page);
  await shoot(page, SLUG, 1, 'view-kanban');

  // View 2 -- Gráfico
  await page.getByRole('button', { name: 'Gráfico' }).click();
  // `canvas` alone is ambiguous -- the sidebar's mobile bottom-nav also renders an
  // (off-screen at this desktop viewport) `.mobile-nav-canvas`. Chart.js sets
  // role="img" on the chart's own canvas; that's unique on this page.
  const canvas = page.locator('canvas[role="img"]');
  await canvas.waitFor();
  let previousSample = -1;
  await expect
    .poll(
      async () => {
        const sample = await canvasPixelSample(canvas);
        const stable = sample > 0 && sample === previousSample;
        previousSample = sample;
        return stable;
      },
      { timeout: 5_000 },
    )
    .toBe(true);
  await waitForFadeIn(page);
  await shoot(page, SLUG, 2, 'view-grafico');

  // View 3 -- Calendário
  await page.getByRole('button', { name: 'Calendário' }).click();
  await page.locator('.month-grid-title').waitFor();
  await waitForFadeIn(page);
  await shoot(page, SLUG, 3, 'view-calendario');

  // View 4 -- Lista
  await page.getByRole('button', { name: 'Lista' }).click();
  await page.getByRole('columnheader', { name: 'Título' }).waitFor();
  await waitForFadeIn(page);
  await shoot(page, SLUG, 4, 'view-lista');

  // View 5 -- Concluídas
  // Verified via REST against prod before writing this spec: there are currently ZERO
  // concluded workflows in this workspace, so this view's real, honest state is its
  // empty state -- not a loading spinner or a bug. Group B is zero-write, so no fluxo is
  // completed just to populate this screenshot; see the task report for this call-out.
  await page.getByRole('button', { name: 'Concluídas' }).click();
  await page.getByText('Nenhum fluxo concluído ainda.').waitFor();
  await waitForFadeIn(page);
  await shoot(page, SLUG, 5, 'view-concluidas');

  // Fails the run if anything outward-facing was attempted. Must be last.
  assertNoViolations(violations);
});
