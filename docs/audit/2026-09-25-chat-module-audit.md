# 聊天板块（私聊 DM）深度审计报告

- 审计对象：前端「消息」面板（Dock 私聊），即用户与用户之间的一对一私信
- 仓库版本：`main` @ `21103bd9`（2026-09-25 已与 GitHub 同步）
- 审计方式：全量阅读前端聊天源码 + 后端 DM 接口 + 数据层迁移与 RLS 策略 + CSS 级联，逐条交叉验证；结论均给出 `文件:行号`
- 审计范围说明：**不含**「小猫 AI」对话模块（`js/ai-agent.js`，独立面板 `#panelAiChat`）。若需要，可另出一份

---

## 0. 一句话结论

**当前聊天板块不是"有 bug 的 IM"，而是"缺了 IM 的地基"。**

消息体本身（发送、媒体、撤回、已读、乐观渲染、增量 DOM 复用）做得相当扎实，工程细节甚至比很多商业项目用心；但**三根地基是断的**：

1. **实时推送从未生效**（`posts` 表根本不在 Realtime publication 里，且 RLS 不允许读 `__dm__`，且 Realtime 连接从未用本应用 JWT 鉴权）—— 所以"秒回"不存在，一切靠 60 秒 / 5 分钟轮询兜底，连带的站内通知、撤回同步全是死代码。
2. **未读角标被恒定写成 0**（浏览器直连 Supabase 查私信，被 RLS 拦成空数组后把 0 写回角标）—— 用户会漏消息。
3. **没有"会话"这个实体**，会话列表是用「最近 180 条消息」在前端现推出来的 —— 会话会凭空消失、未读数必然少算，且**无法实现置顶 / 免打扰 / 删除会话 / 未读持久化**，这几项恰恰是 QQ/微信 的骨架能力。

要往 QQ/微信 方向做，**P0 不是加功能，而是先把这三点止血并重建数据模型**（见 §6、§7）。

另外，后端媒体通道还有两个"高"级问题（见 §1.1）：`/api/dm/send` **漏了一处上传物归属校验**（三行代码的修复，但可被用来让某个用户永久发不出图），以及**上传配额/并发闸晚于 50MB 请求体缓冲**（chunked 可绕过，单 IP 即可打 OOM）。

---

## 1. 结论速览

| # | 级别 | 问题 | 位置 |
|---|---|---|---|
| H-1 | **高（架构级）** | 私信实时推送完全失效（三重原因），通知/撤回同步全链路死 | `05-feed-stats.js:446`、`migrations/022:13`、`migrations/015:20-28`、`migrations/035:17-32` |
| H-2 | **高** | 未读角标恒为 0：前端直连 Supabase 查 `__dm__` 被 RLS 拦成空数组，再把 0 写回 | `05-feed-stats.js:682-724`、`06-chat-and-nav.js:566` |
| H-3 | **高（数据模型）** | 会话列表由「最近 180 条消息」推导 → 老会话消失、未读数少算、无法置顶/免打扰 | `06-chat-and-nav.js:521,530-550`、`server.js:14849-14868` |
| H-4 | **高（隐私）** | 登出后桌面端会话详情仍显示上一账号的完整聊天记录 | `03-profile-report-ai.js:557-566`、`06-chat-and-nav.js:349-365,1229,1273` |
| H-5 | **高（移动端）** | `height:auto !important` 压掉聊天容器 → 手机端消息列表失去独立滚动 | `ui-shell.css:466-469` vs `style.css:2917-2919` |
| H-6 | **中高（视觉）** | 深色模式聊天输入框被后加载的浅色规则反向覆盖 | `visual-refinements.css:113-116` vs `style.css:1626-1634` |
| M-1 | 中 | 撤回按钮超过 3 分钟不会消失（签名不含时间，永不重算） | `06-chat-and-nav.js:1108-1112,921-936` |
| M-2 | 中 | 无历史分页：固定 180 条，无游标、无「加载更早」→ 更早历史永久不可达 | `06-chat-and-nav.js:1176`、`server.js:14872-14905` |
| M-3 | 中 | 已读回执可被发送方伪造（`read_at` / `withdrawn` 未做白名单清洗） | `server.js:15514-15533` |
| M-4 | 中 | 发送中再次回车被静默吞掉，无提示、不排队 | `06-chat-and-nav.js:1328-1331` |
| M-5 | 中 | 发送失败直接删除气泡 + 一次性 toast，无失败态/无「重发」 | `06-chat-and-nav.js:1475-1480` |
| M-6 | 中 | 每发一条消息触发一次 `/api/dm/list`（每次最多 1000 行）→ 写放大 | `06-chat-and-nav.js:1454,890-898` |
| M-7 | 中 | 未读口径不一致：列表按 180 行聚合，角标按 200 行聚合 | `06-chat-and-nav.js:521`、`05-feed-stats.js:707` |
| M-8 | 中 | 聊天面板内无法发起新会话（无「+」、无联系人搜索） | `06-chat-and-nav.js:826-863`、`index.html:338-368` |
| M-9 | 中 | 内容长度契约不一致：前端 `maxlength=500`，后端 5000，无字数提示 | `index.html:353`、`server.js:3958` |
| M-10 | 中 | 未登录也渲染 `xxz` 联系人入口，点了只弹「请先登录」 | `06-chat-and-nav.js:826-863` |
| M-11 | 中 | 桌面侧栏未读徽标镜像 `textContent`，清零时不清文本 → 过期数字常驻 | `js/desktop-shell.js`、`05-feed-stats.js:677-679` |
| M-12 | 中 | 深色发送气泡内「已读/未读」「时间」对比度 ≈2.6:1 | `style.css:884-889,1395-1403` |
| M-13 | 中 | 气泡宽度：`.chat-msg-row .chat-msg{max-width:75%}` 恒胜小屏 88% 规则 | `style.css:1567` vs `1872` |
| M-14 | 中 | 聊天输入框 15px → iOS Safari 聚焦自动放大整页 | `style.css:1640-1643` |
| M-15 | 中 | `.cli-name` 无 ellipsis → 长中文用户名撑破会话行 | `style.css:1492` |
| M-16 | 中 | 分屏判据不一致：JS 只判宽≥768，CSS 还要求高≥480 → 横屏手机混合布局 | `06-chat-and-nav.js:341-347`、`index.html:80` |
| M-17 | 中 | 图片气泡固定 200px + `object-fit:cover` → 窄屏溢出裁剪、长图被裁 | `style.css:1570-1576,15823` |
| M-18 | 中 | 向上翻阅时图片解码顶动视野（仅在贴底时才重新锚定） | `06-chat-and-nav.js:1276-1287` |
| M-19 | 低中 | `_chatCache` / `_chatRenderSignature` 无上限，仅登出清空 | `06-chat-and-nav.js:698-699` |
| L-1 | 低 | `safeJsStr` 未转义换行/`U+2028`/`U+2029`，却被放进内联 `onclick` | `05-feed-stats.js:139-143`、`06-chat-and-nav.js:785` |
| L-2 | 低 | 全站 CSP 仍开 `script-src 'unsafe-inline'`，聊天内联处理器全靠转义兜底 | `security-headers.js:38` |
| L-3 | 低 | 死代码：`if (false && ...)` 的 openChat 覆盖、永不触发的 Realtime 退避重连 | `06-chat-and-nav.js:4340`、`05-feed-stats.js:438-490` |
| L-4 | 低 | `.msg-withdraw-btn` 全库无 CSS，仅内联 11px/`#999`，触摸目标过小且不可键盘访问 | `06-chat-and-nav.js:1112` |
| L-5 | 低 | 会话列表项是 `<div onclick>`，无 role/tabindex/键盘处理（a11y 不一致） | `06-chat-and-nav.js:783-790` vs `842-860` |
| L-6 | 低 | `.chat-load-retry` 全库无样式，靠内联兜底 | `06-chat-and-nav.js:592,1211` |
| L-7 | 低 | 聊天测试几乎无运行时覆盖（正则匹配源码 + 一个 happy path） | `tests/post-chat-runtime-contract.test.js`、`tests/ui/chat-detail-load.spec.js` |
| L-8 | 低 | 私信搜索后端已具备（`source='dm'`），但聊天面板无入口 | `server.js:4952-4960` |

