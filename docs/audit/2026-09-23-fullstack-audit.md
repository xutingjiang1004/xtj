# 小猫AI / xtj 全栈审计报告

> 审计日期：2026-09-23
> 代码版本：`main` @ `c6ee4ec`（侧栏折叠移除后）
> 审计方式：**只读**，未修改任何代码
> 覆盖范围：前端 `js/*.js` 62,514 行 + CSS 32,273 行；后端 `render-api/*.js` 33,544 行（其中 `server.js` 26,596 行）
> 分组：按文件边界并行审计 5 组 —— 前端 AI / 前端核心 / 后端 AI / 后端核心与安全 / Code+深度思考 / 扩展能力调研

---

## 一、执行摘要

**共发现 260+ 条问题**，其中**严重级（S）26 条**。

| 模块 | S 级 | M 级 | # 级 | 小计 |
|---|---|---|---|---|
| 前端 `ai-agent.js` | 7 | 40 | 12 | 59 |
| 前端 `core.js` / `core-parts` | — | — | — | 见附录说明 |
| 后端 `server.js`（AI 部分） | 5 | 27 | 14 | 46 |
| 后端（核心/安全/照片/鉴权） | 4 | 26 | 36 | 66 |
| Code 工作台 | 9 | 11 | 6 | 26 |
| 深度思考（DeepThink） | 5 | 14 | 7 | 26 |
| 扩展能力调研 | — | — | — | 25 个候选工具 |
| **合计** | **30** | **118** | **75** | **223 + 25** |

### 最紧急的 6 件事（按危险程度排序）

| 排名 | 问题 | 位置 | 为什么最紧急 |
|---|---|---|---|
| 1 | **Code 工作台 AI 多文件一键直推、无 diff 确认** | `code-workbench.js:2734` | 一次点击把 AI 内容写进多个文件；非默认分支出**连确认框都没有**。配合 prompt injection 形成完整攻击链 |
| 2 | **AI 输出路径零校验，可写 `.github/workflows/*`** | `code-workbench.js:2801` | 可往仓库塞 CI 配置 → 执行任意代码 → 偷 secret |
| 3 | **管理员用户名默认硬编码 `'xxz'`** | `server.js:169` | 生产漏配环境变量即管理员可预测，且用户名即权限、无第二因子 |
| 4 | **全局 CSRF 防护有 `X-Requested-With` 绕过面** | `server.js:4422` | 所有写端点（含 admin Cookie 鉴权）的通用旁路 |
| 5 | **`read_document` 裸 fetch 跟随重定向，真实 SSRF** | `server.js:2122` | DNS rebinding + 302 到 `169.254.169.254` 云元数据 |
| 6 | **深度思考「取消」请求从未真正到达服务端** | `ai-agent.js:4407` + `server.js:20143` | UI 显示已取消，服务端继续烧 token 和搜索额度 |

### 一个重大认知纠正（影响你的迁移计划）

> **DeepSeek 官方 API 目前明确忽略内置 `web_search`。**
>
> 官方文档 Tools 表原文：`web_search` / `file_search` / `code_interpreter` / `computer_use` / `mcp` / other built-in tools → **Ignored**
> 来源：https://api-docs.deepseek.com/zh-cn/guides/responses_api/#tools
>
> 你在 `server.js:1498-1504` 和 `8915-8916` 写的注释**完全属实**。所以：
> - 「迁移到 `/responses` 就能启用内置搜索、干掉 Tavily」**这条路目前走不通**
> - `search_web` 六层降级链 + Tavily **必须保留**
> - 但迁移到 Responses API **仍有价值**（见 §六），且**发现了一个可以立刻修的能力损失**：Responses 现在支持图片输入，而代码把图片降级成了字符串

---

## 二、安全漏洞专项（优先处理）

### S 级清单

