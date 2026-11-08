'use strict';
// 已登录请求的认证缓存。
//
// 每个需要登录的请求都要查两次数据库：账号身份（__auth__ 行）和封禁/禁言状态（get_user_restrictions）。
// 页面一打开会并发很多请求，聊天、通知还会轮询，这两次查询既占 Supabase 请求数也拖慢每个接口。
// 这里把两个结果各缓存一小段时间，只缓存「成功的结果」：
//   · 身份：只缓存查到的账号；查不到（账号不存在/刚被删）和查询失败一律不缓存，新注册的账号马上能用；
//   · 限制状态：只缓存明确返回的状态；`unavailable`（查询失败）不缓存，写接口仍然 fail-closed。
// 时效：TTL 很短（默认 15 秒），并且管理员的任何写操作（封禁、禁言、拉黑、解除、删用户……）
// 会立刻清空整个缓存，所以管理员操作后封禁马上生效；只有绕过后台直接改库时，最多晚 TTL 秒。
// 同一用户的并发查询合并成一次（防止页面一打开 N 个请求同时打库）。
const DEFAULT_TTL_MS = 15 * 1000;
const DEFAULT_MAX_ENTRIES = 5000;

function createAuthCache(options) {
  const opts = options || {};
  const now = opts.now || Date.now;
  const ttl = Number.isFinite(opts.ttlMs) && opts.ttlMs >= 0 ? opts.ttlMs : DEFAULT_TTL_MS;
  const max = opts.maxEntries || DEFAULT_MAX_ENTRIES;
  const stores = { identity: new Map(), restrictions: new Map() };
  const inflight = { identity: new Map(), restrictions: new Map() };
  // 清空时递增：清空之前发起、清空之后才返回的查询结果不能写回缓存（否则会把刚失效的旧状态又存回去）。
  let generation = 0;
  const stats = { hits: 0, misses: 0 };

  function prune(store, at) {
    if (store.size <= max) return;
    for (const [key, row] of store) if (row.expires <= at) store.delete(key);
    // 仍然超限（大量不同用户同时活跃）：按插入顺序丢最旧的，不让内存无限增长。
    let overflow = store.size - max;
    for (const key of store.keys()) { if (overflow-- <= 0) break; store.delete(key); }
  }

  async function read(kind, userName, loader, cacheable) {
    const key = String(userName || '');
    if (!key || ttl === 0) return loader();
    const store = stores[kind];
    const at = now();
    const hit = store.get(key);
    if (hit && hit.expires > at) { stats.hits++; return hit.value; }
    const pending = inflight[kind].get(key);
    if (pending) return pending;
    stats.misses++;
    const started = generation;
    const promise = (async () => {
      try {
        const value = await loader();
        if (started === generation && cacheable(value)) {
          prune(store, at);
          store.set(key, { value, expires: now() + ttl });
        }
        return value;
      } finally {
        if (inflight[kind].get(key) === promise) inflight[kind].delete(key);
      }
    })();
    inflight[kind].set(key, promise);
    return promise;
  }

  return {
    identity(userName, loader) { return read('identity', userName, loader, value => !!value); },
    restrictions(userName, loader) { return read('restrictions', userName, loader, value => !!value && !value.unavailable); },
    invalidate(userName) {
      const key = String(userName || '');
      generation++;
      for (const kind of Object.keys(stores)) { stores[kind].delete(key); inflight[kind].delete(key); }
    },
    clear() {
      generation++;
      for (const kind of Object.keys(stores)) { stores[kind].clear(); inflight[kind].clear(); }
    },
    size() { return stores.identity.size + stores.restrictions.size; },
    stats() { return { hits: stats.hits, misses: stats.misses }; }
  };
}

module.exports = { createAuthCache, DEFAULT_TTL_MS };
