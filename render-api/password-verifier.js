'use strict';
// 旧口令哈希的「加固封装」。
//
// 早期浏览器端注册留下的口令校验值是无盐 SHA-256：SHA-256(密码) 或 SHA-256(用户名:密码)。
// 服务端一直只能在用户下次成功登录时把它升级成 scrypt——从不登录的账号永远停留在无盐 SHA-256，
// 数据库一旦泄露，这些值可以用彩虹表/显卡秒破。我们不知道明文密码，没法直接重算 scrypt，
// 但可以把「已有的 SHA-256 十六进制串」本身当作输入再套一层加盐的 scrypt（经典的哈希升级做法）：
//     包装值 = scrypt(旧 SHA-256 十六进制串, 随机盐)
// 登录时用同样的方式算出候选的 SHA-256（两种写法各试一次），再过一遍 scrypt 比对。
// 攻击者拿到包装值后要破解，就得对每个候选密码跑一次 scrypt，成本与正常 scrypt 口令一样。
// 格式：scrypt:v1w:<N>:<r>:<p>:<盐>:<密钥>（注意不是 scrypt:v1: 开头，旧代码不会把它当成普通 scrypt 校验值）。
// 用户下次成功登录时，server.js 会照旧把它升级成标准 scrypt 校验值（scrypt(真实密码)）。
const crypto = require('node:crypto');

const WRAP_PREFIX = 'scrypt:v1w:';
const RAW_SHA256 = /^[a-f0-9]{64}$/i;
const WRAP_N = 32768, WRAP_R = 4, WRAP_P = 1;

function scryptAsync(secret, salt, N, r, p) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(String(secret), salt, 32, { N, r, p }, (error, key) => error ? reject(error) : resolve(key));
  });
}
function safeEqual(left, right) {
  const a = Buffer.from(String(left || '')), b = Buffer.from(String(right || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function sha256Hex(text) { return crypto.createHash('sha256').update(String(text)).digest('hex'); }

function isRawLegacyVerifier(value) { return typeof value === 'string' && RAW_SHA256.test(value); }
function isWrappedLegacyVerifier(value) { return typeof value === 'string' && value.indexOf(WRAP_PREFIX) === 0; }

async function wrapLegacyVerifier(rawHex, options) {
  if (!isRawLegacyVerifier(rawHex)) throw new Error('not_a_raw_sha256_verifier');
  const opts = options || {};
  const salt = opts.salt || crypto.randomBytes(16).toString('base64url');
  const key = await scryptAsync(rawHex.toLowerCase(), salt, WRAP_N, WRAP_R, WRAP_P);
  return WRAP_PREFIX + WRAP_N + ':' + WRAP_R + ':' + WRAP_P + ':' + salt + ':' + key.toString('base64url');
}

function parseWrapped(value) {
  const fields = String(value || '').split(':');
  // [scrypt, v1w, N, r, p, salt, key]
  if (fields.length !== 7 || fields[0] !== 'scrypt' || fields[1] !== 'v1w' || !fields[5] || !fields[6]) return null;
  const N = Number(fields[2]), r = Number(fields[3]), p = Number(fields[4]);
  if (!Number.isInteger(N) || N < 16384 || N > 1048576 || (N & (N - 1)) !== 0) return null;
  if (!Number.isInteger(r) || r < 1 || r > 32 || !Number.isInteger(p) || p < 1 || p > 8) return null;
  return { N, r, p, salt: fields[5], key: fields[6] };
}

// 校验包装值：旧值可能是 SHA-256(密码) 也可能是 SHA-256(用户名:密码)，两种候选都算，结果合并（不因先匹配上而提前返回）。
async function verifyWrappedLegacy(value, password, userName) {
  const parsed = parseWrapped(value);
  if (!parsed) return false;
  const candidates = [sha256Hex(password), sha256Hex(String(userName) + ':' + String(password))];
  let matched = false;
  for (const candidate of candidates) {
    const key = await scryptAsync(candidate, parsed.salt, parsed.N, parsed.r, parsed.p);
    if (safeEqual(parsed.key, key.toString('base64url'))) matched = true;
  }
  return matched;
}

module.exports = { WRAP_PREFIX, isRawLegacyVerifier, isWrappedLegacyVerifier, wrapLegacyVerifier, verifyWrappedLegacy };