### 1.1 后端 / 媒体通道专项（媒体上传与注册表）

| # | 级别 | 问题 | 位置 |
|---|---|---|---|
| H-7 | **高（授权）** | `/api/dm/send` **缺少** storage_path 归属校验（upload/abort 都有）→ 他人可抢先"认领"未注册对象，属主此后永久发不出 | `server.js:15401-15419`、`dm-media.js:139-195` |
| H-8 | **高（DoS）** | 上传并发闸与配额在 `express.raw` 缓冲完 50MB **之后**才生效；chunked 无 Content-Length 直接放行 | `server.js:15181,15223,15171` |
| B-1 | 中 | 幂等/对账只按 `actor_key + user_name`，**不含收件人** → 同一文件换人重发返回"成功"但消息未创建 | `server.js:15032-15044,15450-15461,15561-15571` |
| B-2 | 中 | CAS 判定用 `!ok && !updated`（应为 `\|\|`）→ 注册表未写成功仍返回 200（静默假成功） | `server.js:15475,15508,15567` vs 正确写法 `15587` |
| B-3 | 中 | `abort` 不查 `sending` 租约 + 前端 send 无超时参数（默认 15s）→ 超时后可能删掉已提交消息的媒体（媒体 404 且不可重发） | `server.js:15309-15336`、`06-chat-and-nav.js:1435-1472`、`01-bootstrap.js:800` |
| B-4 | 中 | 上传阶段刻意不登记注册表，且清理 worker 只消费 `storage_cleanup_jobs`，无 `chat/` 孤儿巡检 → 页面被杀/abort 失败即永久孤儿（字节已计配额） | `server.js:15280-15282,27446-27450` |
| B-5 | 中 | `033:15` `message_id ... ON DELETE SET NULL` 且无清理触发器 → 删私信后注册行卡在 `attached`+NULL | `migrations/033:15`（`039` 才补触发器） |
| B-6 | 中低 | `read_at` 时区：`to_char(timestamptz, …)` 按会话时区渲染却硬编码字面量 `"Z"` → 库时区非 UTC 时偏移 | `migrations/032:144`、`027:39` |
| B-7 | 中低 | 音视频魔数校验过宽：≤188 字节且首字节 `0x47` 即判 MPEG-TS；MP3 仅 2 字节帧同步 | `server.js:15147-15158` |
| B-8 | 低 | 027 的函数体在 **TEXT** 列上使用 jsonb 运算符（必然运行时报错）—— 但已被 032 覆盖修正，**线上以 032 为准，功能可用**；属"坏迁移不可重放"的维护风险 | `migrations/027:55,66` vs `032:117-118` |
| B-9 | 低 | 幂等（已读）行被计入 `failed_ids` → 重复标记稳定返回 `partial:true` | `migrations/027:76-80`（032 已修） |

---

## 2. 高危问题详解

### H-1 私信实时推送完全失效（架构级）

**证据（三重、互相独立，任一成立即致命）**

1. **`posts` 表根本不在 Realtime publication 里。** 前端订阅的是 `posts`：
   ```js
   // js/core-parts/05-feed-stats.js:446
   .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'posts', filter: 'media_type=eq.__dm__' }, ...)
   ```
   但全仓 migrations 里**唯一**一次 publication 变更是给 `comments` 加表：
   ```sql
   -- supabase/migrations/022_enable_comment_delete_realtime.sql:13
   ALTER PUBLICATION supabase_realtime ADD TABLE public.comments;
   ```
   没有任何迁移执行 `ADD TABLE public.posts`。Supabase 的 Postgres Changes 要求先"启用该表的复制"才有事件（见 Supabase 官方 Postgres Changes 文档第 3 步）。

2. **退一步，即便加了 publication，RLS 也不允许浏览器读私信行。** `posts` 的 SELECT 白名单显式排除了 `__dm__`：
   ```sql
   -- supabase/migrations/035_harden_user_info_read_rls.sql:17-32
   CREATE POLICY posts_public_feed_read ON public.posts FOR SELECT TO anon, authenticated
   USING ( is_deleted IS NOT TRUE AND media_type IS DISTINCT FROM '__user_info__'
     AND (media_type IS NULL OR media_type = '' OR media_type IN
       ('image','video','text','photo','album','audio','__avatar__')) ... );
   ```
   白名单里没有 `__dm__`。Postgres Changes 会按订阅者角色套用 RLS，读不到的行不会推送。

3. **再退一步，Realtime 连接从未用本应用的 JWT 鉴权。** 全仓（`js/**`）grep `setAuth` / `auth.setSession` **零命中** —— 本应用用的是自建 JWT（`/api/user/refresh`），从未喂给 Supabase Realtime，因此 Realtime socket 始终以 `anon` 角色运行。而 `anon` 同样读不到 `__dm__`。

**后果（全是用户可感知的）**

- 新消息不会实时到达。只能靠轮询：会话内 60 秒一次（`06-chat-and-nav.js:489`），列表页 5 分钟一次（`06-chat-and-nav.js:227,443`）。
- `showNotification`（站内气泡通知）写在 Realtime 回调里（`05-feed-stats.js:452-454`），**永远不会执行** —— 用户收不到任何"新私信"提示。
- 对方撤回后，本端不会收到更新（订阅刻意只留 INSERT，见 `05-feed-stats.js:443-446`），要等下一次轮询刷新才变。
- `05-feed-stats.js:438-490` 那套"指数退避最多重连 10 次"的健壮性代码是**不可达的死代码** —— 它等的是一个永远不会到达的事件。

