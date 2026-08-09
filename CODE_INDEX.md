# XTJ 代码索引 (CODE_INDEX)

> 本项目文件较大,此索引用于快速定位代码。**行号会随改动漂移,定位后请用文件内搜索(如 `// ===== 分段名` 或函数名)二次确认。**
>
> **⚠️ 拆分警告**:server.js 的物理拆分**受契约测试锁定**(详见 §9)。改动前必读。

## 1. 项目架构总览

```
浏览器 (index.html)
 ├─ js/early-feed.min.js      首屏并行拉帖(不依赖 core.js)
 ├─ js/ai-core/*.min.js       7 个 AI 共享模块(errors/transport/markdown 等)
 ├─ js/vendor/supabase.min.js Supabase SDK(前端直连,受 RLS 约束)
 ├─ js/core.min.js            核心逻辑(由 js/core-parts/*.js 组装,见 §3)
 ├─ js/ai-agent.min.js        小猫AI 聊天/深度研究(单体 IIFE,§6)
 ├─ js/code-workspace.min.js  Code 工作区(单体 IIFE,§7)
 └─ js/photo-wall/*.min.js    照片墙模块
        ↓
后端 (Render 托管, render-api/)
 ├─ server.js         主入口:全部路由 + AI 函数(§2,17196 行)
 ├─ code-agent.js      Code AI 代理(5621 行,register 模式)
 ├─ code-index.js      Code 项目索引(1639 行)
 ├─ provider-registry.js 模型供应商注册(662 行)
 ├─ photo-create.js    照片创建/缩略图(581 行)
 ├─ search-providers.js 联网搜索 provider(454 行)
 └─ 其余工具模块(见 §5)
        ↓
Supabase (PostgreSQL + Storage)
 ├─ posts 表         全站数据的"大表"(帖子/评论/点赞/DM/照片/系统标记,用 media_type 区分)
 └─ storage bucket   上传文件(照片/头像/DM 媒体,public)
```

**核心设计**:全站数据(帖子、评论、私信、照片、系统记录)都存 Supabase 的 `posts` 表,用 `media_type` 字段区分业务类型(常量见 `render-api/post-markers.js`)。前端直连 Supabase 走 RLS,后端用 service_role key 绕过 RLS 执行受控操作。

---

## 2. render-api/server.js 分段索引(17196 行)

> 所有分段用 `// ===================== 标题 =====================` 分隔。搜索方法:在 server.js 里搜 `// ===== 标题` 或按下方行号跳转。

### 2a. 配置与 AI 函数(1-6400 行)— 辅助函数区,路由在 §2b/2c

| 行号 | 分段 | 内容 |
|---|---|---|
| 1-90 | 导入/初始化 | express、supabase 客户端、cookie 解析、trust proxy |
| 92-158 | 配置 | ADMIN_USERNAME/PASSWORD、API_SECRET、SUPABASE_URL、ALLOWED_ORIGINS |
| 159-334 | DeepSeek AI 配置 | API key、模型目录、`refreshDeepSeekModelCatalog` |
| 335-409 | 深度研究模式 (M/R 架构) | `activeDeepThinkJobs`、agent 构建、缓存 |
| 410-641 | 共享工具函数 | `canUseAiCache`、`buildHistoryContext`、`buildToolExecutor` |
| 642-734 | DeepSeek Function Calling 工具定义 | `AI_TOOLS`、`executeToolCall` |
| 735-1054 | Responses API 辅助 | `buildResponsesInput`、`autoSupplementSearch` |
| 1055-1266 | Tavily Research 增强流水线 | `researchCache`、`rewriteResearchQuery` |
| 1267-1654 | 输入校验 | `mergeUserInfo`、`logVisit`、`logAttack`、`sanitizeError`、`pgrstQuote` |
| 1655-2212 | 中间件 | `rateLimit`、`getClientIp`、`AI_SITE_TOOL_REGISTRY`、`aiSiteSearch` |
| 2213-2661 | 帖子详情 API + IP 属地 | `/api/post/detail/:id`、`resolveIpLocation`、`retryIpRegionAsync` |
| 2662-3366 | 安全检测逻辑 | `checkSameIpMultiUsers`、`runSecurityChecks`、`securityRateLimit` |
| 3367-3516 | DeepSeek 统一调用封装 | `callDeepSeekAI`、`extractEmbeddedFiles` |
| 3517-5246 | **小猫 AI 评论区自动回复** | `CAT_AI_*`、`processCatReplyJob`、`recoverStaleCatJobs` |
| 5247-5623 | Responses API 调用 | `callDeepSeekViaResponses` |
| 5624-5991 | M: 深度研究多智能体 | `runMultiAgentFlow` |
| 5992-6400 | R: 深度研究单智能体 | `runDeepThinkAgent`、`runDeepThinkWorker` |

