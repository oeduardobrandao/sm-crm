import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Button } from '../button';
import { Tabs, TabsList, TabsTrigger } from '../tabs';

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
