'use strict';
// ★ 2026-11-16（审计 P0 U-S9 / U-S10）：DeepSeek 官方 Files API 的归属登记。
//   全站共用一个 DeepSeek 账号，file_id 是账号级全局标识：任何拿到 file_id 的
//   请求都能以 input_file 引用（甚至删除）别人上传的私有文档。这里在服务端维护
//   「file_id -> 归属者」映射，上传时登记，引用/删除时校验，杜绝跨用户引用与
//   游客越权删除。
//
//   设计要点：
//    - 进程内 Map（与项目其它限流/配额缓存一致），带 TTL + 容量上限 + 惰性清理；
//    - 归属者用「登录 userName」或「游客 getRealIp」命名空间，避免游客空串短路；
//    - 未登记的 file_id 一律视为不属于当前请求者（fail-closed）；
//    - 前端零改动：附件里的 file_id 在进入聊天/研究链路前由服务端剥离。

const FILE_ID_RE = /^file-api-[A-Za-z0-9_-]+$/;
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 覆盖一天内的会话续用；重启后旧 file_id 安全降级为本地解析
const DEFAULT_MAX = 4000;                 // 防止无限增长

function isFileId(value) {
  return FILE_ID_RE.test(String(value || '').trim());
}

function createFileOwnership(options) {
  const opts = options || {};
  const now = typeof opts.now === 'function' ? opts.now : function () { return Date.now(); };
  const ttlMs = Number(opts.ttlMs) > 0 ? Number(opts.ttlMs) : DEFAULT_TTL_MS;
  const max = Number(opts.max) > 0 ? Number(opts.max) : DEFAULT_MAX;
  const ipOf = typeof opts.ipOf === 'function' ? opts.ipOf : function (req) {
    return String((req && req.ip) || '');
  };
  // fileId -> { owner, expiresAt }
  const registry = new Map();

  // 归属者命名空间：登录用户用 userName；游客用真实 IP（不用裸 req.ip 之外
  // 的空串），保证「游客 A」与「游客 B」、游客与登录用户互不串号。
  function ownerKeyOf(req) {
    const name = String((req && req.userName) || '').trim();
    if (name) return 'user:' + name;
    let ip = '';
    try { ip = String(ipOf(req) || '').trim(); } catch (_) { ip = ''; }
    return 'guest:' + (ip || 'unknown');
  }

  function sweep(current) {
    for (const entry of registry) {
      if (entry[1].expiresAt <= current) registry.delete(entry[0]);
    }
    // 容量兜底：极端情况下按插入顺序淘汰最旧的条目
    while (registry.size > max) {
      const oldest = registry.keys().next().value;
      if (oldest === undefined) break;
      registry.delete(oldest);
    }
  }

  // 上传成功后登记。仅接受合法 file_id，返回是否登记成功。
  function register(fileId, req) {
    const id = String(fileId || '').trim();
    if (!isFileId(id)) return false;
    const t = now();
    registry.set(id, { owner: ownerKeyOf(req), expiresAt: t + ttlMs });
    // 先插入再 sweep：sweep 会清掉过期条目并按插入顺序裁到硬上限，
    // 保证 register 返回后 registry.size 恒 <= max（容量是硬约束，不是惰性）。
    // 新条目最后插入，永不会被本轮淘汰。
    sweep(t);
    return true;
  }

  // 该 file_id 是否属于当前请求者。未登记 / 过期 / 身份不符一律 false。
  function isOwnedBy(fileId, req) {
    const id = String(fileId || '').trim();
    if (!isFileId(id)) return false;
    const row = registry.get(id);
    if (!row) return false;
    if (row.expiresAt <= now()) { registry.delete(id); return false; }
    return row.owner === ownerKeyOf(req);
  }

  function drop(fileId, req) {
    const id = String(fileId || '').trim();
    if (!isOwnedBy(id, req)) return false;
    registry.delete(id);
    return true;
  }

  // 删除接口已由管理员鉴权把关（上传者通常不是管理员），这里只做无条件
  // 清登记，避免文件被删后仍能被引用。不参与权限判定。
  function forget(fileId) {
    return registry.delete(String(fileId || '').trim());
  }

  // 从请求体附件中剥离「不属于当前请求者」的 file_id（原地修改），返回剥离数量。
  // 剥离后附件仍保留 data_url / name 等字段，前端与本地解析链路不受影响。
  function stripForeignFileIds(body, req) {
    let removed = 0;
    const lists = [];
    if (body && Array.isArray(body.attachments)) lists.push(body.attachments);
    for (const key of ['messages', 'history', 'inputItems', 'input_items']) {
      if (!body || !Array.isArray(body[key])) continue;
      for (const msg of body[key]) {
        if (msg && Array.isArray(msg.attachments)) lists.push(msg.attachments);
      }
    }
    for (const list of lists) {
      for (const att of list) {
        if (!att || typeof att !== 'object') continue;
        const id = String(att.file_id || '').trim();
        if (!id) continue;
        if (!isOwnedBy(id, req)) {
          delete att.file_id;
          if (att.file_token) delete att.file_token;
          removed += 1;
        }
      }
    }
    return removed;
  }

  function size() { return registry.size; }

  // 允许启动期把 IP 解析器换成 server.js 的 getRealIp（避免 Render 反代下
  // 裸 req.ip 退化成 10.x 内网导致游客互相串号）。
  function setIpResolver(fn) {
    if (typeof fn === 'function') opts.ipOf = fn;
  }

  return { register, isOwnedBy, drop, forget, stripForeignFileIds, ownerKeyOf, isFileId, size, setIpResolver };
}

// 进程级共享实例：deepseek-files.js（上传登记 / 删除校验）与 server.js
// （聊天、研究、取消链路）引用同一份映射，避免各自新建导致校验永远落空。
const shared = createFileOwnership();

module.exports = {
  createFileOwnership,
  isFileId,
  FILE_ID_RE,
  shared,
  setIpResolver: shared.setIpResolver
};
