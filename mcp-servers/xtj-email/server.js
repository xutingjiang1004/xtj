#!/usr/bin/env node

/**
 * XTJ 邮件发送 MCP Server (v2 - McpServer API)
 * =============================================
 * 为 XTJ 提供 AI 驱动的邮件发送能力：
 * - 支持 SendGrid / SMTP
 * - 安全警报邮件、通知、测试邮件
 *
 * 环境变量:
 *   EMAIL_PROVIDER     - "sendgrid" 或 "smtp"（默认 sendgrid）
 *   SENDGRID_API_KEY   - SendGrid API Key
 *   SMTP_HOST/PORT/USER/PASS - SMTP 配置
 *   FROM_EMAIL          - 发件人地址（必填）
 *   FROM_NAME           - 发件人名称（默认 XTJ 通知）
 *   ADMIN_NOTIFY_EMAIL  - 管理员通知邮箱
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const PROVIDER = process.env.EMAIL_PROVIDER || "sendgrid";
const FROM_EMAIL = process.env.FROM_EMAIL || "";
const FROM_NAME = process.env.FROM_NAME || "XTJ 通知";
const ADMIN_EMAIL = process.env.ADMIN_NOTIFY_EMAIL || "";
// 白名单：逗号分隔的邮箱或域名（如 "a@x.com,*.x.com"），空则只允许发给管理员
const ALLOWED_RECIPIENTS = (process.env.ALLOWED_RECIPIENTS || "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean);

if (!FROM_EMAIL) { console.error("[xtj-email-mcp] 请设置 FROM_EMAIL"); process.exit(1); }

function isRecipientAllowed(to) {
  if (!ALLOWED_RECIPIENTS.length) return to.toLowerCase() === ADMIN_EMAIL.toLowerCase();
  return ALLOWED_RECIPIENTS.some(r => {
    if (r.includes('*')) {
      const domain = r.replace('*.', '');
      return to.toLowerCase().endsWith('@' + domain);
    }
    return to.toLowerCase() === r;
  });
}

let sendFn = null;

async function initProvider() {
  if (sendFn && PROVIDER !== "smtp") return;
  if (PROVIDER === "sendgrid") {
    const sgMail = (await import("@sendgrid/mail")).default;
    if (!process.env.SENDGRID_API_KEY) throw new Error("需要 SENDGRID_API_KEY");
    sgMail.setApiKey(process.env.SENDGRID_API_KEY);
    sendFn = async (o) => { await sgMail.send({ to: o.to, from: { email: FROM_EMAIL, name: FROM_NAME }, subject: o.subject, text: o.text, html: o.html }); };
  } else if (PROVIDER === "smtp") {
    const nodemailer = (await import("nodemailer")).default;
    sendFn = async (o) => {
      const t = nodemailer.createTransport({ host: process.env.SMTP_HOST, port: parseInt(process.env.SMTP_PORT||"587"), secure: process.env.SMTP_PORT==="465", auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } });
      await t.verify();
      await t.sendMail({ from: `"${FROM_NAME}" <${FROM_EMAIL}>`, to: o.to, subject: o.subject, text: o.text, html: o.html });
      await t.close();
    };
  } else throw new Error(`不支持: ${PROVIDER}`);
}

function esc(s) { return String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }

const server = new McpServer({ name: "xtj-email-mcp", version: "1.0.0" });

server.tool("send_email", "发送邮件（文本或 HTML）", { to: z.string(), subject: z.string(), text: z.string().optional(), html: z.string().optional() }, async (args) => {
  await initProvider();
  if (!args.text && !args.html) throw new Error("请提供 text 或 html");
  if (!isRecipientAllowed(args.to)) throw new Error('收件人不在白名单中');
  const html = args.html || args.text.split("\n").map(l=>`<p>${esc(l)}</p>`).join("");
  const text = args.text || args.html.replace(/<[^>]*>/g,"");
  await sendFn({ to: args.to, subject: args.subject, text, html });
  return { content: [{ type: "text", text: `✅ 邮件已发送到 ${args.to}\n主题: ${args.subject}` }] };
});

server.tool("send_security_alert", "发送安全警报邮件给管理员", { alert_type: z.enum(["same_ip_multi_users","same_device_multi_users","multi_ip_same_user","geo_change","high_frequency","same_browser_fp","same_canvas_fp"]), user_name: z.string(), ip: z.string().optional(), ip_location: z.string().optional(), detail: z.string().optional() }, async (args) => {
  await initProvider();
  if (!ADMIN_EMAIL) return { content: [{ type: "text", text: "⚠️ 未设置 ADMIN_NOTIFY_EMAIL" }] };
  const labels = { same_ip_multi_users:"同IP多账号",same_device_multi_users:"同设备多账号",multi_ip_same_user:"多IP同账号",geo_change:"地区异常",high_frequency:"高频访问",same_browser_fp:"同浏览器指纹多账号",same_canvas_fp:"同Canvas指纹多账号" };
  const label = labels[args.alert_type] || args.alert_type;
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{font-family:-apple-system,sans-serif;background:#f5f5f8;padding:20px}.card{background:#fff;border-radius:12px;padding:24px;max-width:600px;margin:0 auto}.header{color:#ff3b60;font-size:18px;font-weight:600;margin-bottom:16px}.field{margin:8px 0}.label{color:#888;font-size:12px}.value{color:#1d1d24}</style></head><body><div class="card"><div class="header">⚠️ XTJ 安全警报</div><div class="field"><div class="label">类型</div><div class="value">${esc(label)}</div></div><div class="field"><div class="label">用户</div><div class="value">${esc(args.user_name)}</div></div><div class="field"><div class="label">IP</div><div class="value">${esc(args.ip||"未知")}</div></div><div class="field"><div class="label">地区</div><div class="value">${esc(args.ip_location||"未知")}</div></div>${args.detail?`<div class="field"><div class="label">详情</div><div class="value">${esc(args.detail)}</div></div>`:""}<div class="footer" style="margin-top:20px;padding-top:12px;border-top:1px solid #eee;font-size:12px;color:#999">自动发送 | ${new Date().toLocaleString("zh-CN")}</div></div></body></html>`;
  const text = `XTJ 安全警报\n类型: ${label}\n用户: ${args.user_name}\nIP: ${args.ip||"未知"}\n地区: ${args.ip_location||"未知"}${args.detail?`\n详情: ${args.detail}`:""}`;
  await sendFn({ to: ADMIN_EMAIL, subject: `⚠️ XTJ 安全警报: ${label} - ${args.user_name}`, text, html });
  return { content: [{ type: "text", text: `✅ 安全警报已发送到管理员 ${ADMIN_EMAIL}` }] };
});

server.tool("send_test_email", "发送测试邮件验证配置", { to: z.string() }, async ({ to }) => {
  await initProvider();
  if (!isRecipientAllowed(to)) throw new Error('收件人不在白名单中');
  await sendFn({ to, subject: "XTJ 邮件配置测试", text: `测试邮件\n配置正常 ✅\n时间: ${new Date().toLocaleString("zh-CN")}`, html: `<h2>✅ XTJ 邮件配置测试</h2><p>如果看到此邮件说明配置正常。</p><p>${new Date().toLocaleString("zh-CN")}</p>` });
  return { content: [{ type: "text", text: `✅ 测试邮件已发送到 ${to}` }] };
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("[xtj-email-mcp] Server started. Waiting for MCP requests...");
