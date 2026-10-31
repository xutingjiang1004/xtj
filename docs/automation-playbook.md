# 每日自动化维护手册（前端 + 后端）

建立于 2026-10-31。依据用户的明确指示：每天台北时间早上按板块自动找 Bug、修复，由「大哥」会话统一合并到 `main`（Render 随之自动部署）；目标是减少 Bug、让动画更流畅、让交互更顺手；2026-10-31 补充：**后端也纳入，网站前端后端全部交给大哥和这些会话**。

这份手册是所有定时会话的共同依据。会话提示词很短，细节都在这里。冲突时的优先级：用户最新的明确指示 > `AGENTS.md` > `docs/current-product-decisions.md` > 本手册 > 历史代码和旧交接。

## 1. 运行方式

| 台北时间 | 会话（定时任务名） | 范围（前端 + 对应后端接口） | 产出 |
| --- | --- | --- | --- |
| 06:00 | 每日帖子板块巡检与修复 | 帖子、评论、点赞、发布、个人动态页、公告与举报 | 分支 `maint/posts-日期` |
| 07:00 | 每日照片墙巡检与修复 | 照片墙、上传、预览（与帖子图共用）、照片接口与预览缓存 | 分支 `maint/photos-日期` |
| 08:00 | 小猫AI每日巡检修复 | 小猫 AI 页、深入研究、`/api/agent/*` 与模型链路 | 分支 `maint/ai-日期` |
| 09:00 | 每日我的设置登录巡检与修复 | 登录注册、个人资料、设置、头像、账户与安全接口 | 分支 `maint/profile-日期` |
| 09:00 | 每日聊天页巡检与修复 | 私聊、发送队列、图片/语音、未读、通知、`/api/dm/*` | 分支 `maint/chat-日期` |
| 10:00 | 每日全局弹窗动效巡检与修复 | 弹窗、提示、转场、加载态、桌面外壳、性能、可访问性 | 分支 `maint/global-日期` |
| 10:00 | 每日服务端与管理后台巡检与修复 | `render-api` 基础设施、管理后台、安全头、日志、存储清理 | 分支 `maint/server-日期` |
| 11:00 | 每日大哥整合与推送 | 审查并合并当天所有 `maint/*` 分支，全量验证后推送 `main`，汇报 | 推送 `main` + 每日汇报 |

（实际分钟数会略早于整点，是为了错开平台高峰，不影响分工。）

- 模块会话**只推自己的分支 `maint/<模块>-<日期>`，不合并，不推 `main`**。分支就是交付物，说明写在最后一个提交的提交信息里（不依赖 PR：2026-10-31 试跑发现，新开的定时会话没有 GitHub 的 MCP 工具，也没有推送权限，所以改用常驻会话，见第 12 节）。大哥统一合并，避免多条分支同时改生成文件（`js/core.js`、`*.min.*`、`index.html` 指纹）互相冲突。
- 当天没发现确认存在的问题：**不造改动、不推分支**，一句话汇报「今天未发现新问题」并写清检查了什么。
- 用户每天自己验收，所以合并前不需要真机确认；但**必须如实写出哪些没法在浏览器里验证**，让用户知道去手机上看哪里。
- 会话是无人值守的：不要向用户提问，不要等待回复。

## 2. 铁律（所有会话，逐条遵守）

