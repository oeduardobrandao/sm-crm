import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Badge } from '../badge';
import { Button } from '../button';
import { Card, CardContent, CardHeader, CardTitle } from '../card';
import { Skeleton } from '../skeleton';

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
});