**修复方向（重要：不要放开 `posts` 的 RLS）**

`subscribeToMessages` 的过滤器只有 `media_type=eq.__dm__`，**没有任何按用户过滤**（`05-feed-stats.js:446`）。也就是说：一旦有人为了"修好实时"而给 `posts` 加上允许读 `__dm__` 的策略，**每个在线客户端都会收到全站所有人的私信原文**（客户端那句 `if (m.user_name !== currentUser && m.media_url !== currentUser) return` 是在数据已经落到浏览器之后才过滤的，打开 DevTools 就能看全站私信）。

正确做法二选一：

- **A（推荐，面向 IM 的正确形态）**：新建 `dm_messages` 表（见 H-3），RLS 只允许 `sender = 我 OR recipient = 我`，再加入 publication —— 这样 RLS 本身就是按人过滤的，Realtime 天然安全。
- **B（最小改动，止血）**：保留 `posts` 现状，由后端在写入成功后用 service_role 通过 Supabase Realtime **Broadcast** 推到一个按用户命名的私有频道（`user:<name>`），前端只订阅自己的频道。

### H-2 未读角标恒为 0

```js
// js/core-parts/05-feed-stats.js:702-724
var result = await _badgeClient.from('posts')
  .select('id, user_name, content, views, created_at')
  .eq('media_type', DM_MARKER)          // '__dm__'
  .eq('media_url', window.currentUser)
  .order('created_at', { ascending: false }).limit(200);
var data = result.data; var error = result.error;
if (error) return;                       // ← 这条防线救不了它
(data || []).forEach(...);               // data === []  →  cnt === 0
setUnreadBadgeCount(cnt);                // ← 把 0 写回角标
```

**为什么必然为 0：** 这是浏览器用 anon/authenticated 身份直连 Supabase 查 `media_type='__dm__'`。由 H-1 第 2 点，RLS 白名单不含 `__dm__`；而 `migrations/015:17` 已 `GRANT SELECT`，所以**不会报错**（`error` 为 null），RLS 只是把行过滤成空数组。于是走到 `setUnreadBadgeCount(0)`，角标被**主动清掉**。

**调用时机（会反复清）：**

| 调用点 | 时机 |
|---|---|
| `03-profile-report-ai.js:1944` | 启动/登录后 90ms |
| `05-feed-stats.js:659` | DM 轮询（未打开会话时） |
| `06-chat-and-nav.js:896` | 每次发送成功 / 标记已读后 |
| `06-chat-and-nav.js:1200` | 每次拉取会话消息后 |

**并且和正确的数据源互相打架**：`loadDockChatList` 走的是后端 `/api/dm/list`（service_role），算出来的未读数是**对的**（`06-chat-and-nav.js:566-568`），但它被上面这条恒为 0 的路径反复覆盖，最终显示哪个取决于异步竞态。

**附带缺陷**：清零时只摘 class，不清文本 ——
```js
// js/core-parts/05-feed-stats.js:677-679
} else { badge.classList.remove('show'); }   // textContent 保留旧数字
```
而 `js/desktop-shell.js` 的 `syncChatBadge` 是按 `textContent` 镜像到桌面侧栏 `#desktopChatBadge` 的，于是**桌面侧栏会长期显示过期的未读数**。

**修复**：角标一律走后端（新增 `/api/dm/unread`，或复用 `/api/dm/list` 的会话聚合），删除前端直连 Supabase 的统计路径；`setUnreadBadgeCount(0)` 同时清空 `textContent`；把两条数据源收敛成一条（见 M-7）。

### H-3 会话列表由「最近 180 条消息」推导（数据模型缺陷）

```js
// js/core-parts/06-chat-and-nav.js:521
const allMsgs = mergeDockChatRowsById(dmResult.data || [], false, 180);
// 530-550：把这 180 条按对方用户名归组，"现推"出会话列表与未读数
```

而 `/api/dm/list` 返回的**根本不是会话**，是"该用户最近收发的私信消息"（两个方向各 500 条上限）：
```js
// render-api/server.js:14851-14856
supabase.from('posts').select('id, user_name, content, media_url, views, created_at')
  .eq('media_type', DM_MARKER).eq('user_name', req.userName)...limit(500),
supabase.from('posts').select(...)
  .eq('media_type', DM_MARKER).eq('media_url', req.userName)...limit(500)
```

**根因**：私信被塞进了 `posts` 表（`media_type='__dm__'`、`media_url` 当收件人、`content` 存 JSON），**没有独立的会话表**。

**后果**：

- **会话会凭空消失。** 只要"最近 180 条消息"集中在少数几个会话里（跟一个人连续聊 180 句非常容易），其余所有会话就整段从列表里消失 —— 消息还在库里，但 UI 里找不到入口，只能从对方资料卡重新进入。
- **未读数必然少算**（只在 180 条窗口内累计），且窗口内外口径还有 180 vs 200 的不一致（M-7）。
- 排序与预览只反映窗口内最后一条。
- **无法实现**：置顶、免打扰、删除会话、清空历史、保留未读、跨端未读同步 —— 因为这些都需要"会话"这个实体承载状态。这是往 QQ/微信 走**绕不过去的**第一道改造。

**修复方向**：新增 `dm_conversations`（如 `user_a, user_b, last_message_id, last_message_at, unread_a, unread_b, pinned_a, pinned_b, muted_a, muted_b, deleted_a, deleted_b`）+ 唯一索引 `(least(user_a,user_b), greatest(user_a,user_b))`，`/api/dm/list` 改为查会话表并按 `last_message_at` 排序、`limit` 分页。

### H-4 登出后桌面端仍显示上一账号的私聊内容（隐私）

**链路：**

1. 登出清内存缓存、清会话态，但**没清聊天 DOM、也没重绘 UI**：
   ```js
   // js/core-parts/03-profile-report-ai.js:561-567
   _chatCache = {}; dockChatActiveUser = null; _dockChatListRenderSignature = ''; _chatRenderSignature = {};
   ```
   `initUI()`（`03-profile-report-ai.js:1955-2026`）在未登录分支里只处理头部登录态/个人页，然后 `stopDMPolling()` —— **不碰** `#dockChatMessages`。

2. 用户切回「消息」tab 时，`updateChatAuthUI()` → `syncDockChatLayoutState()`（`06-chat-and-nav.js:212,1671`）在桌面分屏（≥768px）下进入：
   ```js
   // js/core-parts/06-chat-and-nav.js:387-393
   if (!dockChatActiveUser) { ...; renderDockChatDesktopEmptyState(); }
   ```
   而它是这样"认领"旧内容的：
   ```js
   // js/core-parts/06-chat-and-nav.js:356-357
   if (messages.dataset.chatUser && messages.dataset.chatUser !== '__empty__') return;  // ← 直接返回，保留旧消息
   if (messages.dataset.emptyRendered === '1') return;
   ```
   而 `dataset.chatUser` 正是上一次渲染时写入的**对方用户名**（`06-chat-and-nav.js:1229,1273`），所以必然命中 `return`。