### 2b. 认证与核心 API(6401-9180 行)

| 行号 | 分段 | 内容 |
|---|---|---|
| 6401-6432 | AI 用户级限流 | `checkAiUserRateLimit` |
| 6433-6701 | **Token 管理(核心)** | `_signPayload`、`signUserAccessToken`、`verifyToken`、吊销 |
| 6702-6794 | 健康检查 | `/health` |
| 6795-6853 | 管理员登录 | `/admin/login` |
| 6854-7236 | 用户 Token 认证 | `/api/user/login/register/refresh/logout` |
| 7237-7259 | 自动过期函数 | |
| 7260-7294 | 数据加载(只读认证) | |
| 7295-7344 | 公告管理 | `/admin/announcement` |
| 7345-7443 | 公告已读跨设备同步 | |
| 7444-7479 | 帖子管理 | 删帖/封禁相关 |
| 7480-7494 | 评论管理 | |
| 7495-7512 | 举报通知辅助 | |
| 7513-7563 | 举报通知查询 API | |
| 7564-7617 | 照片管理 | |
| 7618-7632 | 用户照片上传 API | |
| 7633-8144 | **用户照片删除/清理 API** | `/api/photo/delete`、`/api/photo/cleanup` |
| 8145-8429 | P0: 帖子编辑/删除 API | `/api/post/update/delete` |
| 8430-8545 | Atomic post pin API | `/api/post/pin` |
| 8546-8891 | 点赞接口 | `/api/post/like`、`/api/stats/snapshot` |
| 8892-8998 | **帖子列表接口(核心)** | `/api/feed`(统一可见性过滤) |
| 8999-9037 | 照片墙接口 | `/api/photos/wall/:userName`、`/api/photos/public` |
| 9038-9173 | 头像接口 | `/api/avatar/*`、`/api/avatar/batch` |

### 2c. 私信/管理/统计/AI 路由(9174-17100 行)

| 行号 | 分段 | 内容 |
|---|---|---|
| 9174-9866 | 私信列表/消息/发送/撤回 | `/api/dm/*` |
| 9867-10118 | 封禁/禁言/黑名单管理 | `/admin/ban`、`/admin/mute`、`/admin/blacklist` |
| 10119-10318 | 管理员删除用户账号 | `/admin/user/:userName` |
| 10319-10636 | 举报管理 | `/admin/reports` |
| 10637-10935 | 用户数据(只读) | `/api/my-reports`、`/admin/user-data` |
| 10650-10935 | 数据统计 API | `/admin/stats/*` |
| 10936-11522 | 用户访问日志 | `/api/log-user-visit` |
| 11523-11619 | 用户画像聚合 API | |
| 11620-11858 | 实时在线用户 API | `/admin/stats/online` |
| 11859-12085 | 登录设备/IP 记录 | `/api/log-login-event` |
| 12086-12112 | 安全设置(前端公开读取) | `/api/security-settings` |
| 12113-12178 | 登录事件查询(管理员) | `/admin/login-events` |
| 12179-12313 | 安全提醒/设置管理 | `/admin/security-*` |
| 12314-12370 | 日志清理 | `/admin/cleanup-logs` |
| 12371-12400 | 审计日志查询 | `/admin/audit-logs` |
| 12401-12485 | 用户访问统计(管理员) | `/admin/stats/users` |
| 12486-12903 | 管理员邮件通知 API | `/admin/send-email`、`/admin/email-history` |
| 12904-13014 | 管理员邮件收件人历史 | |
| 13015-13092 | 客户端错误监控 | `/api/client-error-log`(匿名可写) |
| 13093-13379 | **AI 聊天接口** | `/api/agent/chat`、`/api/agent/chat/stream` |
| 13380-15807 | 全局 AI 配置/会话 | `/api/agent/config`、`/api/agent/chat/history` |
| 15808-16440 | 自托管多智能体深度研究 | `/api/agent/research/stream` |
| 16441-16876 | AI site-tool APIs | `/api/agent/post-tools`、`/api/agent/actions/:id/confirm` |
| 16877-17530 | 管理员 AI 管理接口 | `/admin/ai-agent/*` |

### 2d. 尾部(17531-17770 行)

| 行号 | 分段 | 内容 |
|---|---|---|
| 17531-17601 | 全局错误处理 | uncaughtException/unhandledRejection 防崩溃 |
| 17602-17770 | 启动 | `app.listen`、DM 未读邮件提醒、`startLocationTaskProcessor`、`registerCodeAgentRoutes` 等 |

---

## 3. js/core.js(18977 行)— 由 js/core-parts/ 组装

