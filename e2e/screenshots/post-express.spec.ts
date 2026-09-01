import { test } from '@playwright/test';
import path from 'node:path';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { installSafetyNet, assertNoViolations } from './safety';
import { shoot } from './capture';

const SLUG = 'como-usar-o-post-express';

// A throwaway 16x16 gradient PNG, generated once and embedded as base64 so this
// spec is self-contained: no binary fixture committed to the repo, and no
// dependency on any path outside this file. Written to a fresh temp dir per
// run so parallel/serial re-invocations never collide.
const FIXTURE_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAABlklEQVR42g3LQQEAIQgAQRsQwQhEIAIRjEAEIhjBCHz2bwQjGMEKd/Of1hrS6A1tWMMboxGNbMzGalRjN07jNl6jNUGELqhgggtDCCGFKSyhhC0c4QpP/tCRTu9oxzreGZ3oZGd2Vqc6u3M6t/P6HxRRuqKKKa4MJZRUprKUUrZylKs8/YMhRjfUMMONYYSRxjSWUcY2jnGNZ39wxOmOOua4M5xw0pnOcsrZznGu8/wPAxn0gQ5s4IMxiEEO5mANarAHZ3AHb/whkKAHGljgwQgiyGAGK6hgBye4wYs/JJL0RBNLPBlJJJnMZCWV7OQkN3n5h4lM+kQnNvHJmMQkJ3OyJjXZkzO5kzf/sJBFX+jCFr4Yi1jkYi7WohZ7cRZ38dYfCil6oYUVXowiiixmsYoqdnGKW7z6w0Y2faMb2/hmbGKTm7lZm9rszdnczdt/OMihH/RgBz+MQxzyMA/rUId9OId7eOcPF7n0i17s4pdxiUte5mVd6rIv53Iv7/7hIY/+0Ic9/DEe8cjHfKxHPfbjPO7jPT4w9aIwBrSElgAAAABJRU5ErkJggg==';

function writeFixtureImage(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'kb-post-express-'));
  const file = path.join(dir, 'fixture.png');
  writeFileSync(file, Buffer.from(FIXTURE_PNG_BASE64, 'base64'));
  return file;
}

// Post-#330 layout: a single-column 5-step vertical stepper (Formato, Cliente,
// Mídia, Legenda do Instagram, Envio) plus a "Modo de envio" toggle in step 5
// (Publicar agora / Aprovação do cliente). Control 1 is unchanged: never click
// the submit button (data-testid="express-submit") -- in 'now' mode it
// publishes to a real Instagram account, in approval mode it sends a real post
// to the client portal. The safety net stays installed as backstop.

test.describe.configure({ mode: 'serial' });

test('post express walkthrough', async ({ page }) => {
  const violations = await installSafetyNet(page);

  // Etapa 1 -- Formato. Wait until the client <select> is populated: while the
  // clients query is in flight the page shows its "Nenhum cliente com
  // Instagram configurado" empty-state banner, and a shot taken then captures
  // that loading flash instead of the real resting state.
  await page.goto('/post-express');
  await page.getByRole('heading', { name: /post express/i }).waitFor();
  await page.getByText(/Etapa 1/).waitFor();
  const clientSelect = page.locator('select');
  await clientSelect.waitFor();
  await page
    .locator('select option', { hasText: 'Studio Bem-Estar' })
    .waitFor({ state: 'attached', timeout: 15_000 });
  await shoot(page, SLUG, 1, 'etapa-formato');

  // Etapa 2 -- Cliente (native <select>: selectOption drives it directly; an
  // opened dropdown is OS chrome that page.screenshot() cannot capture anyway)
  await clientSelect.selectOption({ label: 'Studio Bem-Estar' });
  // The capture workspace's IG tokens are deliberately fake (DK TESTE), so the
  // client card renders the expired-token warning -- an environment artifact a
  // reader with a healthy connection never sees. Hide that one banner for the
  // shots; everything else is the page's real state.
  await page
    .getByText('Token do Instagram expirou', { exact: false })
    .locator('..')
    .evaluate((el) => {
      (el as HTMLElement).style.display = 'none';
    })
    .catch(() => {});
  // Selecting a client kicks off async draft creation; the media dropzone only
  // renders once the draft exists.
  await page.getByText('Adicionar', { exact: true }).waitFor();
  await shoot(page, SLUG, 2, 'selecionar-cliente');

  // Etapa 3 -- Mídia. The first upload is marked as cover automatically, so
  // the 'capa' badge is a concrete upload-finished signal (not a skeleton).
  const fileInput = page.locator('input[type="file"][multiple]');
  await fileInput.setInputFiles(writeFixtureImage());
  await page.getByText('capa').waitFor();
  await page
    .getByText('Upload concluído')
    .waitFor({ state: 'hidden', timeout: 8_000 })
    .catch(() => {});
  await shoot(page, SLUG, 3, 'enviar-midia');

  // Etapa 4 -- Legenda do Instagram
  const captionBox = page.locator('textarea');
  await captionBox.fill('Exemplo de legenda para o artigo de ajuda.');
  await shoot(page, SLUG, 4, 'escrever-legenda');

  // Etapa 5 -- Envio, modo "Publicar agora" (the default). Anchor on the step
  // label: "Publicar agora" appears twice (mode toggle + submit CTA), so a
  // role query on the button name is ambiguous by design here.
  const stepFive = page.getByText(/Etapa 5/);
  await stepFive.scrollIntoViewIfNeeded();
  await page.getByRole('button', { name: 'Aprovação do cliente', exact: true }).waitFor();
  await shoot(page, SLUG, 5, 'modo-de-envio');

  // Modo "Aprovação do cliente": wait for the hub-link status line (either the
  // active-link confirmation or the missing-link warning) so the shot shows
  // the mode's explanatory state, then capture. Do NOT click submit.
  await page.getByRole('button', { name: 'Aprovação do cliente', exact: true }).click();
  await page
    .getByText(/Link do portal ativo|não tem um link ativo/)
    .waitFor({ timeout: 10_000 })
    .catch(() => {});
  await shoot(page, SLUG, 6, 'aprovacao-do-cliente');

  // Fails the run if anything outward-facing was attempted. Must be last.
  assertNoViolations(violations);
});