| 编号 | 标题 | 位置 | 影响 | 修复要点 |
|---|---|---|---|---|
| SEC-1 | 管理员用户名硬编码 `'xxz'` | `server.js:169-175` | 生产漏配 env → 管理员可预测；`requireAdminUser` 仅比对用户名 | 生产环境缺 `ADMIN_USERNAME`/`ADMIN_PASSWORD` 直接 `process.exit(1)`（照抄 `API_SECRET` 的做法） |
| SEC-2 | CSRF `X-Requested-With` 绕过 | `server.js:4422-4425` | 无 Origin 的跨站写请求可通行；`isAllowedWebOrigin` 对空 Origin 返回 `true` 是根因 | 拆成 `isCorsOriginAllowed()` / `isTrustedRequestOrigin()`；空 Origin 时必须要求可信 Referer **或** `X-Requested-With` 二者之一 |
| SEC-3 | `read_document` 裸 fetch + `redirect:'follow'` | `server.js:2122` | **真实 SSRF**：TOCTOU DNS rebinding + 302 跳内网/元数据 | 改用已有的 `fetchSafeBuffer`（内置 DNS pin + 拒绝重定向 + 大小上限） |
| SEC-4 | 照片上传路径由客户端指定，`upload_id` 可枚举 | `server.js:12348-12383` | 抢占他人照片路径，public 桶内容可控 | 服务端生成路径，或校验首段 == `sha256(userName).slice(0,12)` |
| SEC-5 | 代理放行 `PATCH git/refs` 且不强制 `force:false` | `server.js:26279,26347` | 可直接把主分支重置到任意 commit，代码丢失 | 服务端强制覆写 `body.force = false`，拒绝 tags |
| SEC-6 | GitHub 代理是通用写中转 | `server.js:26274` | `POST git/trees`/`git/commits` 未收窄，可构造任意 tree | 收敛方法白名单 + 写操作审计日志 |
| SEC-7 | `renderMarkdown` 链接 href 未转义 | `ai-agent.js:1223-1358` | **存储型 XSS**：`new URL()` 保留 `"`，属性边界被打穿 | 链接属性走已有的 `escapeAttr()` |
| SEC-8 | 自定义模型 API Key 明文落 localStorage | `ai-agent.js:10838` | 同源脚本/XSS 可直接读；编辑时回填明文到 DOM | 仅内存持有 + 后端加密存储，前端只读掩码 |
| SEC-9 | Token 经服务端代理，UI 文案称"不上传" | `code-workbench.js:11,739` | 与用户预期不符，token 进入 Node 内存与 `req.body` | 改文案说明真相；更优：前端直连 `api.github.com`（支持 CORS）；至少加 body 脱敏中间件 |
| SEC-10 | 头像上传无 sharp 真实格式校验 | `server.js:25099-25117` | 扩展名由客户端决定，可投放任意字节到 public 桶 | 统一走 `photo-create.js:236` 的 sharp metadata 校验 |

### M 级安全问题（择要）

- **M18**：admin token 与 user token **共用同一 `API_SECRET` 与 HMAC 格式**，`!payload.type` 即判为 admin → 密钥单点。应使用不同密钥域 + 强制枚举 `type`
- **M13**：三份 marker 白名单（`post-query.js:11`、`post-markers.js:43`、`server.js:13870`）漂移仅 `console.error` 告警 → 泄露系统记录进公开 feed。应改为启动期硬失败
- **M11**：照片上传配额（500MB/小时）是**进程内 Map**，重启清零、多实例不共享 → 可通过制造重启绕过
- **M25**：`attackLogDedup` 无容量上限 → IPv6 扫描可灌巨量 key
- **S2(后端AI)**：自定义模型 `base_url` 完全可控 + apiKey 原样发出 → **用户内容外带通道**
- **#8(安全)**：CSP 仍含 `'unsafe-inline'` → 上述任何 XSS 都无兜底

### 明确「未发现」的安全问题（可降低你的焦虑）

审计员逐条核对并确认**没问题**的方向：

| 维度 | 结论 |
|---|---|
| **SQL / 查询注入** | 未发现。`.or()` 经 `pgrstQuote` 正确转义；`.ilike()` 用户输入均转义 `[%_]` |
| **IDOR 越权** | 未发现。帖子/评论/照片/DM 的读改删均有 owner 或 admin 校验 |
| **命令注入** | 未发现。全项目无 `child_process`/`exec`/`spawn` |
| **路径穿越** | 未发现（除 Code 工作台前端侧，见 C-S3）。服务端单次编码 `..` 已被拦 |
| **SVG 存储型 XSS** | 未发现。照片墙/DM/头像均显式拒绝 SVG |
| **错误堆栈泄漏** | 未发现。`sanitizeError` 返回通用文案 |
| **工具注册一致性** | **42 个注册工具 ↔ 35 switch case + 7 site registry 完全一致**，无孤儿 |
| **前端 objectURL 泄漏** | 未发现。构造下载均已 revoke |
| **模型 API Key 泄漏** | 未发现。`DEEPSEEK_API_KEY`/`TAVILY_API_KEY` 仅服务端使用，未进日志/前端 |

