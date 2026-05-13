# Workflow Drawer Calendar View — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an interactive, drag-and-drop calendar view inside the WorkflowDrawer so users can see all of a client's scheduled posts across workflows and schedule/reschedule/unschedule posts without leaving the drawer.

**Architecture:** Full drawer takeover toggled by a header button. A shared `MonthGrid` component provides the calendar grid structure (reused by existing CalendarView and ClienteDetalhePage). `@dnd-kit` powers drag-drop between an unscheduled-posts sidebar and the calendar grid cells. `scheduled_at` on `workflow_posts` is the canonical scheduling field.

**Tech Stack:** React 19, TypeScript, @dnd-kit/core + @dnd-kit/utilities, date-fns (parseISO, format, startOfMonth, endOfMonth, eachDayOfInterval, addMonths, subMonths, getDay, isSameDay), TanStack Query, Tailwind + CSS variables, lucide-react icons, sonner toasts.

**Spec:** `docs/superpowers/specs/2026-05-13-workflow-calendar-view-design.md`

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `apps/crm/src/components/ui/month-grid.tsx` | Shared month grid: 7-col layout, day headers (Seg–Dom), month nav, delegates cell content via `renderCell` |
| Create | `apps/crm/src/components/ui/__tests__/month-grid.test.tsx` | Tests for MonthGrid |
| Create | `apps/crm/src/pages/entregas/components/WorkflowCalendarView.tsx` | Calendar view container: DndContext, data fetching, drop handling, TimePickerPopover state |
| Create | `apps/crm/src/pages/entregas/components/CalendarGrid.tsx` | Wraps MonthGrid with droppable cells + post pills |
| Create | `apps/crm/src/pages/entregas/components/UnscheduledPostsSidebar.tsx` | Sidebar with draggable unscheduled post cards + droppable unschedule zone |
| Create | `apps/crm/src/pages/entregas/components/TimePickerPopover.tsx` | Time selection popover after drop |
| Create | `apps/crm/src/pages/entregas/components/__tests__/WorkflowCalendarView.test.tsx` | Integration tests for calendar view |
| Create | `apps/crm/src/pages/entregas/components/__tests__/TimePickerPopover.test.tsx` | Tests for TimePickerPopover |
| Modify | `apps/crm/src/store/posts.ts` | Add `ClientePost` type + `getClientePosts()` function |
| Modify | `apps/crm/src/pages/entregas/components/WorkflowDrawer.tsx` | Add calendar toggle button + conditional rendering |
| Modify | `apps/crm/src/pages/entregas/views/CalendarView.tsx` | Refactor to use shared `MonthGrid` |
| Modify | `apps/crm/src/pages/cliente-detalhe/ClienteDetalhePage.tsx` | Refactor to use shared `MonthGrid` + switch from "Data de postagem" property to `scheduled_at` |

---

## Task 1: Data Layer — `ClientePost` type and `getClientePosts()`

**Files:**
- Modify: `apps/crm/src/store/posts.ts` (after line 37, after `WorkflowPost` interface)

- [ ] **Step 1: Add `ClientePost` type and `getClientePosts` function**

Add after the `WorkflowPost` interface (after line 37) in `apps/crm/src/store/posts.ts`:

```typescript
export interface ClientePost {
  id: number;
  workflow_id: number;
  titulo: string;
  tipo: WorkflowPost['tipo'];
  status: WorkflowPost['status'];
  scheduled_at: string | null;
  ordem: number;
  workflow_titulo: string;
}

export async function getClientePosts(clienteId: number): Promise<ClientePost[]> {
  const { data, error } = await supabase
    .from('workflow_posts')
    .select('id, workflow_id, titulo, tipo, status, scheduled_at, ordem, workflows!inner(titulo, status)')
    .eq('workflows.cliente_id', clienteId)
    .eq('workflows.status', 'ativo')
    .order('scheduled_at', { ascending: true, nullsFirst: false });
  if (error) throw error;
  return (data || []).map((row: any) => ({
    id: row.id,
    workflow_id: row.workflow_id,
    titulo: row.titulo,
    tipo: row.tipo,
    status: row.status,
    scheduled_at: row.scheduled_at,
    ordem: row.ordem,
    workflow_titulo: row.workflows.titulo,
  }));
}
```

- [ ] **Step 2: Verify the store module still exports cleanly**

Run: `npx tsc --noEmit --project apps/crm/tsconfig.json 2>&1 | head -20`
Expected: No errors related to `posts.ts`

- [ ] **Step 3: Commit**

```bash
git add apps/crm/src/store/posts.ts
git commit -m "feat: add ClientePost type and getClientePosts store function"
```

---

## Task 2: Shared `MonthGrid` Component

**Files:**
- Create: `apps/crm/src/components/ui/month-grid.tsx`
- Create: `apps/crm/src/components/ui/__tests__/month-grid.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `apps/crm/src/components/ui/__tests__/month-grid.test.tsx`:

```typescript
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MonthGrid } from '../month-grid';

