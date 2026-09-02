# XTJ

当前版本：`v0.94`

> **关于付费业务**：本站全面免费，不再收费。支付宝支付、VIP 订单、Pro 会员激活等相关业务代码已移除（`alipay-sdk` 依赖、`alipay_private_key.pem` 私钥文件均已删除）。

> **关于仓库历史（2026-08-10 维护）**：历史中曾误提交 `node_modules`，`.git` 一度达 408MB。已用 git-filter-repo 剔除所有 >10MB 大文件，`.git` 瘦身至 43MB，2121 个提交时间线完整保留。清理前完整历史保存在 `backup/pre-cleanup-20260810` 分支；main 提交 hash 已全部改变（内容不变），本地与远端已分叉，暂未强推远端。详见 `CHANGELOG.md` v0.93.1。

> **关于回退（2026-09-02）**：main 已硬回退至 `fba7a3f`（2026-09-02）。因引入「思考胶囊（Liquid Orb）」的 `e1e95dd` 与后续修复提交 `fedec10`（思考胶囊显示时机 + Code 读取文件修复）与当前使用无法配套，已执行硬回退并 force push，从 main 移除这两个提交。如需找回被移除内容，提交对象仍保留在本地仓库，可执行 `git show e1e95dd` / `git show fedec10` 查看。



## 核心功能

### 🐱 小猫 AI 评论助手
- 评论区 `@小猫` 触发 AI 自动回复，流式输出，支持失败重试与状态轮询。
- 前端：前台活跃计时（名义超时不再空转）、进行中气泡防重绘冲掉、切回页面立即重连、Realtime 订阅去重。
- 后端：统一回复查询并对历史重复数据容错、服务端失败返还配额、主触发前校验封禁、Worker 按空闲补满、全/半角 @ 正则统一。
- 数据层：部分唯一索引防重复、孤儿回复清理、咨询锁哈希升级防碰撞（见 `supabase/migrations/052_cat_ai_hardening.sql`）。

### 🤖 第三方自定义模型
- 可接入任意 OpenAI 兼容服务，配置服务商、显示名、API Key、模型名、接口地址；API Key 经 AES-256-GCM 加密存储。
- **配置写入用户账号**，换设备 / 刷新页面不丢失：后端采用“先立后破 + 多行快照合并”，根除旧版“先全删再插”失败即清空的问题。
- 全字段可编辑（旧版仅能删除）、内置模型候选下拉、启动即从账号同步，并统一驼峰 / 下划线字段避免跨端丢失。

### 🧠 思考档位
- 固定五档：关闭 / 轻度 / 中度 / 深度 / 极致，由网站预设，不再被后端“系统默认”覆盖。
- 极致（max）只向厂商传递原生 reasoning effort，**不再被强制拐入“深入研究 / deep-stream”**；思考 Max 只负责最大上下文、更多搜索与工具协作。

### 💻 Code 云端代码工作区（`js/code-workbench.js`）
- 在线连接 GitHub 仓库：文件树浏览、查看 / 新建 / 删除 / 编辑文件、分支切换、修改历史。
- AI 读码改 Bug：一键**批量读取整库代码**、单文件或**多文件同时修改**、多文件一次性提交。
- 提交通道：小文件走 Contents API；超过约 1MB 自动改走 Git Database（blobs → tree → commit），避免大文件无法提交；支持直接提交或创建 Pull Request。
- 分支直接合并，合并前用 compare 接口预检领先 / 落后 / 分叉与变更文件数。
- 安全：服务端为白名单 GitHub 代理，`DELETE` 仅限 contents 删文件、`PATCH` 仅限 git/refs 更新引用，封堵删库 / 删分支等越权调用；Token 默认仅存浏览器本地，可选“仅本次会话保留”。

## 项目结构

- `index.html`
  前台主站入口。
- `admin.html`
  后台管理入口。
- `js/core.js`
  前台主逻辑，包括帖子、聊天、主题切换、站内更新日志、照片墙懒加载入口等。