1. **先读**：`AGENTS.md`、`docs/current-product-decisions.md`、`CHANGELOG.md` 最新一条、本手册里自己板块的工单。用户已明确的决定优先；不要把用户确认过的设计当成 Bug，不要恢复已退役的功能。
2. **底部 Dock 一律不碰**（`.dock-bar`、`.dock-tab`、`.dock-indicator`、`#dockBar`、`dock-liquid-*`、`.dt-icon`、`.dt-label`）：材质、尺寸、顺序、SVG、动画、遮罩、文字颜色都不动。`guards.sh` 和 `pr-check.js` 会检查。
3. **首页帖子页的版面和 UI 冻结**（`#panelPosts`、`css/post-feed.css`、`css/author-posts.css`）：只修「看不出变化」的 Bug。`posts-diff.js` 必须是 0 差异；确有差异时在分支描述里逐条解释为什么是 Bug 修复。
4. 不做液态玻璃统一；不在不合适的地方加胶囊按钮；不改产品行为、不加新功能、不重构——**只修 Bug 和流畅度问题**。
5. 只改源文件（`js/core-parts/*`、`js/*.js`、`css/*.css`、`render-api/*.js`、`admin.html` 等），再 `npm run build`；不手改 `js/core.js` 和任何 `*.min.*`。
6. 不创建、不提交审计报告、修复报告、验收报告及其截图/JSON；过程写进分支描述（最后一个提交的正文）和最终汇报；临时产物放 `output/maintenance/`（已被 git 忽略）或 `/tmp`。
7. **一个修复一个提交，一条回归测试**：测试在修复前失败、修复后通过。浏览器流程用真实页面驱动，不要把被测的函数（例如 `xtjConfirm`）换成桩，曾经因此漏掉过「确认删除没反应」。
8. **改动要小**：每个修复不超过约 200 行，每个分支最多 3 个修复、不超过 800 行；多出来的留到明天，写进汇报。
9. **后端兼容优先**：不改前端依赖的响应字段和状态码；不改限流、配额、鉴权、CSP、CORS 的阈值与策略（这些是产品和安全取舍，写进「需要你决定」）；不引入新依赖；日志里不写密钥和个人信息。
10. **数据库与线上配置不碰**：只能新增向后兼容的迁移文件（`supabase/migrations/`），**不应用**，不改已有迁移，不碰数据；代码必须在迁移未应用时也不会变坏。不碰 `render.yaml`、`.github/`、环境变量、密钥、依赖文件、`package.json`（新测试由大哥登记）。绝不向生产环境发测试请求或写测试数据：`harness.js` 与 `backend-smoke.js` 都只连本机或死地址。
11. **Git**：只推 `maint/<模块>-<日期>` 分支（本会话碰巧有 GitHub 工具时可同时开 PR）；不推 `main`、不合并、不强推、不删别人的分支；提交信息末尾带上本会话系统提示给出的署名行。
12. 不跳过、删除、弱化测试来换取变绿。与 `main` 基线对比，只对**新增**失败负责；基线里本来就失败的要点名。
13. **拿不准就不改**：会改变产品行为的大改动、需要用户取舍的事，写进「需要你决定」，不要自作主张。
14. **浏览器模拟和 Linux 环境不等于 iPhone/iPad 真机**：涉及触摸、手势、Safari 视口与键盘、性能的修复，分支描述里标「需真机复核」并说明看哪里。
15. **省额度**：模块会话总时长不超过 60 分钟；不要整文件读取 `render-api/server.js`（约 2.8 万行）、`js/core.js`、`js/ai-agent.js`，用 `grep -n` 加范围读取；命令输出用 `| tail -n 40` 截断；不要用 `sleep` 轮询，需要等待就放后台。同一个问题两次尝试都没修好就停，写进「未修」。

## 3. 冷启动（常驻会话被唤醒时，容器可能是新的，仓库会重新克隆，依赖和构建产物要重装）

```bash
# 常驻会话创建时就挂好了仓库并带推送权限：直接进仓库目录（用 `git rev-parse --show-toplevel` 确认）。不要裸 `git clone` 另起一份：那份只能读，推不了。
cd <仓库目录>
git fetch origin main
git checkout -B maint/<模块>-$(TZ=Asia/Taipei date +%Y%m%d) origin/main
[ -d node_modules ] || npm ci --no-audit --no-fund
npm run build && git status --short        # 必须干净；不干净说明 main 的生成文件过期，写进汇报
scripts/maintenance/serve.sh               # 工作树 http://127.0.0.1:4173
scripts/maintenance/baseline.sh            # origin/main 对照 http://127.0.0.1:4174
node scripts/maintenance/smoke.js          # 四种配置各点一遍底部标签，应 0 页面错误
```

