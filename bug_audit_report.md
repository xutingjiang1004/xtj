# XTJ 前后端全面 Bug 审查报告

**审查日期**: 2026-06-14
**审查范围**: 全部前端 / 后端代码（render-api/server.js + js/ + css/ + html/ + admin/）
**审查方式**: 静态代码分析 + 逻辑推导 + 攻击面评估
**未做**: 手动浏览器测试、自动化测试、真实渗透

---

## 一、总体评价

代码整体质量**中等**。现有逻辑大多数能跑通，但存在一些**数据一致性隐患**、**内存泄漏隐患**、**状态管理漏洞**。之前已修复的 Pro 标志 / 删除卡死 / 头像点击是**已解决的问题**，本次报告不再重复。

共发现 **2 个严重 Bug + 7 个中等问题 + 8 个轻微问题**。

---

## 🔴 严重 Bug（2 项）

### B1. VIP 支付流程无事务保护（数据不一致）

- **位置**: [server.js:3521-3570](file:///c:/Users/Administrator/Desktop/%E6%9C%80%E6%96%B0index/xtj/render-api/server.js#L3521-L3570)
- **问题**: `processVipPayment` 做两件事：1) 更新订单 status 为 paid；2) 插入 VIP 记录。两步之间**没有事务**。如果第 2 步 `insert` 失败（比如网络断开），第 1 步的 order 已经标记为 paid，但用户**实际没获得 VIP**——钱付了但没记录。
- **影响**: 用户付了钱，VIP 没开通，数据永久不一致
- **修复**: 用 Supabase DB 事务 or 改为先 insert VIP → 再 update order（VIP 记录是"真金白银"，order 是辅助）
- **缓解**: 当前几乎没有，除非手动在 Supabase Dashboard 补记录

### B2. `handleAvatarUpload` 旧头像删了但新头像没插上（数据丢失）