describe('MonthGrid', () => {
  const defaultProps = {
    currentMonth: new Date(2026, 5, 1), // June 2026
    onMonthChange: vi.fn(),
    renderCell: (date: Date, isCurrentMonth: boolean) => (
      <span data-testid={`cell-${date.getDate()}`}>
        {isCurrentMonth ? date.getDate() : ''}
      </span>
    ),
  };

  it('renders day-of-week headers Seg through Dom', () => {
    render(<MonthGrid {...defaultProps} />);
    for (const day of ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom']) {
      expect(screen.getByText(day)).toBeTruthy();
    }
  });

  it('renders 30 cells for June 2026', () => {
    render(<MonthGrid {...defaultProps} />);
    expect(screen.getByTestId('cell-1')).toBeTruthy();
    expect(screen.getByTestId('cell-30')).toBeTruthy();
  });

  it('calls onMonthChange with next month when clicking forward', () => {
    const onMonthChange = vi.fn();
    render(<MonthGrid {...defaultProps} onMonthChange={onMonthChange} />);
    fireEvent.click(screen.getByLabelText('Próximo mês'));
    const call = onMonthChange.mock.calls[0][0] as Date;
    expect(call.getMonth()).toBe(6); // July
    expect(call.getFullYear()).toBe(2026);
  });

  it('calls onMonthChange with previous month when clicking back', () => {
    const onMonthChange = vi.fn();
    render(<MonthGrid {...defaultProps} onMonthChange={onMonthChange} />);
    fireEvent.click(screen.getByLabelText('Mês anterior'));
    const call = onMonthChange.mock.calls[0][0] as Date;
    expect(call.getMonth()).toBe(4); // May
    expect(call.getFullYear()).toBe(2026);
  });

  it('renders leading cells for days before month start (June 2026 starts on Monday = 0 leading cells)', () => {
    // June 2026 starts on Monday, so no leading cells
    render(<MonthGrid {...defaultProps} />);
    // First cell should be day 1
    const cells = screen.getAllByTestId(/^cell-/);
    expect(cells.length).toBeGreaterThanOrEqual(30);
  });

  it('renders trailing cells from next month to fill the last week', () => {
    // June 2026: 30 days, starts Monday. Last day (30) is Tuesday.
    // Should have trailing cells for Wed-Sun (Jul 1-5) with isCurrentMonth=false
    const renderCell = vi.fn((date: Date, isCurrentMonth: boolean) => (
      <span data-testid={`cell-${isCurrentMonth ? 'cur' : 'out'}-${date.getDate()}`}>
        {date.getDate()}
      </span>
    ));
    render(<MonthGrid {...defaultProps} renderCell={renderCell} />);
    // Check that renderCell was called with isCurrentMonth=false for trailing days
    const outCalls = renderCell.mock.calls.filter(([, isCurrent]: [Date, boolean]) => !isCurrent);
    expect(outCalls.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run apps/crm/src/components/ui/__tests__/month-grid.test.tsx 2>&1 | tail -15`
Expected: FAIL — module not found

- [ ] **Step 3: Implement MonthGrid**

Create `apps/crm/src/components/ui/month-grid.tsx`:

```typescript
import {
  startOfMonth, endOfMonth, eachDayOfInterval, getDay,
  addMonths, subMonths, format,
} from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { ChevronLeft, ChevronRight } from 'lucide-react';

const WEEK_DAYS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];

export interface MonthGridProps {
  currentMonth: Date;
  onMonthChange: (date: Date) => void;
  renderCell: (date: Date, isCurrentMonth: boolean) => React.ReactNode;
  cellClassName?: string;
  headerClassName?: string;
  showNavigation?: boolean;
}

function getMonthDays(month: Date): { date: Date; isCurrentMonth: boolean }[] {
  const start = startOfMonth(month);
  const end = endOfMonth(month);
  const days = eachDayOfInterval({ start, end });

  // Leading days (previous month) to fill first week row
  // getDay: 0=Sun, convert so Mon=0
  const startDow = (getDay(start) + 6) % 7; // Mon=0, Tue=1, ..., Sun=6
  const leading: { date: Date; isCurrentMonth: boolean }[] = [];
  for (let i = startDow - 1; i >= 0; i--) {
    const d = new Date(start);
    d.setDate(d.getDate() - (i + 1));
    leading.push({ date: d, isCurrentMonth: false });
  }

  const current = days.map(d => ({ date: d, isCurrentMonth: true }));

  // Trailing days to fill last week row
  const totalSoFar = leading.length + current.length;
  const trailing: { date: Date; isCurrentMonth: boolean }[] = [];
  const remainder = totalSoFar % 7;
  if (remainder > 0) {
    const needed = 7 - remainder;
    for (let i = 1; i <= needed; i++) {
      const d = new Date(end);
      d.setDate(d.getDate() + i);
      trailing.push({ date: d, isCurrentMonth: false });
    }
  }

  return [...leading, ...current, ...trailing];
}

export function MonthGrid({
  currentMonth,
  onMonthChange,
  renderCell,
  cellClassName,
  headerClassName,
  showNavigation = true,
}: MonthGridProps) {
  const allDays = getMonthDays(currentMonth);
  const monthLabel = format(currentMonth, 'MMMM yyyy', { locale: ptBR });

  return (
    <div className={headerClassName}>
      {showNavigation && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <button
            onClick={() => onMonthChange(subMonths(currentMonth, 1))}
            aria-label="Mês anterior"
            className="month-grid-nav-btn"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="month-grid-title" style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: '1rem', textTransform: 'capitalize' }}>
            {monthLabel}
          </span>
          <button
            onClick={() => onMonthChange(addMonths(currentMonth, 1))}
            aria-label="Próximo mês"
            className="month-grid-nav-btn"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Day-of-week headers */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4, marginBottom: 6 }}>
        {WEEK_DAYS.map(d => (
          <div key={d} style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.65rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', padding: 4 }}>
            {d}
          </div>
        ))}
      </div>

      {/* Day cells */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
        {allDays.map(({ date, isCurrentMonth }, i) => (
          <div key={i} className={cellClassName}>
            {renderCell(date, isCurrentMonth)}
          </div>
        ))}
      </div>
    </div>
  );
}

export { getMonthDays };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run apps/crm/src/components/ui/__tests__/month-grid.test.tsx 2>&1 | tail -15`
Expected: All 6 tests PASS

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit --project apps/crm/tsconfig.json 2>&1 | head -20`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add apps/crm/src/components/ui/month-grid.tsx apps/crm/src/components/ui/__tests__/month-grid.test.tsx
git commit -m "feat: add shared MonthGrid component with tests"
```

---

## Task 3: `TimePickerPopover` Component

**Files:**
- Create: `apps/crm/src/pages/entregas/components/TimePickerPopover.tsx`
- Create: `apps/crm/src/pages/entregas/components/__tests__/TimePickerPopover.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `apps/crm/src/pages/entregas/components/__tests__/TimePickerPopover.test.tsx`:

```typescript
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TimePickerPopover } from '../TimePickerPopover';

describe('TimePickerPopover', () => {
  const baseProps = {
    date: new Date(2026, 5, 15), // June 15, 2026
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
  };

  it('displays the formatted date', () => {
    render(<TimePickerPopover {...baseProps} />);
    expect(screen.getByText(/15 de junho/i)).toBeTruthy();
  });

  it('defaults to 10:00', () => {
    render(<TimePickerPopover {...baseProps} />);
    const hourSelect = screen.getByLabelText('Hora') as HTMLSelectElement;
    const minuteSelect = screen.getByLabelText('Minuto') as HTMLSelectElement;
    expect(hourSelect.value).toBe('10');
    expect(minuteSelect.value).toBe('0');
  });

  it('uses previousTime when provided', () => {
    render(<TimePickerPopover {...baseProps} previousTime={{ hour: 14, minute: 30 }} />);
    const hourSelect = screen.getByLabelText('Hora') as HTMLSelectElement;
    const minuteSelect = screen.getByLabelText('Minuto') as HTMLSelectElement;
    expect(hourSelect.value).toBe('14');
    expect(minuteSelect.value).toBe('30');
  });

  it('calls onConfirm with local datetime on confirm click', () => {
    const onConfirm = vi.fn();
    render(<TimePickerPopover {...baseProps} onConfirm={onConfirm} />);
    fireEvent.click(screen.getByText('Confirmar'));
    const result = onConfirm.mock.calls[0][0] as Date;
    expect(result.getFullYear()).toBe(2026);
    expect(result.getMonth()).toBe(5);
    expect(result.getDate()).toBe(15);
    expect(result.getHours()).toBe(10);
    expect(result.getMinutes()).toBe(0);
  });

  it('calls onCancel on cancel click', () => {
    const onCancel = vi.fn();
    render(<TimePickerPopover {...baseProps} onCancel={onCancel} />);
    fireEvent.click(screen.getByText('Cancelar'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('reflects time selection changes in confirm output', () => {
    const onConfirm = vi.fn();
    render(<TimePickerPopover {...baseProps} onConfirm={onConfirm} />);
    fireEvent.change(screen.getByLabelText('Hora'), { target: { value: '18' } });
    fireEvent.change(screen.getByLabelText('Minuto'), { target: { value: '45' } });
    fireEvent.click(screen.getByText('Confirmar'));
    const result = onConfirm.mock.calls[0][0] as Date;
    expect(result.getHours()).toBe(18);
    expect(result.getMinutes()).toBe(45);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run apps/crm/src/pages/entregas/components/__tests__/TimePickerPopover.test.tsx 2>&1 | tail -15`
Expected: FAIL — module not found

- [ ] **Step 3: Implement TimePickerPopover**

Create `apps/crm/src/pages/entregas/components/TimePickerPopover.tsx`:

```typescript
import { useState, useRef, useEffect } from 'react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Clock, X } from 'lucide-react';

interface TimePickerPopoverProps {
  date: Date;
  onConfirm: (datetime: Date) => void;
  onCancel: () => void;
  previousTime?: { hour: number; minute: number };
}

export function TimePickerPopover({ date, onConfirm, onCancel, previousTime }: TimePickerPopoverProps) {
  const [hour, setHour] = useState(previousTime?.hour ?? 10);
  const [minute, setMinute] = useState(previousTime?.minute ?? 0);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onCancel();
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onCancel]);

  const handleConfirm = () => {
    const dt = new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour, minute);
    onConfirm(dt);
  };

  const dateLabel = format(date, "d 'de' MMMM, yyyy", { locale: ptBR });

  return (
    <div ref={ref} className="time-picker-popover">
      <div className="time-picker-header">
        <Clock className="h-3.5 w-3.5" style={{ color: 'var(--primary-color)' }} />
        <span className="time-picker-date">{dateLabel}</span>
        <button onClick={onCancel} className="time-picker-close" aria-label="Fechar">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="time-picker-selectors">
        <div className="time-picker-field">
          <select
            aria-label="Hora"
            value={hour}
            onChange={e => setHour(parseInt(e.target.value, 10))}
            className="time-picker-select"
          >
            {Array.from({ length: 24 }, (_, i) => (
              <option key={i} value={i}>{String(i).padStart(2, '0')}</option>
            ))}
          </select>
        </div>
        <span className="time-picker-separator">:</span>
        <div className="time-picker-field">
          <select
            aria-label="Minuto"
            value={minute}
            onChange={e => setMinute(parseInt(e.target.value, 10))}
            className="time-picker-select"
          >
            {[0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55].map(m => (
              <option key={m} value={m}>{String(m).padStart(2, '0')}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="time-picker-actions">
        <button onClick={onCancel} className="time-picker-cancel">Cancelar</button>
        <button onClick={handleConfirm} className="time-picker-confirm">Confirmar</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run apps/crm/src/pages/entregas/components/__tests__/TimePickerPopover.test.tsx 2>&1 | tail -15`
Expected: All 6 tests PASS

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/pages/entregas/components/TimePickerPopover.tsx apps/crm/src/pages/entregas/components/__tests__/TimePickerPopover.test.tsx
git commit -m "feat: add TimePickerPopover component with tests"
```

---

## Task 4: `UnscheduledPostsSidebar` Component

**Files:**
- Create: `apps/crm/src/pages/entregas/components/UnscheduledPostsSidebar.tsx`

- [ ] **Step 1: Implement UnscheduledPostsSidebar**

Create `apps/crm/src/pages/entregas/components/UnscheduledPostsSidebar.tsx`:

```typescript
import { useDroppable, useDraggable } from '@dnd-kit/core';
import type { ClientePost } from '@/store/posts';

const TIPO_COLORS: Record<string, { bg: string; text: string }> = {
  feed: { bg: '#eab30825', text: '#eab308' },
  reels: { bg: '#E1306C25', text: '#E1306C' },
  stories: { bg: '#42c8f525', text: '#42c8f5' },
  carrossel: { bg: '#3ecf8e25', text: '#3ecf8e' },
};

const TIPO_LABELS: Record<string, string> = {
  feed: 'Feed', reels: 'Reels', stories: 'Stories', carrossel: 'Carrossel',
};

const LOCKED_STATUSES = new Set(['agendado', 'postado', 'falha_publicacao']);

interface UnscheduledPostsSidebarProps {
  posts: ClientePost[];
  currentWorkflowId: number;
}

function DraggablePostCard({ post }: { post: ClientePost }) {
  const isLocked = LOCKED_STATUSES.has(post.status);
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `unscheduled-${post.id}`,
    data: { post },
    disabled: isLocked,
  });
  const colors = TIPO_COLORS[post.tipo] || TIPO_COLORS.feed;

  return (
    <div
      ref={setNodeRef}
      className="sidebar-post-card"
      style={{
        opacity: isDragging ? 0.4 : 1,
        borderLeftColor: '#eab308',
        cursor: isLocked ? 'not-allowed' : 'grab',
      }}
      {...(isLocked ? {} : { ...attributes, ...listeners })}
      title={isLocked ? 'Post com status bloqueado' : `Arraste para agendar: ${post.titulo}`}
    >
      <div className="sidebar-post-title">{post.titulo || 'Post sem título'}</div>
      <div className="sidebar-post-meta">
        <span className="sidebar-tipo-badge" style={{ background: colors.bg, color: colors.text }}>
          {TIPO_LABELS[post.tipo] || post.tipo}
        </span>
        <span className="sidebar-workflow-label">{post.workflow_titulo}</span>
      </div>
    </div>
  );
}

