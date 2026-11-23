import { supabase } from '@/lib/supabase';

export interface HubPerson {
  id: string;
  nome: string;
  email: string;
  last_login_at: string | null;
  created_at: string;
}

export interface HubPeopleData {
  require_login: boolean;
  people: HubPerson[];
}

export type HubPeopleErrorCode =
  | 'forbidden'
  | 'not_found'
  | 'invalid'
  | 'duplicate'
  | 'limit'
  | 'no_people'
  | 'last_person'
  | 'generic';

/** Mirrors the per-client cap enforced by hub_people_add. */
export const HUB_PEOPLE_LIMIT = 20;

export function hubPeopleKey(clienteId: number) {
  return ['hub-people', clienteId] as const;
}

export async function getHubPeople(clienteId: number): Promise<HubPeopleData> {
  const { data, error } = await supabase.rpc('hub_people_list', { p_cliente_id: clienteId });
  if (error) throw error;
  return data as HubPeopleData;
}

export async function addHubPerson(
  clienteId: number,
  nome: string,
  email: string,
): Promise<string> {
  const { data, error } = await supabase.rpc('hub_people_add', {
    p_cliente_id: clienteId,
    p_nome: nome,
    p_email: email,
  });
  if (error) throw error;
  return data as string;
}

export async function removeHubPerson(personId: string): Promise<void> {
  const { error } = await supabase.rpc('hub_people_remove', { p_person_id: personId });
  if (error) throw error;
}

export async function setHubRequireLogin(clienteId: number, value: boolean): Promise<void> {
  const { error } = await supabase.rpc('hub_set_require_login', {
    p_cliente_id: clienteId,
    p_value: value,
  });
  if (error) throw error;
}

const CODES = [
  'forbidden',
  'not_found',
  'invalid',
  'duplicate',
  'limit',
  'no_people',
  'last_person',
] as const;

/** The RPCs raise plain-text codes; raw Postgres text must never reach the user. */
export function hubPeopleErrorCode(e: { message?: string }): HubPeopleErrorCode {
  const m = e?.message ?? '';
  return CODES.find((c) => m.includes(c)) ?? 'generic';
}
