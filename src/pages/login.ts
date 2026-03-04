// =============================================
// Página: Login / Registro
// =============================================
import { signIn, signUp } from '../lib/supabase';
import { navigate, showToast } from '../router';

export function renderLogin(container: HTMLElement): void {
  // Hide sidebar when on login page
  const sidebar = document.querySelector('.sidebar') as HTMLElement;
  if (sidebar) sidebar.style.display = 'none';
  const main = container.closest('.main-content') as HTMLElement;
  if (main) main.style.marginLeft = '0';

  container.innerHTML = `
    <div class="auth-wrapper">
      <div class="auth-card animate-up">
        <div class="auth-header">
          <div class="auth-logo">CRM Fluxo</div>
          <div class="auth-logo-sub">GESTÃO INTELIGENTE</div>
        </div>

        <div class="auth-tabs">
          <button class="auth-tab active" data-tab="login">Entrar</button>
          <button class="auth-tab" data-tab="register">Criar Conta</button>
        </div>

        <!-- LOGIN FORM -->
        <form id="login-form" class="auth-form">
          <div class="form-group">
            <label>E-mail</label>
            <input type="email" name="email" required placeholder="seu@email.com" class="form-input" autocomplete="email">
          </div>
          <div class="form-group">
            <label>Senha</label>
            <input type="password" name="password" required placeholder="••••••••" class="form-input" autocomplete="current-password" minlength="6">
          </div>
          <button type="submit" class="btn-primary auth-submit" id="login-btn">
            <span class="btn-text">Entrar</span>
            <span class="btn-loading" style="display:none"><i class="fa-solid fa-spinner fa-spin"></i></span>
          </button>
        </form>

        <!-- REGISTER FORM -->
        <form id="register-form" class="auth-form" style="display:none">
          <div class="form-group">
            <label>Nome Completo</label>
            <input type="text" name="nome" required placeholder="Marina Silva" class="form-input">
          </div>
          <div class="form-group">
            <label>Nome da Empresa</label>
            <input type="text" name="empresa" placeholder="Agência Digital" class="form-input">
          </div>
          <div class="form-group">
            <label>E-mail</label>
            <input type="email" name="email" required placeholder="seu@email.com" class="form-input" autocomplete="email">
          </div>
          <div class="form-group">
            <label>Senha</label>
            <input type="password" name="password" required placeholder="Mínimo 6 caracteres" class="form-input" autocomplete="new-password" minlength="6">
          </div>
          <button type="submit" class="btn-primary auth-submit" id="register-btn">
            <span class="btn-text">Criar Conta</span>
            <span class="btn-loading" style="display:none"><i class="fa-solid fa-spinner fa-spin"></i></span>
          </button>
        </form>

        <p class="auth-footer">Plataforma segura para gestão de Social Media 🇧🇷</p>
      </div>
    </div>
  `;

  // --- Tab switching ---
  const tabs = container.querySelectorAll('.auth-tab');
  const loginForm = container.querySelector('#login-form') as HTMLFormElement;
  const registerForm = container.querySelector('#register-form') as HTMLFormElement;

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const tabName = (tab as HTMLElement).dataset.tab;
      if (tabName === 'login') {
        loginForm.style.display = 'flex';
        registerForm.style.display = 'none';
      } else {
        loginForm.style.display = 'none';
        registerForm.style.display = 'flex';
      }
    });
  });

  // --- Login ---
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = container.querySelector('#login-btn') as HTMLElement;
    setLoading(btn, true);

    const data = new FormData(loginForm);
    const email = data.get('email') as string;
    const password = data.get('password') as string;

    const { error } = await signIn(email, password);
    setLoading(btn, false);

    if (error) {
      showToast(error.message === 'Invalid login credentials' ? 'E-mail ou senha incorretos.' : error.message, 'error');
    } else {
      showToast('Login realizado com sucesso!');
      navigate('/dashboard');
    }
  });

  // --- Register ---
  registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = container.querySelector('#register-btn') as HTMLElement;
    setLoading(btn, true);

    const data = new FormData(registerForm);
    const email = data.get('email') as string;
    const password = data.get('password') as string;
    const nome = data.get('nome') as string;
    const empresa = data.get('empresa') as string;

    const { error } = await signUp(email, password, { nome, empresa });
    
    // Se ainda estamos na mesma tela de hash
    if (window.location.hash.includes('login')) {
      setLoading(btn, false);
      
      if (error) {
        showToast(error.message, 'error');
      } else {
        showToast('Você será redirecionado em instantes...');
      }
    }
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

export function restoreSidebar(): void {
  const sidebar = document.querySelector('.sidebar') as HTMLElement;
  if (sidebar) sidebar.style.display = 'flex';
  const main = document.querySelector('.main-content') as HTMLElement;
  if (main) main.style.marginLeft = '';
}