---

## 三、前端审计（`js/ai-agent.js` 11,939 行）

### S 级 7 条

| 编号 | 标题 | 行号 | 影响 |
|---|---|---|---|
| FE-S1 | `renderMarkdown` href 属性注入 | 1223-1358 | 存储型 XSS（见 SEC-7） |
| FE-S2 | `stepId` 派生自内容且未过滤 `'`，`querySelector` 抛错 | 8461-8483 | query 含 `:`/`(` 时**整条工具时间线渲染失败**，用户看不到工具执行过程 |
| FE-S3 | 自定义模型 API Key 明文存储 | 10838-11127 | 见 SEC-8 |
| FE-S4 | `S.sending` 在取消竞态下永久锁死 | 7378-7473 | 「发送」按钮点不动，**无任何提示** |
| FE-S5 | 深页「停止」实际不中止请求，且跨通道误伤 | 6668-6686 | 只暂停渲染，SSE 继续烧 token |
| FE-S6 | `S.activeRenderers` 跨通道共享 | 3479, 6674, 11415 | 主聊天和深页互相污染 pause/resume |
| FE-S7 | 研究卡 RAF 循环在页签隐藏时不停止 | 3878-4116 | 后台持续 CPU 与耗电 |

### M 级重点（40 条中筛选高价值）

**SSE 流式解析（最影响体验的一组）**

| 编号 | 问题 | 行号 | 后果 |
|---|---|---|---|
| FE-M1 | `[DONE]` 直接 `break`，丢弃同批剩余事件 | 8260-8265 | 正文与 footer **不渲染** |
| FE-M2 | `line.trim()` + 只认 `data: `（带空格） | 8261, 8265 | 服务端若发 `data:{` → **整条丢弃，表现为「AI 不回复」** |
| FE-M3 | 主聊天**无绝对超时**，仅 idle 看门狗 | 8209-8220 | 服务端持续推 heartbeat → 看门狗永不触发 → 可挂到浏览器断开 |
| FE-M4 | heartbeat 错误地重置 `_receivedAny` | 8209-8249 | 45s 快速失败阈值实际失效 |
| FE-M5 | 深页 45s 硬编码，与主聊天双阈值不一致 | 5522-5532 | 服务端心跳间隔 >45s 必然误判超时 |
| FE-M6 | 三处 SSE buffer 上限常量来源不一致 | 4992, 5729, 8251 | 改一处会失配 |

**内存与监听器泄漏**

| 编号 | 问题 | 行号 |
|---|---|---|
| FE-M12 | `document.addEventListener(pointerdown/keydown, ..., true)` **不在 cleanup 范围** | 10615-10623 |
| FE-M14 | `_selectPopCloseTimer` 未纳入 `_panelCleanup` | 10527-10545 |
| FE-M16 | `__xtjAiCardIds` 只增不减 → 重载历史后**旧卡片被永久去重跳过** | 6790-6793 |
| FE-M22 | `S.messages` 无上限增长 | 7493, 8022, 10293 |
| FE-M24 | 配额轮询在页面隐藏时不停 | 619-669 |

**逻辑缺陷**

| 编号 | 问题 | 行号 |
|---|---|---|
| FE-M8 | `finishThinkCard` 在深页路径下 `detailsEl` 恒 null → **思考过程无法显示** | 5450-5461 |
| FE-M9 | `ensureThinkCardNode` 两份实现 DOM 不同 → 深页**点标题无法折叠** | 5350 vs 6265 |
| FE-M18 | `acceptAiChatFiles` 递归 `next()` 竞态 → 文件**处理两遍** | 11472-11506 |
| FE-M19 | `doCopy` 失败也提示「已复制」→ 假成功 | 1360-1537 |
| FE-M27 | 站点搜索来源顺序敏感 → 调整勾选顺序结果被静默丢弃 | 7269 |

### 「+ 按钮」UI 重构现状

