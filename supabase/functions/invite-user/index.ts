import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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

    // Try to invite the new user
    const { data, error } = await adminClient.auth.admin.inviteUserByEmail(email, {
       data: { conta_id: profile.conta_id, role, nome: email.split('@')[0] }
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

        // Check if profile row exists
        const { data: existingProfile } = await adminClient
          .from('profiles')
          .select('conta_id')
          .eq('id', existingUser.id)
          .maybeSingle();

        if (existingProfile?.conta_id) {
          throw new Error('Este usuário já pertence a um workspace.');
        }

        if (existingProfile) {
          // Profile exists but no workspace — re-associate
          const { error: updateErr } = await adminClient
            .from('profiles')
            .update({ conta_id: profile.conta_id, role })
            .eq('id', existingUser.id);
          if (updateErr) throw updateErr;
        } else {
          // Profile was deleted — recreate it
          const { error: insertErr } = await adminClient
            .from('profiles')
            .insert({
              id: existingUser.id,
              conta_id: profile.conta_id,
              role,
              nome: existingUser.user_metadata?.nome || email.split('@')[0],
            });
          if (insertErr) throw insertErr;
        }

        return new Response(JSON.stringify({ success: true, message: `${email} foi readicionado ao workspace como ${role}.` }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200,
        });
      }

      console.error("Invite error:", error);
      throw error;
    }

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