- `js/photo-wall/`
  照片墙模块，当前活跃链路主要包括：
  - `data.min.js`
  - `render.min.js`
  - `preview.min.js`
  - `preview-hotfix.js`
  - `photo-wall.min.js`
- `js/ai-agent.js`
  AI 聊天助手前端：内置 / 自定义模型、思考档位、第三方模型账号同步与编辑。
- `js/code-workbench.js`
  Code 云端代码工作区前端：GitHub 文件浏览 / 编辑 / 提交、整库读取、AI 改码、分支合并（构建产物为 `js/code-workbench.min.js`）。
- `js/core-parts/`
  `core.js` 的分片源码（IIFE 片段，不能单独运行），由 `scripts/assemble-core.js` 拼接为 `js/core.js`，再经 `scripts/build.js` 压缩为 `core.min.js`。
- `js/admin/admin.js`
  后台管理前端逻辑。
- `render-api/server.js`
  后端 API 与 Render 部署入口。
- `render.yaml`
  Render Web Service 部署配置。
- `scripts/build.js`
  前端压缩构建脚本。
- `CHANGELOG.md`
  仓库版本更新日志。
- `supabase/migrations/`
  数据库迁移文件（幂等，可重复执行），代码部署后需手动在 Supabase 执行，见下方“部署后注意事项”。
- `tests/`
  单元 / 契约 / 回归测试，`npm test` 运行。
- `vercel.json`
  Vercel 部署配置。

## 启动与构建

根目录可用脚本：

```bash
npm install
npm run build
npm start
```

说明：

- `npm start`
  直接启动 `render-api/server.js`
- `npm run build`
  执行 `scripts/build.js`，用于压缩 CSS / JS

`render-api/package.json` 还保留了后端单独启动脚本：

```bash
cd render-api
npm install
npm start
```

## Render 部署

当前 Render 部署入口由 [render.yaml](render.yaml) 定义：

- 服务类型：`web`
- 运行时：`node`
- 构建命令：`npm install`
- 启动命令：`node render-api/server.js`

这意味着 Render 线上实际走的是：

- 前端静态资源：仓库根目录
- 后端入口：`render-api/server.js`

### Vercel 部署
项目同时支持 Vercel，配置见 [vercel.json](vercel.json)，推送到 main 后自动触发构建。前端静态站点与后端 API 的具体路由以 `vercel.json` 为准；环境变量需在 Vercel 项目设置中单独配置（与 Render 互不共享）。

> 部署生效有 1–5 分钟构建延迟，页面未更新时先强刷（`Ctrl/Cmd + Shift + R`）排除本地缓存，再到部署平台查看构建状态；构建产物带内容指纹（`?v=hash`），`npm run build` 会自动刷新。

## 最近重点更新

### v0.94 - 2026-09-01 小猫AI全量加固 + 第三方模型账号同步/可编辑 + 思考档回归原生 + Code工作区增强
**小猫 AI 评论助手（18 项问题全量修复）**
- 前端 F1–F7：轮询改为“前台活跃计时”（保留后台挂起不耗超时的设计，修复名义 90s 实际空转）、进行中气泡防全量重绘冲掉、页面切回立即轮询、not_triggered 窗口加固、异常分支补清定时器、Realtime 订阅去重、AI 行补 post_id 清理。
- 后端 B1–B9：统一 `fetchCatReplyByParent` 查询（全字段、过滤 user_name、多行容错，不再用 maybeSingle 被重复数据卡死）、反泄露正则不再误杀、blocked 不再静默、服务端失败返还配额、completed 补用户过滤、主触发补封禁校验、限流插入处理 23505、Worker 每轮按空闲补满、全/半角提及与清洗正则统一。
- 数据库 D1–D2：迁移 052 清理 SET NULL 孤儿 AI 评论、建部分唯一索引 `idx_comments_unique_ai_reply`、咨询锁哈希升级为 hashtextextended 防碰撞、新增配额返还 RPC。

