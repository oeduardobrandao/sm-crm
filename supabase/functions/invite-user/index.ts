import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, DELETE, OPTIONS',
};

serve(async (req) => {
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

    // Client for auth verify (Use Anon Key for user requests)
    const supabaseClient = createClient(supabaseUrl, supabaseAnonKey);

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
        .select('id, conta_id')
        .eq('id', inviteId)
        .eq('conta_id', profile.conta_id)
        .maybeSingle();

      if (findErr) throw findErr;
      if (!invite) throw new Error('Convite não encontrado.');

      const { error: delErr } = await adminClient.from('invites').delete().eq('id', inviteId);
      if (delErr) throw delErr;

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

    // Check for existing pending invite (not expired)
    const { data: existingInvite } = await adminClient
      .from('invites')
      .select('id, expires_at')
      .eq('email', email.toLowerCase())
      .eq('conta_id', profile.conta_id)
      .eq('status', 'pending')
      .maybeSingle();

    if (existingInvite && new Date(existingInvite.expires_at) > new Date()) {
      return new Response(JSON.stringify({ error: 'Já existe um convite pendente para este e-mail.' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // If there was an expired pending invite, mark it as expired
    if (existingInvite) {
      await adminClient.from('invites').update({ status: 'expired' }).eq('id', existingInvite.id);
    }

    // Try to invite the new user
    const redirectBase = Deno.env.get('OAUTH_REDIRECT_BASE') || 'http://localhost:3000';
    const { data, error } = await adminClient.auth.admin.inviteUserByEmail(email, {
       data: { conta_id: profile.conta_id, role, nome: email.split('@')[0] },
       redirectTo: redirectBase + '/#/configurar-senha',
    });

    if (error) {
      // If user already exists in auth, re-associate them with this workspace
      if (error.message?.includes('already been registered')) {
        // Look up existing user by email (paginate to handle large user bases)
        let existingUser = null;
        let page = 1;
        while (!existingUser) {
          const result = await adminClient.auth.admin.listUsers({ page, perPage: 100 });
          if (result.error) throw result.error;
          const users = result.data?.users;
          if (!users || users.length === 0) break;
          existingUser = users.find(
            (u: any) => u.email?.toLowerCase() === email.toLowerCase()
          ) || null;
          page++;
        }

        if (!existingUser) throw new Error('Usuário não encontrado.');

        // Check if user is already a member of this workspace
        const { data: existingMembership } = await adminClient
          .from('workspace_members')
          .select('id')
          .eq('user_id', existingUser.id)
          .eq('workspace_id', profile.conta_id)
          .maybeSingle();

        if (existingMembership) {
          throw new Error('Este usuário já pertence a este workspace.');
        }

        // Add user to workspace via workspace_members
        const { error: memberErr } = await adminClient
          .from('workspace_members')
          .insert({
            user_id: existingUser.id,
            workspace_id: profile.conta_id,
            role,
          });
        if (memberErr) throw memberErr;

        // Ensure profile exists
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
            });
          if (insertErr) throw insertErr;
        }

        // Track re-association as immediately accepted invite
        await adminClient.from('invites').insert({
          conta_id: profile.conta_id,
          email: email.toLowerCase(),
          role,
          invited_by: user.id,
          status: 'accepted',
          accepted_at: new Date().toISOString(),
        });

        return new Response(JSON.stringify({ success: true, message: `${email} foi readicionado ao workspace como ${role}.` }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200,
        });
      }

      console.error("Invite error:", error);
      throw error;
    }

    // Track invite in invites table
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
    console.error("Catch erro:", JSON.stringify(err), err?.message, err);
    const message = err?.message || err?.msg || (typeof err === 'string' ? err : 'Erro interno do servidor');
    return new Response(JSON.stringify({ error: message }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