- 浏览器：Chromium 已预装，`require('playwright')` 直接可用；测试若找不到 `/usr/bin/chromium`，`run-tests.sh` 会自动设置 `CHROMIUM_PATH=/opt/pw-browsers/chromium`（也可手动 `ln -sf /opt/pw-browsers/chromium /usr/bin/chromium`）。
- 数据库测试需要本地 PostgreSQL：`eval "$(scripts/maintenance/pg.sh)"`（`run-tests.sh` 会自动调用）。没有它们时数据库测试会被**跳过并算通过**，汇报里要写「跳过了 N 个」。
- 不依赖 GitHub 的 MCP 工具：用 `git push` 推分支；会话里碰巧有 `mcp__github__*` 时可以顺便开 PR（仓库没有 PR 模板），但没有也不影响流程。

## 4. 每日流程

1. **同步与基线**：冷启动；`git log --since="3 days ago" --stat --format='%h %s' origin/main | head -60` 看近几天谁改了你的板块——**近期改动最容易引入回归，先查它们**。
2. **巡检**：按自己的工单逐项检查（第 8 节），用 `harness.js` 驱动真实页面、读控制台、对比浅色/深色、手机/桌面；后端用现有测试夹具和 `backend-smoke.js`。每个疑点先复现，再找根因。
3. **排序**：严重度 P1 崩溃/数据错误/安全 > P2 流程不可用/明显错乱 > P3 动画卡顿、闪烁、小瑕疵；同级里先修把握大、改动小的。最多取 3 个。
4. **修复**：最小改动，改源文件，补回归测试。
5. **验证**：`scripts/maintenance/guards.sh`（构建一致性、语法、Dock 0 差异、帖子页 0 差异；改了后端会自动再跑 `backend-smoke.js`）；`scripts/maintenance/test-compare.sh '<本板块筛选>'`（只看新增失败）；动画类修复前后各跑一次 `probe-motion.js` 或 `bench-ai.js`，写出两组数字。
6. **提交与推送**：一个修复一个提交；整份描述（第 7 节模板）写进**最后一个提交的提交信息正文**（大哥靠它审查，`git log -1 --format=%B` 能读到）；`git push -u origin <分支>`。不要自己合并，不要推 `main`。
7. **汇报**：最终回复按第 11 节格式写，中文，尽量短。

## 5. 找问题的方法

**什么算 Bug**：能复现的错误行为——崩溃、控制台报错、流程走不通、数据错乱、重复触发或丢失、卡住不动、状态残留、竞态、泄漏（监听器/定时器/内存）、深色模式对比度不足（正文低于 4.5:1）、布局溢出或被裁切（320–1280px）、点击区域过小或点不中、焦点与键盘不可用、缺少可访问名称、时间/时区格式错误、错误提示不准确。
**不算 Bug**：口味差异、用户已确认的设计、没有测量支撑的「优化」、需要产品取舍的行为变化。

**流畅度与交互**（用户的明确目标）：
- 动画：入场/退场/折叠/转场有没有掉帧、闪烁、重复触发、残留、回弹；「减少动态效果」下是否精简。用 `probe-motion.js` 量帧间隔、长任务、布局偏移，列出哪些过渡在跑。无头 Chromium 是软件渲染，**绝对数字比手机差很多**，只做修改前后的相对对比，并如实写明。
- 交互：点击到出现反馈应在 100 ms 内；长任务（>50 ms）出现在交互里就要查原因；手势冲突（捏合与滑动、滚动与下拉）；连点、快速切换标签是否出错；慢网和断网时的提示。
- 流式输出（小猫 AI）：`bench-ai.js` 量一次长回答的帧间隔和长任务。

