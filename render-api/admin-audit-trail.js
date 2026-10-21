'use strict';

const { randomUUID } = require('node:crypto');

const SENSITIVE_READS = new Set([
  '/admin/users', '/admin/user-data', '/admin/user-profile', '/admin/user-location-history',
  '/admin/login-events', '/admin/stats/online', '/admin/users-with-email',
  '/admin/email-history', '/admin/email-recipient-history',
  '/admin/data', '/admin/stats/users', '/admin/ai-agent/config', '/admin/ai-agent/effective-prompt',
  '/admin/ai-agent/invite-codes', '/admin/ai-agent/invite-redemptions', '/admin/ai-agent/pro-users',
  '/admin/ai-agent/users', '/admin/ai-agent/conversations', '/admin/ai-agent/conversation'
]);

function operationPath(req) {
  const path = String(req.originalUrl || req.url || '').split('?')[0].replace(/\/$/, '').toLowerCase();
  // Keep route shapes, never invitation codes, query strings, bodies or credentials.
  return path.replace(/(\/admin\/ai-agent\/invite-codes)\/[^/]+$/, '$1/:code')
    .replace(/(\/admin\/user)\/[^/]+$/, '$1/:userName')
    .replace(/(\/admin\/(?:post|photo|comment|announcement|ban|mute|blacklist|report|email-job))\/[^/]+/, '$1/:id')
    .slice(0, 160);
}

function createAdminAuditTrail({ supabase, marker = '__admin_audit__', timeoutMs = 5000 }) {
  async function confirmed(build) {
    const controller = new AbortController();
    let timer;
    try {
      const query = build();
      const result = await Promise.race([query.abortSignal(controller.signal), new Promise((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(Error('audit_timeout')); }, timeoutMs);
      })]);
      if (!result || result.error || !result.data || !result.data.id) throw Error('audit_not_persisted');
      return result.data;
    } finally { clearTimeout(timer); }
  }

  async function middleware(req, res, next) {
    const route = operationPath(req), method = String(req.method || 'GET').toUpperCase();
    // Session revocation must remain available when audit storage is down.
    if (route === '/admin/logout') return next();
    if (['GET', 'HEAD', 'OPTIONS'].includes(method) && !SENSITIVE_READS.has(route)) return next();
    const operator = req.adminName || req.userName;
    if (!operator) return res.status(403).json({ ok: false, code: 'admin_required', error: '需要管理员身份' });
    const id = randomUUID();
    const rawPath = String(req.originalUrl || req.url || '').split('?')[0];
    const resource = rawPath.match(/\/admin\/(?:post|photo|comment|announcement|ban|mute|blacklist|report|email-job)\/([\da-f-]+)(?:\/|$)/i);
    const resourceId = resource && /^(?:\d{1,20}|[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12})$/i.test(resource[1]) ? resource[1] : '';
    let target = req.query && req.query.user_name || req.body && req.body.user_name;
    if (!target) {
      const account = rawPath.match(/\/admin\/user\/([^/]+)\/?$/i);
      try { if (account) target = decodeURIComponent(account[1]); } catch (_) {}
    }
    const targetName = typeof target === 'string' && /^[\u4e00-\u9fa5a-zA-Z0-9_]{2,20}$/.test(target) ? target : '';
    const intent = {
      action: method.toLowerCase() + ':' + route,
      operator,
      detail: 'method=' + method + '; route=' + route + (resourceId ? '; resource_id=' + resourceId : '') + (targetName ? '; target_user=' + targetName : ''),
      timestamp: new Date().toISOString(),
      request_id: id,
      status: 'started',
      outcome: 'unconfirmed'
    };
    try {
      // A durable intent must exist BEFORE an action or sensitive read starts.
      // A crash leaves an explicitly unconfirmed operation instead of no record.
      await confirmed(() => supabase.from('posts').insert([{
        id, user_name: operator, media_type: marker, media_url: intent.action,
        content: JSON.stringify(intent), actor_key: 'audit_request:' + id, visibility: 'private'
      }]).select('id').single());
    } catch (_) {
      return res.status(503).json({ ok: false, code: 'admin_audit_unavailable',
        error: '审计服务暂不可用，操作尚未执行，请稍后重试', retryable: true });
    }

    let finishing = false;
    async function finish(status, body) {
      const httpStatus = res.statusCode || 200;
      const failed = httpStatus >= 400 || body && body.ok === false;
      const outcome = status === 'interrupted' ? 'unconfirmed' : body && body.partial ? 'partial' : failed ? 'failed' : 'succeeded';
      const record = { ...intent, status, outcome, http_status: httpStatus, completed_at: new Date().toISOString() };
      // Store a bounded error CODE, never an upstream error/body or private content.
      if (body && typeof body.code === 'string' && /^[a-z0-9_-]{1,80}$/i.test(body.code)) record.result_code = body.code;
      await confirmed(() => supabase.from('posts').update({ content: JSON.stringify(record) })
        .eq('id', id).eq('media_type', marker).select('id').single());
    }

    const sendJson = res.json.bind(res);
    res.json = function(body) {
      if (finishing) return sendJson(body);
      finishing = true;
      return finish('completed', body).then(() => sendJson(body), () => {
        // The business action may already have committed. Preserve its result
        // and the durable intent; never encourage a second execution.
        return sendJson({ ...body, audit_pending: true, audit_request_id: id,
          audit_warning: '操作结果已返回，审计结果尚未确认，请勿重复执行，可在操作审计中核对' });
      });
    };
    res.once('close', () => {
      if (finishing) return;
      finishing = true;
      finish('interrupted').catch(() => {});
    });
    return next();
  }
  return { middleware };
}

module.exports = { createAdminAuditTrail, operationPath };
