/* CMDI Supabase browser client. Publishable key only; never use service_role here. */
(() => {
  'use strict';
  const SUPABASE_URL = 'https://bvrkoviyrijcdnulnwxz.supabase.co';
  const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_ydW1NNcifKSKt0BuOwH2vQ_vsny-01p';

  if (window.supabaseClient) {
    window.supabaseClientReady = Promise.resolve(window.supabaseClient);
    return;
  }
  if (!window.supabase?.createClient) {
    const error = new Error('Supabase JS v2 did not load. Check the CDN script before js/supabase-client.js.');
    window.supabaseClientError = error;
    window.supabaseClientReady = Promise.reject(error);
    window.supabaseClientReady.catch(() => {});
    return;
  }

  // Create synchronously so RBAC's deferred startup can read window.supabaseClient.
  window.supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });
  window.supabaseClientReady = Promise.resolve(window.supabaseClient);
})();
