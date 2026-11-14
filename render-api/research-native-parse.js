'use strict';
// ★ 2026-11-14（用户要求：深入研究附件的官方解析 / 混合增强）
//
// 背景：研究主链路是 callDeepSeek（chat/completions + 推理模型 + 多智能体），
//   而官方 Files API 的 file_id 引用必须配 deepseek-flash，且文档解析结果
//   官方明确不提供下载。若把 input_file 直接挂到每个子 agent 上，会被上游
//   拒绝、还要为每个 agent 重复付一遍输入 token，成本与稳定性都不可控。
//
// 所以这里走「侧车转写」：只对本地解析不足的资料额外跑一次官方版面解析，
//   让 flash 把文档忠实转写成纯文本，再切成 [F:P] 段落追加到 documents。
//   documentsContext() 会自动把它们注入所有 agent 的上下文，于是：
//     · [F1:P1] 引用体系不变（模型仍按文件/段落编号引用，不声称看过全文）
//     · documentFingerprint（基于 name+sha256）不变 → 24h 缓存 key 不变
//     · 多智能体流程、自定义第三方研究模型、checkpoint 断点全部一行不动
//     · 前端零改动：复用研究请求里本就带 dataUrl 的 attachments，不新增上传
//     · 图片不参与：本地 OCR/视觉链路已可用，purposeFor 天然排除图片扩展
//
// 触发条件（只在这些情况，正常读全的文件完全不碰，成本可控）：
//   ① document.status === 'unread'（本地没读出：PPT、扫描件、加密、格式不支持）
//   ② document.truncated === true（本地 14000 字被截断）
// 任何一步失败（未配置密钥、上传 400/413/429/504、转写超时、上游拒绝
//   input_file、用户取消）都静默跳过该文档，研究照常继续，绝不抛错阻断。
//
// 开关：RESEARCH_NATIVE_PARSE_ENABLED=false 可一键关闭（联动 DEEPSEEK_FILES_ENABLED）。
// API Key 只在服务端从 env 读取，永不下放前端。

const { purposeFor, decodeDataUrl, safeFilename } = require('./deepseek-files');

const FILES_URL = 'https://api.deepseek.com/files';
const RESPONSES_URL = 'https://api.deepseek.com/responses';
const FLASH_MODEL = 'deepseek-flash';
const MAX_CANDIDATES = 3;              // 一次研究最多补 3 个文件，控成本与首包延迟
const MAX_TRANSCRIBE_CHARS = 12000;    // 转写文本总上限（≈ 本地 14000 字预算量级）
const MAX_PARAGRAPH_CHARS = 4000;      // 单段上限，与 research-documents 一致
const DEFAULT_TIMEOUT_MS = 90000;      // 单个文件「上传 + 转写」总墙钟上限
const CACHE_LIMIT = 60;                // 进程内转写结果缓存条数（避免缓存命中时重复付费）

const TRANSCRIBE_INSTRUCTION = [
  '你是文档转写员。请把用户上传的这份文档，按原文顺序完整转写为纯文本，供后续逐段对照研究使用。',
  '要求：',
  '1. 保留标题层级、正文段落、表格里的数据、图表/图示中的数据与结论、扫描件上的文字、页码或章节编号。',
  '2. 用空行分隔自然段；表格用「表：…」开头并以制表符或竖线保留行列数据；图表写出「图：」及其中可读到的数据与图注。',
  '3. 只转写，禁止总结、评论、改写、推断，禁止添加原文没有的内容，禁止写开场白或结束语，直接输出正文。',
  '4. 无法识别的部分写 [无法识别]，不要猜测。',
  '5. 不要输出 Markdown 代码块围栏，不要输出 JSON。'
].join('\n');

