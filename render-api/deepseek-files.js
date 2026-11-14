'use strict';
// 文件解析（小猫AI）：把浏览器上传的 PDF / Word / PPT / 表格 / 电子书 / 纯文本
// 交给 DeepSeek Files API 解析，拿到 file_id；聊天时以 input_file 引用，
// 模型能看到版面、图表与扫描件文字，比本地纯文本抽取强得多。
//
// 设计要点：
//  - API Key 只在服务端，前端永远拿不到；
//  - purpose 字段必须排在 file 之前（官方硬性要求，顺序错了直接 400）；
//  - 图片不走这里：现有视觉链路（内联 image_url + OCR）已经可用，不动它；
//  - 任何失败都返回明确的中文提示，前端静默回落本地解析，聊天不会失败。

const FILES_URL = 'https://api.deepseek.com/files';
const MAX_BYTES = 32 * 1024 * 1024;       // 单文件上限（官方 100MiB，这里控制内存与代理超时）
const BODY_LIMIT = '50mb';                 // base64 约为原始大小的 4/3
const DEFAULT_TIMEOUT_MS = 120000;         // 上传 + 解析，官方解析上限 120s

const LAYOUT_EXTS = new Set(['pdf', 'doc', 'docx', 'ppt', 'pptx']);
const USER_DATA_EXTS = new Set([
  'txt', 'md', 'markdown', 'csv', 'json', 'jsonl', 'xml', 'yaml', 'yml', 'log',
  'js', 'jsx', 'ts', 'tsx', 'py', 'java', 'c', 'cpp', 'h', 'hpp', 'cs', 'go',
  'rs', 'rb', 'php', 'swift', 'kt', 'sql', 'sh', 'css', 'html', 'htm', 'ini',
  'toml', 'tex', 'rtf', 'srt', 'vtt', 'xlsx', 'xls', 'epub', 'mobi'
]);
const DATA_URL_RE = /^data:([^,;\s]+);base64,([A-Za-z0-9+/=\s]+)$/;

function extOf(name) {
  const dot = String(name || '').lastIndexOf('.');
  return dot > 0 ? String(name).slice(dot + 1).toLowerCase() : '';
}

/** 返回 { purpose } 或 null（不支持 / 图片走原视觉链路） */
function purposeFor(name) {
  const ext = extOf(name);
  if (LAYOUT_EXTS.has(ext)) return { purpose: 'rich_layout_recognition' };
  if (USER_DATA_EXTS.has(ext)) return { purpose: 'user_data' };
  return null;
}

/** 文件名只保留安全字符，避免路径穿越与控制字符进入 multipart 头 */
function safeFilename(name) {
  const raw = String(name || 'file').replace(/[\r\n\t]/g, '_');
  const base = raw.split(/[\\/]/).pop() || 'file';
  const cleaned = base.replace(/[^a-zA-Z0-9._\-\u4e00-\u9fa5\u3040-\u30ff]/g, '_').slice(0, 180);
  return cleaned || 'file';
}

function decodeDataUrl(value) {
  const m = DATA_URL_RE.exec(String(value || '').trim());
  if (!m) return null;
  const buf = Buffer.from(m[2].replace(/\s+/g, ''), 'base64');
  if (!buf.length || buf.length > MAX_BYTES) return null;
  return { buffer: buf, mime: m[1] };
}

function settings(env) {
  const key = String((env && env.DEEPSEEK_API_KEY) || '').trim();
  const enabled = !!key && String((env && env.DEEPSEEK_FILES_ENABLED) || '') !== 'false';
  return { key, enabled };
}

function upstreamMessage(status, detail) {
  switch (status) {
    case 400: return '这个文件的格式不支持或已加密，请换一个文件试试';
    case 408: return '文件上传超时，请压缩后重试';
    case 413: return '文件过大（单个最多 32MB）';
    case 429: return '同时解析的文件太多，请稍后再试';
    case 500: return '文件解析结果不完整，请重试或拆分后上传';
    case 503: return '文件解析服务繁忙，请稍后再试';
    case 504: return '文件解析超时，可能页数过多，请拆分后上传';
    default: return '文件解析失败，请稍后重试' + (detail ? '：' + String(detail).slice(0, 120) : '');
  }
}