**不要直接编辑 core.js**!它由 `scripts/assemble-core.js` 按 `js/core-parts/MANIFEST.json` 顺序拼接。改代码去改对应的 part 文件,然后跑 `node scripts/assemble-core.js`(或 `npm run build`)。

| part 文件 | 内容 |
|---|---|
| `01-bootstrap.js` | 启动序列、token 管理(`memoryUserToken`)、会话恢复、主题 |
| `02-auth-restrictions.js` | 登录态、封禁限制、用户信息 |
| `03-profile-report-ai.js` | 个人资料、举报、猫 AI 轮询 |
| `04-posts-interactions.js` | **feed 加载、帖子渲染/点赞/评论/删除**(核心) |
| `05-feed-stats.js` | 统计、双击刷新、AI tab |
| `06-chat-and-nav.js` | dock 聊天、tab 切换、公告 |
| `07-final-overrides.js` | 最终覆盖/兼容层 |

**找前端逻辑的顺序**:先在 §3 定位是哪个 part,再搜函数名。

---

## 4. js/photo-wall/ 照片墙模块

| 文件 | 内容 |
|---|---|
| `data.js` | 数据加载、`loadPhotoWallData`、`fetchPhotoPage`、`mergePhotoLists` |
| `render.js` | 渲染、`renderPhotoWall`、分组(album)、懒加载图片 |
| `photo-wall.js` | 入口、`initPhotoWall` |
| `upload-ui.js` | 上传 UI、批量上传、`uploadPhotoWallFiles` |
| `preview.js` | 全屏预览 `Q()`/`closePhotoPreview`(被 hotfix 覆盖) |
| `preview-hotfix.js` | 预览修复层(包装 preview.js) |

---

## 5. render-api/ 其他模块

| 文件 | 内容 | 备注 |
|---|---|---|
| `code-agent.js` | Code AI 代理(工具调用/文件操作/会话) | 5621 行,`registerCodeAgentRoutes(app, deps)` |
| `code-index.js` | Code 项目索引构建/查询 | 1639 行 |
| `code-github.js` | GitHub 只读代理 | 仓库白名单 |
| `provider-registry.js` | 模型供应商注册 | |
| `photo-create.js` | 照片创建/缩略图/sharp 校验 | |
| `dm-media.js` | DM 媒体上传校验 | |
| `search-providers.js` | 联网搜索(bing/tavily/searxng 等) | |
| `storage-cleanup.js` | Storage 孤儿文件清理 | |
| `post-markers.js` | **所有 media_type 标记常量** | 系统标记清单源头 |
| `post-query.js` | 帖子白名单过滤辅助 | |
| `security-headers.js` | CSP/安全头 | |
| `sse-write.js` | SSE 写入辅助 | |
| `mail-transport.js` | 邮件发送 | |
| `weather.js` | 天气查询 | |
| `util-helpers.js` | 通用工具 | |
| `ai-sanitize.js` | AI 输出清洗 | |

---

## 6. js/ai-agent.js(8379 行)— 小猫AI 单体 IIFE

> 整个文件是一个大 IIFE,内部状态 `S` 对象持有所有 UI/会话状态。无分段注释的部分按下方函数定位。

| 行号 | 内容 |
|---|---|
| 24-150 | 常量与状态 `S` |
| 161-348 | `el()` 安全 DOM 构建、`renderMarkdown`(旧版,注意 XSS) |
| 484-700 | AI 根节点、头像、会话 key |
| 1995-2870 | 深度思考模式 toggle/cancel |
| 2871-3588 | Tavily Deep Research |
| 3589-4051 | SSE 流解析循环 |
| 4052-4467 | 多智能体模式实现 |
| 4468-8379 | 二级页面、历史、搜索、工具卡 |

**找 AI 逻辑顺序**:搜 `function <功能名>` 或 `S.xxx` 状态字段。

---

## 7. js/code-workspace.js(9521 行)— Code 工作区单体 IIFE

| 行号 | 内容 |
|---|---|
| 134-688 | IndexedDB、Monaco 加载、工具函数 |
| 688-1004 | `init()`、`tryRestoreWorkspace`、`cleanup`、欢迎页 |
| 1005-1303 | 文件打开/API/工作区 |
| 1510-1785 | 布局系统(toggle/重置) |
| 1812-2370 | `renderWorkspace`、resizer |
| 2370-2950 | 文件树、`renderFileTree`、右键菜单 |
| 2952-3454 | 打开/关闭 tab、编辑器渲染 |
| 3455-3790 | 保存、图片/PDF/文档预览 |
| 3913-4612 | 项目索引 `buildProjectIndex` |
| 4613-4813 | GitHub 工作区 |
| 4814-5611 | 模型/能力/附件 |
| 5169-6435 | 聊天面板、composer、`sendMessage` |
| 6436-8295 | 流式请求 `sendStreamingRequest`、恢复、watchdog |
| 8296-9470 | API 请求、diff、文档操作(`applyDocumentOperation`) |

