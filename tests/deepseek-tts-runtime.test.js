'use strict';
// DeepSeek 语音合成（朗读）：把裸 PCM 包成 WAV、参数校验、失败时明确回落信号。
const test = require('node:test'), assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const { createDeepSeekTts, wavHeader, speakableText, normalizeVoice, settings } = require('../render-api/deepseek-tts');

async function start(env, upstream) {
  const calls = [];
  const app = express();
  app.use('/api/agent/tts', createDeepSeekTts({ express, env, timeoutMs: 400,
    guestAiAuth: (req, res, next) => next(),
    rateLimit: () => (req, res, next) => next(),
    fetchImpl: async (url, init) => { calls.push({ url, init }); return upstream(url, init); } }));
  const server = http.createServer(app); await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port + '/api/agent/tts';
  return { base, calls, close: () => new Promise(r => server.close(r)) };
}
const post = body => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

test('settings: 只有配置了 DeepSeek 密钥才启用，可用环境变量显式关闭', () => {
  assert.equal(settings({}).enabled, false);
  assert.equal(settings({ DEEPSEEK_API_KEY: 'k' }).enabled, true);
  assert.equal(settings({ DEEPSEEK_API_KEY: 'k', DEEPSEEK_TTS_ENABLED: 'false' }).enabled, false);
});

test('wavHeader: 44 字节标准头，长度与 PCM 一致', () => {
  const pcm = Buffer.alloc(960);
  const head = wavHeader(pcm.length);
  assert.equal(head.length, 44);
  assert.equal(head.toString('ascii', 0, 4), 'RIFF');
  assert.equal(head.readUInt32LE(4), 36 + pcm.length);
  assert.equal(head.toString('ascii', 8, 12), 'WAVE');
  assert.equal(head.readUInt16LE(22), 1);         // 单声道
  assert.equal(head.readUInt32LE(24), 24000);     // 24kHz
  assert.equal(head.readUInt16LE(34), 16);        // 16-bit
  assert.equal(head.toString('ascii', 36, 40), 'data');
  assert.equal(head.readUInt32LE(40), pcm.length);
});

test('speakableText: 去掉代码块、表格与链接地址，只留可读文字', () => {
  const text = speakableText('# 标题\n```js\nconsole.log(1)\n```\n看[这里](https://example.com)和 `code`\n| a | b |\n| - | - |\n**加粗**');
  assert.ok(!text.includes('console.log'));
  assert.ok(!text.includes('https://example.com'));
  assert.ok(!text.includes('|'));
  assert.ok(text.includes('标题'));
  assert.ok(text.includes('这里'));
  assert.ok(text.includes('加粗'));
  assert.ok(!/\s{2,}/.test(text));
  assert.equal(speakableText('字'.repeat(3000)).length, 2000);
});

test('normalizeVoice: 只接受官方音色，其余回落第一个', () => {
  assert.equal(normalizeVoice('tide'), 'tide');
  assert.equal(normalizeVoice('STELLA'), 'stella');
  assert.equal(normalizeVoice('evil'), 'stella');
  assert.equal(normalizeVoice(''), 'stella');
});

test('未配置：status 明确不可用，朗读请求直接 503 且不调上游', async t => {
  const s = await start({}, () => { throw new Error('must not be called'); }); t.after(s.close);
  assert.deepEqual(await (await fetch(s.base + '/status')).json(), { ok: true, available: false, voices: ['stella', 'tide'], sample_rate: 24000 });
  const r = await fetch(s.base, post({ text: '你好' }));
  assert.equal(r.status, 503); assert.equal((await r.json()).code, 'tts_unconfigured');
  assert.equal(s.calls.length, 0);
});

test('成功：按官方参数请求 TTS，并把裸 PCM 包成可播放的 WAV 返回', async t => {
  const pcm = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]);
  const s = await start({ DEEPSEEK_API_KEY: 'k-1' }, async () => new Response(pcm, { status: 200 })); t.after(s.close);
  const r = await fetch(s.base, post({ text: '你好 **世界**', voice: 'tide' }));
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'audio/wav');
  const body = Buffer.from(await r.arrayBuffer());
  assert.equal(body.length, pcm.length + 44);
  assert.equal(body.toString('ascii', 0, 4), 'RIFF');
  assert.deepEqual(body.subarray(44), pcm);
  assert.equal(s.calls.length, 1);
  assert.equal(s.calls[0].url, 'https://api.deepseek.com/v1/tools/tts');
  assert.equal(s.calls[0].init.headers.Authorization, 'Bearer k-1');
  assert.deepEqual(JSON.parse(s.calls[0].init.body), { text: '你好 世界', voice_id: 'tide', format: 'pcm', filter_markdown: true });
});

test('空文本：不请求上游，返回 400', async t => {
  const s = await start({ DEEPSEEK_API_KEY: 'k-1' }, async () => { throw new Error('must not be called'); }); t.after(s.close);
  const r = await fetch(s.base, post({ text: '   ```\ncode\n```  ' }));
  assert.equal(r.status, 400); assert.equal((await r.json()).code, 'empty_text');
  assert.equal(s.calls.length, 0);
});

test('上游失败：429 透传为繁忙，5xx 归为暂时不可用，两者都可重试', async t => {
  const busy = await start({ DEEPSEEK_API_KEY: 'k' }, async () => new Response('busy', { status: 429 })); t.after(busy.close);
  const r1 = await fetch(busy.base, post({ text: '你好' }));
  assert.equal(r1.status, 429); assert.equal((await r1.json()).code, 'tts_busy');

  const down = await start({ DEEPSEEK_API_KEY: 'k' }, async () => new Response('err', { status: 500 })); t.after(down.close);
  const r2 = await fetch(down.base, post({ text: '你好' }));
  assert.equal(r2.status, 502);
  const body2 = await r2.json();
  assert.equal(body2.code, 'tts_failed');
  assert.equal(body2.retryable, true);
});
