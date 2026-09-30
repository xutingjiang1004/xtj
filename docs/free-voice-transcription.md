# 免费本地语音转写

自动转写在浏览器 Worker 内运行 Whisper tiny，不需要 OpenAI 密钥，不自动请求付费转写接口。首次需要联网下载模型与 WASM，浏览器缓存被清理后会重新下载；识别速度取决于设备，短模型的识别准确率有限。界面显示下载、识别和失败重试。新发送语音优先处理，历史消息在打开会话时按队列补识别。

发送者可以保存自己仍可见、未撤回的语音消息转写。接收者只在本地显示结果，不能修改发送者消息。退出、账号切换与页面离开终止 Worker；不缓存私有音频到公共服务器。公开模型下载不包含用户音频。设备内模型缓存不等于保存识别用的私有音频。

固定依赖：

- Transformers.js 3.8.1，自托管 `js/vendor/transformers-3.8.1.min.js`，Apache-2.0 许可随库保存。SHA-256：`aa5002b70e789798da263f5f99c62bd3e8fcd0c119258a493c40c180648365fa`。
- 模型 `onnx-community/whisper-tiny`，固定 revision `ff4177021cc41f7db950912b73ea4fdf7d01d8e7`，q8、单线程 WASM。
- ONNX Runtime Web `1.22.0-dev.20250409-89f8206ba4`，仅允许该固定 CDN dist 路径；Worker 同源，不开放 blob 脚本权限。

维护时同步核对 Worker 的模型版本与 `render-api/security-headers.js` 中 CSP，不能仅通过模拟 Worker 的界面测试判断模型可运行。本轮使用公开 JFK 语音、真实音频解码和生产 CSP 在 Chromium 成功执行实际模型；Linux WebKit 界面检查不代表物理 iPhone 麦克风或双设备验收。
