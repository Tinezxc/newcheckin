// CMDI secure staff invitation endpoint.
// Deploy with Supabase CLI. SUPABASE_SERVICE_ROLE_KEY stays server-side only.
import { createClient } from 'npm:@supabase/supabase-js@2';

<<<<<<< HEAD
function getDefaultKey(dictionaryName: string, legacyName: string): string | null {
  const raw = Deno.env.get(dictionaryName);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const value = parsed.default;
      if (typeof value === 'string' && value.length > 0) return value;
    } catch (error) {
      console.error(`[CMDI staff-provision] Could not parse ${dictionaryName}:`, error);
    }
  }
  return Deno.env.get(legacyName) || null;
}

const allowedOrigins = (Deno.env.get('CMDI_ALLOWED_ORIGINS')
  ?? 'https://newcheckin-rose.vercel.app')
=======
const allowedOrigins = (Deno.env.get('CMDI_ALLOWED_ORIGINS')
  ?? 'https://cmdi-hotel-check-in.vercel.app')
>>>>>>> 4b37ebf4172cb3faf9aeee4c3fb66af9e7f38305
  .split(',').map((value) => value.trim()).filter(Boolean);

function corsFor(origin: string | null): Record<string, string> | null {
  if (!origin || !allowedOrigins.includes(origin)) return null;
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}

function json(status: number, body: Record<string, unknown>, corsHeaders: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  const corsHeaders = corsFor(req.headers.get('Origin'));
  if (!corsHeaders) return new Response('Origin not allowed.', { status: 403 });
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed.' }, corsHeaders);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
<<<<<<< HEAD
  // Current Supabase projects expose key dictionaries; retain legacy fallbacks.
  const anonKey = getDefaultKey('SUPABASE_PUBLISHABLE_KEYS', 'SUPABASE_ANON_KEY');
  const serviceRoleKey = getDefaultKey('SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY');
=======
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
>>>>>>> 4b37ebf4172cb3faf9aeee4c3fb66af9e7f38305
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return json(500, { error: 'Staff provisioning is not configured on the server.' }, corsHeaders);
  }

  const authorization = req.headers.get('Authorization') ?? '';
  const token = authorization.replace(/^Bearer\s+/i, '').trim();
  if (!token) return json(401, { error: 'Authentication required.' }, corsHeaders);

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  try {
    const { data: userResult, error: userError } = await userClient.auth.getUser(token);
    if (userError || !userResult.user) return json(401, { error: 'Invalid or expired session.' }, corsHeaders);
    const actor = userResult.user;

    const { data: actorProfile, error: profileError } = await adminClient
      .from('profiles')
      .select('id,full_name,role,status,access_expires_at')
      .eq('id', actor.id)
      .single();
    if (profileError || !actorProfile || actorProfile.role !== 'manager' || actorProfile.status !== 'active') {
      return json(403, { error: 'Only an active Manager can invite staff.' }, corsHeaders);
    }
    if (actorProfile.access_expires_at && new Date(actorProfile.access_expires_at).getTime() < Date.now()) {
      return json(403, { error: 'Manager access has expired.' }, corsHeaders);
    }

    // Verify the user's OTP session in the user-context client, not as service role.
    const { data: otpVerified, error: otpError } = await userClient.rpc('is_login_otp_verified');
    if (otpError || otpVerified !== true) return json(403, { error: 'A verified Login OTP session is required.' }, corsHeaders);
    const { data: profileUsable, error: usableError } = await userClient.rpc('profile_is_usable');
    if (usableError || profileUsable !== true) return json(403, { error: 'The Manager profile is not usable.' }, corsHeaders);

    let payload: { full_name?: string; email?: string; role?: string };
    try { payload = await req.json(); }
    catch { return json(400, { error: 'Invalid JSON body.' }, corsHeaders); }

    const fullName = String(payload.full_name ?? '').trim();
    const email = String(payload.email ?? '').trim().toLowerCase();
    const role = String(payload.role ?? '').trim().toLowerCase();
    const allowedRoles = new Set(['manager', 'front-desk', 'housekeeping', 'maintenance']);
    if (fullName.length < 2 || fullName.length > 150) return json(400, { error: 'Enter a valid staff name (2–150 characters).' }, corsHeaders);
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json(400, { error: 'Enter a valid staff email address.' }, corsHeaders);
    if (!allowedRoles.has(role)) return json(400, { error: 'Invalid staff role.' }, corsHeaders);

<<<<<<< HEAD
    const redirectTo = Deno.env.get('CMDI_STAFF_INVITE_REDIRECT_URL') ?? 'https://newcheckin-rose.vercel.app/index.html';
=======
    const redirectTo = Deno.env.get('CMDI_STAFF_INVITE_REDIRECT_URL') ?? 'https://cmdi-hotel-check-in.vercel.app/index.html';
>>>>>>> 4b37ebf4172cb3faf9aeee4c3fb66af9e7f38305
    const { data: inviteResult, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(email, {
      data: { full_name: fullName, role },
      redirectTo,
    });
    if (inviteError || !inviteResult.user) {
      return json(400, { error: inviteError?.message ?? 'Supabase could not create the invitation.' }, corsHeaders);
    }

    const invitedUserId = inviteResult.user.id;
    const { error: upsertError } = await adminClient.from('profiles').upsert({
      id: invitedUserId,
      full_name: fullName,
      role,
      status: 'active',
    }, { onConflict: 'id' });

    if (upsertError) {
      // Roll back the Auth invitation if profile provisioning fails.
      await adminClient.auth.admin.deleteUser(invitedUserId);
      return json(500, { error: `Invitation rolled back because profile creation failed: ${upsertError.message}` }, corsHeaders);
    }

    const { error: auditError } = await adminClient.from('audit_log').insert({
      actor_id: actor.id,
      actor_name: actorProfile.full_name ?? actor.email ?? 'Manager',
      actor_role: 'manager',
      action: 'staff_invited',
      target_type: 'staff',
      target_id: invitedUserId,
      reason: 'Manager invited a new CMDI staff account.',
      details: { email, role },
    });

    if (auditError) {
      await adminClient.from('profiles').delete().eq('id', invitedUserId);
      await adminClient.auth.admin.deleteUser(invitedUserId);
      return json(500, { error: `Invitation rolled back because audit logging failed: ${auditError.message}` }, corsHeaders);
    }

    return json(200, { ok: true, user_id: invitedUserId, email, role, message: 'Staff invitation sent.' }, corsHeaders);
  } catch (error) {
    console.error('[CMDI staff-provision]', error);
    return json(500, { error: error instanceof Error ? error.message : 'Unexpected provisioning error.' }, corsHeaders);
  }
});
