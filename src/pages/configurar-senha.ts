// =============================================
// Página: Configurar Senha (Invite / Recovery)
// =============================================
import { supabase } from '../lib/supabase';
import { navigate, showToast } from '../router';

export function renderConfigurarSenha(container: HTMLElement): void {
  // Hide sidebar (same pattern as login page)
  const sidebar = document.querySelector('.sidebar') as HTMLElement;
  if (sidebar) sidebar.style.display = 'none';
  const main = container.closest('.main-content') as HTMLElement || document.querySelector('.main-content');
  if (main) {
    main.style.marginLeft = '0';
    main.style.padding = '0';
  }

  container.innerHTML = `
    <div class="auth-wrapper">
      <div class="auth-card animate-up">
        <div class="auth-header">
          <div class="auth-logo">
            <img src="/mesaas-logo-horiz-dark-bg.svg" alt="Mesaas" style="height: 48px; width: auto;" class="logo-light" />
            <img src="/mesaas-logo-horiz-light-bg.svg" alt="Mesaas" style="height: 48px; width: auto; display: none;" class="logo-dark" />
          </div>
          <div class="auth-logo-sub" style="margin-top:5px;letter-spacing:1px">PLATAFORMA INTELIGENTE</div>
        </div>

        <h2 style="text-align:center;margin:0 0 0.25rem;font-size:1.25rem;color:var(--text-main)">Configurar Senha</h2>
        <p style="text-align:center;color:var(--text-muted);font-size:0.9rem;margin-bottom:1.5rem">Defina sua senha para acessar a plataforma.</p>

        <form id="set-password-form" class="auth-form">
          <div class="form-group">
            <label>Nova Senha</label>
            <input type="password" name="password" required placeholder="Mínimo 6 caracteres" class="form-input" autocomplete="new-password" minlength="6">
          </div>
          <div class="form-group">
            <label>Confirmar Senha</label>
            <input type="password" name="confirm" required placeholder="Repita a senha" class="form-input" autocomplete="new-password" minlength="6">
          </div>
          <button type="submit" class="btn-primary auth-submit" id="set-password-btn">
            <span class="btn-text">Salvar Senha</span>
            <span class="btn-loading" style="display:none"><i class="fa-solid fa-spinner fa-spin"></i></span>
          </button>
        </form>

        <p class="auth-footer">Plataforma segura para gestão de Social Media 🇧🇷</p>
      </div>
    </div>
  `;

  const form = container.querySelector('#set-password-form') as HTMLFormElement;
  const btn = container.querySelector('#set-password-btn') as HTMLElement;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const data = new FormData(form);
    const password = data.get('password') as string;
    const confirm = data.get('confirm') as string;

    if (!password || password.length < 6) {
      showToast('A senha deve ter no mínimo 6 caracteres.', 'error');
      return;
    }
    if (password !== confirm) {
      showToast('As senhas não coincidem.', 'error');
      return;
    }

    setLoading(btn, true);

    // Get the user's email before updating (to auto-fill login)
    const { data: { session } } = await supabase.auth.getSession();
    const email = session?.user?.email || '';

    const { error } = await supabase.auth.updateUser({ password });
    setLoading(btn, false);

    if (error) {
      showToast(error.message, 'error');
      return;
    }

    // Sign out so they log in fresh with the new password
    await supabase.auth.signOut();

    // Store email temporarily to auto-fill login form
    if (email) {
      sessionStorage.setItem('prefill_email', email);
    }

    showToast('Senha configurada com sucesso! Faça login.', 'success');
    navigate('/login');
  });
}

function setLoading(btn: HTMLElement, loading: boolean) {
  const text = btn.querySelector('.btn-text') as HTMLElement;
  const spinner = btn.querySelector('.btn-loading') as HTMLElement;
  if (loading) {
    text.style.display = 'none';
    spinner.style.display = 'inline';
    (btn.closest('button') || btn).setAttribute('disabled', 'true');
  } else {
    text.style.display = 'inline';
    spinner.style.display = 'none';
    (btn.closest('button') || btn).removeAttribute('disabled');
  }
}
