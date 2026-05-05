import { supabase, getCurrentUser } from './core';

export interface GlobalBanner {
  id: string;
  type: 'info' | 'warning' | 'critical';
  content: string;
  link: string | null;
  custom_color: string | null;
  dismissible: boolean;
  created_at: string;
}

export async function getActiveBanners(): Promise<GlobalBanner[]> {
  const { data, error } = await supabase
    .from('global_banners')
    .select('id, type, content, link, custom_color, dismissible, created_at')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function getDismissedBannerIds(): Promise<string[]> {
  const user = await getCurrentUser();
  if (!user) return [];
  const { data, error } = await supabase
    .from('banner_dismissals')
    .select('banner_id')
    .eq('user_id', user.id);
  if (error) throw error;
  return (data || []).map((d) => d.banner_id);
}

export async function dismissBanner(bannerId: string): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error('Not authenticated');
  const { error } = await supabase
    .from('banner_dismissals')
    .insert({ banner_id: bannerId, user_id: user.id });
  if (error && error.code !== '23505') throw error;
}
