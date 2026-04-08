// =============================================
// Mesaas - Supabase Client
// =============================================
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error('Missing Supabase environment variables. Check your .env file.');
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ---- Auth State ----
let cachedProfile: any = null;

export function clearProfileCache() {
  cachedProfile = null;
}

/**
 * Returns the current authenticated user.
 * Uses getSession() directly — zero dependency on event callbacks.
 */
export async function getCurrentUser() {
  const { data, error } = await supabase.auth.getSession();
  if (error) {
    console.warn('getSession error:', error);
    return null;
  }
  return data.session?.user || null;
}

/**
 * Returns the user's profile from the profiles table. Cached until force=true.
 */
export async function getCurrentProfile(force = false) {
  if (cachedProfile && !force) return cachedProfile;

  try {
    const user = await getCurrentUser();
    if (!user) return null;

    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single();

    if (error) throw error;
    cachedProfile = data;
    return data;
  } catch (e) {
    console.warn('getCurrentProfile error:', e);
    return null;
  }
}

/**
 * Updates the sidebar avatar and name from the profile.
 */
export function updateSidebarUI(profile: any) {
  if (!profile?.nome) return;
  const initials = profile.nome
    .split(' ')
    .map((w: string) => w?.charAt(0) || '')
    .join('')
    .substring(0, 2)
    .toUpperCase();

  // Desktop sidebar
  const avatarEl = document.querySelector('.sidebar .avatar');
  const nameEl = document.querySelector('.sidebar .user-name');
  if (avatarEl) avatarEl.textContent = initials;
  if (nameEl) nameEl.textContent = profile.nome;

  // Mobile profile in "More" sheet
  const mobileAvatar = document.getElementById('mobile-avatar');
  const mobileName = document.getElementById('mobile-user-name');
  if (mobileAvatar) mobileAvatar.textContent = initials;
  if (mobileName) mobileName.textContent = profile.nome;

  // Populate workspace switcher (async, fire-and-forget)
  populateWorkspaceSwitcher(profile.active_workspace_id || profile.conta_id);
}

async function populateWorkspaceSwitcher(activeWorkspaceId: string | null) {
  const switcherEl = document.getElementById('workspace-switcher');
  const listEl = document.getElementById('workspace-list');
  if (!switcherEl || !listEl) return;

  try {
    const user = await getCurrentUser();
    if (!user) return;

    const { data, error } = await supabase
      .from('workspace_members')
      .select('workspace_id, role, workspaces!inner(id, name)')
      .eq('user_id', user.id);

    if (error || !data || data.length <= 1) {
      // Single workspace or error — hide switcher
      switcherEl.style.display = 'none';
      return;
    }

    switcherEl.style.display = '';
    listEl.textContent = ''; // Clear safely

    data.forEach((m: any) => {
      const btn = document.createElement('button');
      btn.className = 'user-dropdown-item';
      btn.style.cssText = 'width: 100%; border: none; background: transparent; text-align: left; font-family: inherit; font-size: inherit; cursor: pointer; display: flex; align-items: center; gap: 0.5rem;';
      const isActive = m.workspaces.id === activeWorkspaceId;
      if (isActive) {
        btn.style.fontWeight = '600';
        btn.style.color = 'var(--primary-color)';
      }

      const icon = document.createElement('i');
      icon.className = isActive ? 'ph ph-check-circle' : 'ph ph-circle';
      btn.appendChild(icon);

      const span = document.createElement('span');
      span.textContent = m.workspaces.name || 'Workspace';
      btn.appendChild(span);

      if (!isActive) {
        btn.addEventListener('click', async () => {
          try {
            const { error: switchErr } = await supabase
              .from('profiles')
              .update({ active_workspace_id: m.workspaces.id, conta_id: m.workspaces.id })
              .eq('id', user.id);
            if (switchErr) throw switchErr;
            cachedProfile = null;
            window.location.reload();
          } catch (e) {
            console.error('Workspace switch error:', e);
          }
        });
      }

      listEl.appendChild(btn);
    });
  } catch (e) {
    console.error('populateWorkspaceSwitcher error:', e);
    switcherEl.style.display = 'none';
  }
}

export async function signIn(email: string, password: string) {
  cachedProfile = null; // clear cache on new login
  return supabase.auth.signInWithPassword({ email, password });
}

export async function signUp(email: string, password: string, meta?: { nome?: string; empresa?: string }) {
  return supabase.auth.signUp({
    email,
    password,
    options: { data: meta, emailRedirectTo: window.location.origin + '/login' },
  });
}

export async function resetPassword(email: string) {
  return supabase.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin + '/configurar-senha',
  });
}

export async function signOut() {
  cachedProfile = null;
  return supabase.auth.signOut();
}
