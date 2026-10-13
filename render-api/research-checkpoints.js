'use strict';
const { randomUUID } = require('node:crypto');

const MAX_BYTES = 2 * 1024 * 1024;
function summary(row) {
  const state = row.state || {}, request = state.request || {};
  return { id: row.id, query: request.query || '', conversation_id: request.conversation_id,
    model: request.model, research_model: request.research_model, status: row.status,
    completed: (state.workers || []).filter(w => w && w.status === 'success').length,
    total: (state.agents || []).length, stage: state.stage || 'planning',
    updated_at: row.updated_at, expires_at: row.expires_at,
    resumable: row.status !== 'complete' && (row.status !== 'running' || Date.parse(row.lease_until) < Date.now()) };
}
function createResearchCheckpoints(db) {
  async function rpc(owner, op, values = {}) {
    if (!owner || !owner.userName || !owner.accountId) throw Error('checkpoint_identity_missing');
    const result = await db.rpc('manage_ai_research_checkpoint', {
      p_user_name: owner.userName, p_account_id: String(owner.accountId), p_op: op,
      p_id: values.id || null, p_lease: values.lease || null,
      p_state: values.state || null, p_status: values.status || null
    });
    if (!result || result.error) throw Error('checkpoint_storage_unavailable');
    const value = result.data;
    if (!value || value.ok !== true) throw Object.assign(Error(value && value.error || 'checkpoint_unavailable'), { code: value && value.error });
    return value;
  }
  async function begin(owner, request, id) {
    const lease = randomUUID();
    const value = await rpc(owner, id ? 'claim' : 'start', { id, lease, state: id ? null : { version: 1, request, stage: 'planning', workers: [] } });
    let state = value.row.state, chain = Promise.resolve();
    // Serialize snapshots: parallel workers cannot overwrite a newer frontier.
    async function save(next) {
      state = next;
      const snapshot = JSON.parse(JSON.stringify(next));
      if (Buffer.byteLength(JSON.stringify(snapshot)) > MAX_BYTES) throw Error('checkpoint_too_large');
      chain = chain.catch(() => {}).then(() => rpc(owner, 'save', { id: value.row.id, lease, state: snapshot }));
      return chain;
    }
    return { id: value.row.id, state, resumed: !!id, save,
      async finish(status) { await chain.catch(() => {}); return rpc(owner, 'finish', { id: value.row.id, lease, state, status }); }
    };
  }
  return { begin,
    async list(owner) { return (await rpc(owner, 'list')).rows.map(summary); },
    async remove(owner, id) { return rpc(owner, 'remove', { id }); }
  };
}
function installResearchCheckpoints(app, deps) {
  const store = createResearchCheckpoints(deps.db);
  const owner = req => ({ userName: req.userName, accountId: req.accountId });
  app.get('/api/agent/research/checkpoints', deps.authenticateUser, deps.rateLimit(60000, 30), async (req, res) => {
    try { res.json({ ok: true, records: await store.list(owner(req)) }); }
    catch (_) { res.status(503).json({ ok: false, error: '研究断点暂时无法读取，请稍后重试' }); }
  });
  app.delete('/api/agent/research/checkpoints/:id', deps.authenticateUser, deps.rateLimit(60000, 20), async (req, res) => {
    if (!/^[a-f\d-]{36}$/i.test(req.params.id)) return res.status(400).json({ ok: false, error: '断点无效' });
    try { await store.remove(owner(req), req.params.id); res.json({ ok: true }); }
    catch (error) { res.status(error.code === 'checkpoint_running' ? 409 : 503).json({ ok: false, error: error.code === 'checkpoint_running' ? '请先暂停研究再删除断点' : '断点删除失败，请重试' }); }
  });
  return store;
}
module.exports = { createResearchCheckpoints, installResearchCheckpoints, summary };
