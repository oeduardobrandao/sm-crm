import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { i18n } from '@mesaas/i18n';
import { WIDGET_CATALOG, WIDGET_CATEGORIES } from '@mesaas/report-blocks/catalog';
import { AddWidgetDrawer } from '../AddWidgetDrawer';
import { sectionKindName, widgetCategoryLabel, widgetLabel } from '../editorText';

describe('report editor chrome in English', () => {
  afterEach(async () => {
    await i18n.changeLanguage('pt');
  });

  it('renders the add-widget drawer with English heading, categories and widget names', async () => {
    await i18n.changeLanguage('en');
    render(
      <AddWidgetDrawer
        open
        onOpenChange={vi.fn()}
        onInsert={vi.fn()}
        section={{ kind: 'general' }}
        hasCover
      />,
    );
    expect(screen.getByRole('heading', { name: 'Add widget' })).toBeInTheDocument();
    expect(screen.getByText('In the General section')).toBeInTheDocument();
    expect(screen.getByText('Text')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Free text' })).toBeInTheDocument();
    expect(screen.queryByText('Texto livre')).not.toBeInTheDocument();
  });

  it('localizes every catalog label and category, and keeps Portuguese identical in pt', async () => {
    // pt must match the shared catalog verbatim (the PDF/print document still reads the catalog).
    for (const w of WIDGET_CATALOG) expect(widgetLabel(w.type)).toBe(w.label);
    for (const c of WIDGET_CATEGORIES) expect(widgetCategoryLabel(c)).toBe(c);
    expect(sectionKindName('google')).toBe('Google Meu Negócio');
    await i18n.changeLanguage('en');
    for (const w of WIDGET_CATALOG) expect(widgetLabel(w.type)).not.toMatch(/[ãçéíóúêôáà]/);
    expect(sectionKindName('google')).toBe('Google Business Profile');
  });
});
