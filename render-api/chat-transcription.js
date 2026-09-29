'use strict';
const crypto = require('node:crypto');
const { dmStorageBucket } = require('./dm-media');

function createChatTranscription({ supabase, publishChatEvent, env = process.env, fetchImpl = fetch }) {
  const key = env.CHAT_TRANSCRIPTION_API_KEY;
  const endpoint = env.CHAT_TRANSCRIPTION_URL || 'https://api.openai.com/v1/audio/transcriptions';
  const enabled = !!key && /^https:\/\//.test(endpoint);
  let busy = false;
  async function result(query) {
    const r = await query;
    if (!r || r.error) throw new Error('database_error');
    return r.data;
  }
  async function enqueue(messageId) {
    if (!enabled) return { status: 'unavailable' };
    const job = await result(supabase.from('chat_transcription_jobs').select('status,transcript').eq('message_id', messageId).maybeSingle());
    if (job && job.status !== 'failed') return job;
    // Ignore duplicate inserts; concurrent requests cannot reset a running lease.
    if (!job) await result(supabase.from('chat_transcription_jobs').upsert({ message_id: messageId }, { onConflict: 'message_id', ignoreDuplicates: true }));
    else await result(supabase.from('chat_transcription_jobs').update({ status: 'queued', attempts: 0, available_at: new Date().toISOString(), last_error: null }).eq('message_id', messageId).eq('status', 'failed'));
    void tick();
    return { status: 'queued' };
  }
  async function processJob(job) {
    const message = await result(supabase.from('chat_messages').select('legacy_post_id,message_type,withdrawn_at').eq('id', job.message_id).maybeSingle());
    if (!message || message.withdrawn_at || message.message_type !== 'audio') throw new Error('message_unavailable');
    const post = await result(supabase.from('posts').select('id,content,user_name,media_url').eq('id', message.legacy_post_id).eq('media_type', '__dm__').maybeSingle());
    if (!post) throw new Error('message_unavailable');
    const registry = await result(supabase.from('dm_media_uploads').select('storage_path,mime_type,size_bytes').eq('message_id', post.id).eq('kind', 'audio').eq('status', 'attached').maybeSingle());
    if (!registry || registry.size_bytes > 24 * 1024 * 1024) throw new Error('audio_unavailable');
    // Never fetch a URL supplied by the message/client. Download only its registry object.
    const blob = await result(supabase.storage.from(dmStorageBucket(registry.storage_path)).download(registry.storage_path));
    if (!blob || !blob.size || blob.size > 24 * 1024 * 1024) throw new Error('audio_unavailable');
    const form = new FormData();
    form.append('model', env.CHAT_TRANSCRIPTION_MODEL || 'whisper-1');
    const ext = /webm/.test(registry.mime_type) ? 'webm' : /ogg/.test(registry.mime_type) ? 'ogg' : /wav/.test(registry.mime_type) ? 'wav' : /mpeg/.test(registry.mime_type) ? 'mp3' : 'm4a';
    form.append('file', blob, 'voice.' + ext); form.append('response_format', 'json');
    const response = await fetchImpl(endpoint, { method: 'POST', headers: { Authorization: 'Bearer ' + key }, body: form, signal: AbortSignal.timeout(90000) });
    if (!response.ok) throw new Error('provider_error');
    const output = await response.json();
    const transcript = String(output.text || '').replace(/\0/g, '').trim().slice(0, 5000);
    if (!transcript) throw new Error('empty_transcript');
    // Re-read after the remote request: withdrawal/read receipts may have changed.
    for (let attempt = 0; attempt < 3; attempt++) {
      const current = await result(supabase.from('posts').select('content').eq('id', post.id).eq('media_type', '__dm__').maybeSingle());
      if (!current) throw new Error('message_unavailable');
      const next = JSON.parse(current.content);
      if (next.withdrawn) throw new Error('message_unavailable');
      next.transcript = transcript;
      const updated = await result(supabase.from('posts').update({ content: JSON.stringify(next) }).eq('id', post.id).eq('content', current.content).select('id').maybeSingle());
      if (updated) {
        await result(supabase.from('chat_transcription_jobs').update({ status: 'completed', transcript, lease_until: null }).eq('message_id', job.message_id).eq('lease_token', job.lease_token));
        if (publishChatEvent) {
          publishChatEvent(post.user_name, 'chat-state', { kind: 'transcript', peer: post.media_url, message_id: job.message_id });
          publishChatEvent(post.media_url, 'chat-state', { kind: 'transcript', peer: post.user_name, message_id: job.message_id });
        }
        return;
      }
    }
    throw new Error('write_conflict');
  }
  async function tick() {
    if (!enabled || busy) return;
    busy = true;
    try {
      const jobs = await result(supabase.rpc('chat_claim_transcription', { p_token: crypto.randomUUID() }));
      const job = jobs && jobs[0];
      if (!job) return;
      try { await processJob(job); }
      catch (error) {
        await result(supabase.from('chat_transcription_jobs').update({ status: job.attempts >= 3 ? 'failed' : 'queued', available_at: new Date(Date.now() + 30000 * job.attempts).toISOString(), lease_until: null, last_error: error.message }).eq('message_id', job.message_id).eq('lease_token', job.lease_token));
      }
    } catch (_) { console.error('[chat-transcription] worker unavailable'); }
    finally { busy = false; }
  }
  const timer = enabled ? setInterval(tick, 10000) : null;
  if (timer) timer.unref();
  return { enabled, enqueue, tick, processJob, stop() { if (timer) clearInterval(timer); } };
}
module.exports = { createChatTranscription };
