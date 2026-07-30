/* Browser-only local Qwen runtime. The model is downloaded by WebLLM on first use
 * and then retained in the browser cache; no prompt or API key leaves the device. */
import * as webllm from '/vendor/webllm/webllm.js';

const MODEL_ID = 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC';
let engine = null;

function send(type, requestId, payload) {
  self.postMessage(Object.assign({ type: type, requestId: requestId }, payload || {}));
}

function cleanMessages(messages) {
  return (Array.isArray(messages) ? messages : []).slice(-8).map(function(message) {
    return {
      role: message && message.role === 'assistant' ? 'assistant' : 'user',
      content: String(message && message.content || '').slice(0, 4000)
    };
  }).filter(function(message) { return message.content.trim(); });
}

async function initialize(requestId) {
  if (engine) {
    send('ready', requestId, { modelId: MODEL_ID });
    return;
  }
  send('status', requestId, { status: 'loading' });
  engine = await webllm.CreateMLCEngine(MODEL_ID, {
    initProgressCallback: function(progress) {
      send('progress', requestId, {
        text: String(progress && progress.text || '正在准备本地模型'),
        progress: Number(progress && progress.progress || 0)
      });
    }
  });
  send('ready', requestId, { modelId: MODEL_ID });
}

self.onmessage = async function(event) {
  const data = event.data || {};
  try {
    if (data.type === 'init') {
      await initialize(data.requestId);
      return;
    }
    if (data.type === 'cancel') {
      if (engine && typeof engine.interruptGenerate === 'function') engine.interruptGenerate();
      return;
    }
    if (data.type !== 'chat') return;
    await initialize(data.requestId);
    const stream = await engine.chat.completions.create({
      messages: cleanMessages(data.messages),
      stream: true,
      temperature: 0.7,
      max_tokens: 512
    });
    for await (const chunk of stream) {
      const delta = chunk && chunk.choices && chunk.choices[0] && chunk.choices[0].delta;
      if (delta && delta.content) send('delta', data.requestId, { content: String(delta.content) });
    }
    send('done', data.requestId);
  } catch (error) {
    engine = null;
    send('error', data.requestId, {
      code: 'LOCAL_AI_RUNTIME_ERROR',
      message: error && error.message ? error.message : '本地模型无法启动'
    });
  }
};
