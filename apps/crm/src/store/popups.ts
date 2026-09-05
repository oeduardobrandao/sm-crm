import { supabase, getCurrentUser } from './core';

export interface PopupPage {
  title: string;
  eyebrow: string | null;
  body: string;
  image_key: string | null;
  cta_label?: string | null;
  cta_url?: string | null;
}

export interface GlobalPopup {
  id: string;
  pages: PopupPage[];
  cta_label: string | null;
  cta_url: string | null;
  cta_style: 'ink' | 'brand';
  secondary_label: string | null;
  frequency: 'once' | 'until_cta';
  require_ack: boolean;
  created_at: string;
}

export type PopupAction = 'seen' | 'closed' | 'cta' | 'ack';

export interface PopupInteraction {
  popup_id: string;
  action: PopupAction;
}

const COLUMNS =
  'id, pages, cta_label, cta_url, cta_style, secondary_label, frequency, require_ack, created_at';

/** A RLS já filtra ativo + janela + targeting. Só o platform-admin escreve `pages`,
 * mas um dado inesperado nunca pode derrubar o shell: linha malformada é descartada. */
export async function getActivePopups(): Promise<GlobalPopup[]> {
  const { data, error } = await supabase
    .from('global_popups')
    .select(COLUMNS)
    .order('created_at', { ascending: false });
  if (error) throw error;
  const rows = (data || []) as GlobalPopup[];
  return rows.filter((p) => {
    const ok = Array.isArray(p.pages) && p.pages.length > 0;
    if (!ok) console.warn('[popups] ignoring popup with malformed pages', p.id);
    return ok;
  });
}

export async function getMyPopupInteractions(): Promise<PopupInteraction[]> {
  const user = await getCurrentUser();
  if (!user) return [];
  const { data, error } = await supabase
    .from('popup_interactions')
    .select('popup_id, action')
    .eq('user_id', user.id);
  if (error) throw error;
  return (data || []) as PopupInteraction[];
}

export async function recordPopupInteraction(popupId: string, action: PopupAction): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error('Not authenticated');
  const { error } = await supabase
    .from('popup_interactions')
    .insert({ popup_id: popupId, user_id: user.id, action });
  if (error) throw error;
}
