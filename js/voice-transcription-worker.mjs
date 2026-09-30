// Transformers.js 3.8.1, Apache-2.0; model revision is immutable.
import { pipeline, env } from './vendor/transformers-3.8.1.min.js';
env.allowLocalModels = false;
env.backends.onnx.wasm.numThreads = 1;
env.backends.onnx.wasm.proxy = false;
const runtime = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0-dev.20250409-89f8206ba4/dist/';
env.backends.onnx.wasm.wasmPaths = {
  mjs: runtime + 'ort-wasm-simd-threaded.jsep.mjs',
  wasm: runtime + 'ort-wasm-simd-threaded.jsep.wasm'
};
let recognizer;
let busy = false;
self.onmessage = async ({ data }) => {
  if (busy || data.type !== 'transcribe') return;
  busy = true;
  const id = data.id;
  try {
    if (!recognizer) recognizer = await pipeline('automatic-speech-recognition', 'onnx-community/whisper-tiny', {
      revision: 'ff4177021cc41f7db950912b73ea4fdf7d01d8e7', device: 'wasm', dtype: 'q8',
      progress_callback: event => self.postMessage({ id, type: 'progress', downloading: true,
        progress: Number.isFinite(event.progress) ? Math.round(event.progress) : null })
    });
    self.postMessage({ id, type: 'progress', downloading: false });
    const result = await recognizer(data.audio, {
      language: data.language || 'chinese', task: 'transcribe', chunk_length_s: 30, stride_length_s: 5
    });
    const text = String(result.text || '').trim();
    self.postMessage({ id, type: 'result', text });
  } catch (_) {
    self.postMessage({ id, type: 'error', error: '语音识别暂时失败，请检查网络后重试' });
  } finally { busy = false; }
};
