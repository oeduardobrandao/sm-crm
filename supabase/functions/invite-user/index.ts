import { createClient } from "npm:@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { seatsAvailable } from "./seats.ts";
import { classifyExistingUser } from "./onboarding.ts";
import { effectivePlanLimit } from "../_shared/entitlements-rpc.ts";

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

  // Key cleanup off onboarding completion, not email_confirmed_at: a user who
  // clicked the invite link is confirmed but may never have set a password.
  // Only skip deletion for a fully-onboarded user, or the anomalous
  // confirmed-with-no-profile state (never auto-delete that).
  const { data: profile } = await adminClient
    .from('profiles')
    .select('onboarding_complete')
    .eq('id', authUser.id)
    .maybeSingle();
  const action = classifyExistingUser({
    emailConfirmed: !!authUser.email_confirmed_at,
    hasProfile: !!profile,
    onboardingComplete: profile?.onboarding_complete === true,
  });
  if (action !== 'reinvite') return;

  await adminClient.from('profiles').delete().eq('id', authUser.id);
  await adminClient.from('workspace_members').delete().eq('user_id', authUser.id);
  await adminClient.auth.admin.deleteUser(authUser.id);
}

Deno.serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req);
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

    // Get current user profile
    const { data: profile, error: profileError } = await adminClient
      .from('profiles')
      .select('conta_id, role')
      .eq('id', user.id)
      .single();

    if (profileError || !profile) {
       console.error("Profile erro:", profileError);
       throw new Error('Perfil não encontrado');
    }

    // DELETE: Cancel an invite
    if (req.method === 'DELETE') {
      if (profile.role === 'agent') throw new Error('Agentes não têm permissão para cancelar convites.');

      const url = new URL(req.url);
      const inviteId = url.searchParams.get('id');
      if (!inviteId) throw new Error('ID do convite não informado.');

      const { data: invite, error: findErr } = await adminClient
        .from('invites')
        .select('id, conta_id, email')
        .eq('id', inviteId)
        .eq('conta_id', profile.conta_id)
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

    if (profile.role === 'agent') throw new Error('Agentes não têm permissão para convidar novos usuários.');

    // Admin can't invite owner
    if (profile.role === 'admin' && role === 'owner') {
      throw new Error('Administradores não podem convidar novos donos.');
    }

    // Seat pre-check: count active members + pending invites against plan limit
    const limit = await effectivePlanLimit(adminClient, profile.conta_id, "max_team_members");
    const [{ count: members }, { count: pending }] = await Promise.all([
      adminClient.from("workspace_members").select("*", { count: "exact", head: true })
        .eq("workspace_id", profile.conta_id),
      adminClient.from("invites").select("*", { count: "exact", head: true })
        .eq("conta_id", profile.conta_id).eq("status", "pending"),
    ]);
    if (!seatsAvailable({ limit, members: members ?? 0, pendingInvites: pending ?? 0 })) {
      return new Response(
        JSON.stringify({ error: "plan_limit_exceeded", resource: "max_team_members" }),
        { status: 403, headers: { "Content-Type": "application/json", ...corsHeaders } },
      );
    }

    // Clean up any existing pending/expired invites for this email + workspace
    await adminClient.from('invites').delete()
      .eq('email', email.toLowerCase())
      .eq('conta_id', profile.conta_id)
      .in('status', ['pending', 'expired']);

    // Check if user already exists in auth
    const existingUser = await findAuthUserByEmail(adminClient, email);

    if (existingUser) {
      // A user who clicked the invite link has their e-mail confirmed but may
      // never have set a password ("confirmed-with-no-password"). Branch on
      // whether they actually completed onboarding, not on email_confirmed_at,
      // so a half-finished invitee is re-invited with a fresh set-password link
      // instead of being silently marked "accepted" (which left them unable to
      // log in — the "wrong password" symptom).
      const { data: existingOnboarding } = await adminClient
        .from('profiles')
        .select('onboarding_complete')
        .eq('id', existingUser.id)
        .maybeSingle();

      const action = classifyExistingUser({
        emailConfirmed: !!existingUser.email_confirmed_at,
        hasProfile: !!existingOnboarding,
        onboardingComplete: existingOnboarding?.onboarding_complete === true,
      });

      if (action === 'blocked-anomalous') {
        // Confirmed auth user with no profile row — impossible by design.
        // Refuse to auto-wipe; surface for manual support intervention.
        throw new Error(
          'Conta com e-mail confirmado mas sem perfil. Não foi possível reenviar o convite automaticamente — contate o suporte.',
        );
      }

      if (action === 'reinvite') {
        // Never-onboarded user (never confirmed, or confirmed-but-passwordless)
        // — delete and re-invite fresh so they receive a working set-password link.
        await adminClient.from('profiles').delete().eq('id', existingUser.id);
        await adminClient.from('workspace_members').delete().eq('user_id', existingUser.id);
        await adminClient.auth.admin.deleteUser(existingUser.id);
        // Fall through to "new user" path below
      } else {
        // --- Fully onboarded user: add to this workspace directly ---
        const { data: existingMembership } = await adminClient
          .from('workspace_members')
          .select('id')
          .eq('user_id', existingUser.id)
          .eq('workspace_id', profile.conta_id)
          .maybeSingle();

        if (existingMembership) {
          return new Response(JSON.stringify({ error: 'Este usuário já pertence a este workspace.' }), {
            status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        const { error: memberErr } = await adminClient
          .from('workspace_members')
          .insert({
            user_id: existingUser.id,
            workspace_id: profile.conta_id,
            role,
          });
        if (memberErr) throw memberErr;

        const { data: existingProfile } = await adminClient
          .from('profiles')
          .select('id')
          .eq('id', existingUser.id)
          .maybeSingle();

        if (!existingProfile) {
          const { error: insertErr } = await adminClient
            .from('profiles')
            .insert({
              id: existingUser.id,
              conta_id: profile.conta_id,
              role,
              nome: existingUser.user_metadata?.nome || email.split('@')[0],
              active_workspace_id: profile.conta_id,
              onboarding_complete: true,
            });
          if (insertErr) throw insertErr;
        }

        await adminClient.from('invites').insert({
          conta_id: profile.conta_id,
          email: email.toLowerCase(),
          role,
          invited_by: user.id,
          status: 'accepted',
          accepted_at: new Date().toISOString(),
        });

        return new Response(JSON.stringify({ success: true, message: `${email} foi adicionado ao workspace como ${role}.` }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200,
        });
      }
    }

    // --- New user (or stale user cleaned up above): send invite email ---
    const redirectBase = Deno.env.get('OAUTH_REDIRECT_BASE') || 'http://localhost:5173';
    const { error } = await adminClient.auth.admin.inviteUserByEmail(email, {
       data: { conta_id: profile.conta_id, role, nome: email.split('@')[0] },
       redirectTo: redirectBase + '/configurar-senha',
    });

    if (error) {
      console.error('[invite-user] inviteUserByEmail error:', JSON.stringify({ message: error.message, status: error.status }));
      throw error;
    }

    await adminClient.from('invites').insert({
      conta_id: profile.conta_id,
      email: email.toLowerCase(),
      role,
      invited_by: user.id,
      status: 'pending',
    });

    return new Response(JSON.stringify({ success: true, message: `Convite enviado para ${email} como ${role}.` }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });
  } catch (err: any) {
    console.error('[invite-user] error:', err);
    const detail = err?.message || err?.toString?.() || 'unknown';
    return new Response(JSON.stringify({ error: `Erro interno do servidor: ${detail}` }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