审计发现：**这个重构其实已经基本做完了**。`renderAiRoot`（9666 起）已有 `plusWrap`/`plusBtn`/`panelShell`，面板内含 6 个 `data-action`（upload / upload-folder / open-model / open-think / work-mode / search），并有自绘下拉 `openSelectPopup`。

**剩余收尾项**：

1. `#aiSearchStatus` 的 `tagName === 'SPAN'` 兼容分支是残留 → 删
2. `fileBtn` 保留但 `display:none`（11268）→ 死路径，删
3. **`panelShell` 挂在 `inputBar` 而非 `document.body`** → 被输入栏 `overflow` 裁剪，这是首要决策点
4. `positionPanel` 只处理水平方向；输入框 autoresize 后不重定位
5. `panelAbortController` 在 11244 赋值前**没有 abort 旧的** → 连续调用 `renderAiRoot` 会泄漏

---

## 四、后端审计（`server.js` 26,596 行）

### S 级（AI 部分）

| 编号 | 标题 | 行号 | 影响 |
|---|---|---|---|
| BE-AI-S1 | `/api/agent/image` 无鉴权 + `redirect:'follow'` | 21655 | 匿名可用作出网跳板 |
| BE-AI-S2 | 自定义模型 `base_url` 用户完全控制 | 20702, 21230 | 用户内容外带通道（SSRF 防护本身到位） |
| BE-AI-S3 | `read_document` 裸 fetch | 2122 | **真实 SSRF**（见 SEC-3） |
| BE-AI-S4 | 搜索配额**先扣后调**，失败不回滚 | 1739-1745 | 上游抖动就吃掉用户额度，且与 `searchWebForUser` 口径不一致 |
| BE-AI-S5 | `search_remaining = -1` 被误判超限 | 10678-10693 | **Pro 无限额度用户被错误拒绝搜索** |

### M 级重点

**成本放大（对你最实际）**

| 编号 | 问题 | 行号 | 放大倍数 |
|---|---|---|---|
| BE-AI-M6 | `autoSupplementSearch` 3 路并行，**只扣 1 次配额** | 3499-3505 | 模型调 1 次搜索，平台实付 **4 次** |
| DT-M13 | `max_workers=10` × `max_tool_rounds=10` | 9713, 19901 | 单次深研最坏 **100 次上游调用** |
| CW-M2 | Code 工作台续写 3 轮 + 工具 4 轮，各自独立计费 | `code-workbench.js:2466-2600` | 单条消息最坏 **8 次**上游调用 |
| BE-AI-M2/M3 | `make_file` base64 内联 + 同步阻塞 | 2189, 2211 | 5000 行表格 → 数十 MB 单帧 → 256KB SSE 上限**直接静默切断流** |

**健壮性**

| 编号 | 问题 | 行号 |
|---|---|---|
| BE-AI-M7 | Chat 路径**无 5xx/网络重试**（Responses 路径有） | 7978 |
| BE-AI-M9 | 取消时未 abort 同轮其余工具 → 悬空连接 | 8274-8287 |
| BE-AI-M10 | 工具统一 20s 超时，对 `read_zip`(60s)/`image_process`(45s) **过短** | 7513 |
| BE-AI-M11 | 配额记账 3 次重试失败仅告警，**无补偿队列** | 10618-10631 |
| BE-AI-M12 | `inFlightStreams` 用 `global` 持有，无 TTL、无上限 | 21746 |
| BE-AI-M17 | `buildResponsesInput` **丢弃全部图片** | 1592-1600 |
| BE-AI-M23 | `looksLikeToolArgsFragment` 对正常 JSON 回答误判 | 9468, 8552 |
| BE-AI-M24 | 工具结果 `slice` 截断后 JSON 非法 | 8317-8319 |

**信息泄漏**

| 编号 | 问题 | 行号 |
|---|---|---|
| BE-AI-M14 | 搜索缓存不含 userName，`diagnostics.query` 跨用户可见 | `search-providers.js:388` |
| BE-AI-M27 | `diagnostics` 原样回传，泄漏 `missing_env`/`provider_errors` | 1765, 1810 |

### 后端核心（非 AI）

