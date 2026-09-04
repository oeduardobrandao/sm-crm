import { describe, expect, it } from 'vitest';
import type { GlobalPopup } from '../../lib/api';
import {
  MAX_PAGES,
  addPage,
  emptyForm,
  formToPayload,
  movePage,
  newPage,
  pageHasContent,
  popupToForm,
  removePage,
  validateForm,
  withRequireAck,
} from '../popup-form';

const popup: GlobalPopup = {
  id: 'p1',
  pages: [
    {
      title: 'Um',
      eyebrow: 'Novo',
      body: 'b1',
      image_key: 'contas/x/files/a.png',
      cta_label: 'Ver aqui',
      cta_url: '/p1',
    },
    { title: 'Dois', eyebrow: null, body: 'b2', image_key: null, cta_label: null, cta_url: null },
  ],
  cta_label: 'Ver',
  cta_url: '/ajuda',
  cta_style: 'brand',
  secondary_label: null,
  frequency: 'until_cta',
  require_ack: false,
  target_mode: 'plan',
  target_plan_ids: ['pro'],
  target_workspace_ids: null,
  starts_at: '2026-09-02T12:00:00.000Z',
  ends_at: null,
  status: 'active',
  created_by: null,
  created_at: '2026-09-01T00:00:00.000Z',
  updated_at: '2026-09-01T00:00:00.000Z',
  counts: { seen: 0, closed: 0, cta: 0, ack: 0 },
};

describe('popupToForm / formToPayload', () => {
  it('vai e volta sem o key e com nulos no lugar de vazios', () => {
    const form = popupToForm(popup);
    expect(form.pages).toHaveLength(2);
    expect(form.pages[0].key).not.toBe(form.pages[1].key);
    expect(form.pages[1].eyebrow).toBe('');
    // True round trip: form -> payload must land back on the exact same ISO
    // instant, not just the same UTC digits (the fixture's ...T12:00:00.000Z
    // round-trips exactly).
    expect(formToPayload(popupToForm(popup)).starts_at).toBe(popup.starts_at);

    const payload = formToPayload(form);
    expect(payload.pages).toEqual([
      {
        title: 'Um',
        eyebrow: 'Novo',
        body: 'b1',
        image_key: 'contas/x/files/a.png',
        cta_label: 'Ver aqui',
        cta_url: '/p1',
      },
      {
        title: 'Dois',
        eyebrow: null,
        body: 'b2',
        image_key: null,
        cta_label: null,
        cta_url: null,
      },
    ]);
    expect(JSON.stringify(payload)).not.toContain('"key"');
    expect(payload.secondary_label).toBeNull();
    expect(payload.target_plan_ids).toEqual(['pro']);
    expect(payload.target_workspace_ids).toBeNull();
    expect(payload.ends_at).toBeNull();
    expect(typeof payload.starts_at).toBe('string');
  });

  it('popupToForm não deriva pelo fuso horário local (checagem de offset manual, vale em qualquer fuso)', () => {
    const local = popupToForm(popup).starts_at;
    expect(new Date(local).toISOString()).toBe(popup.starts_at);
  });

  it('formulário vazio tem uma página e defaults da spec', () => {
    const f = emptyForm();
    expect(f.pages).toHaveLength(1);
    expect(f.cta_style).toBe('ink');
    expect(f.frequency).toBe('once');
    expect(f.require_ack).toBe(false);
    expect(f.status).toBe('draft');
  });
});