**复现（桌面 ≥768px）**：A 登录 → 打开与某人的会话 → 切到「我的」→ 退出登录 → 切回「消息」。标题变成「消息」、输入框隐藏，但**右侧详情栏仍是 A 与对方的完整聊天记录**，新登录的 B 或同一台共享电脑的下一位使用者直接可见。

**修复**：登出时（或该函数在未登录态下无条件）清空 `#dockChatMessages.innerHTML`、`delete el.dataset.chatUser`；更稳的做法是把"渲染态"与"登录态"解耦，未登录时强制走空态分支。

### H-5 手机端聊天容器被 `height:auto !important` 压掉

```css
/* css/ui-shell.css:466-469  —— 最后加载，!important */
#panelChat .dock-chat-container { display: block !important; height: auto !important; }
```
压掉的是 `style.css:2917-2919` 的 `.dock-chat-container{display:flex;flex-direction:column;height:100%;min-height:0}`。`.dock-panel` 自身是 `position:absolute;inset:0;overflow-y:auto`（`style.css:2297-2299`），于是容器高度=内容高度 → `.chat-messages`（`flex:1;min-height:0;overflow-y:auto`）拿不到可分配高度，**滚动落到整块面板上**。

**后果（iOS Safari / 微信 web-view）**：打开会话时历史消息渲染在 DOM 顶部，必须手动一路滑到底才能看到最新消息；输入框不吸底；`#dockChatJumpLatest` 因相对定位容器高度异常而不可见/失效。

**修复**：移动端改为 `display:flex !important; height:100% !important; min-height:0 !important`，并保留 `.chat-view.hidden{display:none!important}`。

### H-6 深色模式聊天输入框被浅色规则覆盖

```css
/* css/style.css:1626-1634 */
.chat-input-wrap { background: rgba(255,255,255,0.3); border: 1px solid rgba(255,255,255,0.4); }
/* css/visual-refinements.css:113-116  —— 后加载，同权重 (0,2,0)、都没有 !important */
[data-theme="dark"] .chat-input-wrap { background: var(--xtj-dark-surface-soft); border-color: var(--xtj-dark-border); }
```
两条规则权重完全相同、都无 `!important`，而 `visual-refinements` 在 `style` **之后**加载 → 深色变量被浅色玻璃层反向覆盖，**深色模式下输入框发白、与底色几乎没有边界**。

**修复**：给深色规则加 `#panelChat` 前缀提权或加 `!important`，或把深色规则收口到 `ui-shell.css` 的统一样式段。

---

## 3. 中危问题详解

### M-1 撤回按钮超过 3 分钟不会消失
```js
// js/core-parts/06-chat-and-nav.js:1108-1112
var elapsed = Date.now() - new Date(message.created_at).getTime();
var canWithdraw = sent && !message.__optimistic && !isWithdrawn && (elapsed <= timeLimit);  // 3 分钟
```
但行签名 `buildDockChatRowSignature`（`06-chat-and-nav.js:921-936`）只含 `user_name/media_url/content/created_at/actor_key/views/__optimistic/read_at/withdrawn/media.url`，**不含时间**。于是：

- 每 60 秒轮询 → `renderDockMessages` → 签名未变 → **提前 return，不重绘**（`06-chat-and-nav.js:1235-1238`）；
- 撤回按钮就永久留在那里，直到该行因别的原因重建；
- 用户点了必然被服务端拒：`server.js:15659` 返回 403 `timeout`，只弹一句 toast。

**修复**：把"是否可撤回"从渲染期动态判断改为**带过期定时器**（渲染后 `setTimeout` 到期时移除按钮/重绘该行），或把时间档位纳入签名。

### M-2 无历史分页
前端固定 `limit=180`（`06-chat-and-nav.js:1176`），`/api/dm/messages` **没有游标参数**（`server.js:14872-14905` 只支持 `target`/`limit`，上限 1000），前端也没有"上拉加载更早"的入口。**超过 180 条的历史消息永久不可达** —— 用户翻不到，也没有任何提示。

**修复**：改为 keyset 分页（`before_created_at` / `before_id` 游标），前端加滚动到顶自动加载 + 顶部 loading。

### M-3 已读回执可被发送方伪造
```js
// render-api/server.js:15514-15533
parsedPayload = JSON.parse(content);
if (parsedPayload && typeof parsedPayload === 'object' && !Array.isArray(parsedPayload)) {
  if (!parsedPayload.read_at) parsedPayload.read_at = null;   // ← 只补 null，客户端传了真值就原样保留
  if (mediaPayload) parsedPayload.media = mediaPayload; else delete parsedPayload.media;
```
`media` 被清洗了，但 `read_at` 和 `withdrawn` **没有**。发送方只要把 `content` 发成 `{"text":"hi","read_at":"2020-01-01T00:00:00Z"}`，"已读"就会立刻显示给对方（`06-chat-and-nav.js:1103` 依赖 `isMsgReadByMe` → `getDMMessageReadAt`），而接收方根本没看。同理 `{"withdrawn":true}` 可伪造撤回态（`06-chat-and-nav.js:1061-1063`）。

**修复**：服务端对客户端 `content` 做**字段白名单**（只保留 `text`），`read_at` / `withdrawn` / `media` 一律由服务端生成。

### M-4 发送中再次回车被静默吞掉
```js
// js/core-parts/06-chat-and-nav.js:1328-1331
if ((!content && !file) || !dockChatActiveUser || dockChatSending) {
  if (!dockChatActiveUser && content) showToast('请先选择一个聊天对象');
  return;   // ← dockChatSending 为真时什么都不做、不提示、不入队
}
```
用户在上一张图还在上传时按回车，**界面毫无反应**（文字仍在输入框里，但不发送）。QQ/微信 是排队发送。

### M-5 发送失败直接删除气泡，无失败态、无「重发」
```js
// js/core-parts/06-chat-and-nav.js:1475-1480
removeDockChatCacheMessage(targetUser, tempId);
if (dockChatActiveUser === targetUser) renderDockMessages(targetUser, ..., true);
if (!inp.value) { inp.value = capturedContent; }
showToast('发送失败: ' + ...);
```
乐观气泡被**直接抹掉**，只剩 3 秒 toast。用户失去"这条没发出去"的视觉锚点，也没有一键重发。QQ/微信 的标准做法是气泡左侧红色感叹号 + 点击重发。

### M-6 每发一条消息触发一次 `/api/dm/list`
`06-chat-and-nav.js:1454` → `scheduleDockChatListRefresh(320)` → `loadDockChatList()`（`06-chat-and-nav.js:890-898`），而该接口每次最多回 1000 行（`server.js:14853-14855` 各 500）。**每发一句就多一次 1000 行量级的往返**，在会话列表变大后是明显浪费。更好的做法是本地增量更新会话行（已有 `applyDockChatConversationPreview` 在做这件事），只在必要时才全量刷新。