| 编号 | 标题 | 行号 | 要点 |
|---|---|---|---|
| BE-S1 | CSRF `X-Requested-With` 绕过 | 4422 | 见 SEC-2 |
| BE-S2 | 管理员用户名默认 `'xxz'` | 169 | 见 SEC-1 |
| BE-S3 | 照片路径客户端指定 | 12348 | 见 SEC-4 |
| BE-S4 | 头像无 sharp 校验 | 25099 | 见 SEC-10 |
| BE-M3 | `/api/feed` 评论/点赞 `select('*')` 无 limit | 13932 | 热门帖单次响应可达数 MB |
| BE-M4 | `/api/stats/snapshot` 非管理员仍拿到全站互动时序样本 | 13688 | 社交图谱旁路 |
| BE-M7 | `/api/feed/authors` 硬 `limit(1000)` | 24882 | 老作者永久消失 + 每次扫表 |
| BE-M9 | `processLocationTasks` 多实例**无 CAS** | 16325 | 重复外呼地理编码 API |
| BE-M15 | `/api/dm/messages` 无游标分页 | 14266 | 长会话历史不可达 |
| BE-M23 | 全局 `express.json({limit:'12mb'})` 在鉴权**之前** | 4345 | 未鉴权即可让服务端缓冲 12MB |
| BE-M26 | `/api/photo/status` 循环内串行 `ilike` 全表扫描 | 12493 | 最多 60 次往返 |
| BE-M16 | DM 撤回注释称「管理员10分钟」但**无管理员分支** | 14743 | 文档与实现不符 |

---

## 五、Code 工作台 + 深度思考专项

### Code 工作台 —— 这是全项目风险最高的模块

它在做「让 AI 直接读写你的 GitHub 仓库」，安全模型必须最严。当前有 9 个 S 级：

| 编号 | 标题 | 行号 | 危险程度 |
|---|---|---|---|
| CW-S1 | AI 多文件改动**一键直推**，非默认分支出**无确认框**、无 diff 展示 | 2734-2752 | ★★★★★ |
| CW-S2 | 仓库内容直注入 AI 上下文 → **prompt injection 写入链** | 2195-2283 | ★★★★★ |
| CW-S3 | AI 输出路径**零校验**，可写 `.github/workflows/*` | 2801-2843 | ★★★★★ |
| CW-S4 | Token 经服务端代理，UI 称「不上传」 | 11, 739 | ★★★ |
| CW-S5 | 代理是通用 GitHub 写中转 | `server.js:26274` | ★★★★ |
| CW-S6 | 放行 `PATCH git/refs` 且不强制 `force:false` | `server.js:26279` | ★★★★ |
| CW-S7 | `normalizeGhPath` 双重编码**潜在**绕过（未确认可利用） | `server.js:26294` | ★★ |
| CW-S8 | 图片 base64 直注 `img.src`，无大小预判 | 1454-1500 | ★★ |
| CW-S9 | `currentFileTruncated` 标志残留 → 正常文件**被误拒提交** | 104-127, 2814 | ★ |

**攻击链演示**（审计员还原的真实路径）：

```
仓库里任何文件含恶意指令（第三方 README / 被 PR 引入的文件）
        ↓  C-S2：内容直注入 AI 上下文，无结构性隔离
AI 输出 // path: .github/workflows/deploy.yml  + 恶意 YAML
        ↓  C-S3：路径零校验，applyAiOutput 当新文件接受
        ↓  C-S1：点一次「应用全部」，非默认分支连确认框都不弹
GitHub Actions 执行 → 窃取仓库 secret
```

**Code 工作台明确「未发现」**：无命令注入、无 SSRF（host 固定 `api.github.com`）、token **未落 localStorage**（已改 sessionStorage 且主动清理残留）、`min.js` 未陈旧、无 XSS。

### 深度思考

| 编号 | 标题 | 行号 | 影响 |
|---|---|---|---|
| DT-S1 | 45s idle 阈值与「服务端最长 10 分钟」冲突 | `ai-agent.js:5522` | 代理缓冲时**误判超时掐断研究** |
| DT-S2 | `custom-chat/deep-stream` 与 `/stream` **缺 `X-Accel-Buffering`** | `server.js:21204, 20654` | 自定义模型+思考 Max 通道被反向代理缓冲 → 前端误判中断 |
| DT-S3 | 取消请求 `conversation_id: ''` → 服务端 400 | `ai-agent.js:4407` | **取消从未到达服务端**，UI 却已标已取消 |
| DT-S4 | 研究流未注册 `activeDeepThinkJobs` | `server.js:24527` | `/chat/cancel` 对研究流**完全无效** |
| DT-S5 | `markDeepThinkDisconnected` 早期断开时记账被跳过 | `server.js:19714` | 「断开不免单」目标有缺口 |

