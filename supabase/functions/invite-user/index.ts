import { createClient } from "npm:@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { classifyExistingUser, coerceHasPassword } from "../_shared/invite-classify.ts";
import { inviteOrResend } from "../_shared/invite-actions.ts";
import { createJsonResponder, internalServerError } from "../_shared/http.ts";
import { resolveActiveCaller, validateMembroForInvite } from "../_shared/invite-membro.ts";
import { hasPermissionFor } from "../_shared/permissions.ts";

async function findAuthUserByEmail(adminClient: any, email: string) {
  let page = 1;
  while (true) {
    const result = await adminClient.auth.admin.listUsers({ page, perPage: 100 });
    if (result.error) throw result.error;
    const users = result.data?.users;
    if (!users || users.length === 0) return null;
    const found = users.find(
      (u: any) => u.email?.toLowerCase() === email.toLowerCase()
    );
    if (found) return found;
    page++;
  }
}

async function deleteUnconfirmedInvitedUser(adminClient: any, email: string) {
  const authUser = await findAuthUserByEmail(adminClient, email);
  if (!authUser) return;

  // Cancelling an invite removes the invitee entirely, so delete any
  // not-onboarded user (whether they'd otherwise be re-invited or resent a
  // link). Only skip a fully-onboarded user, or the anomalous
  // confirmed-with-no-profile state (never auto-delete those).
  const { data: profile } = await adminClient
    .from('profiles')
    .select('onboarding_complete')
    .eq('id', authUser.id)
    .maybeSingle();
  const { data: pwData, error: pwError } = await adminClient
    .rpc('user_has_password', { p_user_id: authUser.id });
  const action = classifyExistingUser({
    emailConfirmed: !!authUser.email_confirmed_at,
    hasProfile: !!profile,
    onboardingComplete: profile?.onboarding_complete === true,
    hasPassword: coerceHasPassword(pwData, pwError),
  });
  if (action !== 'reinvite' && action !== 'resend-link') return;

  await adminClient.from('profiles').delete().eq('id', authUser.id);
  await adminClient.from('workspace_members').delete().eq('user_id', authUser.id);
  await adminClient.auth.admin.deleteUser(authUser.id);
}

