import { render, screen, fireEvent } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Badge } from '../badge';
import { Button } from '../button';
import { Card, CardContent, CardHeader, CardTitle } from '../card';
import { Skeleton } from '../skeleton';
import { Switch } from '../switch';
import { Textarea } from '../textarea';

describe('admin primitives', () => {
  it('Badge maps variants to admin token classes', () => {
    render(<Badge variant="warning">Pendente</Badge>);
    const el = screen.getByText('Pendente');
    expect(el.className).toContain('text-warning');
    expect(el.className).toContain('bg-warning/10');
  });

  it('Badge solid tone fills the background', () => {
    render(
      <Badge variant="danger" tone="solid">
        6
      </Badge>,
    );
    expect(screen.getByText('6').className).toContain('bg-destructive ');
  });

  it('Button has no bottom margin baked in', () => {
    render(<Button>Ok</Button>);
    expect(screen.getByRole('button').className).not.toMatch(/\bmb-2\b/);
  });

  it('Card composes header and content', () => {
    render(
      <Card>
        <CardHeader>
          <CardTitle>Atenção</CardTitle>
        </CardHeader>
        <CardContent>corpo</CardContent>
      </Card>,
    );
    expect(screen.getByRole('heading', { name: 'Atenção' })).toBeInTheDocument();
    expect(screen.getByText('corpo')).toBeInTheDocument();
  });

  it('Skeleton is a pulsing block', () => {
    const { container } = render(<Skeleton className="h-3 w-10" />);
    expect(container.firstElementChild?.className).toContain('animate-pulse');
  });

  it('Textarea forwards ref, value and className', () => {
    const ref = createRef<HTMLTextAreaElement>();
    const onChange = vi.fn();
    render(
      <Textarea ref={ref} value="nota" onChange={onChange} className="extra" aria-label="Notas" />,
    );
    const el = screen.getByRole('textbox', { name: 'Notas' }) as HTMLTextAreaElement;
    expect(ref.current).toBe(el);
    expect(el.value).toBe('nota');
    expect(el.className).toContain('extra');
    fireEvent.change(el, { target: { value: 'nova' } });
    expect(onChange).toHaveBeenCalled();
  });

  it('Switch toggles aria-checked and respects disabled', () => {
    const onCheckedChange = vi.fn();
    render(<Switch aria-label="Ativo" onCheckedChange={onCheckedChange} />);
    const sw = screen.getByRole('switch', { name: 'Ativo' });
    expect(sw).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(sw);
    expect(onCheckedChange).toHaveBeenCalledWith(true);
    expect(sw).toHaveAttribute('aria-checked', 'true');
  });

  it('Switch disabled does not toggle', () => {
    const onCheckedChange = vi.fn();
    render(<Switch aria-label="Travado" disabled onCheckedChange={onCheckedChange} />);
    fireEvent.click(screen.getByRole('switch', { name: 'Travado' }));
    expect(onCheckedChange).not.toHaveBeenCalled();
  });
});