**常用工具**（都在 `scripts/maintenance/`，开头注释有用法）：
- `harness.js`：打开真实页面，所有 `/api` 与 Supabase 调用都已模拟（7 条帖子、评论含小猫 AI 回复、14 张照片）；`open({theme, viewport, mobile, user, fixedTime, extraRoutes})` 返回 `page`、`errors`、`consoleMsgs`、`failed`、`calls`；`shot(page, 名字)` 存到 `output/maintenance/`。要模拟接口失败或慢响应，用 `extraRoutes`。
- `ai-mock.js`：模拟小猫 AI 的流式接口，可逐条发 `reasoning`、`content`、`tool_calls`、`tool_result`（需 `success: true`）、`done`。
- `probe-motion.js`、`bench-ai.js`：流畅度测量。`smoke.js`：四种配置冒烟。`backend-smoke.js`：用一次性密钥和死地址启动真实服务端并检查。
- 现成夹具：`tests/helpers/post-browser-fixture.js`、`ai-polish-fixture.js`、`backend-database-fixture.js` 等；后端模块测试多用 `express` + `supertest` 加假 Supabase。
- 只读检查线上：`https://xtj.onrender.com/health`；不要对生产发写请求。

## 6. 修复与测试规则

- 先复现、再根因、再修，不要只改表象；同一根因的多处表现合成一个修复。
- 修在根因所在的共享代码里时，说明影响面；不要碰与本板块无关的功能。
- 回归测试放进 `tests/` 下已有的对应文件，或新建 `tests/<主题>.test.js`；**不要改 `package.json`**，大哥会用 `register-tests.js` 登记新文件。
- 修复前后各跑一遍新测试，记录「修复前失败、修复后通过」。
- 改了生成文件的源文件后一定 `npm run build`，并提交生成结果（`js/core.js`、`*.min.*`、`index.html` 指纹）。

## 7. 分支描述模板（中文，写在最后一个提交的正文里；有 PR 时同样贴进 PR 描述）

```
## 摘要
板块：<帖子/照片墙/…>　分支：maint/<模块>-<日期>
- <每条一句话，说清用户能看到的变化>

## 修复
### 1. <标题>（P1/P2/P3）
- 现象与复现步骤：
- 根因（文件:行）：
- 修复：
- 回归测试：<文件> 「<测试名>」，修复前失败、修复后通过

## 验证
- guards.sh：<Dock 0 差异；帖子页 0 差异或逐条解释>
- test-compare.sh '<筛选>'：<N 个文件，新增失败 0；基线失败：…；跳过：…>
- 流畅度：<前 → 后的数字，注明无头软件渲染只作相对对比>
- 需真机复核：<看哪里>

## 需要你决定
- <问题 · 选项 · 我的建议 · 影响>；没有就写「无」

## 待应用迁移
- <文件名 · 作用 · 没应用时代码如何保持可用>；没有就写「无」

## 更新日志条目（大哥会写入 CHANGELOG.md，会话自己不要改它）
- <中文，沿用现有格式>

## 未改动
- Dock；帖子页版面（适用时）；后端接口形状（适用时）
```

## 8. 各板块工单

通用提醒：每个板块都先看第 4 节第 1 步的近期改动，再按下面的清单。后端部分只修 Bug，兼容优先。

### 8.1 帖子（06:00）——UI 冻结
- **前端**：信息流与无限滚动；发布区（文字/图片/视频/音频/定位/可见范围/进度与动效/失败重试）；点赞；评论（预览、详情页、分页、回复层级、头像、小猫 AI 回复与轮询、删除）；帖子删除、置顶、公开/私密切换；帖子详情；图片视频预览与原图加载与缩放手势；搜索与筛选；更多菜单（小猫 AI 对话、深入研究、站内搜索、翻译、锐评、举报）；点头像进入的个人动态页；公告与举报弹窗；骨架屏、加载与错误重试；亮色/深色；390/1024/1280px。
- **后端**：`/api/feed`、`/api/post/*`、`/api/comments`、`/api/likes`、`/api/announcements`、`/api/report`；`render-api/post-*.js`、`author-posts.js`、`feed-search.js`、`post-attachments.js`、`post-media.js`。
- **常见 Bug 类型**：分页游标重复或漏条；乐观点赞重复计数；评论数不一致；删除后刷新又出现（缓存）；发布后信息流缓存过期；双击发布发两次；上传失败留下孤儿媒体；私密帖泄露给他人；超长文本与超长网址溢出；昵称里的 HTML；相对时间在跨天时出错；轮询泄漏。
- **不许碰**：`#panelPosts` 的版面、配色、字号、间距、图标；决定文档里「等用户拍板」的项目（头像取色、评论里的 🐱 换线稿、顶栏按钮过渡）。
- **筛选**：`'post|feed|author-posts|comment|like|announce|report|search'`（约 37 个文件）。
- **已知基线**：`post-attachments-browser`「real composer appends…retry succeeds」、`frontend-social-audit-runtime`「failed media publish uses authenticated cleanup…」「cached posts beyond the first visible page remain expandable…」在修复前就失败，原因待用户决定，除非有确凿证据否则不要动。

