import { format } from 'date-fns';
import type { GlobalPopup } from '../lib/api';

export const MAX_PAGES = 6;
const MAX_TITLE = 120;
const MAX_EYEBROW = 60;
const MAX_BODY = 2000;
const MAX_LABEL = 40;
const MAX_URL = 2048;
const CTA_URL_RE = /^(\/(?![/\\])|https?:\/\/)/; // `//host` é protocol-relative, não caminho interno, nem `/\host`

export interface PageForm {
  /** Identidade estável para o dnd-kit e o React. Nunca vai para o payload. */
  key: string;
  title: string;
  eyebrow: string;
  body: string;
  image_key: string;
}

export interface PopupFormState {
  pages: PageForm[];
  cta_label: string;
  cta_url: string;
  secondary_label: string;
  cta_style: 'ink' | 'brand';
  frequency: 'once' | 'until_cta';
  require_ack: boolean;
  target_mode: 'all' | 'plan' | 'workspace';
  target_plan_ids: string[];
  target_workspace_ids: string[];
  starts_at: string;
  ends_at: string;
  status: 'draft' | 'active' | 'archived';
}

export interface PopupFormErrors {
  pages: Record<number, { title?: string; eyebrow?: string; body?: string }>;
  cta?: string;
  frequency?: string;
  target?: string;
  schedule?: string;
}

let pageKeyCounter = 0;

export function newPage(): PageForm {
  pageKeyCounter += 1;
  return { key: `page-${pageKeyCounter}`, title: '', eyebrow: '', body: '', image_key: '' };
}

export function emptyForm(): PopupFormState {
  return {
    pages: [newPage()],
    cta_label: '',
    cta_url: '',
    secondary_label: '',
    cta_style: 'ink',
    frequency: 'once',
    require_ack: false,
    target_mode: 'all',
    target_plan_ids: [],
    target_workspace_ids: [],
    starts_at: '',
    ends_at: '',
    status: 'draft',
  };
}

export function popupToForm(p: GlobalPopup): PopupFormState {
  return {
    pages: p.pages.map((pg) => ({
      ...newPage(),
      title: pg.title,
      eyebrow: pg.eyebrow ?? '',
      body: pg.body,
      image_key: pg.image_key ?? '',
    })),
    cta_label: p.cta_label ?? '',
    cta_url: p.cta_url ?? '',
    secondary_label: p.secondary_label ?? '',
    cta_style: p.cta_style,
    frequency: p.frequency,
    require_ack: p.require_ack,
    target_mode: p.target_mode,
    target_plan_ids: p.target_plan_ids ?? [],
    target_workspace_ids: p.target_workspace_ids ?? [],
    // ISO (UTC) -> local `datetime-local` value. Slicing the UTC digits
    // instead would have the browser reinterpret them as local time and
    // drift the schedule by the UTC offset on every edit-save.
    starts_at: p.starts_at ? format(new Date(p.starts_at), "yyyy-MM-dd'T'HH:mm") : '',
    ends_at: p.ends_at ? format(new Date(p.ends_at), "yyyy-MM-dd'T'HH:mm") : '',
    status: p.status,
  };
}

const orNull = (s: string): string | null => (s.trim() ? s.trim() : null);

export function formToPayload(f: PopupFormState): Record<string, unknown> {
  return {
    pages: f.pages.map((pg) => ({
      title: pg.title.trim(),
      eyebrow: orNull(pg.eyebrow),
      body: pg.body.trim(),
      image_key: orNull(pg.image_key),
    })),
    cta_label: orNull(f.cta_label),
    cta_url: orNull(f.cta_url),
    secondary_label: orNull(f.secondary_label),
    cta_style: f.cta_style,
    frequency: f.frequency,
    require_ack: f.require_ack,
    target_mode: f.target_mode,
    target_plan_ids: f.target_mode === 'plan' ? f.target_plan_ids : null,
    target_workspace_ids: f.target_mode === 'workspace' ? f.target_workspace_ids : null,
    starts_at: f.starts_at ? new Date(f.starts_at).toISOString() : null,
    ends_at: f.ends_at ? new Date(f.ends_at).toISOString() : null,
    status: f.status,
  };
}

export function validateForm(f: PopupFormState): PopupFormErrors | null {
  const errors: PopupFormErrors = { pages: {} };
  let any = false;

  f.pages.forEach((pg, i) => {
    const e: { title?: string; eyebrow?: string; body?: string } = {};
    if (!pg.title.trim()) e.title = 'Title is required';
    else if (pg.title.trim().length > MAX_TITLE) e.title = `Max ${MAX_TITLE} characters`;
    if (!pg.body.trim()) e.body = 'Body is required';
    else if (pg.body.trim().length > MAX_BODY) e.body = `Max ${MAX_BODY} characters`;
    if (pg.eyebrow.trim().length > MAX_EYEBROW) e.eyebrow = `Max ${MAX_EYEBROW} characters`;
    if (e.title || e.body || e.eyebrow) {
      errors.pages[i] = e;
      any = true;
    }
  });

  const label = f.cta_label.trim();
  const url = f.cta_url.trim();
  if ((label === '') !== (url === '')) errors.cta = 'CTA needs both a label and a URL';
  else if (label.length > MAX_LABEL) errors.cta = `CTA label max ${MAX_LABEL} characters`;
  else if (url && !CTA_URL_RE.test(url)) errors.cta = 'CTA URL must start with / or http(s)://';
  else if (url.length > MAX_URL) errors.cta = `CTA URL max ${MAX_URL} characters`;
  else if (f.secondary_label.trim().length > MAX_LABEL) {
    errors.cta = `Secondary label max ${MAX_LABEL} characters`;
  }
  if (errors.cta) any = true;

  if (f.frequency === 'until_cta' && !url) {
    errors.frequency = '"Until CTA" needs a CTA';
    any = true;
  }

  if (f.target_mode === 'plan' && f.target_plan_ids.length === 0) {
    errors.target = 'Select at least one plan';
    any = true;
  } else if (f.target_mode === 'workspace' && f.target_workspace_ids.length === 0) {
    errors.target = 'Select at least one workspace';
    any = true;
  }

  if (f.starts_at && f.ends_at && new Date(f.ends_at) <= new Date(f.starts_at)) {
    errors.schedule = 'End must be after start';
    any = true;
  }

  return any ? errors : null;
}

/** Confirmação obrigatória implica frequência "once" (spec, Parte 1). */
export function withRequireAck(f: PopupFormState, on: boolean): PopupFormState {
  return { ...f, require_ack: on, frequency: on ? 'once' : f.frequency };
}

export function addPage(f: PopupFormState): PopupFormState {
  if (f.pages.length >= MAX_PAGES) return f;
  return { ...f, pages: [...f.pages, newPage()] };
}

export function removePage(f: PopupFormState, index: number): PopupFormState {
  if (f.pages.length <= 1) return f;
  return { ...f, pages: f.pages.filter((_, i) => i !== index) };
}

export function movePage(f: PopupFormState, from: number, to: number): PopupFormState {
  const last = f.pages.length - 1;
  if (from < 0 || from > last || to < 0 || to > last || from === to) return f;
  const pages = [...f.pages];
  const [moved] = pages.splice(from, 1);
  pages.splice(to, 0, moved);
  return { ...f, pages };
}

export function pageHasContent(p: PageForm): boolean {
  return Boolean(p.title.trim() || p.eyebrow.trim() || p.body.trim() || p.image_key);
}
