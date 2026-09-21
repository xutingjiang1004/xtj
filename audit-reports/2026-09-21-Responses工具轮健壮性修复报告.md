# P0 修复报告：Responses 工具轮「思考后调工具突然报 AI 调用失败」

**日期**：2026-09-21
**触发场景**：工作模式 + 思考模式下让 AI 搜索「徐旭泽」，思考完成后进入工具调用，随即 toast「AI 调用失败，请稍后再试」。
**改动文件**：`render-api/server.js`（本次仅后端）、新增 `tests/p0-responses-tool-round-robustness.test.js`

---

## 根因分析

错误文案 `AI 调用失败，请稍后再试` 来自 `/chat/stream` Responses 主调用 catch 的**最末兜底分支**（server.js 约 21848 行）。能落进兜底而没被 timeout/thinking/401/429/HTTP4xx 任何一个分类命中的，只有三类：**HTTP 5xx、fetch 网络异常、无 code 的运行时异常**。

进一步对照 DeepSeek 官方文档（api-docs.deepseek.com/guides/responses_api）发现两个关键事实：

1. **`/responses` 流式不以 `data: [DONE]` 结束**，终止事件为 `response.completed` / `response.incomplete` / `response.failed`；
2. 带工具的多轮请求中，第 2 轮起必须回传 reasoning 项与 function_call/function_call_output 配对项，**格式非法时上游在流内以 `response.failed` 报错（HTTP 仍是 200）**。

而旧代码：

| # | 缺陷 | 后果 |
|---|---|---|
| 1 | **零处理 `response.failed`/`response.incomplete` 事件** | 上游流内失败被当"正常空回复"，真实错误信息被整体吞掉，日志一片空白，用户只看到笼统兜底文案 |
| 2 | `function_call` 只在 `output_item.added` 收集 id，部分实现此时 id 为空，真 id 在 `done` 事件才下发 | 回传空 id 的 function_call / function_call_output，配对断裂 → 上游 400/流内失败 |
| 3 | tools+thinking 被上游 400 拒绝时的降级重试只改 `effort:none`，**不剥离 input 中已回传的 reasoning 项** | 若被拒对象正是 reasoning 项，重试必败 |
| 4 | HTTP 5xx 与网络抖动无任何重试 | Render 出口到 api.deepseek.com 偶发连接重置直接整轮失败 |
| 5 | `_friendly` 分类链没有 5xx / 网络异常 / 流内失败分支 | 三类错误全部落进笼统兜底，诊断黑洞 |

## 修复内容（server.js）

| # | 修复 |
|---|---|
| A | 流式解析新增 `response.failed` 处理：抛出 `code='PROVIDER_STREAM_FAILED'`、携带上游错误原文（providerMessage）的专用错误，上层分类与日志立即精准命中；`response.incomplete` 记录截断原因、内容照常使用 |
| B | 新增 `output_item.done`（type=function_call）归并：按序补全 added 时缺失的 id/arguments |
| C | 回传兜底：fcId 缺失时生成确定性占位 `call_r{round}_{name}_{fi}`，function_call 与 function_call_output 两处同 id，保证配对非空 |
| D | 降级重试增强：effort:none 的同时**剥离 input 中全部 reasoning 项**（宁可少思考不能没工具） |
| E | 新增 fetch 层重试：HTTP 5xx 与网络异常各自动重试一次（900ms 退避，仅每轮一次；AbortError 不重试） |
| F | `_friendly` 分类补充：`PROVIDER_STREAM_FAILED` → 展示上游原因；`HTTP 5xx` → "上游异常，已自动重试仍失败"；`fetch failed/ECONNRESET/ETIMEDOUT/...` → "网络波动" |
| G | SSE error 事件透出 `provider_status` / `provider_message` / `round` 诊断字段（前端 console 可读，下次报错截图即可定位） |

## 验证

- 新增合约测试 `p0-responses-tool-round-robustness.test.js` 6 项，锁定上述全部契约
- 相关套件 77/77 通过；全量 **604 + 99 = 703 用例，0 失败**
- 本次仅改 `render-api/server.js`，前端 / dock 零改动

## 说明

- 修复 B/C 直接消除"思考完 → 调工具 → 突然失败"的最可疑格式错误源；即使上游真实原因另有其他（需线上日志确认），修复 A 也保证**下次复现时错误原文会出现在服务端日志与前端 console**，不再有诊断黑洞。
- 存量会话无需处理；部署后建议直接重试同一问题（搜索徐旭泽）验证。
