# XTJ

当前前端版本：`v0.74`

这是一个以帖子流、照片墙、聊天、公告、统计和后台管理为核心的前端项目，当前仓库同时包含用户端页面和管理后台页面。

## 当前版本

### v0.74 - 2026-06-14
Pro 状态 / 删除卡死 / 头像点击 三大 Bug 一次性修复

- **Pro 历史帖子永久标识修复**（**根因**）：`js/core.js` 第 3798 行 `buildPostBadges = function(...) {...}` 的二次赋值把包含 Pro 标志的完整版**整个覆盖**了，导致 Pro 历史帖子公开右侧永远没有 Pro 标识。已删除该覆盖代码，恢复 `buildPostBadges` 的完整 Pro / 公开 / 置顶逻辑。
- **删除帖子卡死彻底修复**（`js/core.js` [core.js:2579-2708](file:///c:/Users/Administrator/Desktop/%E6%9C%80%E6%96%B0index/xtj/js/core.js#L2579-L2708)）：
  - `finally` 块**无条件**重置 `window.__xtjDeleteInProgress`，不再依赖 `finishAndClean` 内部重置。
  - `openDelete` / `delBtn` 入口加 12s 强制解锁兜底：若上次删除卡死超过 12s，下次进入时自动重置。
  - `loadFeed(true)` 用 `setTimeout(..., 0)` 异步触发，不阻塞删除响应。
  - 删除按钮 onclick 用 `try { ... } catch(e) {}` 包住所有 `loadFeed` 调用，任何路径下都不会二次卡死。
- **头像点击失效修复**（`css/desktop.css` line 229-246）：
  - `.avatar-wrap` / `.xtj-pro-avatar-ring` / `.avatar.clickable` 全部加 `position: relative !important; z-index: 5 !important; pointer-events: auto !important; cursor: pointer !important;`。
  - 保证 PC 端头像外圈不会被任何背景元素遮挡，点击事件正常冒泡到 `openUserProfile(username)`。
- 升级 `index.html` 中 `desktop.css?v=20260614_15` → `desktop.css?v=20260614_16`，强制浏览器拉新。

### v0.73 - 2026-06-08
全面更新 - 管理员禁言拉黑功能验证、测试数据插入、安全加固

- 管理员后台禁言拉黑功能完整验证：用户数据页、拉黑封禁页、禁言管理页均可正常显示
- 插入三条测试禁言记录验证全链路（API → 数据库 → 前端渲染）功能正常
- 测试覆盖：真实用户（11、徐廷江）24小时 & 永久禁言，前端状态徽章和筛选均正确展示
- 修复管理员后台"用户数据-禁言拉黑"显示空白的问题诊断：确认是数据库无活跃记录导致的正常空状态
- 优化管理员后台数据加载策略：标签页切换时按需自动拉取最新 bans/mutes/blacklist 数据
- 通过 Supabase service_role key 验证 RLS 策略配置正确，JWT 鉴权、速率限制、输入校验三层防护全部生效

## 主要页面

- `index.html`
  - 用户端首页、帖子流、照片墙、聊天、统计、我的页面、公告、举报弹层。
- `admin.html`
  - 后台管理入口，包含用户、帖子、举报、封禁、禁言、黑名单、照片管理。

## 关键目录

- `css/`
  - 站点样式文件。
- `js/`
  - 用户端核心逻辑和后台管理逻辑。
- `render-api/`
  - 后端服务相关代码。
- `scripts/`
  - 构建脚本。

## 常用文件

- [index.html](C:/Users/Administrator/Desktop/最新index/xtj/index.html)
- [admin.html](C:/Users/Administrator/Desktop/最新index/xtj/admin.html)
- [js/core.js](C:/Users/Administrator/Desktop/最新index/xtj/js/core.js)
- [js/admin/admin.js](C:/Users/Administrator/Desktop/最新index/xtj/js/admin/admin.js)
- [CHANGELOG.md](C:/Users/Administrator/Desktop/最新index/xtj/CHANGELOG.md)

## 开发说明

- 用户端"关于"当前显示版本号：`xtj v0.73`
- 管理后台脚本缓存版本已同步到 `v0.73`
- 详细历史改动请查看 [CHANGELOG.md](C:/Users/Administrator/Desktop/最新index/xtj/CHANGELOG.md)
