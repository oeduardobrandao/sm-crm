// =============================================
// Página: Login / Registro
// =============================================
import { signIn, signUp, resetPassword } from '../lib/supabase';
import { navigate, showToast } from '../router';

export function renderLogin(container: HTMLElement): void {
  // Hide sidebar when on login page
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
          <p style="text-align:center;margin-top:0.75rem"><a href="#" id="forgot-password-link" class="auth-text-link">Esqueci minha senha</a></p>
        </form>

        <!-- FORGOT PASSWORD FORM -->
        <form id="forgot-form" class="auth-form" style="display:none">
          <p style="color:var(--text-muted);font-size:0.9rem;margin-bottom:1rem">Informe seu e-mail para receber um link de redefinição de senha.</p>
          <div class="form-group">
            <label>E-mail</label>
            <input type="email" name="email" required placeholder="seu@email.com" class="form-input" autocomplete="email">
          </div>
          <button type="submit" class="btn-primary auth-submit" id="forgot-btn">
            <span class="btn-text">Enviar Link</span>
            <span class="btn-loading" style="display:none"><i class="fa-solid fa-spinner fa-spin"></i></span>
          </button>
          <p style="text-align:center;margin-top:0.75rem"><a href="#" id="back-to-login-link" class="auth-text-link">← Voltar para o login</a></p>
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

  // --- Prefill email from configure-password flow ---
  const prefillEmail = sessionStorage.getItem('prefill_email');
  if (prefillEmail) {
    sessionStorage.removeItem('prefill_email');
    const emailInput = container.querySelector('#login-form input[name="email"]') as HTMLInputElement;
    if (emailInput) emailInput.value = prefillEmail;
  }

  // --- Tab switching ---
  const tabs = container.querySelectorAll('.auth-tab');
  const loginForm = container.querySelector('#login-form') as HTMLFormElement;
  const registerForm = container.querySelector('#register-form') as HTMLFormElement;
  const forgotForm = container.querySelector('#forgot-form') as HTMLFormElement;
  const tabsContainer = container.querySelector('.auth-tabs') as HTMLElement;

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const tabName = (tab as HTMLElement).dataset.tab;
      loginForm.style.display = tabName === 'login' ? 'flex' : 'none';
      registerForm.style.display = tabName === 'register' ? 'flex' : 'none';
      forgotForm.style.display = 'none';
      tabsContainer.style.display = '';
    });
  });

  // --- Forgot password link ---
  container.querySelector('#forgot-password-link')?.addEventListener('click', (e) => {
    e.preventDefault();
    loginForm.style.display = 'none';
    registerForm.style.display = 'none';
    forgotForm.style.display = 'flex';
    tabsContainer.style.display = 'none';
  });

  container.querySelector('#back-to-login-link')?.addEventListener('click', (e) => {
    e.preventDefault();
    forgotForm.style.display = 'none';
    loginForm.style.display = 'flex';
    tabsContainer.style.display = '';
    tabs.forEach(t => t.classList.remove('active'));
    tabs[0]?.classList.add('active');
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

  // --- Forgot Password ---
  forgotForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = container.querySelector('#forgot-btn') as HTMLElement;
    setLoading(btn, true);

    const data = new FormData(forgotForm);
    const email = data.get('email') as string;

    const { error } = await resetPassword(email);
    setLoading(btn, false);

    if (error) {
      showToast(error.message, 'error');
    } else {
      showToast('Link de redefinição enviado para ' + email + '. Verifique sua caixa de entrada.', 'success');
      // Switch back to login
      forgotForm.style.display = 'none';
      loginForm.style.display = 'flex';
      tabsContainer.style.display = '';
      tabs.forEach(t => t.classList.remove('active'));
      tabs[0]?.classList.add('active');
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
  if (main) {
    main.style.marginLeft = '';
    main.style.padding = '';
  }
}