### M-7 未读口径不一致
`06-chat-and-nav.js:521` 按 **180** 行聚合；`05-feed-stats.js:707` 按 **200** 行聚合（而且这条本身是坏的，见 H-2）。注释（`05-feed-stats.js:698-701`）声称"口径已对齐"，实际数字并不一致。修复 H-2 时应顺手把口径收敛到服务端单一来源。

### M-8 聊天面板内无法发起新会话
`#panelChat` 里没有「+」按钮、没有联系人列表、没有用户搜索（`index.html:338-368`）。唯一的固定入口是硬编码的管理员 `xxz`（`06-chat-and-nav.js:826-863`）。发起新会话只能从：

- 对方资料卡的「发消息」按钮（`03-profile-report-ai.js:136-141` `upcSendMessage`）
- 站内通知气泡（`05-feed-stats.js:67-72`，但它永远不会触发，见 H-1）
- 桌面侧栏最近联系人（`js/desktop-shell.js`）

对微信/QQ 而言，"通讯录 / 发起新会话 / 搜人"是聊天模块的一等公民，这里完全缺失。

### M-9 内容长度契约不一致
`index.html:353` 是 `maxlength="500"`，`server.js:3958` 是 `MAX_CONTENT_LEN = 5000`。前端会**静默截断**超过 500 字的消息，且没有字数计数器。择一：放宽前端并加计数器，或把后端限制改成 500。

### M-10 未登录也渲染 `xxz` 联系人入口
`renderDockChatFixedEntry`（`06-chat-and-nav.js:826-863`）不判断登录态：未登录访客在聊天 tab 看到「登录后可查看消息」的同时，列表顶部却有一个「xxz 管理员 · 想我就给我发消息」条目，点击只弹「请先登录」。应在未登录时跳过固定入口。

### M-11 桌面侧栏未读徽标显示过期数字
见 H-2 附带缺陷。`js/desktop-shell.js` 的 `syncChatBadge` 用 `navChatBadge.textContent` 镜像且仅在文本为空时隐藏，而清零点不清文本。

### M-12 ~ M-17（CSS，已逐条核实级联）
- **M-12** `style.css:884-889` 的白色状态字与 `style.css:1395-1403` `[data-theme=dark] .msg-text{color:#0f1016!important}` 同权重冲突，深色发送气泡内「已读/未读」「时间」对比度 ≈2.6:1。
- **M-13** `style.css:1567` `.chat-msg-row .chat-msg{max-width:75%}`（权重 0,2,0）恒胜 `style.css:1872` 的小屏 88%（0,1,0）→ 小屏气泡比设计意图更窄、换行更碎。
- **M-14** 聊天输入框 `font-size:15px`（`style.css:1640-1643`），而 16px 的"防 iOS 聚焦放大"规则只补了发帖框（`ui-shell.css:1272`）→ 每次点输入框整页被放大。
- **M-15** `.chat-list-item .cli-name{display:flex}`（`style.css:1492`）无 `min-width:0`/ellipsis；文本节点是匿名 flex item，`text-overflow` 不生效 → 长中文用户名撑破行，先把预览挤没、再把 `.cli-right`（`flex-shrink:0`）推到面板外被裁掉。
- **M-16** JS 判据仅 `width >= 768`（`06-chat-and-nav.js:341-347`），而 `desktop.css` 只在 `(min-width:768px) and (min-height:480px)` 加载（`index.html:80`）→ 横屏手机（如 844×390）会加上 `.desktop-split`、取消两栏 hidden，却没有任何分屏样式，dock 栏也不隐藏 → 单栏布局 + 底栏残留。
- **M-17** `.msg-img{min-width:96px;max-width:200px;max-height:260px;object-fit:cover}`（`style.css:1570-1576,15823`）且全库无 `img{max-width:100%}` → 窄屏（320-360px）图片溢出被 `overflow-x:hidden` 裁切，长图被 `cover` 裁掉内容。

### M-18 向上翻阅时图片解码顶动视野
`renderDockMessages` 只在 `shouldAutoScroll` 为真时重新贴底（`06-chat-and-nav.js:1276-1278`）；非贴底时用 `scrollTop += (scrollHeight - previousScrollHeight)` 补偿一次（`06-chat-and-nav.js:1283`），但图片解码后高度会**再次**变化，此时没有二次锚定 → 用户正在读旧消息时，图片陆续加载会把内容顶动。建议给 `.msg-img` 一个基于已知宽高比/固定占位高度的 `aspect-ratio` 容器。

### M-19 缓存无上限
`_chatCache` / `_chatRenderSignature`（`06-chat-and-nav.js:698-699`）按会话无限增长（每会话最多 180 条含 JSON 的 content），只在登出时清空（`03-profile-report-ai.js:561-566`）。长时间挂着不动 + 多会话会持续吃内存。建议加 LRU（如最多保留 N 个会话）。

---

## 3.5 后端与媒体通道专项详解

### H-7 `/api/dm/send` 缺少上传物归属校验（越权认领 + 拒绝服务）

同一套 `chat/<uidHash>_<ts>_<rand>_<name>` 路径，三个入口的校验**不一致**：

| 入口 | 是否校验 `validateDmUploadOwnership(path, uidHash)` |
|---|---|
| `POST /api/dm/upload`（`server.js:15205`） | ✅ 有 |
| `POST /api/dm/upload/abort`（`server.js:15304`） | ✅ 有 |
| `POST /api/dm/send`（`server.js:15401-15419`） | ❌ **没有** |

而上传阶段**刻意不写注册表**（`server.js:15280-15282`），注册行由**第一个认领者**创建并写入 `uploader = 认领者`（`dm-media.js:186-195`）。也就是说：**对象归属不是由上传者决定的，而是由谁先 claim 决定的。**

**利用**：B 登录后直接 `POST /api/dm/send`，带上 `storage_path = "chat/<hash(A)>_<ts>_<rand>_x.jpg"`。该路径若尚无注册行，`claimDmMediaUpload` 会新建一行且 `uploader = B`，B 的消息即引用 A 的对象；之后 A 用同一路径发送会拿到 `403 media_not_owned`，**永久发不出去**。

**前置条件（如实说明）**：需要知道完整路径。路径含 6 位 base36 随机数（≈31 bit，不可枚举），但 `uidHash` 可由公开用户名算出、`ts` 可猜，且**收件人能从消息里的 public URL 直接得到完整路径**；账号删除/撤回的部分清理失败也会留下"有对象、无注册行"的窗口。因此这是**真实的授权控制缺口**，不是纯理论。

**修复**：在 `server.js:15405` 后立即
```js
var uidHash = sha256(sender).slice(0, 12);
if (!validateDmUploadOwnership(pathResult.storagePath, uidHash).ok) {
  return res.status(400).json({ error: 'Media upload is not owned by the sender', code: 'media_not_owned' });
}
```