### 8.2 照片墙（07:00）
- **前端**：照片格子（渲染、懒加载、扫光占位）；排序与相册；上传面板（选图、紧凑行、说明、进度、失败原因）；顶部上传成功提示；全屏预览（与帖子图共用：左右切换、放大缩小按钮、双指、滚轮、双击、键盘、计数、先预览后原图）；删除、可见性、说明编辑；相册故事页；分享；游客只读；桌面与手机；深色；减少动态效果。
- **后端**：`/api/photo/*`、`/api/photos/*`；`render-api/photo-*.js`、`media-previews.js`、`media-traffic.js`、`flash-photos.js`、`storage-cleanup.js`、`upload-access.js`。
- **常见 Bug 类型**：滚动掉帧与图片解码内存；预览闪烁；手势冲突；上传重复、编号冲突、部分失败；孤儿存储对象；预览缓存雪崩；免费流量额度超支；他人照片的权限检查；EXIF 方向；分页。
- **决定要点**：预览与帖子图共用；+/− 按钮保留；等待用扫光而非「小草」；照片墙进入只做透明度；列表预览 1080/q80。
- **筛选**：`'photo|preview|media|upload|flash|share'`（约 30 个文件）。

### 8.3 小猫 AI（08:00）
- **前端**：发送、流式、停止、重新回答、复制/朗读/收藏/分享、长按与右键菜单；思考时间轴（思考直接显示 → 写出过渡句或调用工具时折进那一步 → 回复完成后整体折叠成「已思考」）；工具与搜索行；多轮推理与联网搜索；深入研究页；历史会话（打开、关闭、重命名、删除、翻页）；上下文详情与压缩；模型菜单与第三方模型；附件；语音对话；Markdown（表格、代码、引用）；顶栏与输入栏；桌面 760px 阅读栏；游客与配额提示；错误与重试。
- **后端**：`/api/agent/*`（约 32 个）；`render-api/ai-*.js`、`deepseek-*.js`、`openrouter.js`、`research-*.js`、`responses-context.js`、`sse-*.js`、`sandbox.js`、`search-*.js`、`web-fetch.js`、`image-ocr.js`、`file-parsers.js`。
- **工具**：`bench-ai.js`、`ai-mock.js`、`tests/helpers/ai-polish-fixture.js`。
- **常见 Bug 类型**：流式渲染抖动；滚动跟随冲突；SSE 分块里的 UTF-8 截断与重复/丢块；工具轮次顺序；停止后界面仍显示「思考中」；历史分页重复；配额计数竞态；提供方失败的降级与错误分类；上下文与 token 记账；长对话内存增长。
- **第一件事**：`main` 上 `npm test` 的第一组因 `tests/ai-stream-latency-runtime.test.js`「semantic completion starts the next genuine tool round…」失败而一直是红的（见第 10 节）：测试的 `vm` 作用域缺 `modelFacingToolResult`，生产代码没问题。修好这个夹具即可，不要改生产代码去迎合它。
- **筛选**：`'ai-|agent|research|openrouter|deepseek|stream|markdown|sse|sandbox'`（约 88 个文件，约 5 分钟）。

