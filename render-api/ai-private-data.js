'use strict';
const { AsyncLocalStorage } = require('node:async_hooks');
const accounts = new AsyncLocalStorage();
const PRIVATE_MARKERS = new Set(['__ai_agent_msg__', '**ai_agent_conv_summary**', '__ai_agent_profile__', '__ai_agent_memory__']);
const OWNER_RPCS = new Set(['list_ai_conversations', 'list_ai_research_records', 'soft_delete_ai_conversation', 'save_ai_tool_retry_result']);
function runAsAccount(req, next) {
  if (!req.userName || !req.accountId) throw Error('ai_account_required');
  return accounts.run({ userName: req.userName, id: String(req.accountId) }, next);
}
function bindAccount(callback) {
  const owner = accounts.getStore();
  return function(...args) { return accounts.run(owner, () => callback.apply(this, args)); };
}
// The authenticated request captures identity once. Async continuations keep that
// identity after disconnect/deletion; they must never look up a successor by name.
function bindPrivateAiData(client) {
  return new Proxy(client, { get(target, key) {
    if (key === 'rpc') return (name, args, ...rest) => {
      const owner = accounts.getStore();
      if (OWNER_RPCS.has(name)) {
        if (!owner || args.p_user_name !== owner.userName) throw Error('ai_account_required');
        args = { ...args, p_account_id: owner.id };
      }
      return target.rpc(name, args, ...rest);
    };
    if (key !== 'from') { const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value; }
    return table => {
      const owner = accounts.getStore();
      function decorate(query) {
        return new Proxy(query, { get(q, method) {
          const value = Reflect.get(q, method);
          if (typeof value !== 'function') return value;
          if (['then', 'catch', 'finally'].includes(method)) return value.bind(q);
          return (...args) => {
            if (['insert','upsert'].includes(method) && (table === 'posts' || table === 'ai_search_results')) {
              const stamp = row => {
                if (table === 'posts' && !PRIVATE_MARKERS.has(row.media_type)) return row;
                if (!owner || (table === 'posts' ? row.user_name : row.owner_name) !== owner.userName) throw Error('ai_account_required');
                return { ...row, ai_account_id: owner.id };
              };
              args[0] = Array.isArray(args[0]) ? args[0].map(stamp) : stamp(args[0]);
            }
            let result = value.apply(q, args);
            if (owner && table === 'ai_search_results' && ['select','update','delete'].includes(method)) result = result.eq('ai_account_id', owner.id);
            // Administrative/background operations have no user scope and keep
            // their existing privileged access. All authenticated user queries
            // naming a private marker (including exports and updates) are scoped.
            if (owner && table === 'posts' && ((method === 'eq' && args[0] === 'media_type' && PRIVATE_MARKERS.has(args[1])) ||
              (method === 'in' && args[0] === 'media_type' && args[1].some(marker => PRIVATE_MARKERS.has(marker))))) {
              // Mixed profile exports also contain non-AI rows. Keep those rows
              // while excluding unbound/foreign private records.
              const markers = [...PRIVATE_MARKERS].map(marker => '"' + marker + '"').join(',');
              result = result.or('media_type.not.in.(' + markers + '),ai_account_id.eq.' + owner.id);
            }
            return result && typeof result === 'object' ? decorate(result) : result;
          };
        } });
      }
      const query = target.from(table);
      return decorate(query);
    };
  } });
}
module.exports = { runAsAccount, bindAccount, bindPrivateAiData, PRIVATE_MARKERS };
