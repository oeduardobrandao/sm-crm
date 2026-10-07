import { supabase } from './core';

// =============================================
// INSTAGRAM AUTOMATION CONTACTS (instagram_automation_contacts)
// =============================================
// Derived, de-duplicated list of people who commented an automation keyword,
// maintained by triggers on instagram_automation_sends and surviving
// automation deletion. Spec: docs/superpowers/specs/2026-10-07-automation-contacts-design.md

export const CONTACTS_KEY = 'instagram-contacts';
export const CONTACT_COUNTS_KEY = ['instagram-contact-counts'] as const;
export const CONTACTS_COUNT_KEY = ['instagram-contacts-count'] as const;
export const CONTACTS_PAGE_SIZE = 50;
export const CONTACTS_EXPORT_CHUNK = 500;

export interface InstagramContact {
  id: string;
  client_id: number;
  commenter_username: string | null;
  first_interaction_at: string;
  last_interaction_at: string;
  interactions_count: number;
  reached: boolean;
  last_comment_text: string | null;
  automation_id: string | null;
  automation_name: string | null;
  automation_deleted: boolean;
  created_at: string;
}

/** `from`/`to` are local calendar dates (`yyyy-MM-dd`), both inclusive. */
export interface ContactFilters {
  clientId: number | null;
  automationId: string | null;
  from: string | null;
  to: string | null;
  reachedOnly: boolean;
  search: string;
}

export interface ContactPage {
  rows: InstagramContact[];
  total: number;
}

export interface ContactAutomationCount {
  automation_id: string;
  automation_name: string;
  client_id: number;
  automation_deleted: boolean;
  reached_count: number;
  total_count: number;
}

type ContactRow = InstagramContact & { total_count: number };

function localDayStart(ymd: string, addDays = 0): string {
  const [y, m, d] = ymd.split('-').map((p) => parseInt(p, 10));
  return new Date(y, m - 1, d + addDays).toISOString();
}

/** The RPC filters on `[p_from, p_to)`: the picked days map to the start of the
 * first day and the start of the day AFTER the last one, in local time. */
export function contactFiltersToRpcArgs(f: ContactFilters): Record<string, unknown> {
  const search = f.search.trim();
  return {
    p_client_id: f.clientId,
    p_automation_id: f.automationId,
    p_from: f.from ? localDayStart(f.from) : null,
    p_to: f.to ? localDayStart(f.to, 1) : null,
    p_reached_only: f.reachedOnly,
    p_search: search === '' ? null : search,
  };
}

function stripTotal(rows: ContactRow[]): InstagramContact[] {
  return rows.map(({ total_count: _total, ...rest }) => rest);
}

export async function listInstagramContacts(
  f: ContactFilters,
  page: number,
  pageSize = CONTACTS_PAGE_SIZE,
): Promise<ContactPage> {
  const { data, error } = await supabase.rpc('list_instagram_automation_contacts', {
    ...contactFiltersToRpcArgs(f),
    p_limit: pageSize,
    p_offset: (Math.max(1, page) - 1) * pageSize,
  });
  if (error) throw error;
  const rows = (data ?? []) as ContactRow[];
  return { rows: stripTotal(rows), total: rows.length > 0 ? Number(rows[0].total_count) : 0 };
}

/** Every contact matching the filters, keyset-paged on the immutable
 * (created_at, id) so a contact that interacts mid-export can't be skipped. */
export async function fetchAllInstagramContacts(f: ContactFilters): Promise<InstagramContact[]> {
  const out: InstagramContact[] = [];
  let cursorAt: string | null = null;
  let cursorId: string | null = null;
  for (;;) {
    const { data, error } = await supabase.rpc('list_instagram_automation_contacts', {
      ...contactFiltersToRpcArgs(f),
      p_export: true,
      p_limit: CONTACTS_EXPORT_CHUNK,
      p_cursor_at: cursorAt,
      p_cursor_id: cursorId,
    });
    if (error) throw error;
    const rows = (data ?? []) as ContactRow[];
    out.push(...stripTotal(rows));
    if (rows.length < CONTACTS_EXPORT_CHUNK) return out;
    const last = rows[rows.length - 1];
    cursorAt = last.created_at;
    cursorId = last.id;
  }
}

export async function getContactCounts(): Promise<ContactAutomationCount[]> {
  const { data, error } = await supabase.rpc('instagram_automation_contact_counts');
  if (error) throw error;
  return ((data ?? []) as ContactAutomationCount[]).map((r) => ({
    ...r,
    reached_count: Number(r.reached_count),
    total_count: Number(r.total_count),
  }));
}

export async function countInstagramContacts(): Promise<number> {
  const { count, error } = await supabase
    .from('instagram_automation_contacts')
    .select('id', { count: 'exact', head: true });
  if (error) throw error;
  return count ?? 0;
}
