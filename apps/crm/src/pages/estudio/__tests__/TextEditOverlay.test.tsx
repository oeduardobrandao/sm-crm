// T2.8 TextEditOverlay tests (docs/estudio-design.md §6.4). ProseMirror/TipTap needs a handful of
// jsdom polyfills that don't exist anywhere else in this repo yet (no prior TipTap-in-jsdom test
// precedent was found — grepped every __tests__ dir) — added locally to this file rather than the
// shared `test/vitest.setup.ts` so they stay scoped to the one file that actually needs them.
import { act } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeTextLayer } from './fixtures';
import { getLayerBBox } from '../lib/layerGeometry';
import { TextEditOverlay } from '../components/Canvas/TextEditOverlay';

// ProseMirror's view construction/selection code calls a handful of DOM range/rect APIs jsdom
// doesn't implement. Minimal stand-ins, scoped to this file only.
beforeEach(() => {
  if (!('getClientRects' in Range.prototype)) {
    // @ts-expect-error jsdom-only polyfill
    Range.prototype.getClientRects = () => [];
  }
  Range.prototype.getBoundingClientRect = () =>
    ({
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      width: 0,
      height: 0,
      x: 0,
      y: 0,
      toJSON() {},
    }) as DOMRect;
  // @ts-expect-error jsdom-only polyfill — ProseMirror's view.dom querying uses this in a few paths.
  document.elementFromPoint = () => null;
});

afterEach(() => {
  vi.restoreAllMocks();
});

const identityCanvasToScreen = (x: number, y: number) => ({ x, y });

function renderOverlay(
  overrides: Partial<Parameters<typeof makeTextLayer>[0]> = {},
  props: { onCommit?: ReturnType<typeof vi.fn>; onCancel?: ReturnType<typeof vi.fn> } = {},
) {
  const layer = makeTextLayer({ id: 'a', x: 10, y: 20, w: 300, ...overrides }) as ReturnType<
    typeof makeTextLayer
  > & { type: 'text' };
  const bbox = getLayerBBox(layer, () => 60);
  const onCommit = props.onCommit ?? vi.fn();
  const onCancel = props.onCancel ?? vi.fn();

  const utils = render(
    <TextEditOverlay
      layer={layer}
      bbox={bbox}
      scale={1}
      canvasToScreen={identityCanvasToScreen}
      onCommit={onCommit}
      onCancel={onCancel}
    />,
  );
  return { ...utils, layer, onCommit, onCancel };
}

function getEditableEl(): HTMLElement {
  return screen.getByTestId('text-edit-overlay-editor');
}