### H-8 上传并发闸与配额晚于请求体缓冲（内存 DoS）

```js
// server.js:15181
app.post('/api/dm/upload', authenticateUser, rateLimit(3600000, 60), dmUploadBudgetPrecheck,
         express.raw({ type: 'application/octet-stream', limit: '55mb' }), async (req, res) => {
  ...
  releaseSlot = acquireDmMediaSlot(uploader);   // server.js:15223 —— 已经太晚
```
槽位获取与 `tryConsumeDmMediaQuota` 都在 handler 内，即 **`express.raw` 已把最多 55MB 全量读进内存之后**才判定；而 `dmUploadBudgetPrecheck` 对 chunked（无 `Content-Length`）直接 `next()` 放行（`server.js:15171`）。`dm-media.js:316` 注释声称"最坏在途内存有界（~4×50MB）"，与实现不符。

**复现**：同一账号/同一 IP 并发 60 个 `Transfer-Encoding: chunked` 的 55MB 请求（限流是 60/小时/IP，**不限并发**）→ 进程 RSS ≈3.3GB，Render 常见 512MB–2GB 实例直接 OOM 重启。

**修复**：把槽位获取与配额预占移到 `express.raw` **之前**（或按 `Content-Length` 预占 + 全局在途字节预算），并给 chunked 请求设更小的硬上限。

### B-1 ~ B-9 其余后端问题的要点

- **B-1（幂等键漏收件人）**：`actorKey` 由 `kind + storage_path` 决定（`server.js:15431`），`findDmMessageByActorKey` 只按 `actor_key + user_name` 查（`15036-15037`）。A 用同一 `storage_path` 先发 B 再发 C，第二次会命中"已 attached"并**直接返回 B 的那条消息**且 `idempotent:true` —— 对 C 的写入从未发生却报告成功（前端还会把它塞进 C 的会话）。修复：对账条件加 `.eq('media_url', targetUser)`，命中但收件人不一致时返回 409。
- **B-2（AND/OR 写反）**：`updateDmMediaRegistryCAS` 在 CAS 命中 0 行时返回 `{ok:true, updated:false}`（`15053-15058`），而 `15475 / 15508 / 15567` 用的是 `!ok && !updated`（AND）→ "注册表没写成功"被当成功返回 200；同族 `15587` 用的是正确的 `!ok || !updated`。修复：统一为 `||`，`updated:false` 按 503 可重试处理。
- **B-3（abort 与在途 send 竞态）**：`abort` 只用 `posts.actor_key` 判断"是否已挂到消息"（`15309-15336`），**不看 `dm_media_uploads` 的 `sending` 租约**；而前端 `/api/dm/send` 没传 `timeoutMs`（默认 15s，`01-bootstrap.js:800`），超时进 catch 后**无条件**调用 abort 删媒体（`06-chat-and-nav.js:1464-1472`）。若服务端在 15s 后仍完成提交 → "消息已入库、对象已删除"：收件人看到 404，且 `dm-media.js:160` 对 attached 行不做毒化处理，重发固定 400。
- **B-4（孤儿回收缺口）**：上传成功但未走到 `/api/dm/send` 的对象（abort 请求失败、页面被杀、断网）没有任何巡检回收，而字节已计入配额。建议把注册登记提前到上传阶段（`status='uploaded'` + TTL 巡检），或增加 `chat/` 前缀的孤儿扫描任务。
- **B-5**：`033:15` 的 `ON DELETE SET NULL` 没有配套清理触发器，删私信后注册行卡在 `attached` + `message_id=NULL`，`dm-media.js:174` 还会把它当 `idempotent:true` 返回。`039` 迁移第 4 项专门补了 `AFTER DELETE` 触发器 —— 这恰好证明 `033` 本身确有缺口（**新库按顺序迁移是好的，但说明该约束设计当初不完整**）。
- **B-6**：`to_char(v_now, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`（`032:144`、`027:39`）按会话时区渲染却硬编码 `Z`。Supabase 默认 UTC 时无害；一旦库/角色时区为 `Asia/Shanghai`，`read_at` 会比真实 UTC 早 8 小时，影响"已读"时间显示与排序。修复：`to_char(v_now AT TIME ZONE 'UTC', ...)`。
- **B-7**：`sniffDmMediaMagic` 的 MPEG-TS 分支对 ≤188 字节且首字节 `0x47` 的文件直接放行（`server.js:15147-15151`），MP3 只判 2 字节帧同步（`15158`）。任何小垃圾文件都能冒充 `video/*`、`audio/*` 进公共桶。缓解：`content_type` 被写为声明的 mime 且必须落在 `image|video|audio` 前缀白名单内（`dm-media.js:31`），所以**不能直接变成 HTML/SVG**；图片分支走 sharp 真解码（`15232-15249`），无此问题。
- **B-8（对子 agent 结论的更正，重要）**：`027` 的函数体确实在 **TEXT** 列 `posts.content` 上直接使用 `jsonb_typeof(p.content)` / `p.content->>'read_at'`（`001_base_schema_snapshot.sql:29` 确认 `content text`），单独执行会运行时报错。**但 `032_security_hardening_fixes.sql:117` 以 `CREATE OR REPLACE` 重新定义了同名函数，且改用 `xtj_private.safe_jsonb(p.content)`（`032:146-199`）、`search_path = public, xtj_private`（`032:117`）。** 按迁移顺序（032 晚于 027）落库后，**线上生效的是 032 的版本，批量已读 RPC 是可用的**，并不会"100% 失效"。所以这条**不是线上故障**，而是"坏迁移不可重放"的维护风险：若有人回滚或从 027 重建该函数，批量已读会立刻退化。建议删除 027 中的函数体或在其头部标注"已被 032 取代"。
- **B-9**：`027:76-80` 把"匹配到但已读"的 id 计入 `failed_ids`，导致重复标记稳定返回 `partial:true`；`032:190-208` 已单独计算 `already_read_ids` 修正。

**后端已明确核查、未发现缺陷的类别**（避免后续重复审计）：路径穿越/写出 `chat/` 之外（`dm-media.js:13-20` 锚定正则 + 显式拒绝 `..`/`\`/`?`/`#`）；bucket 混淆（读写删全部硬编码 `uploads`）；越权标记他人已读（`p_receiver` 恒为 `req.userName`，RPC WHERE 双重限定，且仅 `service_role` 可执行）；SQL 注入与权限提升（REVOKE/GRANT 最小化、无动态 SQL）；图片类型伪装（sharp 真解码 + SVG 显式拒绝）；同路径双写（`storage_path` UNIQUE + 23505 重试 + status CAS 租约）。

---

## 4. 低危 / 加固项

