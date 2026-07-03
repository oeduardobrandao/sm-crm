import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ContextualToolbar from '../components/Toolbar/ContextualToolbar';
import { makeTextLayer, makeImageLayer, makeShapeLayer } from './fixtures';
import type { NormalizedLayer } from '../types';

describe('ContextualToolbar', () => {
  it('renders nothing when layer is null', () => {
    const { container } = render(<ContextualToolbar layer={null} onUpdateLayer={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  describe('text variant', () => {
    function renderText(overrides: Partial<NormalizedLayer> = {}) {
      const onUpdateLayer = vi.fn();
      const layer = makeTextLayer(overrides) as Extract<NormalizedLayer, { type: 'text' }>;
      render(<ContextualToolbar layer={layer} onUpdateLayer={onUpdateLayer} />);
      return { onUpdateLayer, layer };
    }

    it('renders font, weight, size, color, align, shadow and pill controls', () => {
      renderText();
      expect(screen.getByLabelText(/fonte/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/peso/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/tamanho/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/^cor$/i)).toBeInTheDocument();
      expect(screen.getByRole('group', { name: /alinhamento/i })).toBeInTheDocument();
      expect(screen.getByText(/sombra/i)).toBeInTheDocument();
      expect(screen.getByText(/fundo em pílula/i)).toBeInTheDocument();
    });

    it('filters font_weight options to the selected font_key actual variants (normal style)', () => {
      // dm-sans (per the real manifest fixture) ships only 400/normal + 700/normal — no 500/600/800/900.
      renderText({ font_key: 'dm-sans', font_weight: 400 });
      const weightSelect = screen.getByLabelText(/peso/i) as HTMLSelectElement;
      const values = Array.from(weightSelect.options).map((o) => o.value);
      expect(values).toEqual(['400', '700']);
    });

    it('filters font_weight options by font_style so italic/normal stay consistent', () => {
      // playfair-display ships 400/normal, 700/normal, 400/italic — no 700/italic.
      renderText({ font_key: 'playfair-display', font_weight: 400, font_style: 'italic' });
      const weightSelect = screen.getByLabelText(/peso/i) as HTMLSelectElement;
      const values = Array.from(weightSelect.options).map((o) => o.value);
      expect(values).toEqual(['400']);
    });

    it('commits font_key change immediately and resets font_weight if unsupported', () => {
      const { onUpdateLayer } = renderText({ font_key: 'dm-sans', font_weight: 700 });
      const fontSelect = screen.getByLabelText(/fonte/i) as HTMLSelectElement;
      // dm-serif-display only ships 400/normal -> should fall back to its first normal weight (400)
      fireEvent.change(fontSelect, { target: { value: 'dm-serif-display' } });
      expect(onUpdateLayer).toHaveBeenCalledWith('layer-1', {
        font_key: 'dm-serif-display',
        font_weight: 400,
      });
    });

    it("resets font_style to normal when switching to a family that does not ship the layer's current style — regression: an italic layer switched to an all-normal family previously kept font_style:'italic' unchanged, reaching a (font_key, font_weight, font_style) combo the new family does not have, which only failed at save time", () => {
      // playfair-display ships 400/italic; bebas-neue ships ONLY 400/normal (no italic at all,
      // per the real manifest) — the worst case, since there's no italic fallback weight to find.
      const { onUpdateLayer } = renderText({
        font_key: 'playfair-display',
        font_weight: 400,
        font_style: 'italic',
      });
      const fontSelect = screen.getByLabelText(/fonte/i) as HTMLSelectElement;
      fireEvent.change(fontSelect, { target: { value: 'bebas-neue' } });
      expect(onUpdateLayer).toHaveBeenCalledWith('layer-1', {
        font_key: 'bebas-neue',
        font_weight: 400,
        font_style: 'normal',
      });
    });

    it("does NOT touch font_style when the new family ships the layer's current style", () => {
      const { onUpdateLayer } = renderText({
        font_key: 'dm-sans',
        font_weight: 400,
        font_style: 'normal',
      });
      const fontSelect = screen.getByLabelText(/fonte/i) as HTMLSelectElement;
      fireEvent.change(fontSelect, { target: { value: 'dm-serif-display' } });
      const [, patch] = onUpdateLayer.mock.calls[0];
      expect(patch).not.toHaveProperty('font_style');
    });

    it('flushes an uncommitted CommitInput draft when the SELECTED LAYER changes (unmount) instead of silently discarding it — regression: switching layers mid-edit previously overwrote the draft via the value-sync effect with no commit and no warning', () => {
      const onUpdateLayer = vi.fn();
      const layerA = makeTextLayer({ id: 'a', font_size: 32 }) as Extract<
        NormalizedLayer,
        { type: 'text' }
      >;
      const layerB = makeTextLayer({ id: 'b', font_size: 48 }) as Extract<
        NormalizedLayer,
        { type: 'text' }
      >;
      const { rerender } = render(
        <ContextualToolbar layer={layerA} onUpdateLayer={onUpdateLayer} />,
      );

      const sizeInput = screen.getByLabelText(/tamanho/i) as HTMLInputElement;
      fireEvent.change(sizeInput, { target: { value: '99' } }); // typed, never blurred/committed

      rerender(<ContextualToolbar layer={layerB} onUpdateLayer={onUpdateLayer} />);

      expect(onUpdateLayer).toHaveBeenCalledWith('a', { font_size: 99 });
    });

    it('commits font_weight change immediately', () => {
      const { onUpdateLayer } = renderText({ font_key: 'dm-sans', font_weight: 400 });
      const weightSelect = screen.getByLabelText(/peso/i);
      fireEvent.change(weightSelect, { target: { value: '700' } });
      expect(onUpdateLayer).toHaveBeenCalledWith('layer-1', { font_weight: 700 });
    });

    it('commits font_size on blur, not on every keystroke', () => {
      const { onUpdateLayer } = renderText({ font_size: 32 });
      const sizeInput = screen.getByLabelText(/tamanho/i);
      fireEvent.change(sizeInput, { target: { value: '48' } });
      expect(onUpdateLayer).not.toHaveBeenCalled();
      fireEvent.blur(sizeInput);
      expect(onUpdateLayer).toHaveBeenCalledWith('layer-1', { font_size: 48 });
    });

    it('commits font_size on Enter', () => {
      const { onUpdateLayer } = renderText({ font_size: 32 });
      const sizeInput = screen.getByLabelText(/tamanho/i) as HTMLInputElement;
      sizeInput.focus();
      fireEvent.change(sizeInput, { target: { value: '20' } });
      fireEvent.keyDown(sizeInput, { key: 'Enter' });
      expect(onUpdateLayer).toHaveBeenCalledWith('layer-1', { font_size: 20 });
    });

    it('commits a valid 6-digit hex color on blur', () => {
      const { onUpdateLayer } = renderText({ color: '#000000' });
      const colorInput = screen.getByLabelText(/^cor$/i);
      fireEvent.change(colorInput, { target: { value: '#ff00aa' } });
      fireEvent.blur(colorInput);
      expect(onUpdateLayer).toHaveBeenCalledWith('layer-1', { color: '#ff00aa' });
    });

    it('does not commit an invalid hex color', () => {
      const { onUpdateLayer } = renderText({ color: '#000000' });
      const colorInput = screen.getByLabelText(/^cor$/i);
      fireEvent.change(colorInput, { target: { value: 'not-a-color' } });
      fireEvent.blur(colorInput);
      expect(onUpdateLayer).not.toHaveBeenCalled();
    });

    it('commits align change immediately with aria-pressed reflecting the active option', () => {
      const { onUpdateLayer } = renderText({ align: 'left' });
      const leftBtn = screen.getByRole('button', { name: /esquerda/i });
      const centerBtn = screen.getByRole('button', { name: /centro/i });
      expect(leftBtn).toHaveAttribute('aria-pressed', 'true');
      expect(centerBtn).toHaveAttribute('aria-pressed', 'false');
      fireEvent.click(centerBtn);
      expect(onUpdateLayer).toHaveBeenCalledWith('layer-1', { align: 'center' });
    });

    it('toggles shadow on with a default patch', () => {
      const { onUpdateLayer } = renderText({ shadow: undefined });
      const shadowBtn = screen.getByText(/sombra/i).nextElementSibling as HTMLElement;
      expect(shadowBtn).toHaveAttribute('aria-pressed', 'false');
      fireEvent.click(shadowBtn);
      expect(onUpdateLayer).toHaveBeenCalledWith('layer-1', {
        shadow: { x: 2, y: 2, blur: 4, color: '#00000080' },
      });
    });

    it('toggles shadow off with undefined when already set', () => {
      const onUpdateLayer = vi.fn();
      const layer = makeTextLayer({
        shadow: { x: 2, y: 2, blur: 4, color: '#00000080' },
      }) as Extract<NormalizedLayer, { type: 'text' }>;
      render(<ContextualToolbar layer={layer} onUpdateLayer={onUpdateLayer} />);
      const shadowBtn = screen.getByText(/sombra/i).nextElementSibling as HTMLElement;
      expect(shadowBtn).toHaveAttribute('aria-pressed', 'true');
      fireEvent.click(shadowBtn);
      expect(onUpdateLayer).toHaveBeenCalledWith('layer-1', { shadow: undefined });
    });

    it('toggles pill on with a default patch and off with undefined', () => {
      const { onUpdateLayer } = renderText({ pill: undefined });
      const pillBtn = screen.getByText(/fundo em pílula/i).nextElementSibling as HTMLElement;
      fireEvent.click(pillBtn);
      expect(onUpdateLayer).toHaveBeenCalledWith('layer-1', {
        pill: { color: '#000000', padding_x: 16, padding_y: 8, radius: 8 },
      });
    });
  });

  describe('image variant', () => {
    function renderImage(overrides: Parameters<typeof makeImageLayer>[0] = {}) {
      const onUpdateLayer = vi.fn();
      const onReplaceImage = vi.fn();
      const layer = makeImageLayer(overrides);
      render(
        <ContextualToolbar
          layer={layer}
          onUpdateLayer={onUpdateLayer}
          onReplaceImage={onReplaceImage}
        />,
      );
      return { onUpdateLayer, onReplaceImage, layer };
    }

    it('renders fit, radius, border and replace controls', () => {
      renderImage();
      expect(screen.getByLabelText(/ajuste/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/raio da borda/i)).toBeInTheDocument();
      expect(screen.getByText(/^borda$/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /substituir imagem/i })).toBeInTheDocument();
    });

    it('commits fit change immediately', () => {
      const { onUpdateLayer } = renderImage({ fit: 'cover' });
      fireEvent.change(screen.getByLabelText(/ajuste/i), { target: { value: 'contain' } });
      expect(onUpdateLayer).toHaveBeenCalledWith('layer-img-1', { fit: 'contain' });
    });

    it('commits radius on blur', () => {
      const { onUpdateLayer } = renderImage({ radius: 0 });
      const radiusInput = screen.getByLabelText(/raio da borda/i);
      fireEvent.change(radiusInput, { target: { value: '12' } });
      expect(onUpdateLayer).not.toHaveBeenCalled();
      fireEvent.blur(radiusInput);
      expect(onUpdateLayer).toHaveBeenCalledWith('layer-img-1', { radius: 12 });
    });

    it('toggles border on with a default patch and off with undefined', () => {
      const { onUpdateLayer } = renderImage({ border: undefined });
      const borderBtn = screen.getByText(/^borda$/i).nextElementSibling as HTMLElement;
      fireEvent.click(borderBtn);
      expect(onUpdateLayer).toHaveBeenCalledWith('layer-img-1', {
        border: { width: 2, color: '#ffffff' },
      });
    });

    it('calls onReplaceImage with the layer id when Replace is clicked', () => {
      const { onReplaceImage } = renderImage();
      fireEvent.click(screen.getByRole('button', { name: /substituir imagem/i }));
      expect(onReplaceImage).toHaveBeenCalledWith('layer-img-1');
    });

    it('does not throw when onReplaceImage is not provided', () => {
      const onUpdateLayer = vi.fn();
      const layer = makeImageLayer();
      render(<ContextualToolbar layer={layer} onUpdateLayer={onUpdateLayer} />);
      expect(() =>
        fireEvent.click(screen.getByRole('button', { name: /substituir imagem/i })),
      ).not.toThrow();
    });
  });

  describe('shape variant', () => {
    function renderShape(overrides: Parameters<typeof makeShapeLayer>[0] = {}) {
      const onUpdateLayer = vi.fn();
      const layer = makeShapeLayer(overrides);
      render(<ContextualToolbar layer={layer} onUpdateLayer={onUpdateLayer} />);
      return { onUpdateLayer, layer };
    }

    it('renders fill, stroke and radius controls', () => {
      renderShape();
      expect(screen.getByLabelText(/preenchimento/i)).toBeInTheDocument();
      expect(screen.getByText(/contorno/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/raio da borda/i)).toBeInTheDocument();
    });

    it('commits a solid fill color on blur', () => {
      const { onUpdateLayer } = renderShape({ shape: 'rect' });
      const fillInput = screen.getByLabelText(/preenchimento/i);
      fireEvent.change(fillInput, { target: { value: '#123456' } });
      fireEvent.blur(fillInput);
      expect(onUpdateLayer).toHaveBeenCalledWith('layer-shape-1', {
        fill: { type: 'solid', color: '#123456' },
      });
    });

    it('toggles stroke on with a default patch and off with undefined', () => {
      const { onUpdateLayer } = renderShape({ stroke: undefined });
      const strokeBtn = screen.getByText(/contorno/i).nextElementSibling as HTMLElement;
      fireEvent.click(strokeBtn);
      expect(onUpdateLayer).toHaveBeenCalledWith('layer-shape-1', {
        stroke: { width: 2, color: '#000000' },
      });
    });

    it('commits radius on blur for a rect shape', () => {
      const { onUpdateLayer } = renderShape({ shape: 'rect', radius: 0 });
      const radiusInput = screen.getByLabelText(/raio da borda/i);
      expect(radiusInput).not.toBeDisabled();
      fireEvent.change(radiusInput, { target: { value: '10' } });
      fireEvent.blur(radiusInput);
      expect(onUpdateLayer).toHaveBeenCalledWith('layer-shape-1', { radius: 10 });
    });

    it('disables the radius input for an ellipse shape', () => {
      renderShape({ shape: 'ellipse' });
      const radiusInput = screen.getByLabelText(/raio da borda/i);
      expect(radiusInput).toBeDisabled();
    });
  });
});