**第三方自定义模型**
- 配置写入账号并跨设备 / 刷新同步：后端 GET 改为多行快照合并（单行损坏容错）、PUT 改为“先立后破”（先插入完整快照并取回 id，成功后再删旧行），根除旧版“先全删再插”失败即整份清空。
- 新增完整编辑能力：显示名、服务商、API Key、模型名、接口地址全字段可改；新增模型候选 datalist；本地与账号合并改为“字段完整度优先”，避免残缺本地覆盖完整云端配置。

**思考档位回归厂商原生**
- 主聊天思考强度固定为网站预设五档，移除后端 `default_thinking_mode` 对主聊天的覆盖（深度思考二级页仍独立同步）。
- 删除自定义模型 + 极致档被强制拐入 `/custom-chat/deep-stream`（“深入研究”）的分支：任何档位都走 `/custom-chat/stream`，thinking_mode 传厂商原生 effort；thinkMax 仅做最大上下文 / 更多搜索与工具，不改走研究模式。

**Code 云端代码工作区（P0–P3 全量修复 + 能力增强）**
- P0：整库批量注入预算与后端上限对齐（内置 / 自定义通道统一到 20 万字符，文件清单按预算截断）；AI 输出 max_tokens 按档位放大（8k/16k/32k）并检测未闭合代码块，半截代码不再自动覆盖；>1MB 文件自动走 Git Database（blobs→tree→commit），不再能看不能存；AI 应用前检测未保存手改、应用前快照并新增“撤销AI”。
- P1：openFile/loadTree/switchBranch 加请求代次消除快速切换竞态；提交后同步整库缓存、刷新重载当前文件；统一 ghErr（原后端 error 为字符串，前端取 `.error.message` 恒显示“未知错误”）；PR 模式每次取基线最新 SHA、失败 / 残留分支明确提示；分支分页拉全、大目录树剪枝并发遍历。
- P2：代理最小授权（DELETE 仅限 contents、PATCH 仅限 git/refs，已加断言验证）；Token 增加“记住 / 仅本次会话”选项。
- P3 + 能力：新建 / 删除文件、合并前 compare 预检、批量读取失败清单、默认分支直接提交二次确认、二进制识别、首屏并行加载；AI 一次改多文件（解析多个 path 代码块）并支持多文件一次性提交。
- 验证：`node --check` 通过；全量 425 node:test + 99 项回归全过、退出码 0；构建一致性 0 错 0 警；DOM 冒烟构建无异常。

### v0.93 - 2026-08-24 Code 云端工作区初版 + 思考 Max + 小猫AI移动端接入
- 新增 Code 云端代码工作区：连接 GitHub 仓库、文件树浏览、在线查看 / 编辑、分支切换、Contents API 提交（直接推送或创建 PR）、AI 基于单文件上下文改码。
- 新增思考 Max（极致）档位：最大上下文窗口与消息长度、更多搜索与工具调用，可与自定义模型搭配。
- 移动端 Dock 中间 Tab 接入小猫 AI 入口，评论区 `@小猫` 触发自动回复与流式输出。
- 移除付费业务：删除 `alipay-sdk` 依赖与 `alipay_private_key.pem`，全站转为免费。

### v0.92 - 2026-06-27 AI 括号动作清洗 + 搜索 Provider 架构 + 流式加固 + 长期记忆

**括号动作全面清洗（render-api/server.js sanitizeAssistantVisibleText）**：
- 删除所有独立成行或内联的括号动作（全角/半角/方括号）
- 删除以明显动作描写词开头的裸行
- 保留合法括号内容（API、价格、技术术语）
- 流式/非流式回复均强制清洗，done 事件返回 sanitized_content

**搜索 Provider 架构（render-api/server.js searchWeb）**：
- Tavily > Brave > Serper > Custom API > Bing HTML > SearXNG 六层降级链
- 统一返回值格式 `{ results, diagnostics }`，含 provider 错误追踪
- search-health 端点返回完整 Provider 状态与环境变量配置

