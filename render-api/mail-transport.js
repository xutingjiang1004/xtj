/** Gmail SMTP transporter (optional nodemailer). */
'use strict';

var nodemailer = null;
try { nodemailer = require('nodemailer'); } catch (e) {
  console.warn('[INIT] nodemailer not available in mail-transport, email disabled');
}

const GMAIL_USER = process.env.GMAIL_USER || '';
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD || '';
// ★ 启动时打印邮件环境变量状态（便于 Render Dashboard Logs 调试）
console.log('[MAIL-CONFIG] GMAIL_USER:', GMAIL_USER ? '已设置' : '未设置');
console.log('[MAIL-CONFIG] GMAIL_APP_PASSWORD:', GMAIL_APP_PASSWORD ? '已设置' : '未设置');
console.log('[MAIL-CONFIG] SENDGRID_API_KEY:', process.env.SENDGRID_API_KEY ? '已设置' : '未设置');
console.log('[MAIL-CONFIG] GMAIL_GAS_URL:', process.env.GMAIL_GAS_URL ? '已设置' : '未设置');
var mailTransporter = null;
var mailTransporterPort = null;
function getMailTransporter() {
  if (mailTransporter && mailTransporterPort) return mailTransporter;
  if (!nodemailer) {
    console.warn('[MAIL] nodemailer 未安装，邮件功能不可用');
    return null;
  }
  if (!GMAIL_USER || !GMAIL_APP_PASSWORD) {
    console.warn('[MAIL] GMAIL_USER 或 GMAIL_APP_PASSWORD 未配置，邮件功能不可用');
    return null;
  }
  // 优先使用 465 SSL，如果连接失败在 sendMail 时自动回退到 587
  mailTransporterPort = process.env.SMTP_PORT || '465';
  var isSecure = mailTransporterPort === '465';
  mailTransporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: parseInt(mailTransporterPort, 10),
    secure: isSecure,
    auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 15000
  });
  return mailTransporter;
}

// 审计 🟢：GMAIL_USER / GMAIL_APP_PASSWORD 曾被建议不导出，但 server.js 多处
// 直接 import 它们（发件人地址、SMTP auth、健康检查），移除会破坏现有调用契约，
// 故保留导出。约束：凭据仅在模块内使用，不得进入响应体/日志（启动日志只打"已设置/未设置"）。
module.exports = {
  getMailTransporter: getMailTransporter,
  GMAIL_USER: GMAIL_USER,
  GMAIL_APP_PASSWORD: GMAIL_APP_PASSWORD
};
