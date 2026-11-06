import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Button, buttonVariants } from '../button';
import { Tabs, TabsList, TabsTrigger } from '../tabs';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '../card';
import { Input } from '../input';
import { Textarea } from '../textarea';
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '../table';
import { Checkbox } from '../checkbox';
import { Switch } from '../switch';
import { Calendar } from '../calendar';
import { cn } from '@/lib/utils';

describe('data-slot hooks', () => {
  it('marks Button, also through asChild', () => {
    render(
      <>
        <Button>Salvar</Button>
        <Button asChild>
          <a href="/x">Link</a>
        </Button>
      </>,
    );
    expect(screen.getByRole('button', { name: 'Salvar' })).toHaveAttribute('data-slot', 'button');
    expect(screen.getByRole('link', { name: 'Link' })).toHaveAttribute('data-slot', 'button');
  });

  it('marks TabsList and TabsTrigger', () => {
    render(
      <Tabs defaultValue="a">
        <TabsList>
          <TabsTrigger value="a">A</TabsTrigger>
        </TabsList>
      </Tabs>,
    );
    expect(screen.getByRole('tablist')).toHaveAttribute('data-slot', 'tabs-list');
    expect(screen.getByRole('tab', { name: 'A' })).toHaveAttribute('data-slot', 'tabs-trigger');
  });
});

describe('vidro body hooks', () => {
  it('Button carries variant and size, defaulting to default', () => {
    render(
      <>
        <Button>A</Button>
        <Button variant="outline" size="sm">
          B
        </Button>
      </>,
    );
    const a = screen.getByRole('button', { name: 'A' });
    expect(a).toHaveAttribute('data-variant', 'default');
    expect(a).toHaveAttribute('data-size', 'default');
    const b = screen.getByRole('button', { name: 'B' });
    expect(b).toHaveAttribute('data-variant', 'outline');
    expect(b).toHaveAttribute('data-size', 'sm');
    // Button wraps buttonVariants in cn (twMerge), so compare against the same.
    expect(b.className).toBe(cn(buttonVariants({ variant: 'outline', size: 'sm' })));
  });

  it('marks Card, Input, Textarea, Table parts, Checkbox, Switch', () => {
    const { container } = render(
      <>
        <Card>
          <CardHeader>
            <CardTitle>T</CardTitle>
            <CardDescription>d</CardDescription>
          </CardHeader>
          <CardContent>c</CardContent>
          <CardFooter>f</CardFooter>
        </Card>
        <Input aria-label="i" />
        <Textarea aria-label="t" />
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>H</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell>C</TableCell>
            </TableRow>
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell>F</TableCell>
            </TableRow>
          </TableFooter>
        </Table>
        <Checkbox aria-label="cb" />
        <Switch aria-label="sw" />
      </>,
    );
    for (const slot of [
      'card',
      'card-header',
      'card-title',
      'card-description',
      'card-content',
      'card-footer',
      'table-container',
      'table',
      'table-header',
      'table-body',
      'table-footer',
      'table-row',
      'table-head',
      'table-cell',
      'switch-thumb',
    ]) {
      expect(container.querySelector(`[data-slot='${slot}']`), slot).not.toBeNull();
    }
    expect(screen.getByRole('textbox', { name: 'i' })).toHaveAttribute('data-slot', 'input');
    expect(screen.getByRole('textbox', { name: 't' })).toHaveAttribute('data-slot', 'textarea');
    expect(screen.getByRole('checkbox', { name: 'cb' })).toHaveAttribute('data-slot', 'checkbox');
    expect(screen.getByRole('switch', { name: 'sw' })).toHaveAttribute('data-slot', 'switch');
  });

  it('keeps the class strings of the marked parts unchanged', () => {
    const { container } = render(
      <>
        <Card className="x">
          <CardContent>c</CardContent>
        </Card>
        <Table>
          <TableBody>
            <TableRow>
              <TableCell>C</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </>,
    );
    expect(container.querySelector("[data-slot='card']")?.className).toBe(
      'rounded-xl border bg-card text-card-foreground shadow x',
    );
    expect(container.querySelector("[data-slot='table-container']")?.className).toBe(
      'relative w-full overflow-auto',
    );
    expect(container.querySelector("[data-slot='table']")?.className).toBe(
      'w-full caption-bottom text-sm',
    );
  });

  it('adds the inert vidro-cal-* classes to the Calendar nav and day buttons', () => {
    const { container } = render(<Calendar mode="single" defaultMonth={new Date(2026, 9, 1)} />);
    expect(container.querySelectorAll('.vidro-cal-nav')).toHaveLength(2);
    expect(container.querySelectorAll('.vidro-cal-day').length).toBeGreaterThan(27);
    expect(container.querySelector('.vidro-cal-day')?.tagName).toBe('BUTTON');
  });

  it('marks range-middle days with the inert vidro-cal-range-middle class, next to the classic tokens', () => {
    const { container } = render(
      <Calendar
        mode="range"
        defaultMonth={new Date(2026, 9, 1)}
        selected={{ from: new Date(2026, 9, 5), to: new Date(2026, 9, 9) }}
      />,
    );
    const middles = container.querySelectorAll('.vidro-cal-range-middle');
    expect(middles).toHaveLength(3);
    for (const td of middles) {
      expect(td.className).toContain(
        'aria-selected:bg-accent aria-selected:text-accent-foreground',
      );
    }
  });
});