- **L-1** `safeJsStr`（`05-feed-stats.js:139-143`）转义了 `& \ ' "`，但**未转义换行、`U+2028`、`U+2029`**；它被放在内联 `onclick="openChat('...')"`（`06-chat-and-nav.js:785`）里。若用户名允许换行，会产生 JS 语法错误使该行不可点击。当前注册校验看起来收紧了字符集，属加固项。
  好消息：`<`/`>` 在该上下文（双引号属性内）无害，`'`/`"`/`\` 的转义顺序与语义**是正确的** —— 这里没有 XSS。
- **L-2** `security-headers.js:38` 的 CSP 仍含 `script-src 'unsafe-inline'`（注释自述 index.html 有 95 个 `on*` 属性、13 个 JS 模块另有约 232 处动态生成）。聊天模块贡献了其中若干（`onclick="openChat(...)"`、`onclick="window.withdrawDMMessage(...)"`、`onclick="openImageViewer(...)"`）。这意味着**这些内联处理器的安全完全依赖转义质量**。移除 `unsafe-inline` 时需同步改造为事件委托。
- **L-3** 死代码：`06-chat-and-nav.js:4340` 的 `if (false && ...)` 包裹着一段 openChat 覆盖；`05-feed-stats.js:438-490` 的 DM 重连退避不可达（因 Realtime 根本不工作）。建议清理，避免误导后续维护。
- **L-4** `.msg-withdraw-btn` 全库**没有任何 CSS 规则**，只靠内联 `font-size:11px;margin-left:6px;color:#999`（`06-chat-and-nav.js:1112`）→ 深色/彩色气泡上对比度差、11px 触摸目标远小于 44px、`<span onclick>` 无法键盘访问。
- **L-5** 会话列表项是 `<div class="chat-list-item" onclick=...>`（`06-chat-and-nav.js:783-790`），无 `role`/`tabindex`/keydown；而管理员入口（`842-860`）却有完整的 `role="button" tabindex="0"` + Enter/Space 处理。应统一。
- **L-6** `.chat-load-retry` 全库无样式，靠两处内联兜底（`06-chat-and-nav.js:592,1211`）。
- **L-7** **测试几乎不覆盖运行时行为**：`tests/post-chat-runtime-contract.test.js` 是对拼接后的 `js/core.js` 做**正则字符串匹配**（`assert.match(list, /listLoadSeq\s*=\s*\+\+_dockChatListLoadSeq/)`），`tests/ui/chat-detail-load.spec.js` 只有一个 happy path 断言"1 次请求"。H-1/H-2/H-4 这类"代码写得没错、但整条链路不可能生效"的缺陷**完全测不出来**。建议补：Realtime 是否真的收到事件、角标与后端一致性、登出后 DOM 是否清理、撤回窗口过期行为、分页游标。
- **L-8** 私信搜索能力**后端已经具备**（`server.js:4952-4960`，`source='dm'`，按参与者过滤），但聊天面板没有任何搜索入口 —— 属于"功能已在、只差 UI"。

---

## 5. 做得好的地方（避免改造时误删）

这部分是资产，重构时应保留其语义：

- **乐观发送 + 增量 DOM 复用**：`renderDockMessages` 按 `data-msg-key`/`data-msg-sig` 复用节点（`06-chat-and-nav.js:1247-1274`），避免重建导致图片重新请求、"气泡闪白"。这是对的方向，改造时不要退回 `innerHTML` 全量重建。
- **竞态防护**：`_dockChatLoadSeq` / `_dockChatListLoadSeq` + `replaceChildren` 前校验，切会话时丢弃过期回包（`06-chat-and-nav.js:1134,1184,520`）。
- **媒体改走后端上传**：不再依赖浏览器端 anon key（`06-chat-and-nav.js:1356-1402`、`server.js:15106-15120` 的注释记录了真实事故）。方向正确。
- **媒体 idempotency 与孤儿回收**：`actor_key` 确定性 + `dm_media_uploads` 注册表 CAS + 失败路径入队清理（`server.js:15032-15104,15558-15597`）。思路比多数项目严谨（`storage_path` UNIQUE + 23505 重试 + status 租约能防同路径双写），但本轮仍查出归属校验缺失（H-7）与 CAS 判定写反（B-2）等具体漏洞 —— 属于"设计对、实现漏"。其余方向应保留。
- **账号删除级联**：分页遍历发件人/收件人两个方向删除私信并回收媒体（`server.js:16060-16074,16219`），且用 off-by-one 修复注释留痕（`16022-16029`）。
- **撤回的媒体引用校验**：删除 Storage 对象前检查是否还被别的消息/注册表行引用（`server.js:15663-15685`），避免误删他人附件。

---

## 6. 差距分析：当前实现 vs QQ/微信 级 IM

| 能力 | 现状 | 差距 | 改造要点 |
|---|---|---|---|
| 数据模型 | 私信复用 `posts` 表 | 无会话/成员/未读/置顶实体 | 新建 `dm_conversations` + `dm_messages`（**P0 地基**） |
| 实时投递 | **已失效**（H-1） | 无"秒回" | `dm_messages` + 参与者 RLS + publication，或 Broadcast 私有频道 |
| 会话列表 | 最近 180 条消息现推（H-3） | 会话消失/未读少算 | 服务端会话表 + 索引 + 分页 |
| 历史分页 | 固定 180，无游标（M-2） | 翻不到旧消息 | keyset 游标 + 上拉加载 |
| 消息状态机 | 乐观 + 无失败态 | 无"发送中/已送达/失败/重发" | 状态字段 + 失败气泡 + 重发（M-4/M-5） |
| 已读回执 | 有，但存在 `content` JSON 里且**可伪造**（M-3） | 不可信 | 独立 `dm_receipts`，服务端权威 |
| 撤回 | 3 分钟；按钮不消失（M-1）；对方不实时感知（H-1） | 体验断裂 | 统一撤回事件 + 系统气泡「对方撤回了一条消息」 |
| 在线状态/输入中 | **无** | 无 Presence | Realtime Presence |
| 群聊 | **无** | 核心缺失 | 会话成员表 + 群事件 + 群管理 |
| 语音消息 | 仅"上传音频文件"（`06-chat-and-nav.js:1397-1402`） | 无按住录音/波形/时长 | MediaRecorder + 时长元数据 |
| 表情/引用回复/转发/收藏/@提醒 | **无** | 交互深度不足 | 消息 `reply_to_id` + 表情表 + 转发 |
| 通讯录/发起新会话/搜人 | 面板内**无**（M-8） | 一等公民缺失 | 会话面板加「+」与用户搜索 |
| 消息搜索 | 后端已有 `source='dm'`（L-8） | 只差 UI | 聊天面板加搜索入口 |
| 置顶/免打扰/删除会话/清空历史 | **无**（依赖 H-3） | 基础管理缺失 | 会话表加 `pinned/muted/deleted` |
| 未读数一致性 | **已坏**（H-2/M-7/M-11） | 用户漏消息 | 单一后端来源 |
| 多端同步 | 靠轮询；同账号多端已读不同步 | 体验落后 | 会话级 last_read + Broadcast |
| 离线/推送 | **无**（连站内通知都是死代码） | 无触达 | Web Push / 移动端推送 |
| 媒体体验 | 图/视频/音频、50MB 上限 | 无进度条、无断点重试、无压缩缩略图 | 上传进度 + 客户端压缩 |
| 安全 | 无用户间拉黑；单条消息不可举报（`blacklist` 是站点级封禁） | 社交治理缺失 | 用户级 block + 单条举报 |
| 性能 | 每发一条一次 1000 行列表请求（M-6）；无虚拟列表 | 规模上来会卡 | 增量更新列表 + 虚拟滚动 |