describe('validateForm', () => {
  const valid = (): ReturnType<typeof emptyForm> => {
    const f = emptyForm();
    f.pages[0].title = 'T';
    f.pages[0].body = 'B';
    return f;
  };

  it('null quando válido', () => {
    expect(validateForm(valid())).toBeNull();
  });

  it('página sem título ou corpo, com o índice certo', () => {
    const f = addPage(valid());
    const e = validateForm(f)!;
    expect(e.pages[1]).toEqual({ title: 'Title is required', body: 'Body is required' });
    expect(e.pages[0]).toBeUndefined();
  });

  it('CTA pela metade, URL com prefixo errado, until_cta sem CTA', () => {
    let f = { ...valid(), cta_label: 'Ver' };
    expect(validateForm(f)!.cta).toBe('CTA needs both a label and a URL');
    f = { ...valid(), cta_label: 'Ver', cta_url: 'ajuda' };
    expect(validateForm(f)!.cta).toBe('CTA URL must start with / or http(s)://');
    f = { ...valid(), cta_label: 'Ver', cta_url: '//evil.com' };
    expect(validateForm(f)!.cta).toBe('CTA URL must start with / or http(s)://');
    f = { ...valid(), cta_label: 'Ver', cta_url: '/\\evil.com' };
    expect(validateForm(f)!.cta).toBe('CTA URL must start with / or http(s)://');
    f = { ...valid(), cta_label: 'Ver', cta_url: '/\t/evil.com' };
    expect(validateForm(f)!.cta).toBe('CTA URL must start with / or http(s)://');
    f = { ...valid(), frequency: 'until_cta' };
    expect(validateForm(f)!.frequency).toBe(
      '"Until CTA" needs a CTA on the popup or on at least one page',
    );
  });

  it('CTA por página: par completo, limites, e until_cta aceito com CTA só em página', () => {
    const f = valid();
    f.pages[0].cta_label = 'Ver';
    expect(validateForm(f)!.pages[0].cta).toBe('CTA needs both a label and a URL');
    f.pages[0].cta_url = 'ajuda';
    expect(validateForm(f)!.pages[0].cta).toBe('CTA URL must start with / or http(s)://');
    f.pages[0].cta_url = '/ajuda';
    expect(validateForm(f)).toBeNull();
    const g = { ...f, frequency: 'until_cta' as const };
    expect(validateForm(g)).toBeNull();
    const h = { ...valid(), frequency: 'until_cta' as const };
    expect(validateForm(h)!.frequency).toBe(
      '"Until CTA" needs a CTA on the popup or on at least one page',
    );
    expect(formToPayload(f).pages).toEqual([
      {
        title: 'T',
        eyebrow: null,
        body: 'B',
        image_key: null,
        cta_label: 'Ver',
        cta_url: '/ajuda',
      },
    ]);
    expect(pageHasContent({ ...newPage(), cta_url: '/x' })).toBe(true);
  });

  it('target por plano ou workspace sem seleção', () => {
    const f = { ...valid(), target_mode: 'plan' as const };
    expect(validateForm(f)!.target).toBe('Select at least one plan');
    const g = { ...valid(), target_mode: 'workspace' as const };
    expect(validateForm(g)!.target).toBe('Select at least one workspace');
  });

  it('ends_at deve vir depois de starts_at quando os dois estão preenchidos', () => {
    const f = { ...valid(), starts_at: '2026-09-10T12:00', ends_at: '2026-09-10T10:00' };
    expect(validateForm(f)!.schedule).toBe('End must be after start');
    const eq = { ...valid(), starts_at: '2026-09-10T12:00', ends_at: '2026-09-10T12:00' };
    expect(validateForm(eq)!.schedule).toBe('End must be after start');
    const ok = { ...valid(), starts_at: '2026-09-10T12:00', ends_at: '2026-09-10T13:00' };
    expect(validateForm(ok)?.schedule).toBeUndefined();
  });

  it('limites de tamanho', () => {
    const f = valid();
    f.pages[0].title = 'x'.repeat(121);
    expect(validateForm(f)!.pages[0].title).toBe('Max 120 characters');
    const g = { ...valid(), cta_label: 'x'.repeat(41), cta_url: '/x' };
    expect(validateForm(g)!.cta).toBe('CTA label max 40 characters');
    const h = valid();
    h.pages[0].eyebrow = 'x'.repeat(61);
    expect(validateForm(h)!.pages[0]).toEqual({ eyebrow: 'Max 60 characters' });
    const b = valid();
    b.pages[0].body = 'x'.repeat(2001);
    expect(validateForm(b)!.pages[0].body).toBe('Max 2000 characters');
    const u = { ...valid(), cta_label: 'Ver', cta_url: '/' + 'x'.repeat(2048) };
    expect(validateForm(u)!.cta).toBe('CTA URL max 2048 characters');
    const s = { ...valid(), secondary_label: 'x'.repeat(41) };
    expect(validateForm(s)!.cta).toBe('Secondary label max 40 characters');
  });
});

describe('páginas', () => {
  it('addPage respeita MAX_PAGES; removePage nunca deixa zero; movePage reordena', () => {
    let f = emptyForm();
    for (let i = 0; i < 10; i++) f = addPage(f);
    expect(f.pages).toHaveLength(MAX_PAGES);
    f = removePage(f, 0);
    expect(f.pages).toHaveLength(MAX_PAGES - 1);
    let one = emptyForm();
    one = removePage(one, 0);
    expect(one.pages).toHaveLength(1);

    const a = newPage();
    const b = newPage();
    const c = newPage();
    const moved = movePage({ ...emptyForm(), pages: [a, b, c] }, 2, 0);
    expect(moved.pages.map((p) => p.key)).toEqual([c.key, a.key, b.key]);
  });

  it('pageHasContent', () => {
    expect(pageHasContent(newPage())).toBe(false);
    expect(pageHasContent({ ...newPage(), body: 'x' })).toBe(true);
    expect(pageHasContent({ ...newPage(), image_key: 'k' })).toBe(true);
  });

  it('withRequireAck força frequency = once; desligar mantém once', () => {
    const f = { ...emptyForm(), frequency: 'until_cta' as const };
    const on = withRequireAck(f, true);
    expect(on.require_ack).toBe(true);
    expect(on.frequency).toBe('once');
    const off = withRequireAck(on, false);
    expect(off.require_ack).toBe(false);
    expect(off.frequency).toBe('once');
  });

  it('movePage ignora índices fora do range e from === to', () => {
    const f = { ...emptyForm(), pages: [newPage(), newPage()] };
    expect(movePage(f, 5, 0)).toBe(f);
    expect(movePage(f, 0, 9)).toBe(f);
    expect(movePage(f, 1, 1)).toBe(f);
    expect(movePage(f, 0, 1).pages.every(Boolean)).toBe(true);
  });
});
