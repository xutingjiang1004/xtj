'use strict';
const crypto = require('node:crypto');

// Process-local aggregates: no per-image database writes and no signed URLs,
// usernames or credentials in metrics. These are proxy observations, not billing.
function createMediaTraffic({ now = () => Date.now(), dailyBudget = 100 * 1000 * 1000 } = {}) {
  const startedAt = now(), days = new Map();
  function day() {
    const date = new Date(now() + 8 * 3600000).toISOString().slice(0, 10);
    if (!days.has(date)) {
      days.set(date, { date, source_bytes: 0, source_requests: 0, revalidated: 0, preview_hits: 0, previews_generated: 0, resources: new Map() });
      while (days.size > 7) days.delete(days.keys().next().value);
    }
    return days.get(date);
  }
  function resource(bucket, path) {
    const d = day(), key = crypto.createHash('sha256').update(bucket + '\0' + path).digest('hex').slice(0, 16);
    if (!d.resources.has(key)) {
      if (d.resources.size >= 512) d.resources.delete(d.resources.keys().next().value);
      d.resources.set(key, { resource: key, kind: bucket === 'photo-wall' ? 'photo' : (path.startsWith('posts/') ? 'post' : 'other'), requests: 0, bytes: 0 });
    }
    return d.resources.get(key);
  }
  return {
    identify(bucket, path, id) { if (/^[0-9a-f-]{36}$/i.test(String(id || ''))) resource(bucket,path).content_id = id; },
    request(bucket, path) { day().source_requests++; resource(bucket, path).requests++; },
    read(bucket, path, bytes) {
      if (!Number.isSafeInteger(bytes) || bytes <= 0) return;
      day().source_bytes += bytes; resource(bucket, path).bytes += bytes;
    },
    revalidated() { day().revalidated++; },
    previewHit() { day().preview_hits++; },
    generated() { day().previews_generated++; },
    snapshot() {
      day();
      return { scope: 'current_process', started_at: new Date(startedAt).toISOString(), timezone: 'Asia/Shanghai',
        note: '本站媒体代理读取字节估算；重启清零，不含数据库、旧直连和其他服务，以 Supabase 用量页为准。',
        daily_budget_bytes: dailyBudget,
        days: Array.from(days.values()).map(({ resources, ...d }) => ({ ...d,
          budget_warning: d.source_bytes >= dailyBudget * .8,
          top_resources: Array.from(resources.values()).sort((a, b) => b.bytes - a.bytes).slice(0, 10) })) };
    }
  };
}
const mediaTraffic = createMediaTraffic();
module.exports = { createMediaTraffic, mediaTraffic };
