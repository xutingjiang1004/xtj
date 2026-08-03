/* Browser-only local Qwen runtime. The model is downloaded by WebLLM on first use
 * and then retained in the browser cache; no prompt or API key leaves the device. */
import * as webllm from '/vendor/webllm/index.js';

const MODEL_ID = 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC';
// AMD GCN4 in Chrome exposes WebGPU but not shader-f16.  The q4f32 MLC
// library keeps the same Qwen capability while avoiding the q4f16 shader
// family that can fail at reshape1_kernel during engine initialization.
const COMPATIBILITY_MODEL_ID = 'Qwen2.5-0.5B-Instruct-q4f32_1-MLC';
let engine = null;
let initializing = null;
let activeModelId = MODEL_ID;
let usingCompatibilityModel = false;

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
  if (error && error.code === 'LOCAL_AI_INFERENCE_UNUSABLE') return error.code;
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
  if (code === 'LOCAL_AI_INFERENCE_UNUSABLE') {
    return '本地 Qwen 文件已加载，但此设备的 WebGPU/驱动无法完成实际推理。无需重新下载；请切换到“在线 DeepSeek”或更新浏览器与显卡驱动。';
  }
  if (code === 'LOCAL_AI_WEBGPU_LIMIT_UNSUPPORTED') {
    return '此设备的 WebGPU 存储缓冲区限制不足，本地 Qwen 至少需要 10 个缓冲区。已停止本地初始化，请切换到“在线 DeepSeek”。';
  }
  if (code === 'LOCAL_AI_WEBGPU_SHADER_UNSUPPORTED') {
    return '本地 Qwen 已下载，但当前 WebLLM 运行时与此浏览器的 WebGPU shader 编译路径不兼容。此问题不代表电脑性能不足；请切换到“在线 DeepSeek”。系统升级后的新版运行时可再次尝试，无需重复下载模型。';
  }
  return error && error.message ? error.message : '本地模型无法启动';
}

function preferredModelId() {
  // q4f16 needs the optional shader-f16 capability on the generated MLC
  // kernels. Chrome's AMD GCN4 adapter can support general WebGPU while not
  // exposing that feature, so choose q4f32 before any model download there.
  try {
    if (!self.navigator || !self.navigator.gpu) return MODEL_ID;
    return self.navigator.gpu.requestAdapter().then(function(adapter) {
      if (adapter && adapter.features && !adapter.features.has('shader-f16')) {
        return COMPATIBILITY_MODEL_ID;
      }
      return MODEL_ID;
    }).catch(function() { return MODEL_ID; });
  } catch (_) { return MODEL_ID; }
}

async function verifyInference(requestId) {
  send('status', requestId, { status: 'warming' });
  const chunks = await engine.chat.completions.create({
    messages: [
      { role: 'system', content: 'You are a concise assistant.' },
      { role: 'user', content: 'Reply with OK.' }
    ],
    stream: true,
    temperature: 0,
    max_tokens: 4
  });
  let gotContent = false;
  for await (const chunk of chunks) {
    const delta = chunk && chunk.choices && chunk.choices[0] && chunk.choices[0].delta;
    if (delta && delta.content) gotContent = true;
  }
  if (!gotContent) {
    const error = new Error('WebGPU inference warmup produced no output');
    error.code = 'LOCAL_AI_INFERENCE_UNUSABLE';
    throw error;
  }
  // Current WebLLM exposes resetChat; retain a defensive guard for a custom
  // compatible engine implementation while the output check remains required.
  if (engine && typeof engine.resetChat === 'function') await engine.resetChat();
}

async function initialize(requestId) {
  if (engine) {
    send('ready', requestId, { modelId: activeModelId, compatibilityFallback: usingCompatibilityModel });
    return;
  }
  if (initializing) {
    await initializing;
    send('ready', requestId, { modelId: activeModelId, compatibilityFallback: usingCompatibilityModel });
    return;
  }
  send('status', requestId, { status: 'loading' });
  let sentInitializing = false;
  function createEngine(modelId) {
    return webllm.CreateMLCEngine(modelId, {
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
  }
  // Keep the single-flight lock through the warm-up.  If it were released
  // after CreateMLCEngine, a second caller could receive a false ready event
  // while the first caller is still waiting for its first real token.
  const initializationTask = (async function() {
    try {
      const preferred = preferredModelId();
      const initialModelId = typeof preferred === 'string' ? preferred : await preferred;
      if (initialModelId === COMPATIBILITY_MODEL_ID) {
        send('progress', requestId, {
          text: '检测到当前 WebGPU 不支持 shader-f16，正在使用本地 Qwen 兼容版…',
          progress: 0,
          timeElapsed: 0
        });
      }
      engine = await createEngine(initialModelId);
      activeModelId = initialModelId;
      usingCompatibilityModel = initialModelId === COMPATIBILITY_MODEL_ID;
    } catch (error) {
      if (runtimeErrorCode(error) !== 'LOCAL_AI_WEBGPU_SHADER_UNSUPPORTED') throw error;
      // This is deliberately a single fallback, not a retry loop. It uses a
      // different MLC model library and quantization path, not another attempt
      // to compile the failing q4f16 shader.
      sentInitializing = false;
      send('progress', requestId, {
        text: '检测到 q4f16 WebGPU shader 不兼容，正在切换本地 Qwen 兼容版…',
        progress: 0,
        timeElapsed: 0
      });
      engine = await createEngine(COMPATIBILITY_MODEL_ID);
      activeModelId = COMPATIBILITY_MODEL_ID;
      usingCompatibilityModel = true;
    }
    // Engine creation alone is not enough on some AMD/Chrome paths. Only mark
    // ready after a tiny real prefill/decode succeeds.
    await verifyInference(requestId);
  }());
  initializing = initializationTask;
  try {
    await initializationTask;
    send('ready', requestId, { modelId: activeModelId, compatibilityFallback: usingCompatibilityModel });
  } finally {
    if (initializing === initializationTask) initializing = null;
  }
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
