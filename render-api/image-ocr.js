'use strict';

/**
 * Image → text channel for Cat AI.
 * DeepSeek chat APIs do not yet expose multimodal vision for this product path,
 * so we use OCR (OCR.space) as the understanding channel. Text is injected into
 * the model context; the UI can show an image_ocr result card.
 *
 * Env:
 *   OCR_SPACE_API_KEY  optional free key from https://ocr.space/ocrapi
 *                      falls back to demo key (rate-limited)
 */

var https = require('https');

var OCR_MAX_INPUT_BYTES = 4 * 1024 * 1024;
var OCR_TIMEOUT_MS = 20000;
var OCR_TEXT_MAX = 8000;

/**
 * OCR 常把中文竖排/识别噪点拆成「一字一行」。合并单字行，避免前端卡版式崩坏。
 */
function normalizeOcrText(raw) {
  var text = String(raw || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (!text.trim()) return '';
  var lines = text.split('\n');
  var out = [];
  var singleRun = [];
  function flushSingles() {
    if (!singleRun.length) return;
    // 连续单字行拼成一行（保留合理换行）
    out.push(singleRun.join(''));
    singleRun = [];
  }
  for (var i = 0; i < lines.length; i++) {
    var line = String(lines[i] || '').replace(/[ \t]+/g, ' ').trim();
    if (!line) {
      flushSingles();
      if (out.length && out[out.length - 1] !== '') out.push('');
      continue;
    }
    // 单字或极短（含标点）→ 视为竖排碎片
    if (line.length <= 2 && !/[a-zA-Z0-9]{2,}/.test(line)) {
      singleRun.push(line);
      continue;
    }
    flushSingles();
    out.push(line);
  }
  flushSingles();
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function httpsFormPost(hostname, pathName, formFields, timeoutMs) {
  return new Promise(function(resolve, reject) {
    var boundary = '----xtjocr' + Date.now().toString(16) + Math.random().toString(16).slice(2);
    var parts = [];
    Object.keys(formFields).forEach(function(key) {
      var value = formFields[key];
      parts.push(
        '--' + boundary + '\r\n' +
        'Content-Disposition: form-data; name="' + key + '"\r\n\r\n' +
        String(value) + '\r\n'
      );
    });
    parts.push('--' + boundary + '--\r\n');
    var body = Buffer.from(parts.join(''), 'utf8');

    var req = https.request({
      protocol: 'https:',
      hostname: hostname,
      port: 443,
      path: pathName,
      method: 'POST',
      headers: {
        'Content-Type': 'multipart/form-data; boundary=' + boundary,
        'Content-Length': body.length,
        Accept: 'application/json'
      },
      rejectUnauthorized: true
    }, function(res) {
      var chunks = [];
      var total = 0;
      res.on('data', function(chunk) {
        total += chunk.length;
        if (total > 2 * 1024 * 1024) {
          req.destroy();
          reject(new Error('OCR 响应过大'));
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', function() {
        var raw = Buffer.concat(chunks).toString('utf8');
        resolve({ status: res.statusCode || 0, body: raw });
      });
      res.on('error', reject);
    });
    req.setTimeout(timeoutMs || OCR_TIMEOUT_MS, function() {
      req.destroy(new Error('OCR 请求超时'));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/**
 * @param {Buffer} buffer
 * @param {string} mimeType
 * @param {string} [fileName]
 * @param {{ sharp?: function }} [deps]
 * @returns {Promise<{ text: string, provider: string, error?: string, chars: number }>}
 */
async function ocrImageBuffer(buffer, mimeType, fileName, deps) {
  deps = deps || {};
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    return { text: '', provider: 'none', error: '空图片', chars: 0 };
  }
  if (buffer.length > OCR_MAX_INPUT_BYTES) {
    return { text: '', provider: 'none', error: '图片超过 4MB，无法 OCR', chars: 0 };
  }

  var mime = String(mimeType || 'image/jpeg').split(';')[0].toLowerCase();
  if (mime.indexOf('image/') !== 0) {
    return { text: '', provider: 'none', error: '非图片类型', chars: 0 };
  }

  var workBuf = buffer;
  // Shrink large photos to keep OCR latency/payload reasonable (sharp is already a dep).
  try {
    var sharpLib = deps.sharp;
    if (!sharpLib) {
      try { sharpLib = require('sharp'); } catch (_) { sharpLib = null; }
    }
    if (sharpLib && buffer.length > 400 * 1024) {
      // 审计 🟢：pipeline 完成后显式 destroy()，避免 libvips 句柄/内存滞留 GC
      var shrinkImage = sharpLib(buffer);
      try {
        workBuf = await shrinkImage
          .rotate()
          .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 82 })
          .toBuffer();
        mime = 'image/jpeg';
      } finally {
        try { shrinkImage.destroy(); } catch (_) {}
      }
    }
  } catch (e) {
    workBuf = buffer;
  }

  var dataUrl = 'data:' + mime + ';base64,' + workBuf.toString('base64');
  var apiKey = String(process.env.OCR_SPACE_API_KEY || process.env.OCRSPACE_API_KEY || '').trim();
  // 生产禁止使用共享演示 key helloworld；未配置则直接禁用 OCR
  if (!apiKey || apiKey === 'helloworld') {
    return {
      text: '',
      provider: 'ocr.space',
      error: 'OCR 未配置（请设置 OCR_SPACE_API_KEY）',
      chars: 0
    };
  }

  try {
    var resp = await httpsFormPost('api.ocr.space', '/parse/image', {
      apikey: apiKey,
      language: 'chs',
      isOverlayRequired: 'false',
      OCREngine: '2',
      scale: 'true',
      detectOrientation: 'true',
      base64Image: dataUrl
    }, OCR_TIMEOUT_MS);

    if (!resp || resp.status < 200 || resp.status >= 300) {
      return {
        text: '',
        provider: 'ocr.space',
        error: 'OCR 服务 HTTP ' + (resp && resp.status || 0),
        chars: 0
      };
    }

    var data;
    try { data = JSON.parse(resp.body); } catch (_) {
      return { text: '', provider: 'ocr.space', error: 'OCR 响应解析失败', chars: 0 };
    }

    if (data && data.IsErroredOnProcessing) {
      var errMsg = Array.isArray(data.ErrorMessage) ? data.ErrorMessage.join('; ') : (data.ErrorMessage || data.ErrorDetails || 'OCR 处理失败');
      return { text: '', provider: 'ocr.space', error: String(errMsg).slice(0, 200), chars: 0 };
    }

    var parts = [];
    var results = (data && data.ParsedResults) || [];
    for (var i = 0; i < results.length; i++) {
      var t = results[i] && results[i].ParsedText;
      if (t && String(t).trim()) parts.push(String(t).trim());
    }
    var text = normalizeOcrText(parts.join('\n')).slice(0, OCR_TEXT_MAX);
    if (!text) {
      return {
        text: '',
        provider: 'ocr.space',
        error: '未识别到文字（可能是纯风景图或手写体过潦草）',
        chars: 0,
        file_name: fileName || ''
      };
    }
    return {
      text: text,
      provider: 'ocr.space',
      chars: text.length,
      file_name: fileName || '',
      engine: 'OCREngine2'
    };
  } catch (e) {
    return {
      text: '',
      provider: 'ocr.space',
      error: (e && e.message) || 'OCR 请求失败',
      chars: 0
    };
  }
}

module.exports = {
  ocrImageBuffer: ocrImageBuffer,
  normalizeOcrText: normalizeOcrText,
  OCR_MAX_INPUT_BYTES: OCR_MAX_INPUT_BYTES
};