**AI 配置系统 V2（js/admin/admin.js + render-api/server.js）**：
- 12 模块后台配置 UI：人设/语气/回复风格/角色扮演/输出规则/搜索/记忆/模型/调试
- buildAiCorePrompt 完全从 migrateConfig 读取，硬性禁止项放在 Prompt 最后

**长期用户记忆系统（render-api/server.js）**：
- 基于 DeepSeek 提取用户偏好，存入 posts 表
- 对话摘要异步生成 + 关键词匹配注入
- 管理后台可查看/管理用户记忆

**流式回复加固（render-api/server.js finishStream + js/ai-agent.js）**：
- 统一 finishStream 函数处理所有结束路径
- 20 秒 Idle Timeout 保底
- 前端保留已输出内容 + 显示"回复中断"提示
- 支持 sanitized_content 替换气泡正文 + filtered 标记

**照片墙预览安全兜底（js/photo-wall/preview-hotfix.js）**：
- 图片加载失败显示"图片加载失败"占位文字
- 关闭时重置所有状态（transform/scale/translate/currentIndex/loading）
- 打开新预览前调用 resetPreviewState()

### v0.90 - 2026-06-25 邮件发送记录重构 + 历史邮箱双保险

**邮件发送记录展示（js/admin/admin.js loadEmailHistory）**：
- 表格结构改为 时间 / 接收邮件账号 / 接收人 / 主题 / 结果
- 删除 from_email 列（不再展示发件邮箱）
- 删除"详情"列与展开区域（不再使用 emailToggleDetail）
- 删除"收件人"合计列（已由"接收人"列承载）
- 新增 getRecipientDisplayName helper：网站用户显示用户名，外部邮箱显示邮箱号
- 新增 formatRecipientsList helper：单收件人直接展示；多收件人显示"第一个 + 等 N 人"，title 放完整列表
- 新增 extractRecipientsFromRecord helper：兼容旧数据（recipients / emails / recipient_email / to_email / total_recipients）
- 接收邮件账号列 max-width 180px / 接收人列 max-width 140px / overflow ellipsis

**历史邮箱双保险持久化（js/admin/admin.js emailSend）**：
- 发送成功 / 部分失败 / 全部失败 / 网络异常 都调用 `saveRecipientsHistorySafe()`
- 双保险：后端 `/admin/send-email` 内部已保存，前端再主动 `POST /admin/email-recipient-history` 一次
- 失败只 console.warn，不影响发送结果显示

**后端 helper 抽取（render-api/server.js）**：
- `normalizeEmailAddress(email)`：trim + lowercase
- `isValidEmailAddress(email)`：邮箱格式校验
- `normalizeRecipientUserName(recipient, email)`：外部邮箱时 user_name == email
- `saveEmailRecipientHistory(recipients)`：统一去重 + 一次性查 + 已有更新 / 新增
  - 新增时补齐 actor_key 与 media_url
  - 失败只 console.warn，不阻断邮件发送

**后端 API 兼容（render-api/server.js）**：
- `POST /admin/email-recipient-history` 兼容 `recipients: [{ email, user_name }]` 新格式和 `emails: []` 旧格式
- `GET /admin/email-recipient-history` 兼容 `info.email / row.media_url / info.user_name / info.last_sent_at / info.sent_at`，按 email 去重，created_at desc 顺序

**不影响**：邮件发送主流程（SMTP / SendGrid / GAS）、`/admin/send-email` 接口、`/admin/email-history` 接口、手动添加邮箱、选择用户、删除/清空历史邮箱、照片墙 / 聊天 / 底部 Dock / 普通帖子 / 登录

### v0.89 - 2026-06-25 Pro 会员改为限量/限定/限时活动模式

