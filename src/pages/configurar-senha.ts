// =============================================
// Página: Configurar Senha (Invite / Recovery)
// =============================================
import { supabase } from '../lib/supabase';
import { navigate, showToast, escapeHTML } from '../router';
import { passwordToggleHTML, passwordStrengthHTML, attachPasswordToggle, attachPasswordStrength, validatePassword } from '../utils/password-toggle';

export async function renderConfigurarSenha(container: HTMLElement): Promise<void> {
  // Hide sidebar (same pattern as login page)
  const sidebar = document.querySelector('.sidebar') as HTMLElement;
  if (sidebar) sidebar.style.display = 'none';
  const main = container.closest('.main-content') as HTMLElement || document.querySelector('.main-content');
  if (main) {
    main.style.marginLeft = '0';
    main.style.padding = '0';
  }

  // Get current session to extract user info
  const { data: { session } } = await supabase.auth.getSession();
  const email = session?.user?.email || '';
  const contaId = session?.user?.user_metadata?.conta_id || '';

  // Fetch workspace info (owner's empresa name + inviter name)
  let workspaceName = '';
  let inviterName = '';
  let inviterInitials = '';

  if (contaId) {
    const { data: ownerProfile } = await supabase
      .from('profiles')
      .select('nome, empresa')
      .eq('conta_id', contaId)
      .eq('role', 'owner')
      .maybeSingle();

    if (ownerProfile) {
      workspaceName = ownerProfile.empresa || '';
      inviterName = ownerProfile.nome || '';
      inviterInitials = inviterName
        .split(' ')
        .filter(Boolean)
        .slice(0, 2)
        .map((w: string) => w[0].toUpperCase())
        .join('');
    }
  }

  // Determine if this is an invite or password recovery
  const isInvite = !!contaId;

  // All dynamic values are sanitized via escapeHTML before interpolation
  const safeEmail = escapeHTML(email);
  const safeInviterInitials = escapeHTML(inviterInitials);
  const safeInviterName = escapeHTML(inviterName);
  const safeWorkspaceName = escapeHTML(workspaceName);

  container.innerHTML = `
    <style>
      .invite-page { min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 2rem 1rem; background: #f5f3ee; }
      .invite-card { background: #fff; border-radius: 16px; width: 100%; max-width: 440px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.06), 0 4px 16px rgba(0,0,0,0.06); }
      .invite-header { background: #1a3d2b; padding: 2rem 2rem 1.75rem; text-align: center; }
      .invite-header img { display: block; margin: 0 auto 1.5rem; height: 28px; width: auto; }
      .invite-avatar { width: 52px; height: 52px; background: #f0a832; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 18px; font-weight: 700; color: #1a3d2b; margin: 0 auto 1rem; letter-spacing: -0.5px; }
      .invite-header h1 { color: #fff; font-size: 20px; font-weight: 600; letter-spacing: -0.3px; margin: 0 0 0.35rem; }
      .invite-header p { color: #9dbfa9; font-size: 14px; margin: 0; }
      .invite-workspace-badge { display: inline-flex; align-items: center; gap: 6px; background: rgba(240,168,50,0.15); border: 1px solid rgba(240,168,50,0.3); border-radius: 20px; padding: 4px 12px; margin-top: 0.75rem; font-size: 13px; font-weight: 500; color: #f0a832; }
      .invite-workspace-badge svg { width: 13px; height: 13px; flex-shrink: 0; }
      .invite-body { padding: 2rem; }
      .invite-body label { display: block; font-size: 13px; font-weight: 500; color: #444441; margin-bottom: 6px; }
      .invite-input-wrap { position: relative; margin-bottom: 1rem; }
      .invite-body input[type="text"],
      .invite-body input[type="email"],
      .invite-body input[type="password"] { width: 100%; height: 44px; border: 1px solid #d3d1c7; border-radius: 8px; padding: 0 40px 0 12px; font-size: 15px; color: #2c2c2a; background: #fff; outline: none; transition: border-color 0.15s; box-sizing: border-box; font-family: inherit; }
      .invite-body input[type="email"] { background: #f8f7f3; color: #888780; cursor: not-allowed; }
      .invite-body input:focus { border-color: #1a3d2b; }
      .password-input-wrap { position: relative; }
      .password-eye-toggle { position: absolute; right: 12px; top: 50%; transform: translateY(-50%); background: none; border: none; cursor: pointer; color: #888780; padding: 0; display: flex; align-items: center; }
      .password-strength-hints { display: flex; gap: 8px; margin-top: 8px; flex-wrap: wrap; }
      .password-hint-pill { font-size: 11px; padding: 3px 8px; border-radius: 20px; background: #f1efe8; color: #888780; display: flex; align-items: center; gap: 4px; transition: background 0.15s, color 0.15s; }
      .password-hint-pill.met { background: #eaf3de; color: #3b6d11; }
      .password-hint-pill svg { width: 10px; height: 10px; }
      .invite-divider { border: none; border-top: 1px solid #f1efe8; margin: 1.25rem 0; }
      .invite-btn-primary { width: 100%; height: 46px; background: #1a3d2b; color: #fff; border: none; border-radius: 8px; font-size: 15px; font-weight: 600; cursor: pointer; letter-spacing: 0.1px; transition: background 0.15s, transform 0.1s; font-family: inherit; }
      .invite-btn-primary:hover { background: #163325; }
      .invite-btn-primary:active { transform: scale(0.99); }
      .invite-btn-primary:disabled { opacity: 0.7; cursor: not-allowed; }
      .invite-terms { text-align: center; font-size: 12px; color: #888780; margin-top: 1rem; line-height: 1.6; }
      .invite-terms a { color: #1a3d2b; text-decoration: underline; }
      .invite-footer { padding: 1rem 2rem; background: #f8f7f3; border-top: 1px solid #ece9e2; text-align: center; }
      .invite-footer p { font-size: 12px; color: #888780; margin: 0; }
      .invite-footer a { color: #1a3d2b; text-decoration: none; font-weight: 500; }
      .invite-success { display: none; text-align: center; padding: 2rem 2rem 2.5rem; }
      .invite-success-icon { width: 60px; height: 60px; background: #eaf3de; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 1.25rem; }
    </style>

    <div class="invite-page">
      <div class="invite-card">

        <div class="invite-header">
          <img src="/mesaas-logo-horiz-dark-bg.svg" alt="Mesaas" />
          ${isInvite && safeInviterInitials ? `<div class="invite-avatar">${safeInviterInitials}</div>` : ''}
          <h1>${isInvite ? 'Você foi convidado' : 'Configurar Senha'}</h1>
          ${isInvite && safeInviterName
            ? `<p><strong style="color:#fff;">${safeInviterName}</strong> te convidou para</p>`
            : (isInvite ? '' : '<p>Defina sua nova senha para acessar a plataforma.</p>')}
          ${isInvite && safeWorkspaceName ? `
            <div class="invite-workspace-badge">
              <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect x="3" y="3" width="8" height="8" rx="1.5" stroke="currentColor" stroke-width="2"/>
                <rect x="13" y="3" width="8" height="8" rx="1.5" stroke="currentColor" stroke-width="2"/>
                <rect x="3" y="13" width="8" height="8" rx="1.5" stroke="currentColor" stroke-width="2"/>
                <rect x="13" y="13" width="8" height="8" rx="1.5" stroke="currentColor" stroke-width="2"/>
              </svg>
              ${safeWorkspaceName}
            </div>
          ` : ''}
        </div>

        <div id="invite-form-state">
          <div class="invite-body">

            <div class="invite-input-wrap">
              <label for="invite-email">Seu e-mail</label>
              <input type="email" id="invite-email" value="${safeEmail}" readonly />
            </div>

            ${isInvite ? `
              <div class="invite-input-wrap">
                <label for="invite-name">Seu nome completo</label>
                <input type="text" id="invite-name" placeholder="Como prefere ser chamado?" />
              </div>
              <hr class="invite-divider" />
            ` : ''}

            <div class="invite-input-wrap">
              <label for="invite-password">${isInvite ? 'Crie sua senha' : 'Nova senha'}</label>
              <div class="password-input-wrap">
                <input type="password" id="invite-password" placeholder="Mínimo 8 caracteres" />
                ${passwordToggleHTML('invite-eye-btn')}
              </div>
              ${passwordStrengthHTML('invite')}
            </div>

            <div style="margin-top: 1.5rem;">
              <button class="invite-btn-primary" id="invite-submit-btn">${isInvite ? 'Aceitar convite e entrar' : 'Salvar senha'}</button>
            </div>

            ${isInvite ? `
              <p class="invite-terms">
                Ao aceitar, você concorda com os
                <a href="#/politica-de-privacidade">Termos de Uso</a> e a
                <a href="#/politica-de-privacidade">Política de Privacidade</a> do Mesaas.
              </p>
            ` : ''}
          </div>
        </div>

        <div class="invite-success" id="invite-success-state">
          <div class="invite-success-icon">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M20 6L9 17L4 12" stroke="#3b6d11" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </div>
          <h2 style="font-size: 18px; font-weight: 600; color: #1a3d2b; margin: 0 0 0.5rem;">Conta criada com sucesso!</h2>
          <p style="font-size: 14px; color: #888780; line-height: 1.6; margin: 0 0 1.5rem;">
            ${isInvite && safeWorkspaceName
              ? `Bem-vindo ao workspace <strong style="color: #444441;">${safeWorkspaceName}</strong>. Redirecionando você agora...`
              : 'Senha atualizada. Redirecionando você agora...'}
          </p>
          <div style="width: 100%; height: 4px; background: #f1efe8; border-radius: 4px; overflow: hidden;">
            <div id="invite-progress-bar" style="height: 100%; background: #1a3d2b; width: 0%; border-radius: 4px; transition: width 2.5s ease;"></div>
          </div>
        </div>

        <div class="invite-footer">
          <p>${isInvite ? 'Não esperava este convite? Ignore este e-mail — nenhuma conta será criada.' : ''}</p>
        </div>

      </div>
    </div>
  `;

  // --- Event Listeners ---

  const passwordInput = container.querySelector('#invite-password') as HTMLInputElement;
  const submitBtn = container.querySelector('#invite-submit-btn') as HTMLButtonElement;
  const nameInput = container.querySelector('#invite-name') as HTMLInputElement | null;

  // Password visibility toggle & strength hints (shared helpers)
  attachPasswordToggle(container, 'invite-password', 'invite-eye-btn');
  attachPasswordStrength(container, 'invite-password', 'invite');

  // Submit
  submitBtn?.addEventListener('click', async () => {
    const password = passwordInput.value;
    const name = nameInput?.value?.trim() || '';

    const passError = validatePassword(password);
    if (passError) {
      showToast(passError, 'error');
      return;
    }

    if (isInvite && !name) {
      showToast('Por favor, informe seu nome.', 'error');
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Salvando...';

    try {
      // Update password (and name if invite)
      const updateData: { password: string; data?: { nome: string } } = { password };
      if (isInvite && name) {
        updateData.data = { nome: name };
      }
      const { error } = await supabase.auth.updateUser(updateData);
      if (error) {
        showToast(error.message, 'error');
        submitBtn.disabled = false;
        submitBtn.textContent = isInvite ? 'Aceitar convite e entrar' : 'Salvar senha';
        return;
      }

      // Update profile name if invite
      if (isInvite && name && session?.user?.id) {
        await supabase
          .from('profiles')
          .update({ nome: name })
          .eq('id', session.user.id);
      }

      // Mark invite as accepted (via edge function since RLS blocks direct client updates)
      if (isInvite && email) {
        try {
          const token = (await supabase.auth.getSession()).data.session?.access_token;
          await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/manage-workspace-user`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ action: 'accept-invite', email: email.toLowerCase() })
          });
        } catch (_) { /* non-critical — invite will expire naturally */ }
      }

      // Show success state
      const formState = container.querySelector('#invite-form-state') as HTMLElement;
      const successState = container.querySelector('#invite-success-state') as HTMLElement;
      formState.style.display = 'none';
      successState.style.display = 'block';

      setTimeout(() => {
        const bar = container.querySelector('#invite-progress-bar') as HTMLElement;
        if (bar) bar.style.width = '100%';
      }, 100);

      // Redirect after animation
      setTimeout(() => {
        navigate('/dashboard');
      }, 2800);

    } catch (err: unknown) {
      showToast('Erro: ' + (err instanceof Error ? err.message : 'Desconhecido'), 'error');
      submitBtn.disabled = false;
      submitBtn.textContent = isInvite ? 'Aceitar convite e entrar' : 'Salvar senha';
    }
  });
}
