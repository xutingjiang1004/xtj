'use strict';
// 语音转文字（小猫AI 麦克风、聊天语音）。浏览器把录音发到这里，服务端转给一个
// OpenAI 兼容的转写接口（默认 Groq 的 whisper-large-v3-turbo，有免费额度）。
// 没有配置密钥时接口返回「未配置」，浏览器退回本机识别，什么都不会坏。
// 录音只在内存里转发一次，不落盘、不写日志。
const TYPES = { 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/m4a': 'm4a', 'audio/aac': 'aac', 'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'video/webm': 'webm', 'video/mp4': 'm4a' };
const MAX_BYTES = 12 * 1024 * 1024;
const DEFAULT_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';
const DEFAULT_MODEL = 'whisper-large-v3-turbo';
// Whisper 类模型会参考这句提示的写法：简体中文、中英混说时英文照写。
const HINT = '以下是普通话的句子，使用简体中文，夹杂的 English words 保持英文原文。';

function settings(env) {
  const key = String(env.VOICE_TRANSCRIPTION_API_KEY || env.CHAT_TRANSCRIPTION_API_KEY || '').trim();
  const url = String(env.VOICE_TRANSCRIPTION_URL || (env.VOICE_TRANSCRIPTION_API_KEY ? '' : env.CHAT_TRANSCRIPTION_URL) || DEFAULT_URL).trim();
  const model = String(env.VOICE_TRANSCRIPTION_MODEL || (env.VOICE_TRANSCRIPTION_API_KEY ? '' : env.CHAT_TRANSCRIPTION_MODEL) || DEFAULT_MODEL).trim();
  return { key, url, model, enabled: !!key && /^https:\/\//.test(url) };
}
function describeConfig(env = process.env) {
  const s = settings(env);
  let host = ''; try { host = new URL(s.url).host; } catch (_) {}
  return '[VOICE-CONFIG] key=' + (s.key ? 'set' : 'missing') + ' host=' + (host || 'invalid') + ' model=' + s.model + ' enabled=' + s.enabled;
}
// 转写结果里常见的空白、重复标点和模型在静音时编出来的套话。
function cleanTranscript(value) {
  let text = String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  text = text.replace(/<\|[^|>]*\|>/g, '').trim();
  if (/^(?:字幕|字幕由|請不吝點贊|请不吝点赞|谢谢观看|謝謝觀看|thanks for watching|thank you\.?)[\s\S]{0,24}$/i.test(text) && text.length <= 30) return '';
  return text.slice(0, 5000);
}

function createVoiceTranscribe({ express, authenticateUser, rateLimit, env = process.env, fetchImpl = fetch, timeoutMs = 45000 }) {
  const router = express.Router();
  router.get('/status', authenticateUser, (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ ok: true, available: settings(env).enabled });
  });
  router.post('/', authenticateUser, rateLimit(60000, 12), express.raw({ type: () => true, limit: MAX_BYTES }), async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const s = settings(env);
    if (!s.enabled) return res.status(503).json({ ok: false, code: 'transcription_unconfigured', error: '服务端语音识别尚未配置' });
    const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    const ext = TYPES[type];
    const body = Buffer.isBuffer(req.body) ? req.body : null;
    if (!ext) return res.status(415).json({ ok: false, code: 'unsupported_audio', error: '不支持的录音格式' });
    if (!body || !body.length) return res.status(400).json({ ok: false, code: 'empty_audio', error: '没有收到录音' });
    const controller = new AbortController();
    const abort = () => controller.abort();
    const timer = setTimeout(abort, timeoutMs);
    res.once('close', abort);
    try {
      const form = new FormData();
      form.append('model', s.model);
      form.append('response_format', 'json');
      form.append('temperature', '0');
      form.append('prompt', HINT);
      form.append('file', new Blob([body], { type }), 'voice.' + ext);
      const upstream = await fetchImpl(s.url, { method: 'POST', headers: { Authorization: 'Bearer ' + s.key }, body: form, signal: controller.signal });
      if (!upstream.ok) {
        const busy = upstream.status === 429;
        console.warn('[VOICE] upstream status ' + upstream.status);
        return res.status(busy ? 429 : 502).json({ ok: false, code: busy ? 'transcription_busy' : 'transcription_failed', error: busy ? '语音识别繁忙，请稍后再试' : '语音识别服务暂时不可用', retryable: true });
      }
      const data = await upstream.json().catch(() => null);
      return res.json({ ok: true, text: cleanTranscript(data && data.text) });
    } catch (error) {
      if (res.headersSent || res.writableEnded) return;
      const timedOut = controller.signal.aborted;
      return res.status(timedOut ? 504 : 502).json({ ok: false, code: timedOut ? 'transcription_timeout' : 'transcription_failed', error: timedOut ? '语音识别超时，请重试' : '语音识别服务暂时不可用', retryable: true });
    } finally { clearTimeout(timer); res.removeListener('close', abort); }
  });
  return router;
}

module.exports = { createVoiceTranscribe, cleanTranscript, describeConfig, settings, MAX_BYTES };