**前端**：
- 删除 vipModal 中的常驻 ¥3/月 套餐卡（vipPlanCard / vipPayBtn / vipCancelArea）
- 删除 vip-modal-footer（订阅即表示同意服务条款 + 取消订阅）
- 删除个人资料卡 vipCard 中"¥3/月 · 解锁更多特权"，改为"活动由管理员限时发布"
- `updateVipModalUI` 重构：只显示当前 Pro 状态条 + 加载活动列表
- `handleVipPurchase` 改为只 toast 提示，不再调用 `__xtjDirectPurchasePro`
- `loadProGiftCampaigns`：无活动时显示"暂无可领取的 Pro 活动"空状态
- 活动卡片支持：专属标签、剩余名额、截止时间、功能权益
- 按钮状态：未领取 / 已领取 / 名额满 / 已结束
- pro-gifts 接口调用附带 Authorization Bearer token

**后端**：
- `/api/pro-gifts/available` 与 `/api/pro-gifts/claim` 加 authenticateUser 中间件
- claim 接口强制以 req.userName 为准，避免 body 任意 user_name 替别人领
- `/admin/pro-gifts/save` 支持 claim_limit / allowed_users / exclusive / start_at / end_at
- available/claim 严格过滤（已发布、未禁用、start_at/end_at/claim_expire_at、白名单、claim_limit、重复领取）

**admin**：
- 活动编辑器增加限量名额、限定用户（逗号分隔）、是否专属、活动起止时间字段
- saveProGift 提交 allowed_users 数组、exclusive 标志、claim_limit
- 活动列表显示"限量/已领"、"限定/专属"两列

**deprecated**：前端直接开通 Pro 入口已禁用，Pro 只能由管理员发布的活动领取

### v0.88c - 2026-06-24 邮件历史邮箱账户保存修复

- 后端 `/admin/send-email` 路由发送前先调用统一 `saveEmailRecipientHistory` 保存收件人历史
- 新增 `saveEmailRecipientHistory(recipients)` helper：去重 / 一次性查询 / 已有更新 / 新增插入
- 新增 `actor_key` + `media_url` 字段补齐，避免数据库字段限制或后续查询不稳定
- 邮件发送记录新增 `from_email` 与 `recipients_detail` 字段
- 前端 `loadEmailHistory` 改为显示：发件邮箱 / 主题 / 收件人 / 结果 / 详情（含展开）
- 前端 `loadEmailRecipientHistory` 展示 用户名 <邮箱> / 邮箱 两种形式
- 发送成功后自动清空已选 + 刷新历史 + 刷新记录
- `emailClearSelected` 添加到发送成功链

### v0.88b - 2026-06-24 邮件配置健康检查端点

- 新增 `/health/mail` 端点：返回 active_provider（GAS / SendGrid / Gmail_SMTP）以及 env 加载状态
- 修复 `SENDGRID_API_KEY` 误用 var 声明被覆盖的隐患
- 修复 `/admin/report/:id/delete-post` 和 `/admin/report/:id/ban-user` 端点缺少顶层 try-catch
- 修复 index.html / README.md / CHANGELOG.md 版本号不一致
- 升级 pro-upgrade.js query string 版本号到 20260624_progift

### v0.88a - 2026-06-24 Google Apps Script (GAS) 邮件中转

- 新增 GAS (HTTPS 443) 邮件中转通道，绕过 Render SMTP 465/587 端口封锁
- 邮件发送优先级：GAS (HTTPS 443) > SendGrid > Gmail SMTP（最终兜底）
- 失败链：GAS 失败 → SendGrid → Gmail SMTP
- 新增 `GMAIL_GAS_URL` 环境变量支持（IANA 不带空格）
- GAS Web App 部署权限必须设为"任何人"（Anyone）以允许未认证请求

### v0.87 - 2026-06-24 Pro赠送系统全面升级

**后端 (render-api/server.js)**：
- 🔴 **领取事务一致性**：Pro赠送领取时，VIP记录写入失败会回滚领取记录，避免"已领取但没拿到Pro"
- ✨ **手动赠送接口**：新增 `/admin/pro-gifts/manual-gift`，管理员可直接给指定用户赠送Pro，支持自定义天数/权限/备注
- 📊 **历史记录来源扩展**：新增 `admin_gift` 来源识别，区分"活动领取"、"管理员赠送"、"自主开通"、"付费购买"