**关键契约比对结论**（这是好消息）：

`/api/agent/chat`（deep_think）与 `/research/stream` 的前后端事件名、字段**一一对应**，仅 1 个缺口：`card` 事件（附件 OCR 卡片，`server.js:19798`）前端 **没有处理分支**，被静默丢弃。

---

## 六、DeepSeek /responses 迁移专项

### 核心结论：内置 web_search 不可用，但迁移仍值得做

**已核实的事实**（附官方文档来源）：

| 项 | 状态 | 来源 |
|---|---|---|
| Responses API 是否正式支持 | **是** | https://api-docs.deepseek.com/zh-cn/guides/responses_api/ |
| 内置 `web_search` | **被忽略** | 同上 `#tools` |
| `file_search`/`code_interpreter`/`computer_use`/`mcp` | **均被忽略** | 同上 |
| `custom` tool | 仅支持 `{"type":"custom","name":"apply_patch"}` | 同上 |
| **图片输入** | **支持**（`deepseek-flash`） | 同上 `#image-input` |
| `input_image` 能否出现在 `function_call_output` | **能** — 工具可回传图片给模型看 | 同上 |
| `previous_response_id` / `conversation` / `store` | 不支持（无状态） | 同上 |
| `parallel_tool_calls` | 忽略（**始终开启**） | 同上 |
| `truncation` | 不支持，超上下文返回 400 | 同上 |
| `reasoning.effort` 取值枚举 | **未查证到** | — |

### 迁移决策建议

**应该迁移的理由**：
1. 代码里 `callDeepSeekViaResponses`（8878）**已实现且可用**，是完整路径
2. Responses 路径的 SSE 事件解析（9224-9411）**比 Chat 路径更规范**（`event:`+`data:` 双行）
3. Responses 路径**已有 5xx/网络重试**（9070-9097），Chat 路径没有
4. **图片输入能力**：Responses 支持 `input_image`，但当前代码把它降级成字符串 → 迁移后正好一并修复

**不应该做的事**：
- ❌ 不要因为「想启用内置搜索」而迁移 —— 内置搜索被忽略，迁了也没有
- ❌ 不要下线 Tavily / `search_web` —— 它们是唯一的搜索能力
- ❌ 不要先动 `includeTavily` 裁剪逻辑 —— 前提不成立

**迁移改造点清单**（含行号，供直接施工）：

| 类别 | 位置 | 改动 |
|---|---|---|
| **调用点** | 7457-7459 | 删 `use_responses_api` 开关，直接走 Responses |
| **裸 fetch 遗漏点** ⚠️ | **3621, 8350, 22663, 22980, 23220** | 这 5 处绕过两条主路径，**最易遗漏**，逐一确认 |
| **输入构造** | 1584-1605 `buildResponsesInput` | 修复图片降级；且它**已被弃用**（8900-8911 内联重写），需二选一 |
| **请求体** | 7929-7958 | `messages`→`input`、`max_tokens`→`max_output_tokens`、删 `thinking:{type}` |
| **响应解析** | 8082-8215 | Chat 流式+非流式解析**整体删除** |
| **usage 归一** | 8860 | 统一走 `responsesUsageToInternal` |
| **DSML 解析** | 7646 `parseDsmlToolCalls` | 可整体废弃（Responses 走标准 `function_call`） |
| **前端请求体** | `ai-agent.js:7688-7701` + `7642-7658` | 唯一写入端点，需与后端同步改 |
| **前端 SSE 循环** | `ai-agent.js:8260-9145` | **整个 for 循环需重写** |
| **前端 thinking 映射** | `ai-agent.js:61` | `ALLOWED_THINKING_MODES` 含 `off`，Responses 无对等值，**需要映射层** |
| **前端搜索 UI** | `ai-agent.js:8290-8400` | 4 类搜索事件需重新定义来源 |
| **前端配额 UI** | `ai-agent.js:10469-10480` | `search_used/search_limit` 语义会变 |