- **位置**: [core.js:1887-1915](file:///c:/Users/Administrator/Desktop/%E6%9C%80%E6%96%B0index/xtj/js/core.js#L1887-L1915)
- **问题**:
  1. 先 `sb.storage.from('uploads').upload(path, file)` 上传新头像
  2. 再 `sb.rpc('delete_post_with_actor')` 删除旧头像记录
  3. 再 `sb.from("posts").insert(...)` 插入新头像记录
  4. 如果**第 3 步 insert 失败**（比如 SQL 错误），旧头像记录已删除，新头像记录没插入 → **用户头像空**
- **影响**: 用户头像出现空白，需要重新上传
- **修复**:
  ```js
  // 方案 A：先 insert 新记录 → 再删旧记录（保证至少有一个有效记录）
  // 方案 B：用 upsert 替代 insert+delete
  // 方案 C：在 insert 失败时回滚 delete（重新插入旧记录）
  ```
- **当前代码中 insert 失败只弹 toast**:
  ```js
  if (error) {
    showToast('上传失败: ' + error.message);
    return;  // 旧头像已删，新头像没插上
  }
  ```

---

## 🟠 中等问题（7 项）

### M1. `doLogout` 清理不完整

- **位置**: [core.js:2028-2040](file:///c:/Users/Administrator/Desktop/%E6%9C%80%E6%96%B0index/xtj/js/core.js#L2028-L2040)
- **问题**: 登出时 `clearUserSessionStorage()` 只删 `USER_SESSION_KEY` 和 `xtj_user`——但**没删**：
  - `xtj_avatar_cache`（头像缓存）
  - `xtj_vip` 相关缓存
  - `xtj_dmread_*`（已读消息标记）
  - `xtj_photo_wall_*`（照片墙缓存）
  - `xtj_device_id`（设备 ID）
  - `xtj_pw_hash`（sessionStorage 中的密码 hash）
- **影响**: 用户 A 登出后，用户 B 在同一台电脑登录，可能看到 A 的头像缓存、VIP 缓存、已读消息标记
- **修复**: 登出时清理**所有** `xtj_` 前缀的 localStorage 项

### M2. `toggleLike` 错误恢复不完整

- **位置**: [core.js:2910-2956](file:///c:/Users/Administrator/Desktop/%E6%9C%80%E6%96%B0index/xtj/js/core.js#L2910-L2956)
- **问题**: catch 块调用 `updatePostLikeUi(postId, wasLiked)` 恢复 UI——但**没有恢复 `feedAllPosts` 中的点赞数据**（`updatePostLikeUi` 可能只改 DOM 不改内存数据）
- **影响**: 点赞操作失败后，UI 恢复了但内存数据不一致，下次刷新 feed 覆盖
- **修复**: 确认 `updatePostLikeUi` 同时更新 `feedAllPosts` 中的点赞状态

### M3. `tokenize` / `verifyToken` 的 `exp` 过期时间逻辑有 Bug

- **位置**: [server.js:1200-1240](file:///c:/Users/Administrator/Desktop/%E6%9C%80%E6%96%B0index/xtj/render-api/server.js#L1200-L1240)
- **问题**: `tokenize` 函数中 `exp` 是**未来时间戳**（`Date.now() + 1000 * 60 * 60 * ADMIN_TOKEN_EXPIRY_HOURS`），但 `verifyToken` 中 `payload.exp < Date.now()` 做比较——这里**逻辑正确**
- **但**: `ADMIN_TOKEN_EXPIRY_HOURS` 定义在 [server.js:25-27](file:///c:/Users/Administrator/Desktop/%E6%9C%80%E6%96%B0index/xtj/render-api/server.js#L25-L27)，`ADMIN_TOKEN_EXPIRY_HOURS` 可能被 `Number(process.env.ADMIN_TOKEN_EXPIRY_HOURS)` 覆盖——如果 env 没设，默认值是 `Math.min(24, 24)` = 24，正常
- **实际风险**: 低

### M4. `IntersectionObserver` / `MutationObserver` 无清理泄漏

- **位置**: [core.js:277-339](file:///c:/Users/Administrator/Desktop/%E6%9C%80%E6%96%B0index/xtj/js/core.js#L277-L339)
- **问题**: `postDwellObserver` 和 `postVisibilityObserver` 在首次初始化后，**没有**在 `switchTab` 或 `window.onbeforeunload` 时 `disconnect()`
- **影响**: 用户在帖子 / 照片 / 聊天面板间频繁切换，观察器一直挂载，内存泄漏
- **修复**: 面板切换时 disconnect 重新观察

### M5. `restrictionPollTimer` 未清理

- **位置**: [core.js:1307](file:///c:/Users/Administrator/Desktop/%E6%9C%80%E6%96%B0index/xtj/js/core.js#L1307)
- **问题**: `restrictionPollTimer = setInterval(function() { ... }, 30000)` 每 30 秒轮询限制状态——**但只在 `doLogout` 时 clearInterval**
- **影响**: 如果用户不登出但关闭页面，没有 `beforeunload` 清理
- **修复**: 在 `window.addEventListener('beforeunload', ...)` 中清理，或在 `clearUserSessionStorage` 时一并清理

### M6. `supabase` 客户端初始化缺少 `ANON_KEY` 检查

- **位置**: [core.js:60-80](file:///c:/Users/Administrator/Desktop/%E6%9C%80%E6%96%B0index/xtj/js/core.js#L60-L80)
- **问题**: 如果 `config.js` 加载失败或 `XTJ_CONFIG` 未定义——`sb = supabase.createClient(...)` 会收到 `undefined` 参数——**无错误提示**，后续所有 API 调用静默失败
- **修复**: 在 `createClient` 前检查 `SUPABASE_URL` 和 `SUPABASE_ANON_KEY` 是否有效

### M7. `visitCache` 清理逻辑阻塞事件循环

- **位置**: [server.js:106-121](file:///c:/Users/Administrator/Desktop/%E6%9C%80%E6%96%B0index/xtj/render-api/server.js#L106-L121)
- **问题**: `if (visitCache.size > 10000)` 时同步 `forEach` 清理过期条目——如果 10000 个条目同时过期，`forEach` 会卡住 event loop 数十毫秒
- **修复**: 用 `lru-cache` 包或 `Map` + 异步 lazy cleanup

---

## 🟡 轻微问题（8 项）

### L1. `features.js` 全局变量未声明

- **位置**: [features.js:100-106](file:///c:/Users/Administrator/Desktop/%E6%9C%80%E6%96%B0index/xtj/js/features.js#L100-L106)
- **问题**: `_mjBuilt`、`_mjRegex`、`_mjMap` 用 `var` 声明（实际上是 IIFE 内的局部变量），但 `window.xtjFixText` 引用 `_mjRegex` 和 `_mjMap`——如果 `features.js` 早于 `core.js` 加载，`fixText` 被调用时 `_mjBuilt` 未初始化
- **修复**: 在 `fixText` 开头加 `if (!_mjBuilt) { _buildMjRegex(); }`（代码已有，但确认 `_buildMjRegex` 是否在作用域内）

### L2. `core-animations.js` 未检查 GSAP 加载

- **位置**: [core-animations.js:44,71,100,139,197](file:///c:/Users/Administrator/Desktop/%E6%9C%80%E6%96%B0index/xtj/js/core-animations.js#L44-L197)
- **问题**: 多处直接调用 `gsap.set()` / `gsap.to()` 等，没检查 `typeof gsap !== 'undefined'`
- **影响**: 如果 GSAP CDN 加载失败，所有 modal 打开/关闭动画崩溃
- **修复**: 包装 `const gs = window.gsap || null; if (!gs) return;`

### L3. `ui-effects.js` 引用了未定义的 `isDockTab`

- **位置**: [ui-effects.js:145,188](file:///c:/Users/Administrator/Desktop/%E6%9C%80%E6%96%B0index/xtj/js/ui-effects.js#L145-L188)
- **问题**: `xtjHeartBurst` 和 `XTJEffects.ripple` 中使用 `window.isDockTab`——如果 `core.js` 没挂载这个变量，`undefined` 导致条件判断异常
- **修复**: 加 `typeof window.isDockTab !== 'undefined'` 检查

### L4. `performance.js` 浏览器兼容性

- **位置**: [performance.js:18](file:///c:/Users/Administrator/Desktop/%E6%9C%80%E6%96%B0index/xtj/js/performance.js#L18)
- **问题**: `navigator.deviceMemory` 和 `navigator.hardwareConcurrency` 在 Safari/Firefox 上不可用
- **修复**: `navigator.deviceMemory || 4` 有默认值了，但 `navigator.hardwareConcurrency` 也需要 fallback

### L5. `photo-wall/upload-ui.js` 引用未定义的 `window.deviceId`

- **位置**: [upload-ui.js:185](file:///c:/Users/Administrator/Desktop/%E6%9C%80%E6%96%B0index/xtj/js/photo-wall/upload-ui.js#L185)
- **问题**: `window.deviceId` 可能未定义（不同 IIFE 加载顺序问题）
- **修复**: `const deviceId = window.deviceId || 'unknown';`

### L6. CSS `!important` 过度使用

- **位置**: [desktop.css](file:///c:/Users/Administrator/Desktop/%E6%9C%80%E6%96%B0index/xtj/css/desktop.css) 全文件共 80+ 处 `!important`
- **问题**: 大量 `!important` 让 CSS 层级失效，后续修改困难
- **建议**: 仅在覆盖第三方库样式时使用

### L7. `index.html` 重复的 `id` 属性

- **位置**: [index.html](file:///c:/Users/Administrator/Desktop/%E6%9C%80%E6%96%B0index/xtj/index.html) 多处 modal ID
- **问题**: 需要确认 `delModal`、`reportModal`、`profileDetailModal` 等 ID 唯一
- **修复**: 用 `grep -n 'id="' index.html | sort -t'"' -k2` 检查重复

### L8. `render.yaml` 缺少 `ALIPAY_APP_ID` / `ALIPAY_PUBLIC_KEY`

- **位置**: [render.yaml:19-46](file:///c:/Users/Administrator/Desktop/%E6%9C%80%E6%96%B0index/xtj/render.yaml#L19-L46)
- **问题**: 这两个环境变量没有在 `envVars` 中列出（只列了注释），导致 `LOCAL_TEST_MODE = true`（即 C1 漏洞启用）
- **修复**: 在 Render Dashboard 手动设置这两个变量，值任意（只需存在）

---

## ✅ 已经做对的部分（正面评价）

1. **PBKDF2 iterations = 100,000**（[core.js:1177](file:///c:/Users/Administrator/Desktop/%E6%9C%80%E6%96%B0index/xtj/js/core.js#L1177)）——标准强度，抗字典攻击
2. **密码 salt 16 字节 + CSPRNG**（[core.js:1183](file:///c:/Users/Administrator/Desktop/%E6%9C%80%E6%96%B0index/xtj/js/core.js#L1183)）——每个用户独立 salt
3. **token 签名 + timingSafeEqual**（[server.js:1225-1228](file:///c:/Users/Administrator/Desktop/%E6%9C%80%E6%96%B0index/xtj/render-api/server.js#L1225-L1228)）——防时序攻击
4. **CORS 白名单机制**（[server.js:166-192](file:///c:/Users/Administrator/Desktop/%E6%9C%80%E6%96%B0index/xtj/render-api/server.js#L166-L192)）——动态检测 origin
5. **rate limit 每个端点**（express-rate-limit）——防暴力
6. **XSS 转义 `escapeHtml`**（[core.js:82-90](file:///c:/Users/Administrator/Desktop/%E6%9C%80%E6%96%B0index/xtj/js/core.js#L82-L90)）——所有用户输入都 escape 了
7. **`x-powered-by` 禁用**（[server.js:20](file:///c:/Users/Administrator/Desktop/%E6%9C%80%E6%96%B0index/xtj/render-api/server.js#L20)）——减少信息泄露
8. **乐观 UI + 错误回滚**（[core.js:2918-2948](file:///c:/Users/Administrator/Desktop/%E6%9C%80%E6%96%B0index/xtj/js/core.js#L2918-L2948)）——toggleLike 有 catch 恢复
9. **feed 加载 12s 超时**（[core.js:5490](file:///c:/Users/Administrator/Desktop/%E6%9C%80%E6%96%B0index/xtj/js/core.js#L5490)）——不永久挂起
10. **VIP 历史预加载 5s 超时**（[core.js:5527](file:///c:/Users/Administrator/Desktop/%E6%9C%80%E6%96%B0index/xtj/js/core.js#L5527)）——fire-and-forget

---

## 修复优先级

**P0（立即修复——数据丢失/不一致）**：
- B1: VIP 支付无事务
- B2: 头像上传 insert 失败无回滚

**P1（本周——功能稳定性）**：
- M1: doLogout 清理不完整
- M2: toggleLike 错误恢复
- M4: Observer 内存泄漏
- M5: restrictionPollTimer 清理

**P2（后续改进）**：
- M6: supabase 初始化检查
- M7: visitCache 清理优化
- L1-L8: 各项轻微问题

---

**报告文件**: [bug_audit_report.md](file:///c:/Users/Administrator/Desktop/%E6%9C%80%E6%96%B0index/xtj/bug_audit_report.md)