**后台管理 (admin.html + js/admin/admin.js)**：
- 🎨 **Pro赠送页全面美化**：子Tab按钮、状态徽章、统计卡片、表格样式全部重做，与其他tab风格统一
- 🎁 **新增手动赠送功能**：工具栏加"手动赠送给用户"按钮，弹窗支持用户名/天数/权限/备注
- 📝 **活动列表升级**：新增"截止领取"列、描述预览、状态徽章（已发布/草稿）
- ✨ **编辑弹窗重做**：modal头/体/底三段式布局、form-row双列、feature-grid权限网格、焦点态动效

**前端用户端 (js/core.js + css/style.css + index.html)**：
- 🎨 **赠送活动卡片重做**：金色渐变边框、扫光动效、悬停抬升、时钟图标、剩余天数显示
- ⏳ **领取loading状态**：点击后按钮变"领取中..."，防止重复点击
- 🎉 **领取成功庆祝动画**：调用 `__xtjShowProCelebration` 弹出Pro升级庆祝弹窗
- ✅ **已领取卡片灰化**：已领取的活动卡片加 `.claimed` 类，半透明+灰度+不可点击
- 🏷️ **限时徽章**：标题区加"限时"金色渐变徽章，提升吸引力

### v0.86 - 2026-06-23 全面Bug修复

**后端 (render-api/server.js)**：
- **B1 VIP支付事务保护**：`processVipPayment` 先写VIP记录再更新订单状态，避免"钱付了VIP没开通"
- **M7 visitCache清理优化**：改为 `setTimeout` 异步延迟清理，避免同步 `forEach` 阻塞事件循环

**前端 (js/core.js)**：
- **B2 头像上传回滚**：先插入新头像记录，成功后再删除旧记录，避免"旧头像删了新头像插入失败" → 头像空
- **M1 doLogout彻底清理**：登出时遍历所有 `xtj_*` 前缀的 localStorage 键并清除，避免用户A登出后用户B看到A的缓存
- **M4 Observer内存泄漏**：`cleanupObservers()` 函数在 `beforeunload` 时 disconnect 所有 IntersectionObserver 并清理定时器
- **M5 restrictionPollTimer停止**：`doLogout` 时调用 `stopRestrictionPolling()` 避免轮询泄漏
- **M6 Supabase初始化检查**：`createClient` 前检查 `SUPABASE_URL` 和 `SUPABASE_ANON_KEY` 是否有效，无效时 `sb = null` 并输出错误

**前端 (js/features.js)**：
- **L1 乱码修复初始化**：`_buildMjRegex()` 在 IIFE 加载时立即执行，确保 `window.xtjFixText` 在任意调用时机都可用

**前端 (js/performance.js)**：
- **L4 浏览器兼容性**：`navigator.deviceMemory` 和 `navigator.hardwareConcurrency` 加 `typeof` 检查，兼容 Safari/Firefox

**前端 (js/photo-wall/upload-ui.js)**：
- **L5 deviceId 回退确认**：已有 `window.deviceId || ('photo_' + Date.now())` 回退，无需修改

**前端 (js/core-animations.js / js/ui-effects.js)**：
- 确认所有 `gsap` 调用已有 `hasGSAP()` 守卫，`isDockTab` 为局部函数——无需修改

**版本升级**：
- `index.html` 中 `desktop.css`、`core.js`、`core-animations.js`、`features.js`、`ui-effects.js`、`performance.js` 全部升级 query string 版本号

### v0.85