export function UnscheduledPostsSidebar({ posts, currentWorkflowId }: UnscheduledPostsSidebarProps) {
  const { setNodeRef, isOver } = useDroppable({ id: 'unscheduled-zone' });

  const currentWorkflowPosts = posts.filter(p => p.workflow_id === currentWorkflowId);

  return (
    <div
      ref={setNodeRef}
      className="calendar-sidebar"
      style={{
        borderColor: isOver ? 'var(--primary-color)' : undefined,
        boxShadow: isOver ? '0 0 12px rgba(234, 179, 8, 0.2)' : undefined,
      }}
    >
      <div className="sidebar-header">
        <div className="sidebar-title">Sem data</div>
        <div className="sidebar-subtitle">Arraste para o calendário</div>
      </div>

      <div className="sidebar-posts-list">
        {currentWorkflowPosts.length === 0 ? (
          <div className="sidebar-empty">Todos os posts estão agendados ✓</div>
        ) : (
          currentWorkflowPosts.map(post => (
            <DraggablePostCard key={post.id} post={post} />
          ))
        )}
      </div>

      <div className="sidebar-legend">
        <div className="sidebar-legend-title">Legenda</div>
        <div className="sidebar-legend-item">
          <div className="sidebar-legend-dot" style={{ background: '#eab308' }} />
          <span>Este workflow</span>
        </div>
        <div className="sidebar-legend-item">
          <div className="sidebar-legend-dot" style={{ background: '#3ecf8e' }} />
          <span>Outros workflows</span>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit --project apps/crm/tsconfig.json 2>&1 | head -20`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add apps/crm/src/pages/entregas/components/UnscheduledPostsSidebar.tsx
git commit -m "feat: add UnscheduledPostsSidebar component"
```

---

## Task 5: `CalendarGrid` Component

**Files:**
- Create: `apps/crm/src/pages/entregas/components/CalendarGrid.tsx`

- [ ] **Step 1: Implement CalendarGrid**

Create `apps/crm/src/pages/entregas/components/CalendarGrid.tsx`:

```typescript
import { useDroppable, useDraggable } from '@dnd-kit/core';
import { parseISO, format, isSameDay } from 'date-fns';
import { GripVertical, Lock } from 'lucide-react';
import { MonthGrid } from '@/components/ui/month-grid';
import type { ClientePost } from '@/store/posts';

const TIPO_COLORS: Record<string, string> = {
  feed: '#eab308', reels: '#E1306C', stories: '#42c8f5', carrossel: '#3ecf8e',
};
const TIPO_LABELS: Record<string, string> = {
  feed: 'Feed', reels: 'Reels', stories: 'Stories', carrossel: 'Carrossel',
};
const LOCKED_STATUSES = new Set(['agendado', 'postado', 'falha_publicacao']);
const LOCKED_TOOLTIPS: Record<string, string> = {
  agendado: 'Post já agendado no Instagram — cancele o agendamento para mover',
  postado: 'Post já publicado',
  falha_publicacao: 'Post com falha de publicação — resolva o erro antes de reagendar',
};

interface CalendarGridProps {
  currentMonth: Date;
  scheduledPosts: ClientePost[];
  currentWorkflowId: number;
  onMonthChange: (date: Date) => void;
}

function PostPill({ post, currentWorkflowId }: { post: ClientePost; currentWorkflowId: number }) {
  const isCurrentWorkflow = post.workflow_id === currentWorkflowId;
  const isLocked = LOCKED_STATUSES.has(post.status);
  const canDrag = isCurrentWorkflow && !isLocked;

  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `post-${post.id}`,
    data: { post },
    disabled: !canDrag,
  });

  const time = post.scheduled_at ? format(parseISO(post.scheduled_at), 'HH:mm') : '';
  const color = isCurrentWorkflow ? '#eab308' : '#3ecf8e';
  const tooltip = isLocked
    ? LOCKED_TOOLTIPS[post.status] || ''
    : `${TIPO_LABELS[post.tipo]} · ${time} · ${post.workflow_titulo}${!isCurrentWorkflow ? ' (outro workflow)' : ''}`;

  return (
    <div
      ref={setNodeRef}
      className="calendar-post-pill"
      style={{
        background: color,
        opacity: isDragging ? 0.4 : isLocked ? 0.6 : isCurrentWorkflow ? 1 : 0.8,
        cursor: canDrag ? 'grab' : 'default',
      }}
      title={tooltip}
      {...(canDrag ? { ...attributes, ...listeners } : {})}
    >
      {isLocked && <Lock className="h-2.5 w-2.5" style={{ flexShrink: 0 }} />}
      {canDrag && <GripVertical className="h-2.5 w-2.5" style={{ flexShrink: 0, opacity: 0.7 }} />}
      <span className="pill-text">
        {TIPO_LABELS[post.tipo]} · {time}
      </span>
    </div>
  );
}

function DroppableCell({
  date, isCurrentMonth, posts, currentWorkflowId,
}: {
  date: Date; isCurrentMonth: boolean; posts: ClientePost[]; currentWorkflowId: number;
}) {
  const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const { setNodeRef, isOver } = useDroppable({ id: `date-${dateStr}` });

  const today = new Date();
  const isToday = isSameDay(date, today);
  const isWeekend = date.getDay() === 0 || date.getDay() === 6;
  const maxVisible = 2;
  const visiblePosts = posts.slice(0, maxVisible);
  const overflow = posts.length - maxVisible;

  return (
    <div
      ref={setNodeRef}
      className={`calendar-cell ${!isCurrentMonth ? 'out-of-month' : ''} ${isWeekend ? 'weekend' : ''} ${isToday ? 'today' : ''}`}
      style={{
        border: isOver ? '2px dashed rgba(234, 179, 8, 0.4)' : undefined,
        boxShadow: isOver ? '0 0 12px rgba(234, 179, 8, 0.12)' : undefined,
      }}
    >
      <div className="cell-day-number" style={{ fontFamily: 'var(--font-mono)', fontSize: 11, textAlign: 'right' }}>
        {date.getDate()}
      </div>
      <div className="cell-posts">
        {visiblePosts.map(post => (
          <PostPill key={post.id} post={post} currentWorkflowId={currentWorkflowId} />
        ))}
        {overflow > 0 && (
          <div
            className="cell-overflow"
            title={posts.slice(maxVisible).map(p => `${TIPO_LABELS[p.tipo]} · ${p.titulo}`).join('\n')}
          >
            +{overflow} mais
          </div>
        )}
      </div>
      {isOver && <div className="cell-drop-hint">Soltar aqui</div>}
    </div>
  );
}

export function CalendarGrid({ currentMonth, scheduledPosts, currentWorkflowId, onMonthChange }: CalendarGridProps) {
  return (
    <MonthGrid
      currentMonth={currentMonth}
      onMonthChange={onMonthChange}
      renderCell={(date, isCurrentMonth) => {
        const dayPosts = scheduledPosts.filter(p => {
          if (!p.scheduled_at) return false;
          const postDate = parseISO(p.scheduled_at);
          return isSameDay(postDate, date);
        });
        return (
          <DroppableCell
            date={date}
            isCurrentMonth={isCurrentMonth}
            posts={dayPosts}
            currentWorkflowId={currentWorkflowId}
          />
        );
      }}
    />
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit --project apps/crm/tsconfig.json 2>&1 | head -20`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add apps/crm/src/pages/entregas/components/CalendarGrid.tsx
git commit -m "feat: add CalendarGrid component with droppable cells and post pills"
```

---

## Task 6: `WorkflowCalendarView` Container

**Files:**
- Create: `apps/crm/src/pages/entregas/components/WorkflowCalendarView.tsx`

- [ ] **Step 1: Implement WorkflowCalendarView**

Create `apps/crm/src/pages/entregas/components/WorkflowCalendarView.tsx`:

```typescript
import { useState, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  DndContext, DragOverlay, PointerSensor, KeyboardSensor,
  useSensor, useSensors, type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core';
import { parseISO } from 'date-fns';
import { ArrowLeft, X } from 'lucide-react';
import { getClientePosts, updateWorkflowPost, type ClientePost } from '@/store';
import { CalendarGrid } from './CalendarGrid';
import { UnscheduledPostsSidebar } from './UnscheduledPostsSidebar';
import { TimePickerPopover } from './TimePickerPopover';

const TIPO_LABELS: Record<string, string> = {
  feed: 'Feed', reels: 'Reels', stories: 'Stories', carrossel: 'Carrossel',
};

interface WorkflowCalendarViewProps {
  clienteId: number;
  clienteNome: string;
  currentWorkflowId: number;
  currentWorkflowTitulo: string;
  onBack: () => void;
}

interface PendingDrop {
  postId: number;
  date: Date;
  previousTime?: { hour: number; minute: number };
}

export function WorkflowCalendarView({
  clienteId, clienteNome, currentWorkflowId, currentWorkflowTitulo, onBack,
}: WorkflowCalendarViewProps) {
  const qc = useQueryClient();
  const [currentMonth, setCurrentMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [pendingDrop, setPendingDrop] = useState<PendingDrop | null>(null);
  const [activePost, setActivePost] = useState<ClientePost | null>(null);
  const [hintDismissed, setHintDismissed] = useState(() => localStorage.getItem('calendarHintDismissed') === 'true');

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  );

  const { data: allPosts = [], isLoading } = useQuery({
    queryKey: ['clientePosts', clienteId],
    queryFn: () => getClientePosts(clienteId),
  });

  const scheduledPosts = allPosts.filter(p => p.scheduled_at != null);
  const unscheduledPosts = allPosts.filter(p => p.scheduled_at == null);

  const invalidateQueries = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['clientePosts', clienteId] });
    qc.invalidateQueries({ queryKey: ['workflow-posts-with-props', currentWorkflowId] });
    qc.invalidateQueries({ queryKey: ['workflow-posts-counts'] });
  }, [qc, clienteId, currentWorkflowId]);

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const post = event.active.data.current?.post as ClientePost | undefined;
    setActivePost(post ?? null);
  }, []);

  const handleDragEnd = useCallback(async (event: DragEndEvent) => {
    setActivePost(null);
    const { active, over } = event;
    if (!over) return;

    const post = active.data.current?.post as ClientePost | undefined;
    if (!post) return;

    const overId = String(over.id);

    // Dropped on unscheduled zone → unschedule
    if (overId === 'unscheduled-zone') {
      if (!post.scheduled_at) return; // already unscheduled
      try {
        await updateWorkflowPost(post.id, { scheduled_at: null });
        invalidateQueries();
        toast.success('Data removida do post');
      } catch {
        toast.error('Erro ao remover data do post');
      }
      return;
    }

    // Dropped on a date cell
    if (overId.startsWith('date-')) {
      const dateStr = overId.replace('date-', '');
      const [y, m, d] = dateStr.split('-').map(Number);
      const dropDate = new Date(y, m - 1, d);

      // Get previous time if rescheduling
      let previousTime: { hour: number; minute: number } | undefined;
      if (post.scheduled_at) {
        const prev = parseISO(post.scheduled_at);
        previousTime = { hour: prev.getHours(), minute: prev.getMinutes() };
      }

      setPendingDrop({ postId: post.id, date: dropDate, previousTime });
    }
  }, [invalidateQueries]);

  const handleTimeConfirm = useCallback(async (datetime: Date) => {
    if (!pendingDrop) return;
    try {
      await updateWorkflowPost(pendingDrop.postId, { scheduled_at: datetime.toISOString() });
      invalidateQueries();
      const isReschedule = pendingDrop.previousTime != null;
      toast.success(
        isReschedule
          ? `Post reagendado para ${datetime.toLocaleDateString('pt-BR')} às ${String(datetime.getHours()).padStart(2, '0')}:${String(datetime.getMinutes()).padStart(2, '0')}`
          : `Post agendado para ${datetime.toLocaleDateString('pt-BR')} às ${String(datetime.getHours()).padStart(2, '0')}:${String(datetime.getMinutes()).padStart(2, '0')}`
      );
    } catch {
      toast.error('Erro ao agendar post');
    } finally {
      setPendingDrop(null);
    }
  }, [pendingDrop, invalidateQueries]);

  const handleTimeCancel = useCallback(() => {
    setPendingDrop(null);
  }, []);

  const dismissHint = () => {
    setHintDismissed(true);
    localStorage.setItem('calendarHintDismissed', 'true');
  };

  if (isLoading) {
    return <div className="drawer-empty">Carregando calendário...</div>;
  }

  return (
    <div className="workflow-calendar-view">
      {/* Hint banner */}
      {!hintDismissed && (
        <div className="calendar-hint-banner">
          <span className="calendar-hint-text">
            💡 Arraste posts da lista lateral para agendar, ou entre datas para reagendar. Arraste de volta para remover a data.
          </span>
          <button onClick={dismissHint} className="calendar-hint-close" aria-label="Fechar dica">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Main content */}
      <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <div className="calendar-content">
          <UnscheduledPostsSidebar
            posts={unscheduledPosts}
            currentWorkflowId={currentWorkflowId}
          />
          <div className="calendar-grid-container">
            <CalendarGrid
              currentMonth={currentMonth}
              scheduledPosts={scheduledPosts}
              currentWorkflowId={currentWorkflowId}
              onMonthChange={setCurrentMonth}
            />
          </div>
        </div>

        {/* Drag overlay */}
        <DragOverlay>
          {activePost && (
            <div className="drag-overlay-card">
              <span className="drag-overlay-tipo">{TIPO_LABELS[activePost.tipo]}</span>
              <span className="drag-overlay-title">{activePost.titulo || 'Post sem título'}</span>
            </div>
          )}
        </DragOverlay>
      </DndContext>

      {/* Time picker popover */}
      {pendingDrop && (
        <div className="time-picker-overlay">
          <TimePickerPopover
            date={pendingDrop.date}
            onConfirm={handleTimeConfirm}
            onCancel={handleTimeCancel}
            previousTime={pendingDrop.previousTime}
          />
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify `getClientePosts` and `updateWorkflowPost` are exported from `@/store`**

Check that the barrel export in `apps/crm/src/store/index.ts` (or equivalent) re-exports `getClientePosts` and `ClientePost` from `./posts`. If not, add the export.

Run: `grep -n 'getClientePosts\|ClientePost' apps/crm/src/store/index.ts apps/crm/src/store.ts 2>/dev/null | head -10`

If missing, add to the re-export file:
```typescript
export { getClientePosts, type ClientePost } from './posts';
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit --project apps/crm/tsconfig.json 2>&1 | head -20`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add apps/crm/src/pages/entregas/components/WorkflowCalendarView.tsx
git commit -m "feat: add WorkflowCalendarView container with drag-drop and time picker"
```

---

## Task 7: CSS Styles for Calendar Components

**Files:**
- Modify: `style.css` (add new styles at the end of the file, before the closing media queries)

- [ ] **Step 1: Add calendar component styles**

Add the following CSS to `style.css` (find the appropriate location near existing drawer styles):

```css
/* ── Workflow Calendar View ─────────────────────────────────────── */

.workflow-calendar-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.calendar-hint-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 20px;
  background: rgba(234, 179, 8, 0.06);
  border-bottom: 1px solid var(--border-color);
}

.calendar-hint-text {
  flex: 1;
  font-size: 0.7rem;
  color: var(--primary-color);
}

.calendar-hint-close {
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  padding: 2px;
}

.calendar-content {
  display: flex;
  flex: 1;
  overflow: hidden;
}

/* ── Sidebar ──────────────────────────────────────────────────── */

.calendar-sidebar {
  width: 200px;
  flex-shrink: 0;
  background: var(--surface-darker);
  border-right: 1px solid var(--border-color);
  padding: 16px;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  transition: border-color 0.2s, box-shadow 0.2s;
}

.sidebar-header { margin-bottom: 14px; }
.sidebar-title { font-weight: 700; font-size: 0.75rem; color: var(--text-main); }
.sidebar-subtitle { font-size: 0.6rem; color: var(--text-muted); margin-top: 2px; }

.sidebar-posts-list { flex: 1; display: flex; flex-direction: column; gap: 8px; }

.sidebar-post-card {
  background: var(--surface-main);
  border-radius: 8px;
  padding: 10px;
  border-left: 3px solid;
  transition: opacity 0.15s;
}

.sidebar-post-title {
  font-weight: 600;
  font-size: 0.7rem;
  color: var(--text-main);
  margin-bottom: 5px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sidebar-post-meta { display: flex; gap: 5px; align-items: center; }

.sidebar-tipo-badge {
  font-size: 0.5rem;
  padding: 2px 6px;
  border-radius: 2px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.sidebar-workflow-label {
  font-size: 0.55rem;
  color: var(--text-muted);
  font-family: var(--font-mono);
}

.sidebar-empty {
  text-align: center;
  padding: 2rem 0;
  font-size: 0.7rem;
  color: var(--text-muted);
}

.sidebar-legend {
  border-top: 1px solid var(--border-color);
  padding-top: 12px;
  margin-top: 12px;
}

.sidebar-legend-title {
  font-size: 0.55rem;
  color: var(--text-muted);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 6px;
}

.sidebar-legend-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.6rem;
  color: var(--text-light);
  margin-bottom: 4px;
}

.sidebar-legend-dot {
  width: 10px;
  height: 10px;
  border-radius: 2px;
  flex-shrink: 0;
}

/* ── Calendar Grid ────────────────────────────────────────────── */

.calendar-grid-container {
  flex: 1;
  padding: 20px;
  overflow-y: auto;
}

.month-grid-nav-btn {
  background: var(--surface-main);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  color: var(--text-muted);
  cursor: pointer;
  padding: 4px 8px;
  transition: background 0.15s;
}

.month-grid-nav-btn:hover { background: var(--surface-hover); }

.calendar-cell {
  min-height: 64px;
  background: var(--surface-main);
  border-radius: 8px;
  padding: 6px;
  position: relative;
  transition: border 0.15s, box-shadow 0.15s;
  border: 2px solid transparent;
}

.calendar-cell.out-of-month { background: var(--surface-darker); }
.calendar-cell.out-of-month .cell-day-number { color: var(--text-muted); opacity: 0.5; }
.calendar-cell.weekend { background: color-mix(in srgb, var(--surface-main), var(--surface-darker) 50%); }
.calendar-cell.today { border-color: var(--primary-color); }

.cell-day-number { color: var(--text-main); }
.cell-posts { display: flex; flex-direction: column; gap: 2px; margin-top: 4px; }

.calendar-post-pill {
  display: flex;
  align-items: center;
  gap: 2px;
  color: var(--dark);
  font-size: 0.625rem;
  font-weight: 600;
  padding: 2px 5px;
  border-radius: 3px;
  white-space: nowrap;
  overflow: hidden;
}

.pill-text {
  overflow: hidden;
  text-overflow: ellipsis;
}

.cell-overflow {
  font-size: 0.625rem;
  color: var(--text-muted);
  text-align: center;
  padding: 1px 0;
  cursor: default;
}

.cell-drop-hint {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.5rem;
  color: var(--primary-color);
  opacity: 0.7;
  pointer-events: none;
}

/* ── Drag Overlay ─────────────────────────────────────────────── */

.drag-overlay-card {
  display: flex;
  gap: 6px;
  align-items: center;
  background: var(--surface-main);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  padding: 8px 12px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
  opacity: 0.85;
  pointer-events: none;
}

.drag-overlay-tipo {
  font-size: 0.6rem;
  font-weight: 700;
  text-transform: uppercase;
  color: var(--primary-color);
}

.drag-overlay-title {
  font-size: 0.7rem;
  color: var(--text-main);
  max-width: 150px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ── Time Picker Popover ──────────────────────────────────────── */

.time-picker-overlay {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10000;
  background: rgba(0, 0, 0, 0.3);
}

.time-picker-popover {
  background: var(--card-bg);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  padding: 16px;
  min-width: 240px;
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.2);
}

.time-picker-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 14px;
}

.time-picker-date {
  flex: 1;
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--text-main);
  text-transform: capitalize;
}

.time-picker-close {
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  padding: 2px;
}

.time-picker-selectors {
  display: flex;
  align-items: center;
  gap: 8px;
  justify-content: center;
  margin-bottom: 16px;
}

.time-picker-select {
  height: 36px;
  border-radius: 8px;
  border: 1px solid var(--border-color);
  background: var(--surface-main);
  color: var(--text-main);
  padding: 0 8px;
  font-size: 0.85rem;
  font-family: var(--font-mono);
}

.time-picker-separator {
  font-size: 1rem;
  color: var(--text-muted);
  font-weight: 700;
}

.time-picker-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}

.time-picker-cancel {
  padding: 6px 14px;
  border-radius: 8px;
  border: 1px solid var(--border-color);
  background: transparent;
  color: var(--text-muted);
  font-size: 0.75rem;
  cursor: pointer;
  transition: background 0.15s;
}

.time-picker-cancel:hover { background: var(--surface-hover); }

.time-picker-confirm {
  padding: 6px 14px;
  border-radius: 8px;
  border: none;
  background: var(--primary-color);
  color: var(--dark);
  font-size: 0.75rem;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s;
}

.time-picker-confirm:hover { background: var(--primary-hover); }

/* ── Calendar header button ───────────────────────────────────── */

.drawer-calendar-btn {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 5px 10px;
  border-radius: 8px;
  border: 1px solid var(--border-color);
  background: var(--surface-main);
  color: var(--text-main);
  font-size: 0.7rem;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}

.drawer-calendar-btn:hover {
  background: var(--surface-hover);
  border-color: var(--primary-color);
}

.drawer-calendar-btn.active {
  background: var(--primary-color);
  color: var(--dark);
  border-color: var(--primary-color);
}
```

- [ ] **Step 2: Verify no CSS syntax errors**

Run: `npm run build 2>&1 | tail -10`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add style.css
git commit -m "feat: add CSS styles for calendar view components"
```

---

## Task 8: Integrate Calendar View into WorkflowDrawer

**Files:**
- Modify: `apps/crm/src/pages/entregas/components/WorkflowDrawer.tsx`

- [ ] **Step 1: Add imports at the top of WorkflowDrawer.tsx**

Add after the existing imports (after line 34):

```typescript
import { Calendar as CalendarIcon } from 'lucide-react';
import { WorkflowCalendarView } from './WorkflowCalendarView';
```

Note: `Calendar` is already imported from `lucide-react` indirectly via `DateTimePicker`, but we need the direct icon. Check if `Calendar` is already imported. If the `CalendarIcon` alias conflicts, use a different alias.

- [ ] **Step 2: Add state for calendar toggle**

Add after the existing state declarations (after line 96, near the other `useState` calls):

```typescript
const [showCalendar, setShowCalendar] = useState(false);
```

- [ ] **Step 3: Add calendar toggle button in the header**

Find the `drawer-header-actions` div (around line 415). Add the calendar button before the close button:

```tsx
<button
  className={`drawer-calendar-btn${showCalendar ? ' active' : ''}`}
  onClick={() => setShowCalendar(v => !v)}
  title={showCalendar ? 'Voltar aos posts' : 'Ver calendário do cliente'}
>
  <CalendarIcon className="h-3.5 w-3.5" />
  {showCalendar ? 'Posts' : 'Calendário'}
</button>
```

Place this button before the existing close button inside `drawer-header-actions`.

- [ ] **Step 4: Conditionally render calendar view or posts list**

Find the `drawer-body` div (around line 434). Wrap the existing content in a conditional:

```tsx
<div className="drawer-body">
  {showCalendar ? (
    <WorkflowCalendarView
      clienteId={clienteId}
      clienteNome={card.cliente?.nome || '—'}
      currentWorkflowId={workflowId}
      currentWorkflowTitulo={card.workflow.titulo}
      onBack={() => setShowCalendar(false)}
    />
  ) : (
    <>
      {/* existing posts section header + posts list — keep as-is */}
      <div className="drawer-section-header">
        {/* ... existing content ... */}
      </div>
      {/* ... existing posts accordion ... */}
    </>
  )}
</div>
```

Important: Move only the content inside `drawer-body` into the conditional. Keep the `drawer-body` div itself outside the conditional. The existing DndContext for post reordering should only render when `!showCalendar` to avoid nesting two DndContexts.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit --project apps/crm/tsconfig.json 2>&1 | head -20`
Expected: No errors

- [ ] **Step 6: Run existing tests to check for regressions**

Run: `npx vitest run apps/crm/src/pages/entregas/ 2>&1 | tail -20`
Expected: All existing tests pass

- [ ] **Step 7: Commit**

```bash
git add apps/crm/src/pages/entregas/components/WorkflowDrawer.tsx
git commit -m "feat: integrate calendar view toggle into WorkflowDrawer"
```

---

## Task 9: Refactor `CalendarView.tsx` to Use Shared `MonthGrid`

**Files:**
- Modify: `apps/crm/src/pages/entregas/views/CalendarView.tsx`

- [ ] **Step 1: Refactor CalendarView to use MonthGrid**

Replace the entire `CalendarView.tsx` content. The component keeps its same props and behavior but delegates grid rendering to `MonthGrid`:

```typescript
import { useState } from 'react';
import type { BoardCard } from '../hooks/useEntregasData';
import { computeDeadlineDate, computeWorkflowDeadlineDate } from '../hooks/useEntregasData';
import { MonthGrid } from '@/components/ui/month-grid';
import { isSameDay } from 'date-fns';

interface CalendarViewProps {
  cards: BoardCard[];
  onCardClick: (card: BoardCard) => void;
}

interface CalendarEvent {
  card: BoardCard;
  type: 'etapa' | 'workflow';
  date: Date;
}

const monthNames = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

export function CalendarView({ cards, onCardClick }: CalendarViewProps) {
  const today = new Date();
  const [currentDate, setCurrentDate] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const [selectedDay, setSelectedDay] = useState<number | null>(today.getDate());

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  // Build events for this month
  const events: CalendarEvent[] = [];
  for (const card of cards) {
    if (card.etapa.iniciado_em) {
      const etapaDeadline = computeDeadlineDate(card.etapa.iniciado_em, card.etapa.prazo_dias, card.etapa.tipo_prazo);
      if (etapaDeadline.getFullYear() === year && etapaDeadline.getMonth() === month) {
        events.push({ card, type: 'etapa', date: etapaDeadline });
      }
      const wfDeadline = computeWorkflowDeadlineDate(card.allEtapas, card.etapa);
      if (wfDeadline && wfDeadline.getFullYear() === year && wfDeadline.getMonth() === month) {
        if (!isSameDay(wfDeadline, etapaDeadline)) {
          events.push({ card, type: 'workflow', date: wfDeadline });
        }
      }
    }
  }

  const selectedEvents = selectedDay
    ? events.filter(e => e.date.getDate() === selectedDay && e.date.getMonth() === month && e.date.getFullYear() === year)
    : [];

  if (cards.length === 0) {
    return (
      <div className="card animate-up" style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
        <p>Nenhuma entrega encontrada. Ajuste os filtros.</p>
      </div>
    );
  }

  return (
    <div className="animate-up">
      <div className="calendar-layout">
        <div className="calendar-main">
          <MonthGrid
            currentMonth={currentDate}
            onMonthChange={(d) => { setCurrentDate(d); setSelectedDay(null); }}
            renderCell={(date, isCurrentMonth) => {
              if (!isCurrentMonth) return <div className="calendar-day empty" />;
              const d = date.getDate();
              const dayEvents = events.filter(e => isSameDay(e.date, date));
              const hasEvents = dayEvents.length > 0;
              const etapaCount = dayEvents.filter(e => e.type === 'etapa').length;
              const wfCount = dayEvents.filter(e => e.type === 'workflow').length;
              const isToday = isSameDay(date, today);
              return (
                <div
                  className={`calendar-day ${isToday ? 'today' : ''} ${selectedDay === d ? 'selected' : ''} ${hasEvents ? 'has-events' : ''}`}
                  onClick={() => setSelectedDay(d)}
                >
                  <span className="day-number">{d}</span>
                  <div className="day-events">
                    {etapaCount > 0 && (
                      <div className="event-pill deadline">
                        ⚑ {etapaCount} Etapa{etapaCount > 1 ? 's' : ''}
                      </div>
                    )}
                    {wfCount > 0 && (
                      <div className="event-pill" style={{ background: 'rgba(249, 115, 22, 0.12)', color: '#f97316', fontWeight: 600 }}>
                        ◎ {wfCount} Conclus.
                      </div>
                    )}
                  </div>
                </div>
              );
            }}
          />
        </div>

        <div className="scheduled-panel">
          <div className="scheduled-header">
            <h3>Entregas</h3>
            <p>{selectedDay ? `${selectedDay} de ${monthNames[month]}, ${year}` : `${monthNames[month]} ${year}`}</p>
          </div>
          <div className="scheduled-list">
            {selectedEvents.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '2rem 0', color: 'var(--text-muted)' }}>
                <p>{selectedDay ? 'Nenhuma entrega neste dia.' : 'Selecione um dia.'}</p>
              </div>
            ) : (
              selectedEvents.map((ev, i) => (
                <div key={i} className="scheduled-item" style={{ cursor: 'pointer' }} onClick={() => onCardClick(ev.card)}>
                  <div className="item-top">
                    <div className="item-badge" style={{ background: ev.type === 'etapa' ? '#a855f7' : '#f97316' }} />
                    <span className="badge" style={{ fontSize: '0.65rem' }}>
                      {ev.type === 'etapa' ? '⚑ PRAZO DA ETAPA' : '◎ CONCLUSÃO PREVISTA'}
                    </span>
                  </div>
                  <div className="item-title">{ev.card.workflow.titulo}</div>
                  <div className="item-subtitle">{ev.card.cliente?.nome || '—'} · ETAPA: {ev.card.etapa.nome}</div>
                  <div className="item-divider" />
                  <div className="item-meta">{ev.date.toLocaleDateString('pt-BR')}</div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '1.5rem', fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '1rem' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}><span style={{ width: 10, height: 10, borderRadius: '50%', background: '#a855f7', display: 'inline-block' }} /> Prazo da etapa</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}><span style={{ width: 10, height: 10, borderRadius: '50%', background: '#f97316', display: 'inline-block' }} /> Conclusão prevista</span>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Run existing CalendarView tests**

Run: `npx vitest run apps/crm/src/pages/entregas/views/__tests__/CalendarView.test.tsx 2>&1 | tail -15`
Expected: All tests pass (behavior is preserved)

- [ ] **Step 3: Commit**

```bash
git add apps/crm/src/pages/entregas/views/CalendarView.tsx
git commit -m "refactor: CalendarView uses shared MonthGrid component"
```

---

## Task 10: Refactor `ClienteDetalhePage` Post Calendar

**Files:**
- Modify: `apps/crm/src/pages/cliente-detalhe/ClienteDetalhePage.tsx`

This task switches the client detail post calendar from reading the "Data de postagem" custom property to reading `scheduled_at` directly, and refactors the calendar grid to use `MonthGrid`.

- [ ] **Step 1: Update the post calendar data source**

Find the `useEffect` that builds `postCalendarEvents` (around line 224). Replace the property-value lookup with direct `scheduled_at` usage:

Replace the `Promise.all` result processing (the inner loop that finds `dateProp`) with:

```typescript
for (const post of posts) {
  if (post.scheduled_at) {
    const parsed = new Date(
      ...post.scheduled_at.match(/^(\d{4})-(\d{2})-(\d{2})/)!.slice(1).map((v, i) => i === 1 ? Number(v) - 1 : Number(v)) as [number, number, number]
    );
    if (!isNaN(parsed.getTime())) {
      events.push({
        postId: post.id!,
        postTitle: post.titulo || t('detail.noTitle'),
        workflowId: post._wfId,
        workflowTitle: post._wfTitle,
        date: parsed,
        tipo: post.tipo,
        status: post.status,
      });
    }
  }
}
```

Apply the same change to the `refreshPostCalendar` function (around line 266).

- [ ] **Step 2: Refactor the calendar grid rendering to use MonthGrid**

Add import at the top:
```typescript
import { MonthGrid } from '@/components/ui/month-grid';
```

Replace the inline calendar grid rendering (the `Array.from({ length: firstDay })` + `Array.from({ length: daysInMonth })` section, around lines 682-717) with a `MonthGrid` usage, similar to the `CalendarView` refactor in Task 9. Keep the existing `tipoColors`, `tipoLabels`, and event rendering logic inside the `renderCell` callback.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit --project apps/crm/tsconfig.json 2>&1 | head -20`
Expected: No errors

- [ ] **Step 4: Run full test suite**

Run: `npm run test 2>&1 | tail -20`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/pages/cliente-detalhe/ClienteDetalhePage.tsx
git commit -m "refactor: client detail post calendar uses scheduled_at and shared MonthGrid"
```

---

## Task 11: Integration Tests for WorkflowCalendarView

**Files:**
- Create: `apps/crm/src/pages/entregas/components/__tests__/WorkflowCalendarView.test.tsx`

- [ ] **Step 1: Write integration tests**

Create `apps/crm/src/pages/entregas/components/__tests__/WorkflowCalendarView.test.tsx`:

```typescript
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WorkflowCalendarView } from '../WorkflowCalendarView';

// Mock the store
vi.mock('@/store', () => ({
  getClientePosts: vi.fn(),
  updateWorkflowPost: vi.fn(),
}));

import { getClientePosts } from '@/store';
const mockGetClientePosts = vi.mocked(getClientePosts);

function renderWithQuery(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const baseProps = {
  clienteId: 1,
  clienteNome: 'Marca X',
  currentWorkflowId: 10,
  currentWorkflowTitulo: 'Campanha Junho',
  onBack: vi.fn(),
};

describe('WorkflowCalendarView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('shows loading state', () => {
    mockGetClientePosts.mockReturnValue(new Promise(() => {})); // never resolves
    renderWithQuery(<WorkflowCalendarView {...baseProps} />);
    expect(screen.getByText('Carregando calendário...')).toBeTruthy();
  });

  it('renders sidebar and calendar grid after data loads', async () => {
    mockGetClientePosts.mockResolvedValue([
      { id: 1, workflow_id: 10, titulo: 'Post A', tipo: 'feed', status: 'rascunho', scheduled_at: null, ordem: 0, workflow_titulo: 'Campanha Junho' },
      { id: 2, workflow_id: 10, titulo: 'Post B', tipo: 'reels', status: 'rascunho', scheduled_at: '2026-06-15T10:00:00.000Z', ordem: 1, workflow_titulo: 'Campanha Junho' },
    ]);
    renderWithQuery(<WorkflowCalendarView {...baseProps} />);
    expect(await screen.findByText('Sem data')).toBeTruthy();
    expect(screen.getByText('Post A')).toBeTruthy();
  });

  it('shows empty state when all posts are scheduled', async () => {
    mockGetClientePosts.mockResolvedValue([
      { id: 1, workflow_id: 10, titulo: 'Post A', tipo: 'feed', status: 'rascunho', scheduled_at: '2026-06-10T10:00:00.000Z', ordem: 0, workflow_titulo: 'Campanha Junho' },
    ]);
    renderWithQuery(<WorkflowCalendarView {...baseProps} />);
    expect(await screen.findByText(/agendados/i)).toBeTruthy();
  });

  it('shows hint banner on first visit and hides after dismiss', async () => {
    mockGetClientePosts.mockResolvedValue([]);
    renderWithQuery(<WorkflowCalendarView {...baseProps} />);
    expect(await screen.findByText(/Arraste posts/)).toBeTruthy();
  });

  it('only shows current workflow posts in sidebar', async () => {
    mockGetClientePosts.mockResolvedValue([
      { id: 1, workflow_id: 10, titulo: 'My Post', tipo: 'feed', status: 'rascunho', scheduled_at: null, ordem: 0, workflow_titulo: 'Campanha Junho' },
      { id: 2, workflow_id: 20, titulo: 'Other Post', tipo: 'reels', status: 'rascunho', scheduled_at: null, ordem: 0, workflow_titulo: 'Outro Workflow' },
    ]);
    renderWithQuery(<WorkflowCalendarView {...baseProps} />);
    expect(await screen.findByText('My Post')).toBeTruthy();
    // Other Post should NOT appear in sidebar (it's from workflow 20, not 10)
    const sidebarPosts = screen.queryAllByText('Other Post');
    expect(sidebarPosts.length).toBe(0);
  });
});
```

- [ ] **Step 2: Run the integration tests**

Run: `npx vitest run apps/crm/src/pages/entregas/components/__tests__/WorkflowCalendarView.test.tsx 2>&1 | tail -15`
Expected: All 5 tests PASS

- [ ] **Step 3: Run full test suite to check for regressions**

Run: `npm run test 2>&1 | tail -20`
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add apps/crm/src/pages/entregas/components/__tests__/WorkflowCalendarView.test.tsx
git commit -m "test: add integration tests for WorkflowCalendarView"
```

---

## Deferred to Fast Follow

- **Context menu fallback** (right-click / long-press "Agendar para..." / "Remover data") — the spec calls for this as an accessibility/mobile fallback. Keyboard drag via `KeyboardSensor` is implemented in Task 6. The context menu is additive and can be added without changing existing components.

---

## Task 12: Manual Testing and Final Verification

**Files:** None (testing only)

- [ ] **Step 1: Start the dev server**

Run: `npm run dev`

- [ ] **Step 2: Test the golden path**

1. Navigate to Entregas page
2. Click on a workflow card to open the drawer
3. Click the "Calendário" button in the drawer header
4. Verify: calendar view replaces posts list, sidebar shows unscheduled posts from current workflow only
5. Verify: calendar grid shows month with navigation arrows
6. Verify: hint banner appears on first visit
7. Drag an unscheduled post from sidebar onto a calendar date
8. Verify: TimePickerPopover appears with default time 10:00
9. Select a time and click "Confirmar"
10. Verify: toast appears, post moves from sidebar to calendar cell
11. Drag the scheduled post to a different date
12. Verify: TimePickerPopover appears with previous time as default
13. Confirm → verify post pill moves to new date
14. Drag the post back to the sidebar
15. Verify: toast "Data removida do post", post reappears in sidebar
16. Click "Posts" button to return to posts list
17. Verify: the post's "Data de postagem" field reflects the changes made in calendar

- [ ] **Step 3: Test edge cases**

1. Open calendar for a workflow where all posts are scheduled → sidebar shows empty state
2. Open calendar for a workflow with posts that have status `agendado` → verify lock icon, not draggable
3. Navigate to a month with no posts → verify empty grid renders correctly
4. Verify posts from other workflows appear in green on the calendar but are not draggable
5. Dismiss the hint banner → refresh page → verify it stays dismissed
6. Open a client detail page → verify the post calendar now reads from `scheduled_at`

- [ ] **Step 4: Typecheck and test suite one final time**

Run: `npm run build && npm run test`
Expected: Build succeeds, all tests pass

- [ ] **Step 5: Commit any final adjustments**

If any CSS tweaks or minor fixes are needed from manual testing, commit them:

```bash
git add -A
git commit -m "fix: polish calendar view after manual testing"
```
