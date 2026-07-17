import { test, expect } from '@playwright/test';
import path from 'node:path';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { installSafetyNet, assertNoViolations } from './safety';
import { shoot } from './capture';

const SLUG = 'como-usar-o-post-express';

// A throwaway 16x16 gradient PNG, generated once and embedded as base64 so this
// spec is self-contained: no binary fixture committed to the repo, and no
// dependency on any path outside this file (an earlier version pointed at an
// agent-session-scoped scratchpad directory, which would not exist on a
// re-run from a different session or machine). Written to a fresh temp dir
// per run so parallel/serial re-invocations never collide.
const FIXTURE_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAABlklEQVR42g3LQQEAIQgAQRsQwQhEIAIRjEAEIhjBCHz2bwQjGMEKd/Of1hrS6A1tWMMboxGNbMzGalRjN07jNl6jNUGELqhgggtDCCGFKSyhhC0c4QpP/tCRTu9oxzreGZ3oZGd2Vqc6u3M6t/P6HxRRuqKKKa4MJZRUprKUUrZylKs8/YMhRjfUMMONYYSRxjSWUcY2jnGNZ39wxOmOOua4M5xw0pnOcsrZznGu8/wPAxn0gQ5s4IMxiEEO5mANarAHZ3AHb/whkKAHGljgwQgiyGAGK6hgBye4wYs/JJL0RBNLPBlJJJnMZCWV7OQkN3n5h4lM+kQnNvHJmMQkJ3OyJjXZkzO5kzf/sJBFX+jCFr4Yi1jkYi7WohZ7cRZ38dYfCil6oYUVXowiiixmsYoqdnGKW7z6w0Y2faMb2/hmbGKTm7lZm9rszdnczdt/OMihH/RgBz+MQxzyMA/rUId9OId7eOcPF7n0i17s4pdxiUte5mVd6rIv53Iv7/7hIY/+0Ic9/DEe8cjHfKxHPfbjPO7jPT4w9aIwBrSElgAAAABJRU5ErkJggg==';

function writeFixtureImage(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'kb-post-express-'));
  const file = path.join(dir, 'fixture.png');
  writeFileSync(file, Buffer.from(FIXTURE_PNG_BASE64, 'base64'));
  return file;
}

// Task 4 Step 3 finding (verified against source, not re-litigated since):
// scheduling a post is a raw PostgREST write -- updateWorkflowPost
// (apps/crm/src/store/posts.ts:458-470) does
// supabase.from('workflow_posts').update({ status: 'agendado' }), i.e. a
// PATCH to /rest/v1/workflow_posts that never touches /functions/v1/. The
// safety net's **/rest/v1/** interceptor (installSafetyNet, extended in
// cc9dade1 / isSchedulingWrite()) blocks exactly this shape as a backstop.
// Post Express itself exposes no schedule control at all (only "Publicar
// agora" / "Publicar Stories"), so Control 1 here is simply: never click
// Publish.

test.describe.configure({ mode: 'serial' });

test('post express walkthrough', async ({ page }) => {
  const violations = await installSafetyNet(page);

  // Step 1 -- 'Acesse Post Express'
  await page.goto('/post-express');
  await page.getByRole('heading', { name: /post express/i }).waitFor();
  await shoot(page, SLUG, 1, 'acessar-post-express');

  // Step 2 -- 'Selecione o cliente'
  // This is a native <select>, not a custom listbox: selectOption() drives it
  // directly. Clicking it to "open" the dropdown would trigger an OS-native
  // popup on macOS that Playwright's page.screenshot() cannot capture (it
  // only captures the page's own render tree, not OS chrome), so the
  // brief's illustrative click+option pattern does not apply here.
  const clientSelect = page.locator('select');
  await clientSelect.waitFor();
  await clientSelect.selectOption({ label: 'Studio Bem-Estar' });
  // Selecting a client kicks off an async draft (workflow + workflow_post)
  // creation; the media upload card only renders once `draft` is set. Wait
  // for the dropzone itself (not just the card label) so the gallery's own
  // "loading" skeleton (PostMediaGallery's mediaLoading state) has resolved
  // before the shot -- otherwise this step's screenshot risks catching that
  // skeleton mid-fade.
  await page.getByText('Adicionar', { exact: true }).waitFor();
  await shoot(page, SLUG, 2, 'selecionar-cliente');

  // Step 3 -- 'Envie a mídia ou mídias do post'
  const fileInput = page.locator('input[type="file"][multiple]');
  await fileInput.setInputFiles(writeFixtureImage());
  // Wait for the uploaded tile's cover badge -- post-media-finalize marks the
  // first upload as the cover automatically, so this is a concrete signal
  // the upload finished and the thumbnail rendered (not a spinner/skeleton).
  await page.getByText('capa').waitFor();
  await shoot(page, SLUG, 3, 'enviar-midia');

  // Step 4 -- 'Revise o tipo detectado: feed, reels ou carrossel'
  // A single image with no story toggle detects as 'Feed'; the badge is
  // computed synchronously from the media list, so it's already visible by
  // the time the cover badge above rendered. Re-assert it explicitly so this
  // step's screenshot is anchored to its own selector, not a reused wait.
  await page.getByText('Feed', { exact: true }).waitFor();
  // Let the transient "Upload concluído" toast clear so steps 3 and 4 aren't
  // pixel-identical, and confirm the Instagram Preview's own <img> (a
  // separate element from the gallery tile, fetching the same file over the
  // network) has actually finished loading -- not just mounted. Without
  // this, the preview renders as a blank dark square in later screenshots:
  // `.complete` is true for a still-loading OR broken <img>, but
  // `naturalWidth > 0` only once pixels have actually decoded, so this is a
  // real load check, not a bare timeout. The only <img alt=""> on this page
  // at this point in the flow is the Preview panel's media image (the two
  // avatar slots that would also match render as a gradient div instead,
  // since this client has no profile_picture_url).
  await page.getByText('Upload concluído').waitFor({ state: 'hidden', timeout: 8_000 });
  const previewImg = page.locator('img[alt=""]');
  await previewImg.waitFor();
  await expect
    .poll(() =>
      previewImg.evaluate(
        (el) => (el as HTMLImageElement).complete && (el as HTMLImageElement).naturalWidth > 0,
      ),
    )
    .toBe(true);
  await shoot(page, SLUG, 4, 'tipo-detectado');

  // Step 5 -- 'Escreva a legenda com até 2.200 caracteres'
  const captionBox = page.locator('textarea');
  await captionBox.fill('Exemplo de legenda para o artigo de ajuda.');
  await shoot(page, SLUG, 5, 'escrever-legenda');

  // Step 6 -- 'Confira o preview e publique'
  // Capture the pre-click state only. Do NOT click publish.
  const publishButton = page.getByRole('button', { name: /publicar agora/i });
  await publishButton.scrollIntoViewIfNeeded();
  await shoot(page, SLUG, 6, 'preview-e-publicar');

  // Fails the run if anything outward-facing was attempted. Must be last.
  assertNoViolations(violations);
});