- **Pro 赠送活动系统**：管理员后台创建/编辑/发布 Pro 赠送活动，用户一键免费领取，每个活动限领一次；后台完整历史记录（来源/时间/次数）
- Pro 领取庆祝动画重做：暗色渐变卡片、来源展示、GSAP 分段入场
- 全量安全审计修复：XSS 高危漏洞修复（safeJsStr 全转义 + 注册字符限制）、Storage 路径遍历防护、后端错误信息不返回前端、RateLimit 边界修复、currentUser TDZ 修复、fetch 超时保护
- 设备型号识别全面升级：新增 UA 标识符映射表（30+ 型号），15 Pro Max 不再误判为 16 Plus
- 聊天列表头像即时更新：hydrateDockChatAvatars 改为全量检查，去掉 dockChatActiveUser 限制
- 地区中文显示：China·Guangdong·Guangzhou → 广东广州
- 用户详情卡片数据回填：最近访问/IP/地区/设备从登录事件自动回填，去掉安全提醒区块
- 举报弹窗 × 按钮独立样式修复
- 点赞/评论记录显示被操作人
- 未登录用户隐藏三大数据版块
- 管理员登出清理定时器与事件监听
- 邮箱发件地址修正确认
- 详细变更见 CHANGELOG.md

### v0.84

- 管理后台新增"安全中心"：同 IP 多账号、同设备多账号、多 IP 同账号、地区变化、高频访问五类安全提醒，支持已读/忽略/误报标记
- 后台用户列表新增"地区"列、"风险评分"列，最近 IP 显示完整 IP 不再打码
- IP 地区解析改为多源 fallback（ip-api.com / ipapi.co / ipwho.is），失败有日志
- 登录事件写入后同步更新 `__user_info__` 的 last_login、last_visit、last_device、last_ip、last_ip_location
- 客户端温和浏览器指纹（SHA-256 hash）+ Canvas 指纹（仅保存 hash，无原始像素/图像），受后台安全开关控制
- 客户端错误监控：JS error、unhandledrejection、fetch 失败、图片加载失败、白屏检测自动上报
- 管理员操作审计日志：删除帖子/照片、封禁/解封、禁言/解禁、清理日志、修改安全设置等操作全记录
- 用户详情弹窗（点击用户名打开）：注册时间、IP、地区、设备、指纹 hash、发帖/点赞/评论/照片统计、最近登录记录、安全提醒、处罚历史
- 指纹与 Canvas hash 仅保存截断值，浏览器阻止时优雅降级，不做跨站追踪，不采集剪贴板/通讯录/麦克风/摄像头
- 帖子流和 `/admin/data` 排除 `__login_event__` 与 `__security_alert__`，前台不泄露登录和安全数据
- 页面访问冷却改为 15 秒

### v0.83

- 统计弹窗恢复到旧版记录布局，不再继续沿用 `statHero` / `stat-row` 面板化样式
- “总动态”恢复为按用户分组的横向帖子记录结构，图片帖与视频帖重新显示正确缩略图 / 占位
- “总浏览”“点赞和评论”统一改回图文记录卡，评论内容独立显示，原帖缺失时明确回退为“原帖已删除”
- 关于页版本号、站内 changelog、仓库 `CHANGELOG.md` 与构建产物同步更新到 `v0.83`

### v0.82

- 首页三大统计卡片入口修复，“总动态 / 总浏览 / 点赞和评论” 现在都可正常打开统计详情弹窗
- 修复 `js/core.js` 运行时中断问题：`applyPerformanceMode()` 的作用域错误与旧 header 绑定入口干扰已处理
- 首页入口排查改为以浏览器真实点击结果为准，不再只依赖静态搜索或函数名检查

### v0.81

- 后台用户统计口径统一：
  - `/admin/stats/users` 现在合并 `__auth__`、`__user_info__`、`__user_visit__`
  - `/admin/stats/daily` 的 `new_users` 改为按 `user_name` 去重后统计最早注册时间
  - `/admin/stats` 的 `total_users` 改为按注册用户名去重
- 后台新增“新用户注册提醒”：
  - `GET /admin/users/register-alerts`
  - `POST /admin/users/register-alerts/read`
  - “用户数据”按钮支持红点数字提醒
- 照片墙移动端全屏预览手势修复：
  - 双指 pinch / 单指 pan / 左右切图 / 下滑关闭互斥
  - pinch 后不会再立刻被单击逻辑缩回原图
  - pinch 结束后松开一根手指会重建 pan 起点，不再突然跳回旧坐标
  - 预览层补齐移动端 `touch-action` / `overscroll-behavior` / `user-select` 保护样式

