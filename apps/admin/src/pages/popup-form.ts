import { format } from 'date-fns';
import type { GlobalPopup } from '../lib/api';

export const MAX_PAGES = 6;
const MAX_TITLE = 120;
const MAX_EYEBROW = 60;
const MAX_BODY = 2000;
const MAX_LABEL = 40;
const MAX_URL = 2048;
const CTA_URL_RE = /^(\/(?![/\\])|https?:\/\/)/; // `//host` é protocol-relative, não caminho interno, nem `/\host`

/** Regra única da URL de CTA (global e por página), espelhando o servidor. */
function ctaUrlError(url: string): string | null {
  if (/[\t\r\n]/.test(url) || !CTA_URL_RE.test(url))
    return 'A URL do CTA deve começar com / ou http(s)://';
  if (url.length > MAX_URL) return `URL do CTA: máximo de ${MAX_URL} caracteres`;
  return null;
}

export interface PageForm {
  /** Identidade estável para o dnd-kit e o React. Nunca vai para o payload. */
  key: string;
  title: string;
  eyebrow: string;
  body: string;
  image_key: string;
  cta_label: string;
  cta_url: string;
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
  pages: Record<number, { title?: string; eyebrow?: string; body?: string; cta?: string }>;
  cta?: string;
  frequency?: string;
  target?: string;
  schedule?: string;
}

let pageKeyCounter = 0;

export function newPage(): PageForm {
  pageKeyCounter += 1;
  return {
    key: `page-${pageKeyCounter}`,
    title: '',
    eyebrow: '',
    body: '',
    image_key: '',
    cta_label: '',
    cta_url: '',
  };
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
      cta_label: pg.cta_label ?? '',
      cta_url: pg.cta_url ?? '',
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
      cta_label: orNull(pg.cta_label),
      cta_url: orNull(pg.cta_url),
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
    const e: { title?: string; eyebrow?: string; body?: string; cta?: string } = {};
    if (!pg.title.trim()) e.title = 'Título é obrigatório';
    else if (pg.title.trim().length > MAX_TITLE) e.title = `Máximo de ${MAX_TITLE} caracteres`;
    if (!pg.body.trim()) e.body = 'Corpo é obrigatório';
    else if (pg.body.trim().length > MAX_BODY) e.body = `Máximo de ${MAX_BODY} caracteres`;
    if (pg.eyebrow.trim().length > MAX_EYEBROW) e.eyebrow = `Máximo de ${MAX_EYEBROW} caracteres`;
    const pl = pg.cta_label.trim();
    const pu = pg.cta_url.trim();
    const puErr = pu ? ctaUrlError(pu) : null;
    if ((pl === '') !== (pu === '')) e.cta = 'O CTA precisa de rótulo e URL';
    else if (pl.length > MAX_LABEL) e.cta = `Rótulo do CTA: máximo de ${MAX_LABEL} caracteres`;
    else if (puErr) e.cta = puErr;
    if (e.title || e.body || e.eyebrow || e.cta) {
      errors.pages[i] = e;
      any = true;
    }
  });

  const label = f.cta_label.trim();
  const url = f.cta_url.trim();
  const urlErr = url ? ctaUrlError(url) : null;
  if ((label === '') !== (url === '')) errors.cta = 'O CTA precisa de rótulo e URL';
  else if (label.length > MAX_LABEL)
    errors.cta = `Rótulo do CTA: máximo de ${MAX_LABEL} caracteres`;
  else if (urlErr) errors.cta = urlErr;
  else if (f.secondary_label.trim().length > MAX_LABEL) {
    errors.cta = `Rótulo secundário: máximo de ${MAX_LABEL} caracteres`;
  }
  if (errors.cta) any = true;

  const anyPageCta = f.pages.some((pg) => pg.cta_url.trim());
  if (f.frequency === 'until_cta' && !url && !anyPageCta) {
    errors.frequency = '"Até o CTA" precisa de um CTA no popup ou em ao menos uma página';
    any = true;
  }

  if (f.target_mode === 'plan' && f.target_plan_ids.length === 0) {
    errors.target = 'Selecione ao menos um plano';
    any = true;
  } else if (f.target_mode === 'workspace' && f.target_workspace_ids.length === 0) {
    errors.target = 'Selecione ao menos um workspace';
    any = true;
  }

  if (f.starts_at && f.ends_at && new Date(f.ends_at) <= new Date(f.starts_at)) {
    errors.schedule = 'O término deve ser depois do início';
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
  return Boolean(
    p.title.trim() ||
    p.eyebrow.trim() ||
    p.body.trim() ||
    p.image_key ||
    p.cta_label.trim() ||
    p.cta_url.trim(),
  );
}
