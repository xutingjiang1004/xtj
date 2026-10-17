'use strict';

// This factory is embedded into the allowlisted Pages artifact at build time.
// Keep it self-contained: no Node/native imports and no build-time credentials.
function createPreviewWorker(securityHeaders, fallbackSupabaseUrl) {
  function publicConfig(env) {
    let url = env.SUPABASE_URL || fallbackSupabaseUrl || null;
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) url = null;
    } catch (_) { url = null; }
    let key = env.SUPABASE_ANON_KEY || env.SUPABASE_PUBLISHABLE_KEY || null;
    if (typeof key !== 'string' || key.length > 16384) key = null;
    if (key) {
      let allowed = /^sb_publishable_[\w-]+$/.test(key);
      if (/^eyJ[\w-]+\.[\w-]+\.[\w-]+$/.test(key)) {
        try {
          const payload = key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
          const claims = JSON.parse(atob(payload));
          allowed = !!claims && claims.role === 'anon';
        } catch (_) { allowed = false; }
      }
      if (!allowed) key = null;
    }
    return { supabase_url: url, supabase_anon_key: key };
  }
  return {
    async fetch(request, env = {}) {
      const headers = {
        ...securityHeaders,
        'Cache-Control': 'no-store, private',
        'Content-Type': 'application/json; charset=utf-8',
        'X-Robots-Tag': 'noindex, nofollow'
      };
      const pathname = new URL(request.url).pathname;
      if ((pathname === '/api/config/public' || pathname === '/api/config/public/') && ['GET', 'HEAD'].includes(request.method)) {
        headers['Cache-Control'] = 'public, max-age=300';
        return new Response(request.method === 'HEAD' ? null : JSON.stringify(publicConfig(env)), { status: 200, headers });
      }
      return new Response(request.method === 'HEAD' ? null : JSON.stringify({
        ok: false, code: 'preview_backend_unavailable', error: '预览后端尚未迁移，此环境不能用于生产。'
      }), { status: 503, headers });
    }
  };
}

module.exports = { createPreviewWorker };
