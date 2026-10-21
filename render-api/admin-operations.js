'use strict';

async function checkedResult(query) {
  const result = await query;
  if (!result || result.error) throw result && result.error || new Error('database_unavailable');
  return result;
}
async function checkedData(query) { return (await checkedResult(query)).data; }
function sendAdminDbFailure(res, error) {
  const { classifySupabaseError } = require('./db-result');
  const limited = /exceed_egress_quota|egress_quota_exceeded/.test(String(error && error.code || '') + ' ' + String(error && error.message || ''));
  if (limited) return res.status(402).json({ok:false,code:'egress_quota_exceeded',error:'网站数据服务暂时受限，请等待恢复',retryable:false});
  const classified = classifySupabaseError(error);
  const status = /^2[23]/.test(String(error && error.code || '')) ? 400 : 503;
  return res.status(status).json({ok:false,code:error && error.code || 'database_error',error:'数据操作未完成，请稍后重试',retryable:classified.retryable});
}
async function checkedRpc(supabase, name, args) {
  const data = await checkedData(supabase.rpc(name, args));
  if (!data || data.ok !== true) {
    const error = new Error(data && data.error || name + '_not_applied');
    error.code = data && data.code || 'operation_not_applied';
    error.status = error.code === 'invalid_request' ? 400 : error.code === 'invalid_record' ? 422 : error.code === 'forbidden' ? 403 : error.code === 'not_found' ? 404 : error.code === 'email_daily_limit' ? 429 : error.code === 'idempotency_conflict' ? 409 : 503;
    throw error;
  }
  return data;
}
function reportNotification(action, message) { return { action, message, is_read: false, created_at: new Date().toISOString() }; }
function patchReport(supabase, id, patch, notification) {
  return checkedRpc(supabase, 'mutate_report_record', {
    p_report_id: id, p_patch: patch || {}, p_notification: notification || null,
    p_reader: null, p_read_before: null
  });
}
function mediaGatewayUrl(value, origin) {
  const path = require('./upload-access').uploadPath(value, origin);
  return path ? '/api/uploads/media?path=' + encodeURIComponent(path) : value;
}
function adminPostPayload(post, origin) {
  const result = Object.assign({}, post, { media_url: mediaGatewayUrl(post.media_url, origin) });
  if (Array.isArray(post.attachments)) result.attachments = post.attachments.map(a => Object.assign({}, a, { media_url: mediaGatewayUrl(a.media_url, origin) }));
  if (Array.isArray(post.media_items)) result.media_items = post.media_items.map(a => Object.assign({}, a, { media_url: mediaGatewayUrl(a.media_url, origin) }));
  return result;
}
function emailOutcome(job) {
  const deliveries = job.deliveries || [];
  const sent = deliveries.filter(r => r.status === 'sent').map(r => r.user_name || r.email);
  const failed = deliveries.filter(r => r.status === 'failed').map(r => ({ user: r.user_name || r.email, error: r.error || '发送失败' }));
  const unknown = deliveries.filter(r => r.status === 'unknown' || r.status === 'sending').map(r => ({ user: r.user_name || r.email, error: '发送结果尚未确认，请勿重复发送' }));
  const pending = deliveries.filter(r => r.status === 'reserved').length;
  return { ok: sent.length > 0 && failed.length === 0 && unknown.length === 0 && pending === 0,
    partial: sent.length > 0 && (failed.length > 0 || unknown.length > 0 || pending > 0),
    request_id: job.id, status: job.status, sent_count: sent.length, failed_count: failed.length,
    unknown_count: unknown.length, pending_count: pending, sent, failed, unknown, recipients_detail: deliveries,
    error: sent.length === 0 ? (unknown.length || pending ? '发送结果尚未确认，请使用同一请求查询进度' : '全部发送失败') : undefined };
}
async function recoverEmailJob(supabase, job, fromEmail) {
  if (job.status === 'processing' && Array.isArray(job.deliveries) && job.deliveries.length &&
      job.deliveries.every(r => ['sent','failed','unknown'].includes(r.status))) {
    return checkedRpc(supabase, 'finish_admin_email_job', {p_job_id:job.id,p_from_email:fromEmail || ''});
  }
  return job;
}
module.exports = { checkedResult, checkedData, checkedRpc, patchReport, reportNotification, mediaGatewayUrl, adminPostPayload, emailOutcome, sendAdminDbFailure, recoverEmailJob };