**迁移前必须先修（阻塞项）**：
1. `read_document` 裸 fetch（SEC-3）—— 与迁移无关但必须同批修
2. `buildResponsesInput` 图片降级（BE-AI-M17）—— 迁移后有直接感知
3. 工具结果 base64 内联 + 同步阻塞（BE-AI-M2/M3）—— 迁移后工具轮次更密集，会放大
4. **先抽公共 SSE 读取器** `createSseReader({onEvent, idleMs, maxEventSize})` —— 当前前端有**两套独立实现**且已漂移（FE-M5/M6/M7），不抽的话迁移要改两份

---

## 七、可扩展能力：25 个候选工具

### 现有工具清单（实测 42 个）

35 个静态工具（`server.js:836-1393`）+ 7 个站内工具（`AI_SITE_TOOL_REGISTRY`）。

**搜索类**：`search_web`、`tavily_search`、`read_web_page`、`web_extract`、`page_meta`、`extract_links`、`search_social`
**信息类**：`get_weather`、`get_current_time`、`get_exchange_rate`、`get_stock_quote`
**文件类**：`make_file`、`generate_pdf`、`read_document`、`read_zip`、`image_info`、`image_process`、`make_chart`
**计算类**：`calculate`、`convert_units`、`date_calc`、`batch_calc`、`text_stats`、`sort_filter`
**开发类**：`run_code`、`process_json`、`encode_decode`、`diff_text`、`regex_test`、`url_parse`、`convert_data`、`qr_code`、`password_tool`、`markdown_table`
**编排**：`task_plan`
**站内**：`search_posts`/`search_comments`/`search_photos`/`search_dm_messages`/`search_ai_history`/`search_users`/`search_everything`

### 能力缺口

| 缺口 | 现状 | 对标 |
|---|---|---|
| **无持久记忆写入** | 7 个站内工具**全是只读**；`ai_drafts`/`ai_action_confirmations` 表已存在但无 tool | ChatGPT/Claude Memory |
| **无日历/待办/提醒** | 完全没有 | ChatGPT Tasks |
| **无 PDF 编辑** | 只能生成/读取，**不能合并拆分** | — |
| **无语音** | 无 STT/TTS | ChatGPT 语音 |
| **图表类型少** | 仅 4 种基础图 | ECharts |
| **无思维导图** | 无 | Mermaid |
| **OCR 不是 tool** | 随附件自动触发，模型**无法主动调用** | — |
| **股票无红涨绿跌语义** | `get_stock_quote` 未处理颜色 | 中国用户强需求 |

### 推荐实施批次

**P0（立刻做，4 项）**

| 工具 | 价值 | 难度 | 依赖 | 理由 |
|---|---|---|---|---|
| `my_stats` 我的数据统计 | ★★★★★ | 低 | 现有 Supabase 表 | 零外部依赖、纯站内、开发量最小 |
| `todo_manage` 待办管理 | ★★★★★ | 中 | 新建 `ai_todos` 表 | 最高频需求；已有写操作确认机制可复用 |
| `stock_enhanced` 股票增强 | ★★★★★ | 低 | `qt.gtimg.cn`（**无需 key**） | **红涨绿跌语义当前缺失**，是明显体验缺陷 |
| 修复 `buildResponsesInput` 图片降级 | ★★★★★ | 低 | 无 | **不是新工具，是修 bug** |

**P1（短期，9 项）**

`unit_convert_pro`（扩展现有映射表，半天）· `weather_forecast`（扩 `weather.js`，Open-Meteo 无 key）· `dictionary`（`dictionaryapi.dev` 无 key，音标是模型给不了的）· `pdf_merge`/`pdf_split`（`pdf-lib`，**高频刚需**）· `post_summarize` · **`ocr_image` 注册为正式 tool**（能力已存在，注册即变现）· `news_feed`（复用 `tavily_search(topic:'news')`，零新增 API）· `xml_format`（沙箱已装 `fast-xml-parser`）· `color_tool`

**P2（中长期，12 项）**

`note_save` · `reminder_set` · `friend_graph` · `trending_topics` · `make_chart_pro` · `mindmap` · `image_watermark` · `qr_decode` · `json_schema_validate` · `cron_explain` · `image_convert_batch` · `calendar_manage`

**建议暂缓**：`translate`（模型自身能译，增量小）· `short_url`（价值低）· **MCP 接入层**（DeepSeek 忽略 `mcp`，且官方 server 与现有安全模型冲突，收益有限）

### 新增工具的开发约定（重要）

