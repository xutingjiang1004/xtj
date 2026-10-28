'use strict';
const defaultIpTools = require('../js/ip-location');
const {createAdminLoginStore} = require('../render-api/admin-login-ip');

// Embedded by build-pages. No Express import, startup tasks, migration, cleanup,
// storage access or Render proxy. All database writes below follow an explicit
// authentication request and target only its credential/session/security rows.
function createLoginBackend(expectedUrl, revokedMarker, cryptoApi, BufferApi, options = {}, ipTools = defaultIpTools, adminIpStore = createAdminLoginStore(cryptoApi, ipTools)) {
  const fetcher = options.fetch || globalThis.fetch;
  const now = options.now || Date.now;
  const B = BufferApi;
  const ACCESS_MS = 15 * 60 * 1000, REFRESH_MS = 90 * 86400000;
  // Bounded, disposable abuse counters only; credentials and account state stay
  // request-local or in the database. The durable layer remains authoritative.
  const localCounters = new Map();
  const paths = new Map([
    ['/api/user/login', 'POST'], ['/api/user/refresh', 'POST'], ['/api/user/logout', 'POST'],
    ['/api/user/profile', 'GET'], ['/api/user/restrictions', 'GET'],
    ['/admin/login', 'POST'], ['/admin/logout', 'POST']
  ]);
  const hash = value => cryptoApi.createHash('sha256').update(value).digest('hex');
  // The username is interpolated into a PostgREST `eq.` filter; reject filter
  // metacharacters and control characters before any database request.
  const UNSAFE_USER_NAME = /[\u0000-\u001f\u007f,()"\\]/;
  const result = (status, body, cookies = []) => ({ status, body, cookies });
  const unavailable = (code = 'auth_unavailable') => result(503, { error: '认证服务暂不可用，请稍后重试', code, retryable: true });
  const invalid = () => result(401, { error: '登录凭证无效或已过期', code: 'auth_expired' });
  const equal = (a, b) => {
    const left = B.from(String(a)), right = B.from(String(b));
    return left.length === right.length && cryptoApi.timingSafeEqual(left, right);
  };
  const scrypt = (password, salt, N, r) => new Promise((resolve, reject) => {
    // Same verifier and memory limits as Render, including its historical p=1.
    cryptoApi.scrypt(password, salt, 32, { N, r, p: 1 }, (err, key) => err ? reject(err) : resolve(key));
  });
  async function derive(password) {
    const salt = cryptoApi.randomBytes(16).toString('base64url');
    return 'scrypt:v1:32768:4:1:' + salt + ':' + (await scrypt(password, salt, 32768, 4)).toString('base64url');
  }
  async function passwordMatches(stored, password, user) {
    if (typeof stored !== 'string' || stored.length > 2048) throw Error('invalid_verifier');
    if (stored.startsWith('scrypt:v1:')) {
      const fields = stored.split(':');
      if (fields.length === 4 && fields[2] && fields[3]) return equal(fields[3], (await scrypt(password, fields[2], 16384, 8)).toString('base64url'));
      if (fields.length !== 7 || !fields[5] || !fields[6]) throw Error('invalid_verifier');
      const N = Number(fields[2]), r = Number(fields[3]), p = Number(fields[4]);
      if (!Number.isInteger(N) || N < 16384 || N > 1048576 || (N & (N - 1))
        || !Number.isInteger(r) || r < 1 || r > 32 || !Number.isInteger(p) || p < 1 || p > 8) throw Error('invalid_verifier');
      return equal(fields[6], (await scrypt(password, fields[5], N, r)).toString('base64url'));
    }
    if (/^[a-f0-9]{32}:[a-f0-9]{64}$/i.test(stored)) {
      const [salt, expected] = stored.split(':');
      const key = await new Promise((resolve, reject) => cryptoApi.pbkdf2(password, salt, 100000, 32, 'sha256', (e, k) => e ? reject(e) : resolve(k)));
      return equal(expected.toLowerCase(), key.toString('hex'));
    }
    return equal(stored.toLowerCase(), hash(password)) || equal(stored.toLowerCase(), hash(user + ':' + password));
  }
  async function boundedJson(response, maxBytes, signal, parse = true) {
    const reader = response.body?.getReader();
    if (!reader) throw Error('empty_body');
    const chunks = [];
    let length = 0;
    const cancel = () => { void reader.cancel().catch(() => {}); };
    signal?.addEventListener('abort', cancel, { once: true });
    try {
      while (true) {
        if (signal?.aborted) throw Error('aborted');
        const part = await reader.read();
        if (part.done) break;
        length += part.value.length;
        if (length > maxBytes) throw Error('body_too_large');
        chunks.push(B.from(part.value));
      }
    } finally {
      signal?.removeEventListener('abort', cancel);
      await reader.cancel().catch(() => {});
    }
    if (signal?.aborted) throw Error('aborted');
    const text = B.concat(chunks).toString('utf8');
    return parse ? JSON.parse(text) : text;
  }
  function cookie(name, value, path, maxAge, sameSite = 'Lax') {
    return name + '=' + value + '; Path=' + path + '; Max-Age=' + Math.max(0, Math.floor(maxAge / 1000)) + '; HttpOnly; Secure; SameSite=' + sameSite;
  }
  function clearUserCookies() {
    return [cookie('xtj_user_refresh', '', '/api/user', 0), cookie('xtj_photo_session', '', '/api/photo', 0),
      cookie('xtj_post_media_session', '', '/api/post', 0), cookie('xtj_post_media_session', '', '/api/uploads', 0)];
  }
  return async function loginBackend(request, env = {}) {
    const path = new URL(request.url).pathname.toLowerCase().replace(/\/+$/, '');
    if (!paths.has(path) || !(request.method === paths.get(path) || (request.method === 'HEAD' && paths.get(path) === 'GET'))) return null;
    const key = env.SUPABASE_SERVICE_KEY;
    let legacyService = false;
    try { legacyService = /^[\w-]+\.[\w-]+\.[\w-]+$/.test(key || '') && JSON.parse(B.from(key.split('.')[1], 'base64url')).role === 'service_role'; } catch (_) {}
    if (!env.API_SECRET || typeof key !== 'string' || !(legacyService || /^sb_secret_[\w-]+$/.test(key)) || !env.SUPABASE_URL) {
      return result(503, { ok: false, code: 'preview_backend_unavailable', error: '预览认证后端尚未配置。' });
    }
    try {
      const url = new URL(env.SUPABASE_URL);
      if (url.origin !== new URL(expectedUrl).origin || url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) return unavailable();
    } catch (_) { return unavailable(); }
    const cookies = Object.create(null);
    for (const pair of (request.headers.get('cookie') || '').split(';')) {
      const index = pair.indexOf('=');
      if (index > 0) cookies[pair.slice(0, index).trim()] = pair.slice(index + 1).trim();
    }
    // Preview credentials are host-only. Cross-site, null-Origin, or unproven
    // cookie writes must never mint/rotate/revoke a browser session.
    if (request.method === 'POST') {
      const origin = request.headers.get('origin'), referer = request.headers.get('referer');
      let trustedReferer = false;
      try { trustedReferer = new URL(referer).origin === new URL(request.url).origin; } catch (_) {}
      if ((origin && origin !== new URL(request.url).origin) || request.headers.get('sec-fetch-site') === 'cross-site'
        || (!origin && (cookies.xtj_user_refresh || cookies.xtj_admin_token) && !trustedReferer)) {
        return result(403, { error: '拒绝跨站请求' });
      }
    }
    const controller = new AbortController();
    const abort = () => controller.abort();
    const timer = setTimeout(abort, options.timeoutMs || 15000);
    request.signal.addEventListener('abort', abort, { once: true });
    if (request.signal.aborted) abort();
    async function db(resource, query = {}, method = 'GET', body) {
      if (controller.signal.aborted) throw Error('aborted');
      const url = new URL('/rest/v1/' + resource, expectedUrl);
      for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
      const headers = { apikey: key, Accept: 'application/json', 'Content-Type': 'application/json', Prefer: 'return=representation' };
      if (legacyService) headers.Authorization = 'Bearer ' + key;
      const response = await fetcher(url.href, { method, headers, body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal, redirect: 'manual', cache: 'no-store' })
        .catch(() => { throw Object.assign(Error('database_unavailable'), { upstreamFailure: 'network' }); });
      if (!response.ok) {
        const restricted = response.status === 402 && /exceed_egress_quota/.test(await boundedJson(response, 32768, controller.signal, false));
        throw Object.assign(Error('database_unavailable'), { upstreamStatus: response.status, egressRestricted: restricted });
      }
      if (!/application\/json/i.test(response.headers.get('content-type') || '')) throw Error('database_unavailable');
      const value = await boundedJson(response, 65536, controller.signal);
      if (controller.signal.aborted) throw Error('aborted');
      return value;
    }
    async function rows(query, method, body) {
      const value = await db('posts', query, method, body);
      if (!Array.isArray(value) || value.length > 100) throw Error('invalid_rows');
      return value;
    }
    const rpc = (name, body) => db('rpc/' + name, {}, 'POST', body);
    // The same guarded administrator store runs on Node and Workers. This
    // adapter implements only its PostgREST operations, with returned rows.
    const postsClient = {from() {
      const query = {}; let method = 'GET', body, single = false;
      const chain = {
        select(fields) {query.select = fields;return chain;},
        insert(value) {method='POST';body=value;return chain;},
        update(value) {method='PATCH';body=value;return chain;},
        eq(field,value) {query[field]='eq.'+value;return chain;},
        is(field,value) {query[field]='is.'+value;return chain;},
        order(field,settings) {query.order=field+(settings.ascending?'.asc':'.desc');return chain;},
        limit(value) {query.limit=String(value);return chain;},
        maybeSingle() {single=true;return chain;},
        then(resolve,reject) {return rows(query,method,body).then(data=>resolve({data:single?data[0]||null:data,error:null}),error=>resolve({data:null,error:{code:error.upstreamStatus===409?'23505':'database_unavailable'}})).catch(reject);}
      };return chain;
    }};
    const bearer = () => (request.headers.get('authorization') || '').startsWith('Bearer ') ? request.headers.get('authorization').slice(7) : '';
    function sign(payload) {
      const b64 = B.from(JSON.stringify(payload)).toString('base64url');
      return b64 + '.' + cryptoApi.createHmac('sha256', env.API_SECRET).update(b64).digest('base64url');
    }
    function verify(token, type) {
      if (typeof token !== 'string' || token.length > 8192 || !/^[\w-]+\.[\w-]{43}$/.test(token)) return null;
      const [b64, sig] = token.split('.');
      if (!equal(sig, cryptoApi.createHmac('sha256', env.API_SECRET).update(b64).digest('base64url'))) return null;
      try {
        const p = JSON.parse(B.from(b64, 'base64url'));
        if (!p || !Number.isFinite(p.exp) || p.exp <= now() || p.type !== type) return null;
        return type ? (typeof p.user_name === 'string' && p.user_name && typeof p.jti === 'string' && p.jti ? p : null) : (p.user === 'xxz' ? p : null);
      } catch (_) { return null; }
    }
    async function revoked(token) {
      let cursor = '';
      for (let page = 0; page < 20; page++) {
        const query = { select: 'id,content', media_type: 'eq.' + revokedMarker, media_url: 'eq.' + hash(token), order: 'id', limit: '100' };
        if (cursor) query.id = 'gt.' + cursor;
        const pageRows = await rows(query);
        if (!pageRows.length) return false;
        for (const row of pageRows) {
          const expiry = new Date(JSON.parse(row.content).expires_at).getTime();
          if (!Number.isFinite(expiry)) throw Error('invalid_revocation');
          if (expiry > now()) return true;
        }
        const next = String(pageRows.at(-1).id || '');
        if (!next || next === cursor || next.length > 200) throw Error('invalid_cursor');
        cursor = next;
      }
      throw Error('revocation_page_limit');
    }
    async function authRecord(user, marker = '__auth__') {
      // Latest-record fallback matches readAuthRecord for duplicate legacy rows.
      return (await rows({ select: 'id,media_url,created_at', user_name: 'eq.' + user, media_type: 'eq.' + marker, order: 'created_at.desc', limit: '1' }))[0] || null;
    }
    async function identity(user) {
      let account = await authRecord(user);
      if (!account && user === 'xxz') account = await authRecord(user, '__admin_auth__') || { id: 'admin:xxz', created_at: '1970-01-01T00:00:00Z' };
      return account;
    }
    function matches(payload, account, lifetime) {
      return !!account && (payload.account_id ? payload.account_id === String(account.id) : Date.parse(account.created_at) < payload.exp - lifetime - 1000);
    }
    async function restrictions(user, includeAdmin = false) {
      if (user === 'xxz' && !includeAdmin) return { is_banned: false, is_muted: false, is_blacklisted: false };
      const value = await rpc('get_user_restrictions', { p_user_name: user });
      if (!value || typeof value !== 'object' || Array.isArray(value) || typeof value.is_banned !== 'boolean') throw Error('restrictions_unavailable');
      return value;
    }
    // Render uses JSON/CAS counters; an older atomic RPC uses numeric content
    // and updated_at. Retain both windows, reset only proven-expired records,
    // and never silently fail open on contention or malformed state.
    async function limit(max, ip) {
      const actor = 'rl_' + hash(ip + ':' + path).slice(0, 32);
      const query = { select: 'id,content,updated_at,created_at', media_type: 'eq.__rate_limit__', media_url: 'eq.' + actor, limit: '2' };
      for (let attempt = 0; attempt < 4; attempt++) {
        const current = await rows(query);
        if (current.length > 1) throw Error('rate_limit_unavailable');
        const row = current[0];
        let count = 0, resetAt = now() + 60000;
        if (row) {
          const previous = JSON.parse(row.content);
          if (Number.isInteger(previous) && previous >= 0) {
            const expiry = Date.parse(row.updated_at || row.created_at) + 60000;
            if (!Number.isFinite(expiry)) throw Error('rate_limit_unavailable');
            if (expiry > now()) { count = previous; resetAt = expiry; }
          } else {
            if (!previous || !Number.isFinite(previous.resetAt) || !Number.isInteger(previous.count) || previous.count < 0) throw Error('rate_limit_unavailable');
            if (previous.resetAt > now()) { count = previous.count; resetAt = previous.resetAt; }
          }
        }
        if (count >= max) return result(429, { error: '请求过于频繁，请稍后再试', code: 'RATE_LIMITED', retry_after: Math.max(1, Math.ceil((resetAt - now()) / 1000)) });
        const update = { content: JSON.stringify({ count: count + 1, resetAt }), created_at: new Date(resetAt).toISOString() };
        if (row) {
          const saved = await rows({ id: 'eq.' + row.id, media_type: 'eq.__rate_limit__', content: 'eq.' + row.content, select: 'id' }, 'PATCH', update);
          if (saved.length === 1) return null;
        } else {
          // A unique-key race is safe to retry; other insert failures are 503.
          try {
            const saved = await rows({ select: 'id' }, 'POST', { ...update, user_name: 'system', media_type: '__rate_limit__', media_url: actor, actor_key: actor });
            if (saved.length === 1) return null;
          } catch (_) {
            if (!(await rows(query)).length) throw Error('rate_limit_unavailable');
          }
        }
      }
      throw Error('rate_limit_unavailable');
    }
    async function persistRevoke(token, payload) {
      const digest = hash(token);
      const saved = await rows({ select: 'id' }, 'POST', { user_name: 'xxz', media_type: revokedMarker, media_url: digest,
        actor_key: revokedMarker + ':' + digest, content: JSON.stringify({ token_hash: digest, expires_at: payload.exp }) });
      if (saved.length !== 1) throw Error('logout_sync_failed');
    }
    function tokens(user, account, device) {
      const access = sign({ exp: now() + ACCESS_MS, account_id: String(account.id), user_name: user, type: 'user_access', jti: cryptoApi.randomUUID() });
      const p = { exp: now() + REFRESH_MS, user_name: user, account_id: String(account.id), type: 'user_refresh', jti: cryptoApi.randomUUID() };
      if (device) p.did = cryptoApi.createHash('sha256').update('dev:' + device).digest('base64url').slice(0, 22);
      const refresh = sign(p);
      return { access, refresh, payload: p };
    }
    function sessionResponse(user, session, event) {
      const value = session.access + '~' + session.payload.jti;
      return result(200, { ok: true, token: session.access, user_name: user, token_type: 'access', expires_in_ms: REFRESH_MS,
        ...(event ? { authenticated_at: event.login_at, registered_at: event.registered_at } : {}) }, [
        cookie('xtj_user_refresh', session.refresh, '/api/user', REFRESH_MS),
        cookie('xtj_photo_session', value, '/api/photo', ACCESS_MS), cookie('xtj_post_media_session', value, '/api/post', ACCESS_MS),
        cookie('xtj_post_media_session', value, '/api/uploads', ACCESS_MS)
      ]);
    }
    async function storeSession(user, session) {
      const saved = await rows({ select: 'id' }, 'POST', { user_name: user, media_type: '__refresh_token__', media_url: session.payload.jti,
        actor_key: 'rt_' + session.payload.jti, content: JSON.stringify({ jti: session.payload.jti, account_id: session.payload.account_id, expires_at: new Date(session.payload.exp).toISOString() }) });
      if (saved.length !== 1) throw Error('refresh_store_failed');
    }
    try {
      let body = {};
      if (request.method === 'POST' && request.body) {
        if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') || '')) return result(415, { error: '请使用 JSON 请求' });
        try { body = await boundedJson(request, 8192, controller.signal); }
        catch (_) { return controller.signal.aborted ? unavailable() : result(400, { error: '请求内容无效或过大' }); }
        if (!body || typeof body !== 'object' || Array.isArray(body)) return result(400, { error: '请求内容无效' });
      }
      const ip = ipTools.cloudflareClientIp(request);
      // Only Cloudflare's platform header is trusted. Never x-forwarded-for or
      // a body-supplied address; missing IP shares a conservative bucket.
      const maximum = path.endsWith('/login') ? 10 : path.endsWith('/refresh') ? 30 : 60;
      const localKey = hash(ip + ':' + path);
      let counter = localCounters.get(localKey);
      if (!counter || counter.resetAt <= now()) counter = { count: 0, resetAt: now() + 60000 };
      if (counter.count >= maximum) return result(429, { error: '请求过于频繁，请稍后再试', code: 'RATE_LIMITED', retry_after: Math.max(1, Math.ceil((counter.resetAt - now()) / 1000)) });
      counter.count++;
      if (localCounters.size >= 2000 && !localCounters.has(localKey)) localCounters.delete(localCounters.keys().next().value);
      localCounters.set(localKey, counter);
      const limited = request.method === 'POST' ? await limit(maximum, ip) : null;
      if (limited) return limited;
      const device = String(body.device_id || body.deviceId || '').trim().slice(0, 200);
      const ua = (request.headers.get('user-agent') || '').slice(0, 500);
      const tablet = /iPad/i.test(ua) || (/Macintosh/i.test(ua) && /Mobile\/\w+/i.test(ua));
      const facts = {
        ip, ip_source: ip ? 'cf-connecting-ip' : 'unknown', ip_version: ip.includes(':') ? 6 : /^\d+\.\d+\.\d+\.\d+$/.test(ip) ? 4 : null,
        user_agent: ua, device_id: device.slice(0, 120), device_type: tablet ? 'iPad' : /iPhone/i.test(ua) ? 'iPhone' : /Android/i.test(ua) ? 'Android' : /Mobi/i.test(ua) ? 'Mobile' : 'Desktop',
        os: tablet ? 'iPadOS' : /iPhone|iPod/i.test(ua) ? 'iOS' : /Android/i.test(ua) ? 'Android' : /Windows/i.test(ua) ? 'Windows' : /Macintosh|Mac OS X/i.test(ua) ? 'macOS' : /Linux/i.test(ua) ? 'Linux' : 'Unknown',
        browser: /MicroMessenger/i.test(ua) ? 'WeChat' : /Edg\//i.test(ua) ? 'Edge' : /Firefox/i.test(ua) ? 'Firefox' : /Chrome/i.test(ua) ? 'Chrome' : /Safari/i.test(ua) ? 'Safari' : 'Unknown'
      };
      if (path === '/api/user/login' || path === '/admin/login') {
        const admin = path === '/admin/login';
        const user = typeof (admin ? body.username : body.user_name) === 'string' ? (admin ? body.username : body.user_name).trim() : '';
        if (!user || user.length > 50 || UNSAFE_USER_NAME.test(user) || typeof body.password !== 'string' || !body.password || body.password.length > 128) return result(400, { error: '缺少用户名或密码' });
        let account, stored;
        if (admin) {
          if (!env.ADMIN_PASSWORD && !env.ADMIN_PASSWORD_HASH) return unavailable('admin_configuration_unavailable');
          stored = env.ADMIN_PASSWORD_HASH;
        } else { account = await authRecord(user); stored = account?.media_url; }
        let valid = false;
        if (admin) {
          let passwordValid = false;
          if (/^sha256:[a-f0-9]{64}$/i.test(stored || '')) passwordValid = equal(hash(body.password), stored.slice(7).toLowerCase());
          else if ((stored || '').startsWith('scrypt:v1:')) passwordValid = await passwordMatches(stored, body.password, 'xxz');
          else if (!stored) passwordValid = equal(hash(body.password), hash(env.ADMIN_PASSWORD));
          valid = user === 'xxz' && passwordValid;
        } else if (stored) valid = await passwordMatches(stored, body.password, user);
        else await derive(body.password); // Unknown accounts pay the usual KDF cost.
        if (!valid) return result(401, { error: '账号或密码错误' });
        const restriction = await restrictions(user);
        if (restriction.is_banned) return result(403, { error: '该账号已被封禁，无法登录', code: 'account_banned' });
        if (!admin && !stored.startsWith('scrypt:v1:')) {
          const verifier = await derive(body.password);
          const updated = await rows({ select: 'id', id: 'eq.' + account.id, user_name: 'eq.' + user, media_type: 'eq.__auth__', media_url: 'eq.' + stored }, 'PATCH', { media_url: verifier });
          if (updated.length !== 1) return unavailable('credential_changed');
        }
        if (admin) {
          const hours = Math.min(Math.max(parseInt(env.ADMIN_TOKEN_EXPIRY_HOURS || '72', 10) || 72, 1), 168);
          const token = sign({ exp: now() + hours * 3600000, user: 'xxz' });
          let companion;
          try {
            const current = await identity(user);
            if (current) {
              const session = tokens(user, current, device);
              await storeSession(user, session);
              companion = sessionResponse(user, session);
            }
          } catch (_) {}
          const adminDevice = 'admin_' + hash(ip + '|' + ua).slice(0, 32), loginAt = new Date(now()).toISOString();
          try {
            await adminIpStore.recordAdminLogin({db:postsClient,userName:'xxz',loginAt,event:{...facts,device_id:adminDevice},
              resolve:async()=>ipTools.cloudflareLocation(request,ip,now())});
          } catch (_) {} // Same non-blocking audit semantics as the original admin endpoint.
          return result(200, { ok: true, username: 'xxz', token, user_token: companion?.body.token || null,
            ...(companion ? {} : { user_session_error: '用户会话暂时无法建立，请稍后重试' }) }, [cookie('xtj_admin_token', token, '/', hours * 3600000, 'Strict'), ...(companion?.cookies || [])]);
        }
        const current = await identity(user);
        if (!current || String(current.id) !== String(account.id)) return unavailable('credential_changed');
        const session = tokens(user, current, device);
        await storeSession(user, session);
        const event = await rpc('record_user_auth_event', { p_user_name: user, p_source: 'login_success', p_event: facts });
        if (!event?.event_id || !event.login_at) return unavailable('auth_event_store_failed');
        const location = ipTools.cloudflareLocation(request,ip,now());
        if (location) {
          try {const saved = await rpc('record_auth_ip_location',{p_event_id:event.event_id,p_ip:ip,p_location:location});if (!saved?.ok) throw Error('ip_location_not_saved');}
          catch (_) {} // The confirmed login survives optional geography failure.
        }
        return sessionResponse(user, session, event);
      }
      if (path === '/api/user/refresh') {
        const payload = verify(cookies.xtj_user_refresh, 'user_refresh');
        if (!payload) return invalid();
        const restriction = await restrictions(payload.user_name);
        if (restriction.is_banned) return result(403, { error: '该账号已被封禁，无法继续使用', code: 'account_banned' });
        const current = await identity(payload.user_name);
        if (!matches(payload, current, REFRESH_MS)) return invalid();
        const nonce = body.refresh_request_id;
        if (nonce != null && (typeof nonce !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(nonce))) return result(400,{error:'刷新请求标识无效'});
        const requestHash = nonce ? hash(nonce.toLowerCase()) : null;
        const active = await rows({ select: 'id', media_type: 'eq.__refresh_token__', media_url: 'eq.' + payload.jti, limit: '2' });
        if (active.length !== 1 && !requestHash) return result(409, { error: '会话已更新，请重试', code: 'token_reused', retryable: true });
        const session = tokens(payload.user_name, current, device);
        const rotated = requestHash ? await rpc('rotate_user_refresh_token_v2',{p_user_name:payload.user_name,p_account_id:String(current.id),p_old_jti:payload.jti,p_request_hash:requestHash,p_successor:session.payload}) : await rpc('rotate_user_refresh_token', { p_user_name: payload.user_name, p_account_id: String(current.id),
          p_old_jti: payload.jti, p_new_jti: session.payload.jti, p_expires_at: new Date(session.payload.exp).toISOString() });
        if (rotated?.ok !== true) return result(409, { error: '会话已更新，请重试', code: 'token_reused', retryable: true });
        if (requestHash) {
          const confirmed = rotated.successor;
          if (!confirmed || confirmed.type !== 'user_refresh' || confirmed.user_name !== payload.user_name || confirmed.account_id !== String(current.id) || typeof confirmed.jti !== 'string' || !Number.isFinite(confirmed.exp) || confirmed.exp<=now()) return unavailable('refresh_store_failed');
          session.payload=confirmed;session.refresh=sign(confirmed);
        }
        return sessionResponse(payload.user_name, session);
      }
      if (path === '/admin/logout') {
        const token = bearer() || cookies.xtj_admin_token, payload = verify(token, undefined);
        if (!payload || await revoked(token)) return invalid();
        await persistRevoke(token, payload);
        return result(200, { ok: true }, [cookie('xtj_admin_token', '', '/', 0, 'Strict')]);
      }
      if (path === '/api/user/logout') {
        let actor;
        if (body.admin_companion_logout === true) {
          const token = cookies.xtj_admin_token, payload = verify(token, undefined);
          if (!payload || await revoked(token)) return invalid();
          actor = payload.user;
        }
        const access = bearer(), accessPayload = verify(access, 'user_access');
        if (accessPayload && (!actor || accessPayload.user_name === actor)) { await persistRevoke(access, accessPayload); actor ||= accessPayload.user_name; }
        const refresh = verify(cookies.xtj_user_refresh, 'user_refresh');
        if (refresh && actor && refresh.user_name !== actor) return result(200, { ok: true, preserved_other_session: true });
        if (refresh) {
          if (await rpc('revoke_user_refresh_session',{p_user_name:refresh.user_name,p_account_id:refresh.account_id || null,p_jti:refresh.jti}) !== true) throw Error('logout_sync_failed');
        }
        return result(200, { ok: true }, clearUserCookies());
      }
      const token = bearer(), payload = verify(token, 'user_access');
      if (!payload || await revoked(token)) return invalid();
      const account = await identity(payload.user_name);
      if (!matches(payload, account, ACCESS_MS)) return invalid();
      if (path === '/api/user/profile') {
        const earliest = await rows({ select: 'created_at', user_name: 'eq.' + payload.user_name, media_type: 'eq.__auth__', order: 'created_at.asc', limit: '1' });
        const records = await rows({select:'content',user_name:'eq.'+payload.user_name,media_type:'eq.__user_info__',order:'created_at.desc',limit:'1'});
        let info={};try{info=JSON.parse(records[0]?.content||'{}');}catch(_){}
        const registeredAt=earliest[0]?.created_at||null;
        return result(200, { ok: true, user_name: payload.user_name, registered_at:registeredAt,info:ipTools.userInfoSnapshot(info,registeredAt) });
      }
      return result(200, { ok: true, is_admin: payload.user_name === 'xxz', restrictions: await restrictions(payload.user_name, true) });
    } catch (error) {
      if (error?.egressRestricted === true) return result(402, { error: '网站数据服务流量额度已用完，服务暂时受限，请等待恢复', code: 'egress_quota_exceeded', retryable: false });
      const reply = unavailable();
      if (Number.isInteger(error?.upstreamStatus) && error.upstreamStatus >= 100 && error.upstreamStatus <= 599) reply.body.upstream_status = error.upstreamStatus;
      if (error?.upstreamFailure === 'network') reply.body.upstream_failure = 'network';
      return reply;
    }
    finally { clearTimeout(timer); request.signal.removeEventListener('abort', abort); }
  };
}

module.exports = { createLoginBackend };