function createDeepSeekFiles({
  express, guestAiAuth, rateLimit,
  env = process.env, fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS
}) {
  const router = express.Router();

  router.get('/status', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const s = settings(env);
    res.json({ ok: true, available: s.enabled, max_bytes: MAX_BYTES, supported: ['pdf', 'doc', 'docx', 'ppt', 'pptx', 'xlsx', 'xls', 'txt', 'md', 'csv', 'json', 'epub', 'mobi'] });
  });

  // 上传并解析：body = { name, type, data_url }。返回 file_id 供聊天时引用。
  router.post('/upload', guestAiAuth, rateLimit(60000, 12), express.json({ limit: BODY_LIMIT }), async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const s = settings(env);
    if (!s.enabled) return res.status(503).json({ ok: false, code: 'files_unconfigured', error: '文件解析服务未配置' });

    const body = req.body || {};
    const filename = safeFilename(body.name);
    const pick = purposeFor(filename);
    if (!pick) return res.status(400).json({ ok: false, code: 'unsupported_file', error: '这种文件暂不支持在线解析，图片可直接发送' });

    const decoded = decodeDataUrl(body.data_url);
    if (!decoded) return res.status(400).json({ ok: false, code: 'invalid_file_data', error: '文件数据无效或超过 32MB' });

    // ★ 官方要求：purpose 必须在 file 之前，否则返回 400。
    const form = new FormData();
    form.append('purpose', pick.purpose);
    form.append('file', new Blob([decoded.buffer], { type: decoded.mime || 'application/octet-stream' }), filename);

    let resp;
    try {
      resp = await fetchImpl(FILES_URL, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + s.key },
        body: form,
        signal: AbortSignal.timeout(timeoutMs)
      });
    } catch (err) {
      const aborted = err && (err.name === 'TimeoutError' || err.name === 'AbortError');
      return res.status(aborted ? 504 : 502).json({
        ok: false,
        code: aborted ? 'parse_timeout' : 'upstream_unreachable',
        error: aborted ? '文件解析超时，可能页数过多，请拆分后上传' : '无法连接文件解析服务，请稍后重试'
      });
    }

    let payload = null;
    let rawText = '';
    try { rawText = await resp.text(); } catch (_) {}
    try { payload = JSON.parse(rawText); } catch (_) {}

    if (!resp.ok) {
      const detail = payload && payload.error && payload.error.message ? String(payload.error.message) : rawText;
      console.error('[DEEPSEEK-FILES] upload failed', resp.status, String(detail).slice(0, 200));
      return res.status(resp.status >= 400 && resp.status < 600 ? resp.status : 502).json({
        ok: false,
        code: 'file_' + resp.status,
        error: upstreamMessage(resp.status, '')
      });
    }

    const fileId = payload && payload.id ? String(payload.id) : '';
    if (!/^file-api-[A-Za-z0-9_-]+$/.test(fileId)) {
      console.error('[DEEPSEEK-FILES] unexpected upload response', rawText.slice(0, 200));
      return res.status(502).json({ ok: false, code: 'bad_upload_response', error: '文件解析服务返回异常，请稍后重试' });
    }

    return res.json({
      ok: true,
      file_id: fileId,
      purpose: pick.purpose,
      filename,
      bytes: decoded.buffer.length
    });
  });

  // 运维用：删除某个已解析文件。前端不会主动调用（会话历史里的 file_id 需要长期可用）。
  router.delete('/:fileId', guestAiAuth, rateLimit(60000, 10), async (req, res) => {
    const s = settings(env);
    if (!s.enabled) return res.status(503).json({ ok: false, code: 'files_unconfigured', error: '文件解析服务未配置' });
    const fileId = String(req.params.fileId || '');
    if (!/^file-api-[A-Za-z0-9_-]+$/.test(fileId)) return res.status(400).json({ ok: false, error: '文件标识无效' });
    try {
      const resp = await fetchImpl(FILES_URL + '/' + encodeURIComponent(fileId), {
        method: 'DELETE',
        headers: { Authorization: 'Bearer ' + s.key },
        signal: AbortSignal.timeout(15000)
      });
      return res.json({ ok: resp.ok, deleted: resp.ok });
    } catch (_) {
      return res.status(502).json({ ok: false, error: '删除失败，请稍后重试' });
    }
  });

  return router;
}

module.exports = {
  createDeepSeekFiles,
  purposeFor,
  safeFilename,
  decodeDataUrl,
  upstreamMessage,
  FILES_URL,
  MAX_BYTES,
  BODY_LIMIT
};