Deno.serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req);
  const json = createJsonResponder(corsHeaders);
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') || '';
    const authHeader = req.headers.get('Authorization');

    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing Auth Header' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const token = authHeader.replace('Bearer ', '');

    // Use service role client to verify the user token (avoids ES256 local verification issue)
    const supabaseClient = createClient(supabaseUrl, supabaseKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: { user }, error: authError } = await supabaseClient.auth.getUser(token);

    if (authError || !user) {
      console.error("Auth erro:", authError);
      throw new Error('Não autenticado');
    }

    // Admin Client (Use Service Role Key)
    const adminClient = createClient(supabaseUrl, supabaseKey);

    // Authorization derives from the ACTIVE workspace: profiles.role/conta_id
    // go stale after a workspace switch (see manage-workspace-user).
    const caller = await resolveActiveCaller(adminClient, user.id);
    if (!caller) {
      return new Response(JSON.stringify({ error: 'Workspace não encontrado.' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // DELETE: Cancel an invite
    if (req.method === 'DELETE') {
      // Gerenciar convites (enviar/cancelar) exige 'equipe':'editar' -- não mais
      // um role literal. Um papel custom com essa permissão passa mesmo com o
      // chassi role='agent'; o preset legado de agent não tem 'equipe', então
      // segue negado, byte a byte com o comportamento anterior.
      const canManageTeam = await hasPermissionFor(
        adminClient, user.id, caller.workspaceId, "equipe", "editar",
      );
      if (!canManageTeam) throw new Error('Agentes não têm permissão para cancelar convites.');

      const url = new URL(req.url);
      const inviteId = url.searchParams.get('id');
      if (!inviteId) throw new Error('ID do convite não informado.');

      const { data: invite, error: findErr } = await adminClient
        .from('invites')
        .select('id, conta_id, email')
        .eq('id', inviteId)
        .eq('conta_id', caller.workspaceId)
        .maybeSingle();

      if (findErr) throw findErr;
      if (!invite) throw new Error('Convite não encontrado.');

      const { error: delErr } = await adminClient.from('invites').delete().eq('id', inviteId);
      if (delErr) throw delErr;

      await deleteUnconfirmedInvitedUser(adminClient, invite.email);

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json().catch(() => ({}));
    const { email, role } = body;

    if (!email || !role) throw new Error('E-mail ou Role não informados');
    if (!['owner', 'admin', 'agent'].includes(role)) {
       throw new Error('Role inválido');
    }

    const canManageTeam = await hasPermissionFor(
      adminClient, user.id, caller.workspaceId, "equipe", "editar",
    );
    if (!canManageTeam) throw new Error('Agentes não têm permissão para convidar novos usuários.');

    // Only a real owner invites an owner. NOT `caller.role === 'admin'`: that
    // literal only blocked the legacy admin role -- a custom role (chassis
    // role='agent') with 'equipe':'editar' sails past the actor gate above
    // and, before this fix, could invite themselves or anyone else as owner.
    if (caller.role !== 'owner' && role === 'owner') {
      throw new Error('Administradores não podem convidar novos donos.');
    }

    // Optional custom role: `role` above is the legacy display value from the
    // request body; roleId is threaded alongside it into inviteOrResend, which
    // is the single choke point that applies the chassis rule — every invites
    // row AND the actual membership collapse to 'agent' whenever roleId is
    // present, never the raw `role` here (see invite-actions.ts). A non-string
    // body.role_id is treated as absent, not an error — only a STRING that
    // fails the checks below is rejected.
    const roleId: string | null = typeof body.role_id === 'string' ? body.role_id : null;
    if (roleId) {
      const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      let validRoleId = UUID_RE.test(roleId);
      if (validRoleId) {
        const { data: roleRow } = await adminClient
          .from('workspace_roles').select('id')
          .eq('id', roleId).eq('conta_id', caller.workspaceId).maybeSingle();
        validRoleId = !!roleRow;
      }
      if (!validRoleId) {
        return new Response(JSON.stringify({ error: 'Papel inválido.' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    let membroId: number | undefined;
    if (body.membroId !== undefined && body.membroId !== null) {
      if (typeof body.membroId !== 'number' || !Number.isInteger(body.membroId)) {
        return new Response(JSON.stringify({ error: 'Requisição inválida.' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const check = await validateMembroForInvite(adminClient, {
        membroId: body.membroId, workspaceId: caller.workspaceId, email: email.toLowerCase(),
      });
      if (!check.ok) {
        const messages: Record<string, string> = {
          not_found: 'Membro não encontrado.',
          already_linked: 'Este membro já está vinculado a uma conta.',
          pending_conflict: 'Este e-mail já tem um convite pendente vinculado a outro membro.',
          membro_has_pending: 'Este membro já tem um convite pendente.',
        };
        return new Response(JSON.stringify({ error: messages[check.reason] }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      membroId = body.membroId;
    }

    const redirectBase = Deno.env.get('OAUTH_REDIRECT_BASE') || 'http://localhost:5173';
    let outcome;
    try {
      // addOnboarded: true — the CRM "invite" action adds an onboarded person
      // (existing behavior). The admin resend passes false. 'already-onboarded'
      // is therefore unreachable here.
      outcome = await inviteOrResend(adminClient, {
        contaId: caller.workspaceId,
        email: email.toLowerCase(),
        role,
        invitedBy: user.id,
        membroId,
        roleId,
        redirectBase,
      }, { addOnboarded: true, confirmCrossWorkspace: true });
    } catch (err: any) {
      if (err?.message === 'generate_link_failed') {
        throw new Error('Não foi possível gerar o link de acesso.');
      }
      throw err;
    }

    switch (outcome.route) {
      case 'plan-limit-exceeded':
        return new Response(
          JSON.stringify({ error: 'plan_limit_exceeded', resource: 'max_team_members' }),
          { status: 403, headers: { 'Content-Type': 'application/json', ...corsHeaders } },
        );
      case 'blocked-anomalous':
        throw new Error(
          'Conta com e-mail confirmado mas sem perfil. Não foi possível reenviar o convite automaticamente — contate o suporte.',
        );
      case 'already-member':
        return new Response(JSON.stringify({ error: 'Este usuário já pertence a este workspace.' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      case 'added':
        return new Response(JSON.stringify({ success: true, message: `${email} foi adicionado ao workspace como ${role}.` }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200,
        });
      case 'resent-link':
        return new Response(JSON.stringify({ success: true, message: `Novo link de acesso enviado para ${email}.` }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200,
        });
      case 'reinvited':
      case 'invited':
      default:
        return new Response(JSON.stringify({ success: true, message: `Convite enviado para ${email} como ${role}.` }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200,
        });
    }
  } catch (err: any) {
    return internalServerError(json, "invite-user", err);
  }
});