### 8.4 聊天（09:00）
- **前端**：私信列表与会话；发送队列（气泡立即出现、顺序、幂等、重试）；图片（扫光占位、超时重试）；语音与转写；撤回；已读（按 200 条分批）；未读角标；通知与 Service Worker（`chat-notifications-sw.js`）；实时通道与轮询降级；好友（添加、删除、备注、拉黑）、免打扰、搜索；草稿同步；iOS 键盘与视口；断网与慢网。
- **后端**：`/api/dm/*`（约 12 个）；`render-api/chat-*.js`、`dm-*.js`、`adaptive-poller.js`、`mail-transport.js`（未读邮件提醒）。
- **常见 Bug 类型**：消息重复或乱序；切会话丢草稿；已读状态回退；未读数漂移；重连后漏消息；大图或语音占内存；推送重复；键盘遮挡输入框。
- **决定要点**：清空、删除会话、删除好友、拉黑、改备注使用站内弹窗；聊天页头部重排等用户未拍板，不要做。
- **筛选**：`'chat|dm-|push|notif|mention|voice|transcri'`（约 20 个文件）。

### 8.5 我的 · 设置 · 登录（09:00）
- **前端**：登录、注册、退出（右上「×」保持现状，不加确认）；会话刷新与吊销；设备登录记录；个人资料与头像上传裁剪；昵称规则；设置开关（布尔设置统一用开关）；数据导出与清理；举报与「我的」列表；主题（浅色/深色/跟随）；操作震动；原图预加载设置；同意与定位历史；IP 属地显示；游客限制（`02-auth-restrictions.js`）。
- **后端**：`/api/user/*`、`/api/avatar/*`、`/api/security-settings`、`/api/my-reports`、`/api/log-*`、`/api/location`；`render-api/profile-settings.js`、`profile-records.js`、`auth-record.js`、`account-*.js`、`behavior-consent.js`、`personal-export.js`、`location-history.js`、`ip-*.js`、`security-activity.js`。
- **常见 Bug 类型**：刷新令牌竞态与丢失回执；多标签页退出；退出后残留缓存的用户；头像缓存过期；表单边界（昵称长度、空白、Unicode）；设置没保存；导出大数据失败；时区；错误文案不准。
- **筛选**：`'profile|settings|login|auth|account|avatar|consent|refresh|register|revoke|ip-|location'`（约 28 个文件）。

### 8.6 全局：弹窗 · 动效 · 性能（10:00）
- **前端**：站内弹窗体系（`xtjConfirm`/`xtjPrompt`、遮罩、实底卡片、焦点陷阱、Esc、滚动锁、层叠）；提示；面板与标签转场；减少动态效果；加载态（扫光、骨架）；离线与错误；桌面侧栏与手机 Dock 的一致行为（只看行为，不碰 Dock）；安全区、视口、键盘；主题切换闪烁；Service Worker 与缓存（部署后旧资源、`?v=` 指纹）；性能（长任务、重排、切标签时的监听器与定时器泄漏、图片解码）；可访问性（焦点环、aria、对比度、点击区）；全站控制台报错与 CSP 违规。
- **工具**：`probe-motion.js`（切标签与弹窗的前后对比）、`smoke.js`。
- **不许碰**：Dock；帖子页版面；液态玻璃统一。
- **筛选**：`'navigation|haptic|theme|performance|layout|modal|toast|motion|ux-|ui-|desktop|dialog|confirm|viewport'`（约 15 个文件）。

### 8.7 服务端 · 管理后台 · CI（10:00）
- **后端基础设施**：`render-api/server.js` 启动与环境检查；安全头、CSP、CORS（`security-headers.js`、`trusted-proxies.js`）；限流；错误处理与日志（不写密钥与个人信息）；`/health` 与保活；静态服务的敏感路径黑名单；上传限制；优雅关闭；定时器与内存泄漏；`supabase-availability.js`、`db-result.js` 的重试与错误分类；`storage-cleanup.js`、`storage-orphan-scan.js`；`media-digest.js`；`ip-geolocation.js`；`mail-transport.js`。
- **管理后台**：`admin.html`、`js/admin/*`、`css/admin.css`、`/api/admin/*`、`admin-*.js`、`admin-statistics.js`。`docs/admin-audit-fixes-2026-10-21.md` 记录了待应用的迁移和未验证的范围，重新核对后再动。
- **CI**：先看自己有没有 `mcp__github__actions_list`：有就只读查 `ci.yml` 在 `main` 上最近一次的结果，哪个作业红了、第一个失败的测试是什么，写进汇报；没有就跳过。`.github/` 不要改。
- **常见 Bug 类型**：未捕获的异常或 Promise 拒绝；超时与重试风暴；日志泄密；路径穿越；限流绕过；请求体大小；时序与竞态；数据库错误被吞；资源未释放。
- **筛选**：`'admin|backend|security|server|media-traffic|database|migration|health|cors|csp|headers|storage|rate'`（约 32 个文件）。