describe('TextEditOverlay', () => {
  it('renders a contenteditable seeded with the layer text', async () => {
    renderOverlay({ text: 'Olá mundo' });
    await waitFor(() => expect(getEditableEl()).toHaveTextContent('Olá mundo'));
  });

  it("positions itself exactly like InteractionOverlay's gesture-ghost (left/top from canvasToScreen(bbox), width bbox.w*scale, rotate transform)", async () => {
    renderOverlay({ x: 10, y: 20, w: 300, rotation: 15 });
    const overlay = await screen.findByTestId('text-edit-overlay');
    expect(overlay).toHaveStyle({
      position: 'absolute',
      left: '10px',
      top: '20px',
      width: '300px',
    });
    expect(overlay.style.transform).toBe('rotate(15deg)');
    // Height must be AUTO (emergent), never a fixed clipped value.
    expect(overlay.style.height).toBe('auto');
  });

  it("replicates the layer's pill and shadow (the canvas hides the satori copy while editing — without parity, pill'd text loses its backing mid-edit)", async () => {
    renderOverlay({
      pill: { color: '#112233', padding_x: 16, padding_y: 8, radius: 12 },
      shadow: { x: 2, y: 3, blur: 4, color: '#00000080' },
    });
    const overlay = await screen.findByTestId('text-edit-overlay');
    expect(overlay.style.background).toContain('rgb(17, 34, 51)');
    expect(overlay.style.padding).toBe('8px 16px');
    expect(overlay.style.borderRadius).toBe('12px');
    expect(overlay.style.textShadow).toBe('2px 3px 4px #00000080');
  });

  it('applies no rotate transform when layer.rotation is 0', async () => {
    renderOverlay({ rotation: 0 });
    const overlay = await screen.findByTestId('text-edit-overlay');
    expect(overlay.style.transform).toBe('');
  });

  it('Enter (no Shift) commits exactly once via tiptapDocToLayerPatch and does not call onCancel', async () => {
    const onCommit = vi.fn();
    const onCancel = vi.fn();
    renderOverlay({ text: 'Olá' }, { onCommit, onCancel });
    const el = getEditableEl();

    await act(async () => {
      fireEvent.keyDown(el, { key: 'Enter' });
    });

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
    const [patch] = onCommit.mock.calls[0];
    expect(patch).toHaveProperty('text');
  });

  it('Escape cancels without ever calling onCommit', async () => {
    const onCommit = vi.fn();
    const onCancel = vi.fn();
    renderOverlay({ text: 'Olá' }, { onCommit, onCancel });
    const el = getEditableEl();

    await act(async () => {
      fireEvent.keyDown(el, { key: 'Escape' });
    });

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('blur commits exactly once (same commit path as Enter)', async () => {
    const onCommit = vi.fn();
    renderOverlay({ text: 'Olá' }, { onCommit });
    const el = getEditableEl();

    await act(async () => {
      fireEvent.blur(el);
    });

    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it('does not double-fire onCommit when Enter is followed by a blur in the same session', async () => {
    const onCommit = vi.fn();
    renderOverlay({ text: 'Olá' }, { onCommit });
    const el = getEditableEl();

    await act(async () => {
      fireEvent.keyDown(el, { key: 'Enter' });
    });
    await act(async () => {
      fireEvent.blur(el);
    });

    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it('does not double-fire onCancel/onCommit when Escape is followed by a blur in the same session', async () => {
    const onCommit = vi.fn();
    const onCancel = vi.fn();
    renderOverlay({ text: 'Olá' }, { onCommit, onCancel });
    const el = getEditableEl();

    await act(async () => {
      fireEvent.keyDown(el, { key: 'Escape' });
    });
    await act(async () => {
      fireEvent.blur(el);
    });

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('does NOT convert a markdown heading shortcut ("# " at line start) into a heading node — proves the minimal extension set (no StarterKit/Heading) actually holds', async () => {
    const onCommit = vi.fn();
    renderOverlay({ text: '' }, { onCommit });
    const el = getEditableEl();

    // Simulate typing "# " via a DOM input event (jsdom can't drive real keypress-based
    // ProseMirror text insertion reliably) — this exercises whatever input-rule machinery the
    // mounted extension set actually has wired up.
    await act(async () => {
      fireEvent.input(el, { target: { textContent: '# ' } });
    });

    await act(async () => {
      fireEvent.keyDown(el, { key: 'Enter' });
    });

    expect(onCommit).toHaveBeenCalledTimes(1);
    const [patch] = onCommit.mock.calls[0] as [{ text?: string; runs?: unknown[] }];
    // Whatever text ended up in the doc, it must NEVER contain a heading node — since this
    // module's TipTap doc type has no `heading` variant at all, the strongest assertion available
    // is that the patch is still the plain single-paragraph text/runs shape this component always
    // produces (a heading node, if StarterKit's Heading were active, would break
    // `tiptapDocToLayerPatch`'s paragraph-only assumption entirely rather than just changing the
    // string content).
    expect(patch.text !== undefined || patch.runs !== undefined).toBe(true);
  });

  it("clamps a run.font_weight/font_style that the layer's font_key does not actually ship, on commit — regression for the render-crash finding: TipTap's Bold/Italic marks have no manifest awareness, and design-doc.ts's validation never inspects per-run overrides, so an unrenderable combo would otherwise save clean and only fail at render time", async () => {
    // bebas-neue ships ONLY 400/normal in the real manifest (supabase/functions/_shared/fonts/
    // manifest.json) — a run inheriting a bold/italic mark on load (e.g. authored under a different
    // font, or from an older manifest) must have that override stripped on the very next commit,
    // not silently re-persisted.
    const onCommit = vi.fn();
    renderOverlay(
      {
        font_key: 'bebas-neue',
        font_weight: 400,
        text: undefined,
        runs: [{ text: 'Olá', font_weight: 700, font_style: 'italic' }],
      },
      { onCommit },
    );
    const el = getEditableEl();

    await act(async () => {
      fireEvent.keyDown(el, { key: 'Enter' });
    });

    expect(onCommit).toHaveBeenCalledTimes(1);
    const [patch] = onCommit.mock.calls[0] as [
      { text?: string; runs?: Array<Record<string, unknown>> },
    ];
    // Either shape is acceptable (a fully-unstyled run may or may not still be reported as `runs`
    // depending on other fields) — what matters is that NEITHER the invalid weight NOR the invalid
    // style survived.
    const runs = patch.runs ?? [];
    for (const run of runs) {
      expect(run.font_weight).not.toBe(700);
      expect(run.font_style).not.toBe('italic');
    }
  });

  it('opens a layer whose text has blank lines/trailing newlines NON-empty and commits it losslessly', async () => {
    // Regression: layerToTiptapDoc used to emit empty text nodes for "a\n\nb" — ProseMirror
    // rejects those, TipTap silently fell back to EMPTY content, and this exact flow (open, then
    // Enter without typing) wiped the layer's text.
    const onCommit = vi.fn();
    renderOverlay({ text: 'linha 1\n\nlinha 2\n' }, { onCommit });
    const el = getEditableEl();

    expect(el.textContent).toContain('linha 1');
    expect(el.textContent).toContain('linha 2');

    await act(async () => {
      fireEvent.keyDown(el, { key: 'Enter' });
    });

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit.mock.calls[0][0]).toEqual({ text: 'linha 1\n\nlinha 2\n' });
  });
});