/** 纯函数：判断某个研究文档是否需要官方补读。便于契约/运行时测试直接调用。 */
function needsEnhance(doc, att) {
  if (!doc || !att) return false;
  if (doc.status !== 'unread' && doc.truncated !== true) return false;
  // 图片守边界：三重排除（mime / dataUrl / 扩展名）。
  const mime = String((att && (att.type || att.mime)) || '').toLowerCase();
  if (mime.indexOf('image/') === 0) return false;
  const dataUrl = String((att && (att.dataUrl || att.data_url)) || '');
  if (/^data:image\//i.test(dataUrl)) return false;
  const name = String(att.name || doc.name || '');
  if (!purposeFor(name)) return false;          // 官方不支持的格式（含图片）一律不补
  if (!decodeDataUrl(dataUrl)) return false;     // 没有可上传的原始文件数据
  return true;
}

/** 纯函数：把转写文本切成带连续 P 编号的段落（编号接在已有段落之后）。 */
function paragraphsFromText(text, startIndex) {
  const clean = String(text || '').replace(/\r\n?/g, '\n').trim();
  if (!clean) return { paragraphs: [], truncated: false };
  const rawParts = clean.split(/\n\s*\n|\n/).map(function(s) { return s.trim(); }).filter(Boolean);
  const paragraphs = [];
  let used = 0;
  let truncated = false;
  for (let p = 0; p < rawParts.length; p++) {
    if (used >= MAX_TRANSCRIBE_CHARS) { truncated = true; break; }
    const part = rawParts[p];
    const piece = part.slice(0, Math.min(MAX_PARAGRAPH_CHARS, MAX_TRANSCRIBE_CHARS - used));
    if (piece.length < part.length) truncated = true;
    paragraphs.push({ id: 'P' + (startIndex + paragraphs.length + 1), text: piece });
    used += piece.length;
  }
  return { paragraphs: paragraphs, truncated: truncated };
}

function combinationSignal(external, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(function() { try { ctrl.abort(); } catch (_) {} }, timeoutMs);
  let onAbort = null;
  if (external) {
    if (external.aborted) { try { ctrl.abort(); } catch (_) {} }
    else {
      onAbort = function() { try { ctrl.abort(); } catch (_) {} };
      external.addEventListener('abort', onAbort, { once: true });
    }
  }
  return {
    signal: ctrl.signal,
    clear: function() {
      clearTimeout(timer);
      if (onAbort && external && typeof external.removeEventListener === 'function') {
        try { external.removeEventListener('abort', onAbort); } catch (_) {}
      }
    }
  };
}

function createResearchNativeParse(options) {
  const opts = options || {};
  const env = opts.env || process.env;
  const fetchImpl = typeof opts.fetchImpl === 'function' ? opts.fetchImpl : fetch;
  const timeoutMs = Math.max(1000, Number(opts.timeoutMs) || DEFAULT_TIMEOUT_MS);
  const cache = new Map();

  function apiKey() {
    return String(env.DEEPSEEK_API_KEY || '').trim();
  }
  function enabled() {
    return !!apiKey()
      && String(env.RESEARCH_NATIVE_PARSE_ENABLED || '') !== 'false'
      && String(env.DEEPSEEK_FILES_ENABLED || '') !== 'false';
  }

  async function uploadOne(att, externalSignal) {
    const filename = safeFilename(att.name);
    const pick = purposeFor(filename);
    const decoded = decodeDataUrl(att.dataUrl || att.data_url);
    if (!pick || !decoded) return '';
    // 官方硬性要求：purpose 字段必须排在 file 之前，顺序错了直接 400。
    const form = new FormData();
    form.append('purpose', pick.purpose);
    form.append('file', new Blob([decoded.buffer], { type: decoded.mime || 'application/octet-stream' }), filename);
    const combo = combinationSignal(externalSignal, timeoutMs);
    try {
      const resp = await fetchImpl(FILES_URL, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + apiKey() },
        body: form,
        signal: combo.signal
      });
      const payload = await resp.json().catch(function() { return null; });
      if (!resp.ok) return '';
      const id = payload && payload.id ? String(payload.id) : '';
      return /^file-api-[A-Za-z0-9_-]+$/.test(id) ? id : '';
    } catch (_) {
      return '';
    } finally {
      combo.clear();
    }
  }

  async function transcribeOne(fileId, externalSignal, retryWithoutMaxTokens) {
    const body = {
      model: FLASH_MODEL,
      input: [{
        type: 'message',
        role: 'user',
        content: [
          { type: 'input_text', text: TRANSCRIBE_INSTRUCTION },
          { type: 'input_file', file_id: fileId }
        ]
      }],
      stream: false,
      reasoning: { effort: 'none' }
    };
    if (!retryWithoutMaxTokens) body.max_output_tokens = 6000;
    const combo = combinationSignal(externalSignal, timeoutMs);
    try {
      const resp = await fetchImpl(RESPONSES_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey() },
        body: JSON.stringify(body),
        signal: combo.signal
      });
      if (!resp.ok) {
        // 部分上游版本不认 max_output_tokens；去掉该字段再试一次，仍失败就静默放弃。
        if (resp.status === 400 && !retryWithoutMaxTokens) return transcribeOne(fileId, externalSignal, true);
        return '';
      }
      const data = await resp.json().catch(function() { return null; });
      let text = '';
      if (data && Array.isArray(data.output)) {
        for (let oi = 0; oi < data.output.length; oi++) {
          const item = data.output[oi];
          if (!item || item.type !== 'message' || item.role !== 'assistant' || !Array.isArray(item.content)) continue;
          for (let ci = 0; ci < item.content.length; ci++) {
            const part = item.content[ci];
            if (part && part.type === 'output_text' && typeof part.text === 'string') text += part.text;
          }
        }
      }
      if (!text && data && typeof data.output_text === 'string') text = data.output_text;
      return String(text).trim();
    } catch (_) {
      return '';
    } finally {
      combo.clear();
    }
  }

  function applyEnhancement(doc, paragraphs, truncated) {
    doc.paragraphs = (Array.isArray(doc.paragraphs) ? doc.paragraphs : []).concat(paragraphs);
    doc.total_paragraphs = doc.paragraphs.length;
    doc.status = 'read';
    if (truncated) doc.truncated = true;
    const note = '已补充官方版面解析（含图表/扫描件文字）；引用仍按 [F:P] 段落编号，不代表看过原文件全部页面';
    doc.limitation = doc.limitation ? String(doc.limitation).slice(0, 180) + '；' + note : note;
    doc.native_parsed = true;
  }

  /**
   * 原地增强 documents；返回 { documents, enhanced, attempted }。
   * 绝不抛错 —— 调用方只需 await，失败时 documents 保持原样。
   */
  async function enhance(documents, attachments, callOpts) {
    const result = { documents: documents, enhanced: 0, attempted: 0 };
    try {
      if (!enabled() || !Array.isArray(documents) || !documents.length || !Array.isArray(attachments)) return result;
      const externalSignal = callOpts && callOpts.signal;
      const keyPrefix = String((callOpts && callOpts.cacheKey) || '');
      const onEnhanced = typeof (callOpts && callOpts.onEnhanced) === 'function' ? callOpts.onEnhanced : null;
      let attempted = 0;
      for (let i = 0; i < documents.length && attempted < MAX_CANDIDATES; i++) {
        const doc = documents[i];
        const att = attachments[i] || {};
        if (!needsEnhance(doc, att)) continue;
        if (externalSignal && externalSignal.aborted) break;
        attempted++;
        result.attempted = attempted;
        const cacheKey = keyPrefix + '|' + String(doc.sha256 || '') + '|' + String(doc.name || '');
        let paragraphs = null;
        let truncated = false;
        if (cache.has(cacheKey)) {
          const hit = cache.get(cacheKey);
          paragraphs = hit.paragraphs;
          truncated = hit.truncated;
        } else {
          // 附件若已带合法 file_id（聊天侧先上传过），直接复用，不再上传、不再计费。
          const presetId = /^file-api-[A-Za-z0-9_-]+$/.test(String(att.file_id || '')) ? String(att.file_id) : '';
          const fileId = presetId || await uploadOne(att, externalSignal);
          if (!fileId) continue;
          const text = await transcribeOne(fileId, externalSignal, false);
          if (!text) continue;
          const built = paragraphsFromText(text, Array.isArray(doc.paragraphs) ? doc.paragraphs.length : 0);
          if (!built.paragraphs.length) continue;
          paragraphs = built.paragraphs;
          truncated = built.truncated;
          if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value);
          cache.set(cacheKey, { paragraphs: paragraphs, truncated: truncated });
        }
        if (!paragraphs || !paragraphs.length) continue;
        applyEnhancement(doc, paragraphs, truncated);
        result.enhanced++;
        if (onEnhanced) { try { onEnhanced(doc); } catch (_) {} }
      }
    } catch (_) {
      // 兜底：任何意外都不影响研究主链路
    }
    return result;
  }

  return { enhance: enhance, enabled: enabled, cache: cache };
}

module.exports = {
  createResearchNativeParse: createResearchNativeParse,
  needsEnhance: needsEnhance,
  paragraphsFromText: paragraphsFromText,
  TRANSCRIBE_INSTRUCTION: TRANSCRIBE_INSTRUCTION,
  FILES_URL: FILES_URL,
  RESPONSES_URL: RESPONSES_URL,
  FLASH_MODEL: FLASH_MODEL,
  MAX_CANDIDATES: MAX_CANDIDATES,
  MAX_TRANSCRIBE_CHARS: MAX_TRANSCRIBE_CHARS,
  MAX_PARAGRAPH_CHARS: MAX_PARAGRAPH_CHARS
};