**必须两处同改**：`AI_TOOLS` schema（836）+ `executeToolCall` case（1733）。只加 schema 不加 case → 提示词宣称有能力、执行却返回「未知工具」→ **模型幻觉**。项目历史上已踩过。

**其他约定**：
- 无 schema 校验框架，靠手写容错；可复用 `tool-helpers.js` 的 `clampInt`/`clampText`/`toNum`
- 三层超时：工具级 20s / 整体 180s(300s) / 单个远程调用自带 8s `AbortSignal.timeout`
- **返回错误对象不抛异常**：`return { tool_name, error: '中文可读原因' }`
- 错误信息必须**脱敏**（不透传 HTTP 状态码）
- 有配额的工具需先 `measureSearchQuota` 再执行
- 卡片走 `aiSiteCard()`，协议 `xtj.ai.ui.v1`

**建议加一条单测**：断言每个 `AI_TOOLS` 名字都有对应 case 或被 site registry 覆盖。

---

## 八、建议修复顺序（按投入产出）

### 第 1 批：安全止血（1-2 天）
1. **SEC-1** 管理员默认用户名 → `process.exit(1)`（改 3 行）
2. **SEC-2** CSRF 绕过（改 5 行）
3. **SEC-3** `read_document` 改 `fetchSafeBuffer`（改 8 行）
4. **SEC-7** `renderMarkdown` href 转义（改 2 行）
5. **FE-S2** `stepId` 改自增序号（改 5 行）
6. **SEC-5** 代理强制 `force:false`（改 3 行）

> 这一批共约 26 行代码，消除 6 个高危漏洞。

### 第 2 批：Code 工作台写入链路（2-3 天）
7. **CW-S3** AI 输出路径白名单校验（前后端双重）
8. **CW-S1** 批量提交强制 diff 确认 + 非默认分支也确认
9. **CW-S2** 注入内容加数据边界标记 + 敏感路径禁止写入
10. **CW-S5/S6** 代理方法白名单收敛 + 写审计日志

### 第 3 批：取消与状态机（1-2 天）
11. **DT-S3/S4** 取消链路打通（前端回填 convId + 研究流注册 cancel 表）
12. **DT-S2** 补两个端点的 `X-Accel-Buffering: no`
13. **DT-S1** 统一 idle 阈值常量
14. **FE-S4/S5/S6** `S.sending` 拆分 + renderer 按通道过滤

### 第 4 批：SSE 健壮性（2 天）
15. **FE-M1/M2** `[DONE]` 不 break + `data:` 前缀放宽
16. **FE-M3** 加绝对超时
17. **FE-M12/M14/M16** 监听器与状态泄漏
18. **抽公共 `createSseReader`**（为迁移铺路）

### 第 5 批：性能与成本（2-3 天）
19. **BE-AI-M6** 补充搜索计入配额（省 4× 成本）
20. **BE-AI-M2/M3** 大文件改 Storage 短链 + worker 化
21. **BE-AI-M10** 工具差异化超时
22. **CW-M2** Code 工作台加总轮次预算

### 第 6 批：+/responses 迁移（3-5 天）
23. 按 §六 清单逐项推进
24. **迁移后**补回图片输入能力

### 第 7 批：扩展工具（P0 四项）
25. `my_stats` / `todo_manage` / `stock_enhanced` / 图片降级修复

---

## 九、未覆盖 / 需确认项

审计员明确标注「未读到、不下结论」的部分，供后续补充：

1. **`core.js` / `core-parts/` 前端核心** —— 本轮因资源分配未完成审计（15,427 行 + 7 个 part 文件），建议单独一轮
2. **`tool-helpers.js` 的 `evaluateFormula` 实现** —— `batch_calc` 的公式注入风险未下结论
3. **`CW-S7` 双重编码 `%252e%252e`** —— 未做线上验证 GitHub 是否二次解码
4. **`/api/agent/research/stream` 内部研究 agent**（`server.js:23989-24520`）—— 仅抽样阅读
5. **`reasoning.effort` 的官方取值枚举** —— 文档未查到
6. **Code 工作台是否有 `code-agent.js`** —— 本轮在 `main` 上未发现该文件（记忆中提到的 5,217 行版本可能在已删除的分支上）

---

*报告生成：2026-09-23 | 只读审计，未改动任何代码*
