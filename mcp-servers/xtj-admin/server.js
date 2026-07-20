#!/usr/bin/env node

/**
 * XTJ Admin API MCP Server (v2 - McpServer API)
 * =============================================
 * 让 AI 智能体可以直接管理 XTJ 后台：
 * - 用户管理（封禁/解禁/禁言/删除）
 * - 内容管理（帖子/照片/评论 管理）
 * - 举报处理
 * - 安全中心（安全提醒/登录事件/审计日志）
 * - 数据统计
 * - 公告管理
 * - 安全设置
 *
 * 环境变量:
 *   XTJ_API_BASE     - XTJ 后端 API 地址（必填）
 *   XTJ_ADMIN_USER   - 管理员用户名（可选，自动登录）
 *   XTJ_ADMIN_PASS   - 管理员密码（可选，自动登录）
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// ===================== 配置 =====================
const API_BASE = process.env.XTJ_API_BASE || "";
if (!API_BASE) {
  console.error("[xtj-admin-mcp] 错误: 请设置 XTJ_API_BASE 环境变量指向 XTJ 后端地址");
  process.exit(1);
}

let authToken = null;
let authTokenAt = 0;
let adminUser = process.env.XTJ_ADMIN_USER || null;
let adminPass = process.env.XTJ_ADMIN_PASS || null;

// ===================== HTTP 工具 =====================
async function apiRequest(method, path, body = null) {
  const url = `${API_BASE}${path}`;
  const headers = { "Content-Type": "application/json" };
  if (authToken) headers["Authorization"] = `Bearer ${authToken}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  const opts = { method, headers, signal: controller.signal };
  if (body) opts.body = JSON.stringify(body);
  try {
    const res = await fetch(url, opts);
    var data;
    try {
      data = await res.json();
    } catch (jsonErr) {
      // 非 JSON 响应（如 502 HTML 页面）
      var text = '';
      try { text = await res.text(); } catch (_) {}
      throw new Error(`API 返回非 JSON (${res.status}): ${text.slice(0, 200)}`);
    }
    if (!res.ok) {
      if (res.status === 401) { authToken = null; authTokenAt = 0; }
      throw new Error(`API 错误 (${res.status}): ${data.error || JSON.stringify(data)}`);
    }
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

async function ensureLoggedIn() {
  if (!authToken) {
    if (adminUser && adminPass) {
      const data = await apiRequest("POST", "/admin/login", { username: adminUser, password: adminPass });
      if (!data.ok || !data.token) throw new Error("自动登录失败");
      authToken = data.token;
      authTokenAt = Date.now();
    } else {
      throw new Error("未登录，请先通过 admin_login 工具登录");
    }
  }
}

async function login(username, password) {
  const data = await apiRequest("POST", "/admin/login", { username, password });
  if (!data.ok || !data.token) throw new Error("登录失败: " + (data.error || "未知错误"));
  authToken = data.token;
  authTokenAt = Date.now();
  adminUser = username;
  adminPass = password;
}

// ===================== 辅助格式化函数 =====================
var auditLog = [];
function logAudit(action, detail) {
  var entry = { time: new Date().toISOString(), action: action, detail: detail };
  auditLog.push(entry);
  if (auditLog.length > 500) auditLog.shift();
  console.error('[xtj-admin-audit]', JSON.stringify(entry));
}

function formatStats(data) {
  let t = `📊 XTJ 统计数据\n━━━━━━━━━━━━━━━━━━━━\n`;
  t += `👥 用户数: ${data.total_users || 0}\n📝 帖子数: ${data.total_posts || 0}\n💬 评论数: ${data.total_comments || 0}\n`;
  t += `❤️ 点赞数: ${data.total_likes || 0}\n📸 照片数: ${data.total_photos || 0}\n👁️ 访问量: ${data.total_visits || 0}\n`;
  t += `🛡️ 攻击拦截: ${data.firewall_intercepts || 0}\n缓存时间: ${data.cached_at || "-"}`;
  if (data.daily_visits) {
    const days = Object.keys(data.daily_visits).sort().slice(-7);
    t += `\n\n📈 最近 7 天:\n`;
    days.forEach(d => { t += `  ${d}: ${data.daily_visits[d]} 次\n`; });
  }
  return t;
}

function formatAdminData(data) {
  return `📋 管理后台数据概览\n━━━━━━━━━━━━━━━━━━━━\n📝 帖子: ${(data.posts||[]).length}\n❤️ 点赞: ${(data.likes||[]).length}\n💬 评论: ${(data.comments||[]).length}\n📢 举报: ${(data.reports||[]).length}\n🔨 封禁: ${(data.bans||[]).length}\n🔇 禁言: ${(data.mutes||[]).length}\n⬛ 黑名单: ${(data.blacklist||[]).length}\n📢 公告: ${(data.announcements||[]).length}`;
}

// ===================== 创建 MCP Server =====================
const server = new McpServer({ name: "xtj-admin-mcp", version: "1.0.0" });

// ===================== 注册工具 =====================

// --- 认证 ---
server.tool("admin_login", "登录 XTJ 管理后台", { username: z.string(), password: z.string() }, async ({ username, password }) => {
  await login(username, password);
  return { content: [{ type: "text", text: `✅ 登录成功！管理员: ${username}\nToken 已自动保存。` }] };
});

// --- 统计 ---
server.tool("admin_get_stats", "获取汇总统计数据", { start: z.string().optional(), end: z.string().optional() }, async (args) => {
  await ensureLoggedIn();
  let path = "/admin/stats";
  const p = []; if (args.start) p.push(`start=${args.start}`); if (args.end) p.push(`end=${args.end}`); if (p.length) path += "?" + p.join("&");
  const data = await apiRequest("GET", path);
  return { content: [{ type: "text", text: formatStats(data) }] };
});

server.tool("admin_get_daily_stats", "获取每日明细统计数据", { start: z.string().optional(), end: z.string().optional() }, async (args) => {
  await ensureLoggedIn();
  let path = "/admin/stats/daily";
  const p = []; if (args.start) p.push(`start=${args.start}`); if (args.end) p.push(`end=${args.end}`); if (p.length) path += "?" + p.join("&");
  const data = await apiRequest("GET", path);
  if (!data.daily || !data.daily.length) return { content: [{ type: "text", text: "暂无每日统计" }] };
  let t = `📈 每日统计 (最近 ${data.daily.length} 天)\n━━━━━━━━━━━━━━━━━━━━━━━━━\n日期        | 访问 | 帖子 | 评论 | 点赞 | 新用户 | 攻击\n`;
  data.daily.slice(-30).forEach(d => { t += `${d.date} | ${d.visits} | ${d.posts} | ${d.comments} | ${d.likes} | ${d.new_users} | ${d.attacks}\n`; });
  return { content: [{ type: "text", text: t }] };
});

server.tool("admin_refresh_stats", "刷新统计缓存", {}, async () => {
  await ensureLoggedIn();
  await apiRequest("POST", "/admin/stats/refresh");
  return { content: [{ type: "text", text: "✅ 统计缓存已刷新" }] };
});

server.tool("admin_get_user_stats", "获取用户统计仪表盘", {}, async () => {
  await ensureLoggedIn();
  const data = await apiRequest("GET", "/admin/stats/users");
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
});

// --- 用户管理 ---
server.tool("admin_get_users", "获取所有用户列表（隐藏敏感字段）", {}, async () => {
  await ensureLoggedIn();
  const data = await apiRequest("GET", "/admin/users");
  const users = data.data || [];
  let t = `📋 用户列表 (共 ${users.length} 人)\n\n`;
  users.forEach((u, i) => { t += `${i+1}. ${u.user_name||u.username||"?"} | 注册: ${(u.created_at||"").slice(0,10)} | 最后: ${(u.last_login||"").slice(0,10)}\n`; });
  return { content: [{ type: "text", text: t }] };
});

server.tool("admin_delete_user", "彻底删除用户账号（高风险！需要传入 confirm=true 确认）", { userName: z.string(), confirm: z.boolean() }, async ({ userName, confirm }) => {
  if (!confirm) return { content: [{ type: "text", text: `⚠️ 高危操作！删除用户 ${userName} 将永久删除其所有数据。请在参数中传入 confirm=true 确认。` }] };
  await ensureLoggedIn();
  const data = await apiRequest("DELETE", `/admin/user/${encodeURIComponent(userName)}`);
  if (!data.ok) return { content: [{ type: "text", text: `❌ 删除失败: ${data.error||"未知错误"}` }] };
  const d = data.deleted || {};
  logAudit('delete_user', { userName, deleted: d });
  return { content: [{ type: "text", text: `✅ 用户 ${userName} 已删除\n帖子: ${d.posts} | 点赞: ${d.likes} | 评论: ${d.comments} | 封禁: ${d.bans} | 禁言: ${d.mutes} | 黑名单: ${d.blacklist} | 文件: ${d.storage_files}` }] };
});

// --- 内容管理 ---
server.tool("admin_get_data", "获取管理后台全部数据", {}, async () => {
  await ensureLoggedIn();
  const data = await apiRequest("GET", "/admin/data");
  return { content: [{ type: "text", text: formatAdminData(data) }] };
});

server.tool("admin_delete_post", "删除指定帖子（高风险，需要 confirm=true 确认）", { id: z.string(), confirm: z.boolean() }, async ({ id, confirm }) => {
  if (!confirm) return { content: [{ type: "text", text: `⚠️ 高危操作！删除帖子 ${id} 不可撤销。请在参数中传入 confirm=true 确认。` }] };
  await ensureLoggedIn();
  await apiRequest("DELETE", `/admin/post/${id}`);
  logAudit('delete_post', { id });
  return { content: [{ type: "text", text: `✅ 帖子 ${id} 已删除` }] };
});

server.tool("admin_delete_comment", "删除指定评论", { id: z.string() }, async ({ id }) => {
  await ensureLoggedIn();
  await apiRequest("DELETE", `/admin/comment/${id}`);
  return { content: [{ type: "text", text: `✅ 评论 ${id} 已删除` }] };
});

server.tool("admin_get_photos", "获取照片列表", {}, async () => {
  await ensureLoggedIn();
  const data = await apiRequest("GET", "/admin/photos");
  const photos = data.data || [];
  let t = `📸 照片列表 (共 ${photos.length} 张)\n\n`;
  photos.forEach((p, i) => { t += `${i+1}. [${p.id}] ${p.user_name} | ${(p.created_at||"").slice(0,10)} | 浏览量:${p.views||0}\n`; });
  return { content: [{ type: "text", text: t }] };
});

server.tool("admin_delete_photo", "软删除照片", { id: z.string() }, async ({ id }) => {
  await ensureLoggedIn();
  await apiRequest("DELETE", `/admin/photo/${id}`);
  return { content: [{ type: "text", text: `✅ 照片 ${id} 已删除（软删除）` }] };
});

server.tool("admin_restore_photo", "恢复已删除的照片", { id: z.string() }, async ({ id }) => {
  await ensureLoggedIn();
  await apiRequest("POST", `/admin/photo/restore/${id}`);
  return { content: [{ type: "text", text: `✅ 照片 ${id} 已恢复` }] };
});

// --- 公告 ---
server.tool("admin_create_announcement", "创建公告", { content: z.string(), title: z.string().optional() }, async ({ content, title }) => {
  await ensureLoggedIn();
  await apiRequest("POST", "/admin/announcement", { title: title||"", content });
  return { content: [{ type: "text", text: `✅ 公告已创建` }] };
});

server.tool("admin_delete_announcement", "删除公告", { id: z.string() }, async ({ id }) => {
  await ensureLoggedIn();
  await apiRequest("DELETE", `/admin/announcement/${id}`);
  return { content: [{ type: "text", text: `✅ 公告 ${id} 已删除` }] };
});

// --- 封禁 ---
server.tool("admin_get_bans", "获取封禁列表", {}, async () => {
  await ensureLoggedIn();
  const data = await apiRequest("GET", "/admin/bans");
  const bans = data.data || [];
  let t = `🔨 封禁列表 (共 ${bans.length} 条)\n\n`;
  bans.forEach((b,i) => { t += `${i+1}. ${b.user_name} | ${b.is_active?"🔴生效中":"✅已解除"} | 原因:${b.ban_reason||"-"} | 操作:${b.banned_by||"-"}\n`; });
  return { content: [{ type: "text", text: t }] };
});

server.tool("admin_ban_user", "封禁用户", { user_name: z.string(), duration_hours: z.number().optional(), reason: z.string().optional() }, async (args) => {
  await ensureLoggedIn();
  await apiRequest("POST", "/admin/ban", { user_name: args.user_name, duration_hours: args.duration_hours??0, reason: args.reason||"" });
  const t = (args.duration_hours??0)===0?"永久封禁":`封禁 ${args.duration_hours} 小时`;
  return { content: [{ type: "text", text: `✅ ${args.user_name} 已被${t}` }] };
});

server.tool("admin_unban_user", "解除封禁", { id: z.string() }, async ({ id }) => {
  await ensureLoggedIn();
  await apiRequest("PUT", `/admin/ban/${id}/lift`);
  return { content: [{ type: "text", text: `✅ 封禁记录 ${id} 已解除` }] };
});

// --- 禁言 ---
server.tool("admin_get_mutes", "获取禁言列表", {}, async () => {
  await ensureLoggedIn();
  const data = await apiRequest("GET", "/admin/mutes");
  const mutes = data.data || [];
  let t = `🔇 禁言列表 (共 ${mutes.length} 条)\n\n`;
  mutes.forEach((m,i) => { t += `${i+1}. ${m.user_name} | ${m.is_active?"🔴生效中":"✅已解除"} | 原因:${m.reason||"-"}\n`; });
  return { content: [{ type: "text", text: t }] };
});

server.tool("admin_mute_user", "禁言用户", { user_name: z.string(), duration_hours: z.number().optional(), reason: z.string().optional() }, async (args) => {
  await ensureLoggedIn();
  await apiRequest("POST", "/admin/mute", { user_name: args.user_name, duration_hours: args.duration_hours??0, reason: args.reason||"" });
  const t = (args.duration_hours??0)===0?"永久禁言":`禁言 ${args.duration_hours} 小时`;
  return { content: [{ type: "text", text: `✅ ${args.user_name} 已被${t}` }] };
});

server.tool("admin_unmute_user", "解除禁言", { id: z.string() }, async ({ id }) => {
  await ensureLoggedIn();
  await apiRequest("PUT", `/admin/mute/${id}/lift`);
  return { content: [{ type: "text", text: `✅ 禁言记录 ${id} 已解除` }] };
});

// --- 黑名单 ---
server.tool("admin_get_blacklist", "获取黑名单列表", {}, async () => {
  await ensureLoggedIn();
  const data = await apiRequest("GET", "/admin/blacklist");
  const bl = data.data || [];
  let t = `⬛ 黑名单 (共 ${bl.length} 条)\n\n`;
  bl.forEach((b,i) => { t += `${i+1}. ${b.user_name} | ${b.is_active?"🔴生效中":"✅已解除"} | 原因:${b.reason||"-"}\n`; });
  return { content: [{ type: "text", text: t }] };
});

server.tool("admin_add_blacklist", "加入黑名单", { user_name: z.string(), reason: z.string().optional(), duration_hours: z.number().optional() }, async (args) => {
  await ensureLoggedIn();
  await apiRequest("POST", "/admin/blacklist", { user_name: args.user_name, reason: args.reason||"", duration_hours: args.duration_hours??0 });
  return { content: [{ type: "text", text: `✅ ${args.user_name} 已加入黑名单` }] };
});

server.tool("admin_lift_blacklist", "解除黑名单", { id: z.string() }, async ({ id }) => {
  await ensureLoggedIn();
  await apiRequest("PUT", `/admin/blacklist/${id}/lift`);
  return { content: [{ type: "text", text: `✅ 黑名单记录 ${id} 已解除` }] };
});

// --- 举报 ---
server.tool("admin_get_reports", "获取举报列表", {}, async () => {
  await ensureLoggedIn();
  const data = await apiRequest("GET", "/admin/reports");
  const r = data.data || [];
  let t = `📢 举报列表 (共 ${r.length} 条)\n\n`;
  r.forEach((a,i) => { t += `${i+1}. [${a.status}] ${a.reporter_name}→${a.target_user||"-"} | ${a.report_category} | ${(a.created_at||"").slice(0,10)}\n`; });
  return { content: [{ type: "text", text: t }] };
});

server.tool("admin_update_report", "更新举报状态", { id: z.string(), status: z.enum(["pending","reviewed","actioned","dismissed"]) }, async ({ id, status }) => {
  await ensureLoggedIn();
  await apiRequest("PUT", `/admin/report/${id}`, { status });
  return { content: [{ type: "text", text: `✅ 举报 ${id} 状态已更新` }] };
});

server.tool("admin_respond_report", "回复举报", { id: z.string(), response: z.string() }, async ({ id, response }) => {
  await ensureLoggedIn();
  await apiRequest("PUT", `/admin/report/${id}/respond`, { response });
  return { content: [{ type: "text", text: `✅ 举报 ${id} 已回复` }] };
});

server.tool("admin_report_delete_post", "处理举报→删除帖子", { id: z.string() }, async ({ id }) => {
  await ensureLoggedIn();
  await apiRequest("POST", `/admin/report/${id}/delete-post`);
  return { content: [{ type: "text", text: `✅ 举报 ${id}: 被举报内容已删除` }] };
});

server.tool("admin_report_ban_user", "处理举报→封禁用户", { id: z.string(), duration_hours: z.number().optional() }, async ({ id, duration_hours }) => {
  await ensureLoggedIn();
  await apiRequest("POST", `/admin/report/${id}/ban-user`, { duration_hours: duration_hours??0 });
  return { content: [{ type: "text", text: `✅ 举报 ${id}: 被举报用户已处理` }] };
});

// --- 安全中心 ---
server.tool("admin_get_security_alerts", "获取安全提醒列表", {}, async () => {
  await ensureLoggedIn();
  const data = await apiRequest("GET", "/admin/security-alerts");
  const alerts = data.data||data.alerts||data;
  if (!Array.isArray(alerts)||!alerts.length) return { content: [{ type: "text", text: "暂无安全提醒 ✅" }] };
  let t = `⚠️ 安全提醒 (共 ${alerts.length} 条)\n━━━━━━━━━━━━━━━━━━━━━━━\n`;
  alerts.forEach((a,i) => {
    const icon = a.level==="critical"?"🔴":a.level==="warning"?"🟡":"🔵";
    t += `${icon} ${i+1}. [${a.level}] ${a.type||"-"}\n   用户:${a.user_name||"-"} IP:${a.ip||"-"} 状态:${a.status||"unread"}\n   原因:${a.reason||"-"}\n   时间:${(a.created_at||"").slice(0,19)}\n\n`;
  });
  return { content: [{ type: "text", text: t }] };
});

server.tool("admin_mark_alerts_read", "标记安全提醒为已读", { ids: z.array(z.string()) }, async ({ ids }) => {
  await ensureLoggedIn();
  await apiRequest("POST", "/admin/security-alerts/read", { ids });
  return { content: [{ type: "text", text: `✅ 已标记 ${ids.length} 条为已读` }] };
});

server.tool("admin_update_alert_status", "更新安全提醒状态", { id: z.string(), status: z.enum(["read","ignored","false_positive"]) }, async ({ id, status }) => {
  await ensureLoggedIn();
  await apiRequest("POST", "/admin/security-alerts/status", { id, status });
  return { content: [{ type: "text", text: `✅ 提醒 ${id} 已更新为 ${status}` }] };
});

server.tool("admin_get_login_events", "获取登录事件", { user_name: z.string().optional(), limit: z.number().optional() }, async (args) => {
  await ensureLoggedIn();
  let p = "/admin/login-events";
  const q = []; if (args.user_name) q.push(`user_name=${encodeURIComponent(args.user_name)}`); if (args.limit) q.push(`limit=${args.limit}`); if (q.length) p += "?" + q.join("&");
  const data = await apiRequest("GET", p);
  const events = data.data || [];
  let t = `🔐 登录事件 (共 ${events.length} 条)\n\n`;
  events.slice(0,50).forEach((e,i) => { t += `${i+1}. ${e.user_name} | IP:${e.ip||"-"} | 地区:${e.ip_location_text||"-"} | 设备:${e.device_type||"-"} | ${(e.created_at||"").slice(0,19)}\n`; });
  return { content: [{ type: "text", text: t }] };
});

server.tool("admin_get_audit_logs", "获取审计日志", {}, async () => {
  await ensureLoggedIn();
  const data = await apiRequest("GET", "/admin/audit-logs");
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
});

server.tool("admin_get_error_logs", "获取错误日志", { limit: z.number().optional() }, async (args) => {
  await ensureLoggedIn();
  const data = await apiRequest("GET", `/admin/error-logs?limit=${args.limit||200}`);
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
});

server.tool("admin_get_security_settings", "查看安全设置", {}, async () => {
  await ensureLoggedIn();
  const data = await apiRequest("GET", "/admin/security-settings");
  const s = data.settings||data;
  let t = `🔒 当前安全设置\n━━━━━━━━━━━\n`; 
  t += `安全提醒: ${s.security_alerts!==false?"✅":"❌"}\n设备记录: ${s.record_device!==false?"✅":"❌"}\n`;
  t += `浏览器指纹: ${s.browser_fingerprint!==false?"✅":"❌"}\nCanvas: ${s.canvas_fingerprint!==false?"✅":"❌"}\n`;
  t += `WebGL: ${s.webgl_fingerprint?"✅":"❌"}\nWebRTC本地IP: ${s.webrtc_local_ip?"✅":"❌"}\n高级指纹: ${s.advanced_fingerprint?"✅":"❌"}`;
  return { content: [{ type: "text", text: t }] };
});

server.tool("admin_update_security_settings", "更新安全设置", {
  security_alerts: z.boolean().optional(),
  record_device: z.boolean().optional(),
  browser_fingerprint: z.boolean().optional(),
  canvas_fingerprint: z.boolean().optional(),
  webgl_fingerprint: z.boolean().optional(),
  webrtc_local_ip: z.boolean().optional(),
  advanced_fingerprint: z.boolean().optional()
}, async (args) => {
  await ensureLoggedIn();
  await apiRequest("POST", "/admin/security-settings", args);
  return { content: [{ type: "text", text: "✅ 安全设置已更新" }] };
});

server.tool("admin_cleanup_logs", "清理过期日志", {}, async () => {
  await ensureLoggedIn();
  const data = await apiRequest("POST", "/admin/cleanup-logs");
  return { content: [{ type: "text", text: `✅ 日志清理完成\n${JSON.stringify(data)}` }] };
});

server.tool("admin_get_attack_details", "获取攻击详情", { type: z.string().optional(), limit: z.number().optional() }, async (args) => {
  await ensureLoggedIn();
  let p = "/admin/stats/attacks";
  const q = []; if (args.type) q.push(`type=${encodeURIComponent(args.type)}`); if (args.limit) q.push(`limit=${args.limit}`); if (q.length) p += "?" + q.join("&");
  const data = await apiRequest("GET", p);
  const atk = data.data||[];
  let t = `🛡️ 攻击详情 (共 ${atk.length} 条)\n\n`;
  atk.slice(0,50).forEach((a,i) => { t += `${i+1}. 类型:${a.type} IP:${a.ip||"-"} 时间:${(a.created_at||"").slice(0,19)}\n`; });
  return { content: [{ type: "text", text: t }] };
});

server.tool("admin_get_register_alerts", "获取注册异常提醒", {}, async () => {
  await ensureLoggedIn();
  const data = await apiRequest("GET", "/admin/users/register-alerts");
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
});

server.tool("admin_read_register_alerts", "标记注册提醒为已读", { ids: z.array(z.string()) }, async ({ ids }) => {
  await ensureLoggedIn();
  await apiRequest("POST", "/admin/users/register-alerts/read", { ids });
  return { content: [{ type: "text", text: "✅ 注册提醒已标记为已读" }] };
});

// ===================== 启动 =====================
const transport = new StdioServerTransport();
await server.connect(transport);
console.error("[xtj-admin-mcp] Server started. Waiting for MCP requests...");