---

## 8. AI 找 bug 快速导航

### 用户可见的"打不开/卡死"类
- 页面卡死 → `js/ux-features.js`(MutationObserver 修复处)、`js/performance.js`、`js/core-parts/06`(watchdog)
- feed 不显示 → `js/core-parts/04`(`fetchFeedPageChunk`)、`js/early-feed.js`、`render-api/server.js §8892 /api/feed`
- 登录状态异常 → `js/core-parts/01`(token/会话)、`render-api/server.js §6854`

### 安全类(审计已发现)
- 注册提权 → `render-api/server.js:7073` register 未拦截 ADMIN_USERNAME
- 照片墙越权 → `server.js:9001` `/api/photos/wall/:userName` 无可见性过滤
- photo cleanup 越权删 → `server.js:7736`
- AI markdown XSS → `js/ai-agent.js:287` 旧 renderMarkdown

### 数据流追踪
1. 帖子:前端 `04-posts-interactions.js` → `/api/feed`(server.js 8892)→ Supabase posts 表
2. 私信:前端 `06-chat-and-nav.js` → `/api/dm/*`(server.js 9174)→ posts 表 `__dm__` 行
3. 照片:前端 `photo-wall/*` → `/api/photos/*`(server.js 8999)→ posts 表 `__photo_wall__` 行 + Storage

---

## 9. server.js 拆分可行性(重要)

**结论:server.js 的物理拆分(把路由段移到独立文件)受契约测试锁定,当前不可行。** 理由:

1. **路由字符串锚点**:约 20 处测试直接 `fs.readFileSync('render-api/server.js')` 后 `indexOf("app.get('/api/feed'")` 等,代码移走即断言失败。
2. **分段注释边界锚点**:测试用 `indexOf('// ===================== 照片墙')` 等**分段注释作为 slice 结束边界**(`interaction-contracts`、`phase246-contracts`、`complete-tests` 等 10+ 文件)。移动路由 = 分段位置变化 = 边界失效。
3. **AI 函数锚点**:`deepseek-call-runtime.test.js`(40+ 处)、`tavily-search-tool-contract`、`pr357-regression-contracts` 锚定 `async function callDeepSeek`、`executeToolCall` 等 AI 辅助函数——AI 段(160-6400 行)是**函数与路由交织最密**的区域,同样拆不得。
4. **通用锚点**:部分测试直接搜第一个 `// =====================` 作为边界(如 `ai-site-tools-contract.test.js:93`),连"给分段加编号注释"都可能破坏。

### 未来若坚持拆分的条件
- 必须**同步重写所有受影响测试**(约 10-15 个文件),把 `fs.readFileSync('server.js')` 改为读新模块文件,并重建 slice 边界
- 建议先跑 `npm test` 记录基线,拆一段验证一段
- 已按 `registerXxxRoutes(app, deps)` 模式拆出的模块:`code-agent.js`、`code-github.js`、`provider-registry.js`——**新路由应优先写进这些独立文件,不要再堆进 server.js**

### 测试锚定的 server.js 段(拆分红线)

| server.js 段 | 锚定测试 |
|---|---|
| `/api/feed`(8892) | complete-tests(5 处 slice) |
| `/api/post/create`(8185) | complete-tests(593) |
| `/api/photos/wall|public`(8999) | backend-api-contract(175-176)、phase246(188) |
| `/api/avatar/batch`(9080) | phase246(188 slice 起点) |
| `/api/dm/*`(9174+) | interaction-contracts(75) |
| `/api/post/like`(8546) | interaction-contracts(88) |
| `/api/agent/chat/history` | ai-site-tools-contract(93)、interaction-contracts(56) |
| `async function callDeepSeek`(4379) | deepseek-call-runtime(40+ 处) |
| `async function verifyToken`(6667) | optional-auth-regression(34) |
| `async function aiSitePersistResults`(2015) | ai-site-tools-contract(170) |
| `AI_SITE_TOOL_REGISTRY`(1899) | ai-site-tools-contract(56) |
| `/admin/cleanup-logs`(12314) | db-result-contract(176) |
| `登录设备/IP` 分段(11859) | safe-analytics-contract(26) |
| `verifyToken`/`optionalAuth` 等中间件 | complete-tests(539)、optional-auth-regression |

**结论**:server.js 保持单文件 + 本索引导航,是当前风险最低、收益最高的形态。新增功能请优先放 `render-api/` 独立模块或复用 `registerXxxRoutes` 模式。
