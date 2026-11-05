'use strict';
// 用户删除的小猫对话只是软删除（media_url 元数据里 deleted:true）。站内搜索的
// ai_history 来源不能再把这些已删除的消息检索出来交给模型或展示给用户。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require('node:path').join(__dirname, '..', 'render-api', 'server.js'), 'utf8');
const start = source.indexOf('function extractPostPlainText(');
const end = source.indexOf('function validateSearchResult(');
const metaStart = source.indexOf('function parseMsgMeta(');
assert.ok(start > 0 && end > start && metaStart > 0);

function load(rows) {
  const query = {
    select() { return query; }, eq() { return query; }, ilike() { return query; }, order() { return query; },
    limit(n) { query.max = n; return query; },
    then(resolve) { resolve({ data: rows.slice(0, query.max), error: null }); }
  };
  const context = {
    supabase: { from() { return query; } }, AI_AGENT_MESSAGE_MARKER: '__ai_agent_msg__', console,
    normalizeDeepSeekUsageModel: value => value, DEEPSEEK_MODEL_REASONER: 'reasoner',
    crypto: require('node:crypto'), applyNormalPostAllowlist: q => q, isNormalPost: () => true,
    pgrstQuote: value => value, photoMediaUrl: id => id, readVisibleDmPosts: async () => []
  };
  const metaEnd = source.indexOf('\n}\n', metaStart) + 3;
  vm.runInNewContext(source.slice(metaStart, metaEnd) + '\n' + source.slice(start, end) + '\nthis.search = aiSiteSearch;', context);
  return context.search;
}

test('ai_history site search skips soft-deleted conversations and still fills the page', async () => {
  const live = n => ({ id: 'live-' + n, content: '猫粮预算 ' + n, created_at: '2026-11-0' + n + 'T00:00:00Z', media_url: JSON.stringify({ role: 'user', convId: 'KEEP01' }) });
  const gone = n => ({ id: 'gone-' + n, content: '猫粮预算已删除 ' + n, created_at: '2026-11-1' + n + 'T00:00:00Z', media_url: JSON.stringify({ role: 'user', convId: 'GONE01', deleted: true, deleted_at: '2026-11-04T00:00:00Z' }) });
  // 已删除的行较新，排在前面：只取 take 条再过滤会把有效结果挤掉。
  const rows = [gone(1), gone(2), gone(3), live(1), live(2)];
  const out = await load(rows)('ai_history', '猫粮预算', 'alice', 2, false, null);
  assert.equal(out.error, null);
  assert.deepEqual(out.results.map(item => item.source_id).sort(), ['live-1', 'live-2']);
});
