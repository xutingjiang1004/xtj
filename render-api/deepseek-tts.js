'use strict';
// 文字转语音（小猫AI「朗读」按钮）。DeepSeek 的 TTS 返回 24kHz / 单声道 / 16-bit 小端裸 PCM，
// 浏览器不能直接播，所以在这里补一个 44 字节的 WAV 头再回给前端。
// 没有密钥 / 上游失败时返回 503/502，前端自动退回浏览器自带的语音合成，功能不会消失。
const TTS_URL = 'https://api.deepseek.com/v1/tools/tts';
const SAMPLE_RATE = 24000;
const MAX_TEXT = 2000;
const MAX_PCM_BYTES = 24 * 1024 * 1024;
const VOICES = ['stella', 'tide'];

function wavHeader(pcmBytes) {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + pcmBytes, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);          // fmt 块长度
  header.writeUInt16LE(1, 20);           // PCM
  header.writeUInt16LE(1, 22);           // 单声道
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * 2, 28); // 字节率 = 采样率 * 声道 * 位深/8
  header.writeUInt16LE(2, 32);           // 块对齐
  header.writeUInt16LE(16, 34);          // 位深
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(pcmBytes, 40);
  return header;
}

function settings(env) {
  const key = String((env && env.DEEPSEEK_API_KEY) || '').trim();
  const enabled = !!key && String((env && env.DEEPSEEK_TTS_ENABLED) || '') !== 'false';
  return { key, enabled };
}

function normalizeVoice(value) {
  const voice = String(value || '').trim().toLowerCase();
  return VOICES.indexOf(voice) >= 0 ? voice : VOICES[0];
}

// 去掉 Markdown 记号对朗读没有意义的部分（代码块、表格、链接地址），保留可读文字。
function speakableText(value) {
  let text = String(value == null ? '' : value);
  text = text.replace(/```[\s\S]*?```/g, ' ').replace(/`([^`]*)`/g, '$1');
  text = text.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
  text = text.replace(/^\s*\|.*\|\s*$/gm, ' ').replace(/[#>*_~]+/g, ' ');
  text = text.replace(/\s+/g, ' ').trim();
  return text.slice(0, MAX_TEXT);
}

function createDeepSeekTts({ express, guestAiAuth, rateLimit, env = process.env, fetchImpl = fetch, timeoutMs = 60000 }) {
  const router = express.Router();
  router.get('/status', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ ok: true, available: settings(env).enabled, voices: VOICES, sample_rate: SAMPLE_RATE });
  });
  router.post('/', guestAiAuth, rateLimit(60000, 10), express.json({ limit: '64kb' }), async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const s = settings(env);
    if (!s.enabled) return res.status(503).json({ ok: false, code: 'tts_unconfigured', error: '语音朗读服务未配置' });
    const text = speakableText(req.body && req.body.text);
    if (!text) return res.status(400).json({ ok: false, code: 'empty_text', error: '没有可朗读的文字' });
    const voice = normalizeVoice(req.body && req.body.voice);
    const controller = new AbortController();
    const abort = () => controller.abort();
    const timer = setTimeout(abort, timeoutMs);
    res.once('close', abort);
    try {
      const upstream = await fetchImpl(TTS_URL, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + s.key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, voice_id: voice, format: 'pcm', filter_markdown: true }),
        signal: controller.signal
      });
      if (!upstream.ok) {
        console.warn('[TTS] upstream status ' + upstream.status);
        return res.status(upstream.status === 429 ? 429 : 502).json({
          ok: false,
          code: upstream.status === 429 ? 'tts_busy' : 'tts_failed',
          error: upstream.status === 429 ? '朗读请求过多，请稍后再试' : '朗读服务暂时不可用',
          retryable: true
        });
      }
      const buffer = Buffer.from(await upstream.arrayBuffer());
      if (!buffer.length) return res.status(502).json({ ok: false, code: 'tts_empty', error: '朗读服务没有返回音频' });
      if (buffer.length > MAX_PCM_BYTES) return res.status(502).json({ ok: false, code: 'tts_too_large', error: '这段文字太长了，请分段朗读' });
      res.setHeader('Content-Type', 'audio/wav');
      res.setHeader('Content-Length', String(buffer.length + 44));
      res.end(Buffer.concat([wavHeader(buffer.length), buffer]));
    } catch (error) {
      if (res.headersSent || res.writableEnded) return;
      const timedOut = controller.signal.aborted;
      res.status(timedOut ? 504 : 502).json({ ok: false, code: timedOut ? 'tts_timeout' : 'tts_failed', error: timedOut ? '朗读超时，请重试' : '朗读服务暂时不可用', retryable: true });
    } finally { clearTimeout(timer); res.removeListener('close', abort); }
  });
  return router;
}

module.exports = { createDeepSeekTts, wavHeader, speakableText, normalizeVoice, settings, SAMPLE_RATE, MAX_TEXT };