---

## 7. 建议路线图

### P0 · 止血（1~2 天，不动架构）
1. **H-2 未读角标**：删除前端直连 Supabase 的统计路径，统一走后端；`setUnreadBadgeCount(0)` 清空 `textContent`；修复桌面徽标镜像（M-11）。
2. **H-4 登出清聊天 DOM**：登出/切账号时清空 `#dockChatMessages` 与 `dataset.chatUser`。
3. **H-5 / H-6 / M-12~M-17**：CSS 若干修正（容器高度、深色输入框、气泡宽度、iOS 字号、`.cli-name` 省略号、图片尺寸、分屏判据）。
4. **M-1**：撤回按钮加到期定时器。
5. **M-3**：服务端对 `content` 做字段白名单，`read_at`/`withdrawn` 一律服务端生成。
6. **M-10**：未登录不渲染 `xxz` 入口。
7. **H-7**：`/api/dm/send` 补上 `validateDmUploadOwnership`（**约 3 行代码，性价比最高的一条**）。
8. **H-8**：把上传槽位/配额预占移到 `express.raw` 之前，并给 chunked 请求设硬上限。

### P1 · 可用性（1~2 周）
7. **H-3 会话表**：`dm_conversations` + 迁移 + `/api/dm/list` 重写 + 前端改用会话列表。**这是所有 IM 能力的地基，优先级仅次于 P0。**
8. **M-2 分页**：`/api/dm/messages` 加游标 + 前端上拉加载。
9. **M-4 / M-5 发送队列与失败重发**：本地发送队列（`queued → sending → sent/failed`）+ 失败气泡 + 点击重发。
10. **H-1 实时通道**：按 H-3 的表结构加参与者 RLS + publication；或先上 Broadcast 私有频道止血。
11. **M-6 / M-7 收敛请求与口径**：会话行本地增量更新，不再每条消息全量拉列表。
12. **B-1 / B-2 / B-3**：幂等对账加入收件人；CAS 判定 `&&`→`||`；`abort` 增加 `sending` 租约检查并给 `/api/dm/send` 传更长的 `timeoutMs`。
13. **B-4 / B-5**：注册表登记提前到上传阶段 + `chat/` 孤儿 TTL 巡检。

### P2 · 向 QQ/微信 靠（1~2 月）
14. 群聊、语音消息、在线状态与「正在输入」、表情/引用回复/转发/收藏、@提醒。
15. 通讯录/发起新会话/搜人、消息搜索入口（后端已就绪）、置顶/免打扰/删除会话/清空历史。
16. 多端未读同步、离线消息、Web Push、媒体压缩与上传进度。
17. 用户间拉黑、单条消息举报、消息加密（如需）。

---

## 8. 需要你在生产库上确认的两件事

本报告关于 H-1 的结论基于仓库 migrations。如果生产库被人**手工**改过，结论会变，请用下面两条 SQL 各跑一次确认（这也正是本次审计最需要现场验证的一点）：

```sql
-- ① posts 是否真的在 Realtime 复制集合里？（预期：不在）
select schemaname, tablename from pg_publication_tables where pubname = 'supabase_realtime';

-- ② posts 上到底有哪些 SELECT 策略？白名单里有没有 __dm__？（预期：没有）
select polname, pg_get_expr(polqual, polrelid) as using_expr, polroles
from pg_policy where polrelid = 'public.posts'::regclass;
```

以及一条运行时验证：登录两个账号互发消息，在浏览器 Console 观察 Realtime 是否打印任何 `postgres_changes` 事件（或看 Supabase Dashboard → Realtime 的连接与事件量）。若无事件，即证实 H-1。

---

## 9. 附录：本次审计的证据索引

| 主题 | 关键位置 |
|---|---|
| Dock 聊天地图 | `06-chat-and-nav.js:336-1720`（列表 492-606、消息 1128-1288、发送 1320-1483、媒体 1485-1656） |
| 聊天 DOM | `index.html:338-368` |
| DM 助手函数 | `05-feed-stats.js:118-425`（`getDMMessagePayload`/`resolveDockChatMedia`/`markMessagesRead`/`isMsgReadByMe`） |
| Realtime 订阅 | `05-feed-stats.js:427-493` |
| 轮询与角标 | `05-feed-stats.js:643-725` |
| 后端 DM 接口 | `server.js:14849`(list) `14872`(messages) `14922`(read) `15181`(upload) `15298`(upload/abort) `15344`(send) `15606`(withdraw) |
| 私信数据模型 | `post-markers.js:8`（`DM_MARKER='__dm__'`）、`server.js:15539-15549`（写入 posts） |
| RLS 白名单 | `migrations/015:20-28`、`migrations/035:17-32` |
| Realtime publication | `migrations/022:13`（只加了 comments） |
| 已读 RPC | `migrations/027`、`migrations/032:155-214` |
| 媒体注册表 | `migrations/033`、`dm-media.js`、`server.js:15032-15104` |
| 上传归属校验 | `dm-media.js:379-394`（`validateDmUploadOwnership`）、调用点 `server.js:15205`（upload）、`15304`（abort）—— send 无调用 |
| 上传中间件顺序 | `server.js:15169-15181`（`dmUploadBudgetPrecheck` → `express.raw` → handler 内 `acquireDmMediaSlot`） |
| 魔数校验 | `server.js:15128-15167`（`sniffDmMediaMagic`） |
| 幂等与 CAS | `server.js:15032-15062`（`findDmMessageByActorKey` / `updateDmMediaRegistryCAS` / `attachDmMediaRegistry`） |
| 批量已读 RPC | `migrations/027`（坏版本）、`migrations/032:117-224`（线上生效版本）、`xtj_private.safe_jsonb` 定义在 `013:6` |
| 聊天 CSS | `style.css:1480-1760, 15700-15830`、`ui-shell.css:466-469`、`ui-shell.css:914-924`、`desktop.css:338-339,1316-1344`、`visual-refinements.css:113-116` |
| 聊天测试 | `tests/post-chat-runtime-contract.test.js`、`tests/ui/chat-detail-load.spec.js` |
| 登出清理 | `03-profile-report-ai.js:536-620`、`initUI` 1955-2026 |

---

*报告生成：2026-09-25 · 仓库 `main` @ `21103bd9`*