## 9. 大哥整合（11:00）

大哥是唯一能合并到 `main` 的会话。步骤：

1. 冷启动（第 3 节），再 `git fetch origin main '+refs/heads/maint/*:refs/remotes/origin/maint/*'`。`git branch -r --no-merged origin/main --list 'origin/maint/*'` 列出还没合并的 `maint/*` 分支；其他分支不管。
2. 逐个（最早的先）审查：`node scripts/maintenance/pr-check.js origin/main origin/maint/<名字> --integrator`（HARD 不通过就不合并，写进汇报）；读分支最后一个提交的正文（`git log origin/main..origin/maint/<名字> --format=%B`）和 diff，确认修复和描述一致、有回归测试、没有越界。GitHub 的 CI 看不到，由第 5 步的本地验证代替：`test:syntax` 在 `guards.sh` 里，数据库测试在 `test-compare.sh` 里（有 PostgreSQL 时）。
3. 新建 `maint/integrate-<日期>`（从最新 `origin/main`），逐个 `node scripts/maintenance/merge-pr.js origin/maint/<名字>`（自动处理生成文件与指纹冲突；源文件冲突手工解决、`git add`、`git commit --no-edit`）。全部合入后 `node scripts/maintenance/register-tests.js` 登记新测试，`npm run build`，提交生成结果。
4. 写**一条**当天的 `CHANGELOG.md` 条目（把各分支描述里的「更新日志条目」合在一起，沿用现有格式）；只有产品行为的决定变了才改 `docs/current-product-decisions.md`。
5. 全量验证：`scripts/maintenance/guards.sh`；`scripts/maintenance/test-compare.sh`（全量，约 70 分钟，放后台，不要轮询）。出现新增失败：逐个分支单独复测找出元凶，把它从整合里拿掉（写进汇报）、重建、重新验证。
6. 推送：`git fetch origin main`；`main` 又前进了就合并进来、重建、重跑守卫和受影响的测试；然后 `git push origin maint/integrate-<日期>:main`（必须是快进）。最多重试 3 次，**绝不强推**。已经完全并入 `main` 的 `maint/*` 分支可以用 `git push origin --delete` 删掉（只删这一类；被拒绝就留着）。
7. 线上确认：后台轮询 `https://xtj.onrender.com/` 直到 `core.min.js?v=` 指纹与本地一致（最多 15 分钟），并检查 `/health`。环境访问不了就写「线上未验证」。若部署后 `/health` 连续失败，立刻对引起问题的合并提交 `git revert -m 1`、验证、推送，并在汇报里写明。
8. 陈旧分支（超过 3 天、有冲突或已被取代）：写进汇报，不删除未合并的分支。连续多天同一个会话失败，也写进汇报。
9. **迁移与决定**：汇总所有「待应用迁移」和「需要你决定」，放在汇报最前面，不要自己应用迁移。
10. 汇报（第 11 节格式）；用推送通知把摘要发给用户。

## 10. 已知基线（2026-10-31）

