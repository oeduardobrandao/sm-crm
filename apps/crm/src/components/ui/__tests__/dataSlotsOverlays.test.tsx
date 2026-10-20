import { render, screen } from '@testing-library/react';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { beforeAll, describe, expect, it } from 'vitest';
import { PhoneLayoutProvider } from '@/components/layout/PhoneLayoutContext';
import { Dialog, DialogContent, DialogTitle } from '../dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogTitle,
} from '../alert-dialog';
import { Sheet, SheetContent, SheetTitle } from '../sheet';
import { Popover, PopoverContent, PopoverTrigger } from '../popover';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '../dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '../select';
import { Command, CommandDialog, CommandInput, CommandItem, CommandList } from '../command';
import { ToggleGroup, ToggleGroupItem } from '../toggle-group';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../tooltip';

const q = (selector: string) => document.querySelector(selector);

beforeAll(() => {
  // cmdk scrolls the selected item into view; jsdom has no layout, so no scrollIntoView.
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
});

describe('vidro overlay hooks', () => {
  it('marks the desktop Dialog content and overlay, with the default layout', () => {
    render(
      <Dialog open onOpenChange={() => {}}>
        <DialogContent>
          <DialogTitle>Título</DialogTitle>
        </DialogContent>
      </Dialog>,
    );
    expect(q("[data-slot='dialog-content'][data-layout='default']")).not.toBeNull();
    expect(q("[data-slot='dialog-overlay']")).not.toBeNull();
  });

  it('marks a fullscreen Dialog with data-layout="fullscreen"', () => {
    render(
      <Dialog open onOpenChange={() => {}}>
        <DialogContent layout="fullscreen">
          <DialogTitle>Título</DialogTitle>
        </DialogContent>
      </Dialog>,
    );
    expect(q("[data-slot='dialog-content'][data-layout='fullscreen']")).not.toBeNull();
  });

  it('CommandDialog passes its layout through to the content', () => {
    render(
      <CommandDialog open onOpenChange={() => {}} layout="fullscreen">
        <CommandInput placeholder="Buscar" />
      </CommandDialog>,
    );
    expect(q("[data-slot='dialog-content'][data-layout='fullscreen']")).not.toBeNull();
    expect(q("[data-slot='dialog-content'] [data-slot='command']")).not.toBeNull();
  });

  it('leaves the phone sheet branches of Dialog and AlertDialog unmarked', async () => {
    const router = createBrowserRouter([
      {
        path: '*',
        element: (
          <PhoneLayoutProvider isPhone>
            <Dialog open onOpenChange={() => {}}>
              <DialogContent>
                <DialogTitle>Título</DialogTitle>
              </DialogContent>
            </Dialog>
            <AlertDialog open>
              <AlertDialogContent>
                <AlertDialogTitle>Confirmar</AlertDialogTitle>
              </AlertDialogContent>
            </AlertDialog>
          </PhoneLayoutProvider>
        ),
      },
    ]);
    const { unmount } = render(<RouterProvider router={router} />);
    await screen.findByText('Título');
    expect(q('.phone-dialog')).not.toBeNull();
    expect(q('.phone-alert')).not.toBeNull();
    expect(q("[data-slot='dialog-content']")).toBeNull();
    expect(q("[data-slot='dialog-overlay']")).toBeNull();
    expect(q("[data-slot='alert-dialog-content']")).toBeNull();
    expect(q("[data-slot='alert-dialog-overlay']")).toBeNull();
    // The phone sheets pop their history entry on unmount (a popstate, then a timer); let that
    // settle here so it never fires after the jsdom environment is torn down.
    unmount();
    await new Promise((resolve) => setTimeout(resolve, 50));
  });

  it('marks AlertDialog content and overlay, and its Action and Cancel as buttons', () => {
    render(
      <AlertDialog open>
        <AlertDialogContent>
          <AlertDialogTitle>Confirmar</AlertDialogTitle>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction>Excluir</AlertDialogAction>
        </AlertDialogContent>
      </AlertDialog>,
    );
    expect(q("[data-slot='alert-dialog-content']")).not.toBeNull();
    expect(q("[data-slot='alert-dialog-overlay']")).not.toBeNull();
    const action = screen.getByRole('button', { name: 'Excluir' });
    expect(action).toHaveAttribute('data-slot', 'button');
    expect(action).toHaveAttribute('data-variant', 'default');
    expect(action).toHaveAttribute('data-size', 'default');
    const cancel = screen.getByRole('button', { name: 'Cancelar' });
    expect(cancel).toHaveAttribute('data-slot', 'button');
    expect(cancel).toHaveAttribute('data-variant', 'outline');
    expect(cancel).toHaveAttribute('data-size', 'default');
  });

  it('marks Sheet content and overlay', () => {
    render(
      <Sheet open>
        <SheetContent>
          <SheetTitle>Painel</SheetTitle>
        </SheetContent>
      </Sheet>,
    );
    expect(q("[data-slot='sheet-content']")).not.toBeNull();
    expect(q("[data-slot='sheet-overlay']")).not.toBeNull();
  });

  it('marks Popover content', () => {
    render(
      <Popover open>
        <PopoverTrigger>abrir</PopoverTrigger>
        <PopoverContent>conteúdo</PopoverContent>
      </Popover>,
    );
    expect(q("[data-slot='popover-content']")).not.toBeNull();
  });

  it('marks DropdownMenu content, items, sub menu, separator and label', () => {
    render(
      <DropdownMenu open>
        <DropdownMenuTrigger>menu</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuLabel>Rótulo</DropdownMenuLabel>
          <DropdownMenuItem>Item</DropdownMenuItem>
          <DropdownMenuCheckboxItem checked>Marcado</DropdownMenuCheckboxItem>
          <DropdownMenuRadioGroup value="a">
            <DropdownMenuRadioItem value="a">Rádio</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuSub open>
            <DropdownMenuSubTrigger>Mais</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuItem>Sub item</DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    expect(q("[data-slot='dropdown-menu-content']")).not.toBeNull();
    expect(q("[data-slot='dropdown-menu-label']")).not.toBeNull();
    expect(q("[data-slot='dropdown-menu-separator']")).not.toBeNull();
    expect(q("[data-slot='dropdown-menu-sub-trigger']")).not.toBeNull();
    expect(q("[data-slot='dropdown-menu-sub-content']")).not.toBeNull();
    for (const name of ['Item', 'Marcado', 'Rádio', 'Sub item']) {
      expect(
        screen.getByText(name).closest("[data-slot='dropdown-menu-item']"),
        name,
      ).not.toBeNull();
    }
  });

  it('marks the Select trigger when closed', () => {
    render(
      <Select>
        <SelectTrigger aria-label="Status">
          <SelectValue placeholder="Escolha" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="a">A</SelectItem>
        </SelectContent>
      </Select>,
    );
    expect(screen.getByRole('combobox', { name: 'Status' })).toHaveAttribute(
      'data-slot',
      'select-trigger',
    );
  });

  it('marks Select content, items and separator when open', () => {
    render(
      <Select open value="a">
        <SelectTrigger aria-label="Status">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="a">Opção A</SelectItem>
          <SelectSeparator />
          <SelectItem value="b">Opção B</SelectItem>
        </SelectContent>
      </Select>,
    );
    expect(q("[data-slot='select-content']")).not.toBeNull();
    expect(q("[data-slot='select-separator']")).not.toBeNull();
    expect(document.querySelectorAll("[data-slot='select-item']")).toHaveLength(2);
  });

  it('marks Command, its input and items', () => {
    render(
      <Command>
        <CommandInput placeholder="Buscar" />
        <CommandList>
          <CommandItem>Resultado</CommandItem>
        </CommandList>
      </Command>,
    );
    expect(q("[data-slot='command']")).not.toBeNull();
    expect(screen.getByPlaceholderText('Buscar')).toHaveAttribute('data-slot', 'command-input');
    expect(screen.getByText('Resultado').closest("[data-slot='command-item']")).not.toBeNull();
  });

  it('marks ToggleGroup and its items', () => {
    render(
      <ToggleGroup type="single" defaultValue="a">
        <ToggleGroupItem value="a">A</ToggleGroupItem>
        <ToggleGroupItem value="b">B</ToggleGroupItem>
      </ToggleGroup>,
    );
    expect(q("[data-slot='toggle-group']")).not.toBeNull();
    expect(document.querySelectorAll("[data-slot='toggle-group-item']")).toHaveLength(2);
  });

  it('marks Tooltip content', () => {
    render(
      <TooltipProvider>
        <Tooltip open>
          <TooltipTrigger>dica</TooltipTrigger>
          <TooltipContent>texto</TooltipContent>
        </Tooltip>
      </TooltipProvider>,
    );
    expect(q("[data-slot='tooltip-content']")).not.toBeNull();
  });
});
