/** Pure JSON/time helpers (no I/O). */
'use strict';

function safeJsonParse(input) {
  try {
    const parsed = JSON.parse(input || '{}');
    // 审计 ⚪：旧实现把顶层数组/非对象一律折成 {}——数组语义丢失（[] 被折成 {}），
    // 且无法区分"合法非对象"。现改为：数组/对象原样返回；顶层非对象（string/number/
    // boolean/null）返回 null 由调用方判定。JSON 损坏仍返回 {}（保持防御性兜底，
    // 兼容按对象属性读取的既有调用方）。已核对调用方（server.js 各端点）存储内容
    // 均为对象 JSON，正常路径行为不变。
    if (parsed === null || typeof parsed !== 'object') return null;
    return parsed;
  } catch (_) {
    return {};
  }
}

function toTimeMs(value) {
  if (!value) return NaN;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : NaN;
}

function pickEarlierIso(currentValue, candidateValue) {
  const currentMs = toTimeMs(currentValue);
  const candidateMs = toTimeMs(candidateValue);
  if (!Number.isFinite(candidateMs)) return currentValue || null;
  if (!Number.isFinite(currentMs) || candidateMs < currentMs) return candidateValue;
  return currentValue || null;
}

function pickLaterIso(currentValue, candidateValue) {
  const currentMs = toTimeMs(currentValue);
  const candidateMs = toTimeMs(candidateValue);
  if (!Number.isFinite(candidateMs)) return currentValue || null;
  if (!Number.isFinite(currentMs) || candidateMs > currentMs) return candidateValue;
  return currentValue || null;
}

function getUtcDateKey(value) {
  if (!value) return '';
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const ms = toTimeMs(value);
  if (!Number.isFinite(ms)) {
    return typeof value === 'string' ? value.slice(0, 10) : '';
  }
  return new Date(ms).toISOString().slice(0, 10);
}

module.exports = {
  safeJsonParse: safeJsonParse,
  toTimeMs: toTimeMs,
  pickEarlierIso: pickEarlierIso,
  pickLaterIso: pickLaterIso,
  getUtcDateKey: getUtcDateKey
};