- **CI 的 `Test` 作业在 `main` 上一直是红的**：`npm test` 是一条 `&&` 串起来的长命令，第一组里 `tests/ai-stream-latency-runtime.test.js` 的一个测试失败（`modelFacingToolResult is not defined`，是测试夹具过期，不是生产 Bug），后面各组和 `UI Tests` 都没有跑。修好后后面的组可能暴露更多问题，逐组处理，不要靠跳过来变绿。
- `Syntax Check` 和 `Database migrations and atomic APIs` 两个作业在 `main` 上是绿的，必须保持。
- 云端沙箱里约有 30–40 个测试文件在 `main` 上就失败（缺少 Docker/PostgREST、部分依赖等）。**永远用 `test-compare.sh` 与 `main` 对比，只对新增失败负责。**
- `render.yaml` 的构建命令是 `npm ci && npm run build && npm run test:syntax && npm run test:consistency && npm run test:smoke`，合并后会自动部署：部署前没有完整测试把关，所以大哥的全量对比就是最后一道闸。
- 浏览器与无头 Chromium 的帧率、内存都不代表手机。

## 11. 汇报格式

模块会话最终回复（中文，约 25 行以内）：
1. 一句话结论：修了几个、推了哪个分支 / 今天未发现新问题。
2. 修复清单：每条一句话，写用户能看到的变化。
3. 没修的：问题和原因。
4. 需要你决定 / 待应用迁移。
5. 验证：守卫、测试对比（基线失败点名）、前后数字；没验证的（真机）明说，以及请用户在手机上看哪几处。

大哥最终回复：合并了什么（按板块）；没合并的和原因；**需要你决定 / 待应用迁移**；线上状态；请在手机上重点看的几处；基线状态；今天哪个会话失败了或额度用尽。

## 12. 运维清单（谁被谁唤醒）

每个板块是一个常驻工作会话（名字 `每日·<板块>`，创建时就挂了仓库并带推送权限），每天由一个定时任务按台北时间唤醒。会话的上下文会跨天保留，所以每次唤醒都要重新读手册、从最新 `origin/main` 开新分支，不沿用旧分支。

| 板块 | 常驻会话 | 定时任务（台北时间） |
| --- | --- | --- |
| 帖子 | `session_016rCJpV9uHyxQBhXGixnmtG` | `trig_01A3K7J4jFFUXa3i5bDW9bwg`（05:48） |
| 照片墙 | `session_016rCJpToc9ExPgcqQ7kQ1EE` | `trig_0111dHj92TjB1VDjSDpdnRtW`（06:49） |
| 小猫 AI | `session_016rCJpTu3ZtSHnvr98reymJ` | `trig_01Mwxixd6tAsPLrdhPCRGNVq`（07:48） |
| 我的 · 设置 · 登录 | `session_016rCJpVBYXPwtRzttDKggex` | `trig_01Vhm8q6W5sVUVuPn325vx5M`（08:46） |
| 聊天 | `session_016rCJpSrYTsmFa2D9xffJCx` | `trig_016cQuJvfDTBSgrG8MoxomA2`（08:49） |
| 服务端 · 管理后台 | `session_016rCJpUzuooyfsWtDTaXW8T` | `trig_0192GgWEfRviaGqgrXPHYEFe`（09:44） |
| 全局 | `session_016rCJpRVnGeYT5LhjWx9tLn` | `trig_01NPWRVaEyAnDuYmJ9UbMnYx`（09:46） |
| 大哥整合 | `session_016rCJpUhcFjKAqWNdrhtBbd` | `trig_01UQM56KP1nsaJeQ9ZCEtguJ`（11:00） |

- 暂停某个板块：`update_trigger` 设 `enabled=false`；改成隔天一次：改 cron（例如 `CRON_TZ=Asia/Taipei 48 5 */2 * *`）；改提示词：`update_trigger` 的 `prompt`（要改的是整段，所以细则尽量放在本手册里，提示词只保留摘要）。
- 常驻会话不能改系统提示；它们靠定时任务里的消息和本手册工作。需要换会话时：`create_session`（带 `source_url`）建新会话，`create_trigger` 的 `persistent_session_id` 指向它，再删旧的定时任务。
- 用户白天自己用的交互式会话（帖子、照片墙、小猫AI、聊天、前端网站审计报告）不在这套系统里，它们的改动会随时合进 `main`，所以大哥推送前总要重新 `git fetch`。
