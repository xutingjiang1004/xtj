'use strict';
// 服务端语音转文字：未配置时明确告知（浏览器退回本机识别），配置后把录音转给上游并清洗结果。
const test = require('node:test'), assert = require('node:assert/strict');
const http = require('node:http'), fs = require('node:fs'), path = require('node:path');
const express = require('express');
const { createVoiceTranscribe, cleanTranscript, describeConfig, settings } = require('../render-api/voice-transcribe');

async function start(env, upstream) {
  const calls = [];
  const app = express();
  app.use('/api/agent/transcribe', createVoiceTranscribe({ express, env, timeoutMs: 400,
    authenticateUser: (req, res, next) => { if (req.headers['x-user']) { req.userName = req.headers['x-user']; next(); } else res.status(401).json({ ok: false }); },
    rateLimit: () => (req, res, next) => next(),
    fetchImpl: async (url, init) => { calls.push({ url, init }); return upstream(url, init); } }));
  const server = http.createServer(app); await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port + '/api/agent/transcribe';
  return { base, calls, close: () => new Promise(r => server.close(r)) };
}
const audio = { method: 'POST', headers: { 'x-user': 'alice', 'content-type': 'audio/webm;codecs=opus' }, body: Buffer.from('fake-webm-bytes') };

test('settings: off without a key, Groq large model by default, own variables win over the chat ones', () => {
  assert.equal(settings({}).enabled, false);
  assert.deepEqual(settings({ VOICE_TRANSCRIPTION_API_KEY: 'k' }), { key: 'k', url: 'https://api.groq.com/openai/v1/audio/transcriptions', model: 'whisper-large-v3-turbo', enabled: true });
  const legacy = settings({ CHAT_TRANSCRIPTION_API_KEY: 'c', CHAT_TRANSCRIPTION_URL: 'https://example.test/v1/audio/transcriptions', CHAT_TRANSCRIPTION_MODEL: 'm' });
  assert.equal(legacy.url, 'https://example.test/v1/audio/transcriptions'); assert.equal(legacy.model, 'm');
  assert.equal(settings({ VOICE_TRANSCRIPTION_API_KEY: 'k', CHAT_TRANSCRIPTION_URL: 'https://example.test/x' }).url, 'https://api.groq.com/openai/v1/audio/transcriptions');
  assert.equal(settings({ VOICE_TRANSCRIPTION_API_KEY: 'k', VOICE_TRANSCRIPTION_URL: 'http://insecure.test' }).enabled, false);
  const line = describeConfig({ VOICE_TRANSCRIPTION_API_KEY: 'super-secret-value' });
  assert.match(line, /^\[VOICE-CONFIG\] key=set host=api\.groq\.com model=whisper-large-v3-turbo enabled=true$/);
  assert.ok(!line.includes('super-secret-value'));
});

test('unconfigured: status says unavailable and uploads get a clear 503 without calling anything', async t => {
  const s = await start({}, () => { throw new Error('must not be called'); }); t.after(s.close);
  assert.deepEqual(await (await fetch(s.base + '/status', { headers: { 'x-user': 'alice' } })).json(), { ok: true, available: false });
  const r = await fetch(s.base, audio);
  assert.equal(r.status, 503); assert.equal((await r.json()).code, 'transcription_unconfigured');
  assert.equal(s.calls.length, 0);
  assert.equal((await fetch(s.base + '/status')).status, 401);
});

test('configured: the recording is forwarded once with the model, a simplified-Chinese hint and the key, and the text is cleaned', async t => {
  const s = await start({ VOICE_TRANSCRIPTION_API_KEY: 'k-123' }, async () => new Response(JSON.stringify({ text: '  今天学习\n present perfect  ' }), { status: 200 })); t.after(s.close);
  assert.equal((await (await fetch(s.base + '/status', { headers: { 'x-user': 'alice' } })).json()).available, true);
  const r = await fetch(s.base, audio);
  assert.deepEqual(await r.json(), { ok: true, text: '今天学习 present perfect' });
  assert.equal(r.headers.get('cache-control'), 'no-store');
  const call = s.calls[0];
  assert.equal(call.url, 'https://api.groq.com/openai/v1/audio/transcriptions');
  assert.equal(call.init.headers.Authorization, 'Bearer k-123');
  assert.equal(call.init.body.get('model'), 'whisper-large-v3-turbo');
  assert.match(call.init.body.get('prompt'), /简体中文/);
  const file = call.init.body.get('file');
  assert.equal(file.name, 'voice.webm'); assert.equal(file.type, 'audio/webm'); assert.equal(file.size, 15);
});

test('bad input and upstream trouble map to clear, retryable answers', async t => {
  let mode = 'busy';
  const s = await start({ VOICE_TRANSCRIPTION_API_KEY: 'k' }, async (url, init) => {
    if (mode === 'busy') return new Response('{}', { status: 429 });
    if (mode === 'down') return new Response('nope', { status: 500 });
    if (mode === 'hang') return new Promise((resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted'))));
    return new Response('not json', { status: 200 });
  }); t.after(s.close);
  assert.equal((await fetch(s.base, { ...audio, headers: { 'x-user': 'alice', 'content-type': 'text/html' } })).status, 415);
  assert.equal((await (await fetch(s.base, { method: 'POST', headers: { 'x-user': 'alice', 'content-type': 'audio/webm' } })).json()).code, 'empty_audio');
  assert.equal((await fetch(s.base, { ...audio, headers: { 'content-type': 'audio/webm' } })).status, 401);
  let r = await fetch(s.base, audio); assert.equal(r.status, 429); assert.equal((await r.json()).code, 'transcription_busy');
  mode = 'down'; r = await fetch(s.base, audio); assert.equal(r.status, 502); assert.equal((await r.json()).retryable, true);
  mode = 'hang'; r = await fetch(s.base, audio); assert.equal(r.status, 504); assert.equal((await r.json()).code, 'transcription_timeout');
  mode = 'garbage'; r = await fetch(s.base, audio); assert.deepEqual(await r.json(), { ok: true, text: '' });
});

test('transcript cleaning drops control characters, model tags and silence boilerplate', () => {
  assert.equal(cleanTranscript('<|zh|><|NEUTRAL|>你好\u0000 世界'), '你好 世界');
  assert.equal(cleanTranscript('谢谢观看'), '');
  assert.equal(cleanTranscript('字幕由 Amara.org 社群提供'), '');
  assert.equal(cleanTranscript('谢谢观看这部电影之后我想说的话其实还有很多很多很多很多很多'), '谢谢观看这部电影之后我想说的话其实还有很多很多很多很多很多');
  assert.equal(cleanTranscript(null), '');
  assert.equal(cleanTranscript('a'.repeat(6000)).length, 5000);
});

test('the route is mounted behind login and the browser falls back to local recognition', () => {
  const server = fs.readFileSync(path.join(__dirname, '../render-api/server.js'), 'utf8');
  assert.match(server, /app\.use\('\/api\/agent\/transcribe', require\('\.\/voice-transcribe'\)\.createVoiceTranscribe\(\{ express, authenticateUser, rateLimit \}\)\);/);
  const client = fs.readFileSync(path.join(__dirname, '../js/voice-transcription.js'), 'utf8');
  assert.match(client, /var remote = await recognizeOnServer\(job, source\);[\s\S]{0,200}if \(remote !== null\) job\.text = remote;\s*else \{/);
  assert.match(client, /transcription_unconfigured'\) \{ serverSpeech\.available = false;/);
});