### v0.80

- 照片墙首屏加载数量提升到 60
- 上传后即时追加与实时重取链路收口
- 多处 XSS 与前端调试残留清理

## 当前维护注意点

- 照片墙预览的未压缩源文件 `js/photo-wall/preview.js` 已补齐，仓库内同时维护：
  - `preview.js`（源文件，改完需执行 `npm run build`）
  - `preview.min.js`（构建产物）
  - `preview-hotfix.js`（历史热修复入口，仍保留引用）
- `npm run build` 的构建清单中，`js/photo-wall/*` 源文件（`data.js`、`render.js`、`photo-wall.js`、`upload-ui.js`、`preview.js`、`preview-hotfix.js`）当前均已就位，不再存在"跳过缺失源文件"的情况。
- `scripts/build.js` 仍保留 3 个 optional 条目（`upload-ui.js`、`preview.js`、`preview-hotfix.js`），仅作为未来源文件可能缺省时的降级保护；一旦缺失，构建日志会输出 `[SKIP]` 提示。

这表示：

- 照片墙构建链已完整，可直接修改上述源文件后执行 `npm run build` 重新产出 minified 产物。

## 环境与配置注意

- 项目使用 Supabase。
- Render 部署的环境变量来自 `render.yaml` 声明 + Render Dashboard 手动配置，**不依赖**仓库内的 `render-api/.env`（该文件不存在，也不应提交）。
- `render.yaml` 中要求手动配置的关键变量包括：
  - `ADMIN_PASSWORD`
  - `SUPABASE_SERVICE_KEY`
  - `API_SECRET`
  - `SUPABASE_URL`
  - `ADMIN_USERNAME`

额外提醒：

- `API_SECRET` 如果在部署更新后被重置，会导致后台登录态失效。
- 仓库内不存在 `render-api/.env` 或任何支付/密钥文件（已核对），密钥一律通过 Render Dashboard、CI secrets 或环境变量注入，不要将密钥文件提交到仓库。

## 部署后注意事项（重要）
- **数据库迁移不会随代码自动执行**：涉及表结构 / RPC / 索引的变更，需要到 Supabase 的 SQL Editor 手动执行 `supabase/migrations/` 下对应文件。当前版本关键迁移：
  - `052_cat_ai_hardening.sql`：小猫 AI 唯一部分索引、孤儿回复清理、配额返还 RPC、咨询锁哈希升级。
  - 迁移语句均为幂等设计，可重复执行；执行后再部署对应后端代码。
- **改前端源码必须重新构建**：线上 `index.html` 只加载压缩产物。修改 `js/core-parts/`、`js/ai-agent.js`、`js/code-workbench.js`、`css/*.css` 后，必须依次执行 `node scripts/assemble-core.js`（仅改 core 分片时需要）与 `npm run build`，由构建刷新 `*.min.js`、`*.min.css` 以及 HTML 里的 `?v=` 内容指纹；可再跑 `node scripts/check-build-consistency.js`，期望 Errors 0 / Warnings 0。
- **Code 工作区 Token 安全**：GitHub Personal Access Token 只保存在浏览器本地，用于服务端白名单代理；建议使用仅对目标仓库 Contents / Pull requests 授权的 fine-grained token，公共设备上取消“记住 Token”，用完及时在 GitHub 撤销。
- **自定义模型 API Key**：经 AES-256-GCM 加密后随账号存储，加密密钥来自服务端环境变量；更换密钥会导致历史密文无法解密，需重新填写。
- **提交前自测**：`npm run test:syntax` 做全量语法检查，`npm test` 跑单元 + 契约 + 回归，避免把好的功能改坏。

## 文档同步约定

每次发版建议至少同步这三处：

1. `CHANGELOG.md`
2. `index.html` 中关于页版本号（当前 `v0.94`）
3. `js/core.js` 中站内 changelog 数据

这样可以避免“仓库版本、站内版本、关于页版本”再次分裂。
