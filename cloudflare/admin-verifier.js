'use strict';

// Embedded in the Pages Worker. No server import, startup task, database write,
// or public fallback credential. Signing bytes match server.js's _signPayload.
function createAdminVerifier(expectedSupabaseUrl, revokedTokenMarker, options = {}) {
  const cryptoApi = options.crypto || globalThis.crypto;
  const fetcher = options.fetch || globalThis.fetch;
  const now = options.now || Date.now;
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const unavailable = () => ({ status: 503, body: { error: '认证服务暂不可用，请稍后重试', code: 'auth_unavailable', retryable: true } });
  const invalid = () => ({ status: 401, body: { error: '令牌已过期或无效，请重新登录' } });
  function fromBase64Url(value) {
    return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
  }
  function toBase64Url(bytes) {
    return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function serviceCredential(key) {
    if (typeof key !== 'string' || key.length > 16384) return null;
    if (/^sb_secret_[A-Za-z0-9_-]+$/.test(key)) return 'secret';
    if (!/^[\w-]+\.[\w-]+\.[\w-]+$/.test(key)) return null;
    try { return JSON.parse(decoder.decode(fromBase64Url(key.split('.')[1]))).role === 'service_role' ? 'legacy' : null; }
    catch (_) { return null; }
  }
  async function readBoundedJson(response) {
    if (!response.ok && response.status !== 402) throw Object.assign(Error('unavailable'), { upstreamStatus: response.status });
    const reader = response.body.getReader();
    let length = 0, chunks = [];
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        length += part.value.length;
        if (length > 32768) throw Error('unavailable');
        chunks.push(part.value);
      }
    } finally { await reader.cancel().catch(() => {}); }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const decoded = decoder.decode(bytes);
    if (!response.ok) throw Object.assign(Error('unavailable'), { upstreamStatus: response.status, egressRestricted: /exceed_egress_quota/.test(decoded) });
    if (!/application\/json/i.test(response.headers.get('content-type') || '')) throw Error('unavailable');
    const rows = JSON.parse(decoded);
    if (!Array.isArray(rows) || rows.length > 100) throw Error('unavailable');
    return rows;
  }
  return async function verifyAdmin(request, env = {}) {
    const credentialKind = serviceCredential(env.SUPABASE_SERVICE_KEY);
    if (typeof env.API_SECRET !== 'string' || !env.API_SECRET || !credentialKind || !env.SUPABASE_URL || !revokedTokenMarker) {
      return { status: 503, body: { ok: false, code: 'preview_backend_unavailable', error: '预览认证后端尚未配置。' } };
    }
    let endpoint;
    let expiresAt;
    try {
      const parsed = new URL(env.SUPABASE_URL), expected = new URL(expectedSupabaseUrl);
      if (parsed.protocol !== 'https:' || parsed.origin !== expected.origin || parsed.username || parsed.password
        || parsed.pathname !== '/' || parsed.search || parsed.hash) return unavailable();
      endpoint = new URL('/rest/v1/posts', parsed);
    } catch (_) { return unavailable(); }
    const authorization = request.headers.get('authorization') || '';
    let token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
    if (!token) {
      for (const pair of (request.headers.get('cookie') || '').split(';')) {
        const index = pair.indexOf('=');
        if (index > 0 && pair.slice(0, index).trim() === 'xtj_admin_token') token = pair.slice(index + 1).trim();
      }
    }
    if (!token) return { status: 401, body: { error: '未提供认证令牌' } };
    if (token.length > 8192 || !/^[\w-]+\.[\w-]{43}$/.test(token)) return invalid();
    let payload64, signature;
    try {
      const parts = token.split('.');
      payload64 = parts[0];
      signature = fromBase64Url(parts[1]);
      if (toBase64Url(signature) !== parts[1]) return invalid();
    } catch (_) { return invalid(); }
    try {
      const key = await cryptoApi.subtle.importKey('raw', encoder.encode(env.API_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
      if (!await cryptoApi.subtle.verify('HMAC', key, signature, encoder.encode(payload64))) return invalid();
    } catch (_) { return unavailable(); }
    try {
      const payload = JSON.parse(decoder.decode(fromBase64Url(payload64)));
      if (!payload || typeof payload.exp !== 'number' || !(payload.exp > 0) || now() > payload.exp
        || payload.user !== 'xxz' || payload.type) return invalid();
      expiresAt = payload.exp;
    } catch (_) { return invalid(); }
    // Every valid credential checks durable revocation state. No warm-cache
    // assumption, expired-row deletion, refresh rotation, or startup migration.
    const controller = new AbortController();
    const abort = () => controller.abort();
    const timer = setTimeout(abort, options.timeoutMs || 5000);
    request.signal.addEventListener('abort', abort, { once: true });
    if (request.signal.aborted) abort();
    try {
      const hash = Array.from(new Uint8Array(await cryptoApi.subtle.digest('SHA-256', encoder.encode(token))), n => n.toString(16).padStart(2, '0')).join('');
      endpoint.searchParams.set('select', 'id,content');
      endpoint.searchParams.set('media_type', 'eq.' + revokedTokenMarker);
      endpoint.searchParams.set('media_url', 'eq.' + hash);
      endpoint.searchParams.set('order', 'id');
      endpoint.searchParams.set('limit', '100');
      const headers = { apikey: env.SUPABASE_SERVICE_KEY, Accept: 'application/json' };
      if (credentialKind === 'legacy') headers.Authorization = 'Bearer ' + env.SUPABASE_SERVICE_KEY;
      let cursor = '';
      for (let page = 0; page < 20; page++) {
        if (controller.signal.aborted) throw Error('unavailable');
        if (cursor) endpoint.searchParams.set('id', 'gt.' + cursor);
        const response = await fetcher(endpoint.href, { method: 'GET', headers, redirect: 'manual', signal: controller.signal, cache: 'no-store' })
          .catch(() => { throw Object.assign(Error('unavailable'), { upstreamFailure: 'network' }); });
        const rows = await readBoundedJson(response);
        if (controller.signal.aborted) throw Error('unavailable');
        if (!rows.length) return now() > expiresAt ? invalid() : { status: 200, body: { ok: true } };
        for (const row of rows) {
          const info = JSON.parse(row.content || '{}');
          const expires = new Date(info.expires_at).getTime();
          if (!Number.isFinite(expires)) throw Error('unavailable');
          if (expires > now()) return { status: 401, body: { error: '令牌已注销，请重新登录' } };
        }
        const next = String(rows[rows.length - 1].id || '');
        if (!next || next.length > 200 || next === cursor) throw Error('unavailable');
        cursor = next;
      }
      return unavailable();
    } catch (error) {
      if (error?.egressRestricted === true) return { status: 402, body: { error: '网站数据服务流量额度已用完，服务暂时受限，请等待恢复', code: 'egress_quota_exceeded', retryable: false } };
      const reply = unavailable();
      if (Number.isInteger(error?.upstreamStatus) && error.upstreamStatus >= 100 && error.upstreamStatus <= 599) reply.body.upstream_status = error.upstreamStatus;
      if (error?.upstreamFailure === 'network') reply.body.upstream_failure = 'network';
      return reply;
    }
    finally { clearTimeout(timer); request.signal.removeEventListener('abort', abort); }
  };
}

module.exports = { createAdminVerifier };
