/* Browser-only local Qwen runtime. The model is downloaded by WebLLM on first use
 * and then retained in the browser cache; no prompt or API key leaves the device. */
import * as webllm from '/vendor/webllm/index.js';

const MODEL_ID = 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC';
let engine = null;
let initializing = null;

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

// WebLLM can reject during device creation even when the adapter probe in the
// page succeeded.  Preserve this as a capability result, not a generic model
// failure, so both AI and Code can stop the download UI and select the online
// provider instead of leaving the user at an unusable error.
function runtimeErrorCode(error) {
  const message = String(error && error.message || error || '');
  if (/maxStorageBuffersPerShaderStage|storage buffers? per shader stage|requested\s*=\s*10.*limit\s*=\s*8/i.test(message)) {
    return 'LOCAL_AI_WEBGPU_LIMIT_UNSUPPORTED';
  }
  if (/Invalid ShaderModule|reshape\d*_kernel|WGSL|While validating compute stage|WebGPU.*validation/i.test(message)) {
    return 'LOCAL_AI_WEBGPU_SHADER_UNSUPPORTED';
  }
  return 'LOCAL_AI_RUNTIME_ERROR';
}

function runtimeErrorMessage(error, code) {
  if (code === 'LOCAL_AI_WEBGPU_LIMIT_UNSUPPORTED') {
    return '此设备的 WebGPU 存储缓冲区限制不足，本地 Qwen 至少需要 10 个缓冲区。已停止本地初始化，请切换到“在线 DeepSeek”。';
  }
  if (code === 'LOCAL_AI_WEBGPU_SHADER_UNSUPPORTED') {
    return '本地 Qwen 已下载，但此设备的 GPU 或驱动无法编译模型所需的 WebGPU shader。重新下载通常无效；请切换到“在线 DeepSeek”，或更新浏览器和显卡驱动后再试。';
  }
  return error && error.message ? error.message : '本地模型无法启动';
}

async function initialize(requestId) {
  if (engine) {
    send('ready', requestId, { modelId: MODEL_ID });
    return;
  }
  if (initializing) {
    await initializing;
    send('ready', requestId, { modelId: MODEL_ID });
    return;
  }
  send('status', requestId, { status: 'loading' });
  let sentInitializing = false;
  initializing = webllm.CreateMLCEngine(MODEL_ID, {
    initProgressCallback: function(progress) {
      const ratio = Number(progress && progress.progress || 0);
      if (!sentInitializing && ratio >= 0.999) {
        sentInitializing = true;
        send('status', requestId, { status: 'initializing' });
      }
      send('progress', requestId, {
        text: String(progress && progress.text || '正在准备本地模型'),
        progress: ratio,
        timeElapsed: Number(progress && progress.timeElapsed) || 0
      });
    }
  });
  // CreateMLCEngine covers both the first-run download and WebGPU setup. Do
  // not announce "initializing" before that promise resolves: doing so made
  // the page replace the long download timeout with a short init timeout.
  engine = await initializing.finally(function() { initializing = null; });
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
    if (data.type === 'ping') {
      self.postMessage({ type: 'pong', requestId: data.requestId, timestamp: Date.now() });
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
    const code = runtimeErrorCode(error);
    send('error', data.requestId, {
      code: code,
      message: runtimeErrorMessage(error, code)
    });
  }
};
