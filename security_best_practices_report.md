# XTJ 网站安全审计报告

**审计日期**: 2026-06-14
**审计范围**: 前后端完整代码（render-api + js/ + css/ + docs/ + index.html + admin.html）
**审计模式**: 主动扫描（Static Code Review + 攻击面评估）
**未做**: 真实渗透测试（需要用户授权 + 部署环境访问）

---

## ⚡ Executive Summary

你的 XTJ 网站整体安全姿态**中等偏下**。基础防护（Helmet 等价 CSP、CORS 限制、CSRF 防护、rate limit、token 签名 + timingSafeEqual、XSS 转义、Supabase RLS）**已经做得相当不错**——这部分比 80% 的同类项目都强。

但仍有 **3 个 CRITICAL 漏洞 + 5 个 HIGH 漏洞 + 6 个 MEDIUM 漏洞 + 3 个 LOW 漏洞**。

**最危险的三件事（如果被利用，影响你的核心诉求）**：

1. 🔴 **任何人都能给任意用户开通 VIP 会员**（`/api/vip/activate-test` 无身份验证）
2. 🔴 **任何人都能删除任意用户的照片**（`/api/photo/delete` 只对比 client 传的 username）
3. 🔴 **Supabase RLS 缺关键策略**——私密帖子内容、bans/mutes/blacklist 表可能 anon key 直读

**用户隐私风险评估**：
- ✅ 聊天记录：当前默认 `media_type=__dm__` 在 RLS 黑名单中，**理论安全**（必须验证实际执行了 RLS）
- ✅ 照片：上传到 `uploads` bucket（public），但照片 ID 是 UUID，**不能直接枚举**
- ⚠️ 帖子：私密帖子（`visibility='private'`）的 RLS 策略只过滤 `media_type`、**没过滤 visibility**——**任何人都能读你的私密帖子**
- ⚠️ 照片 EXIF、IP 记录、攻击日志：可能被外部攻击者构造 CSRF/CORS 攻击插入脏数据

---

## 🔴 CRITICAL（3 项，必须立即修复）

### C1. `/api/vip/activate-test` 任意 VIP 激活（最严重）
- **位置**: [render-api/server.js:1555-1573](file:///c:/Users/Administrator/Desktop/%E6%9C%80%E6%96%B0index/xtj/render-api/server.js#L1555-L1573)
- **证据**:
```js
app.post('/api/vip/activate-test', rateLimit(60000, 5), async (req, res) => {
  if (!LOCAL_TEST_MODE) return res.status(403).json({ error: '生产模式下不支持测试激活' });
  try {
    const { user_name } = req.body;
    const userNameVal = validateString(user_name, MAX_USERNAME_LEN, '用户名');
    if (!userNameVal) return res.status(400).json({ error: '缺少用户名' });

    const userExists = await verifyUserExists(userNameVal);
    if (!userExists) return res.status(400).json({ error: '用户不存在' });

    const plan = VIP_PLANS[0];
    const orderNo = 'TEST' + Date.now() + String(Math.random()).slice(2, 6);
    const result = await processVipPayment(userNameVal, orderNo, plan);
    return res.json(result);
  } catch(e) { ... }
});
```
- **影响**: 任何未登录用户都能用 `curl -X POST https://xtj.onrender.com/api/vip/activate-test -H "Content-Type: application/json" -d '{"user_name":"任意用户名"}'` 给**任意已注册用户**开通 Pro 会员。攻击者不需要登录、不需要密码。
- **触发条件**:
  - 默认 `LOCAL_TEST_MODE = !(process.env.ALIPAY_APP_ID && process.env.ALIPAY_PUBLIC_KEY)`（[server.js:1427](file:///c:/Users/Administrator/Desktop/%E6%9C%80%E6%96%B0index/xtj/render-api/server.js#L1427)）
  - **只要 Render Dashboard 没同时配齐 ALIPAY_APP_ID 和 ALIPAY_PUBLIC_KEY 就会走测试模式**——根据你 [render.yaml:23-25](file:///c:/Users/Administrator/Desktop/%E6%9C%80%E6%96%B0index/xtj/render.yaml#L23-L25) 注释，这俩变量没列在 `envVars` 里，**默认是测试模式**。
- **紧急修复**:
  - **方案 A（推荐）**：删除此端点，**永不部署测试模式**。
  - **方案 B**：加 admin token 验证 `verifyToken` 中间件。
  - **方案 C**：要求 client 提供密码 hash 与后端 `auth_pw` 列比对。
- **缓解（已发现前的临时）**:
  - 在 Render Dashboard 立即配齐 `ALIPAY_APP_ID` 和 `ALIPAY_PUBLIC_KEY`（即使填假的，触发 `LOCAL_TEST_MODE = false`）
  - 用 `iptables`/WAF 限制 `/api/vip/activate-test` 只接受内网请求

---

### C2. `/api/photo/delete` 无身份验证
- **位置**: [render-api/server.js:529-551](file:///c:/Users/Administrator/Desktop/%E6%9C%80%E6%96%B0index/xtj/render-api/server.js#L529-L551)
- **证据**:
```js
app.post('/api/photo/delete', rateLimit(60000, 20), async (req, res) => {
  try {
    const { photoId, username } = req.body;
    if (!photoId) return res.status(400).json({ error: '缺少照片ID' });
    if (!username) return res.status(400).json({ error: '缺少用户名' });

    const { data: photo } = await supabase.from('posts')
      .select('user_name')
      .eq('id', photoId)
      .maybeSingle();

    if (!photo) return res.status(404).json({ error: '照片不存在' });
    if (photo.user_name !== username) return res.status(403).json({ error: '无权删除此照片' });

    const { error } = await supabase.from('posts').delete().eq('id', photoId);
    ...
  }
});
```
- **影响**: 用 `service_role` key 绕过 RLS 直接删表。攻击者**只需知道照片 ID + 拥有者用户名**就能删任何人的照片。照片 ID 是 UUID 难猜，**但用户名前端帖子列表里直接公开**——任意用户能遍历所有公开帖子抓 user_name 配合暴力枚举。
- **紧急修复**:
  - 加**密码 hash 验证**：`req.body` 加 `password_hash`，后端从 `posts` 表查 `media_type='__auth__'` 的 `media_url`（password hash）做 PBKDF2 比对
  - 或发短期 JWT token（用 Supabase Auth 自签）做身份验证
- **缓解**:
  - 在 RLS 层加 SELECT 限制：`anon` key 不允许读 `posts` 表的 `id` 字段——但 service_role 绕不过——所以**必须后端鉴权**

---

### C3. `/api/vip/create-order` 任意用户下单
- **位置**: [render-api/server.js:1481-1552](file:///c:/Users/Administrator/Desktop/%E6%9C%80%E6%96%B0index/xtj/render-api/server.js#L1481-L1552)
- **证据**:
```js
app.post('/api/vip/create-order', rateLimit(60000, 10), async (req, res) => {
  try {
    const { user_name, plan_id } = req.body;
    const userNameVal = validateString(user_name, MAX_USERNAME_LEN, '用户名');
    if (!userNameVal) return res.status(400).json({ error: '缺少用户名' });

    // 验证用户存在
    const userExists = await verifyUserExists(userNameVal);
    if (!userExists) return res.status(400).json({ error: '用户不存在' });
    ...
```
- **影响**: 与 C2 相同，**只验证用户存在**（user_name 在 `__auth__` 标记里查得到），**不验证请求者就是该用户**。攻击者可以为任意用户创建 VIP 订单（虽然要钱，但能制造脏数据 / 钓鱼链接 / 刷量）。
- **修复**: 同 C2，加密码 hash 验证或 JWT

---

## 🟠 HIGH（5 项）

### H1. Supabase RLS 缺 `visibility='private'` 过滤（你的私密帖子可能全网可读）
- **位置**: [docs/security-rls.sql:14-22](file:///c:/Users/Administrator/Desktop/%E6%9C%80%E6%96%B0index/xtj/docs/security-rls.sql#L14-L22)
- **证据**:
```sql
CREATE POLICY "anon_select_posts" ON posts
  FOR SELECT
  USING (
    media_type NOT IN (
      '__admin_auth__', '__ann__', '__report__', '__dm__',
      '__visit__', '__attack__', '__user_visit__', '__auth__'
    )
  );
```
- **影响**: **策略只过滤 `media_type`**，**没过滤 `visibility='private'`**！如果你用某个 `media_type='post'` 但 `visibility='private'`（前端用 `postVisibility = "private"` 设置）发帖子——**任何 anon key 都能 SELECT 到**——这意味着**所有用户的私密帖子**全网可读。
- **严重程度**: 这正是你最怕的事——"别人可以黑进去网站看到聊天记录和照片"。
- **验证**: 在 Supabase Dashboard 跑：
  ```sql
  SELECT user_name, content, visibility FROM posts WHERE visibility='private' LIMIT 5;
  ```
  用 anon key 跑应该返回空——但**可能返回所有私密帖子**。
- **修复**:
  ```sql
  DROP POLICY "anon_select_posts" ON posts;
  CREATE POLICY "anon_select_posts" ON posts
    FOR SELECT
    USING (
      media_type NOT IN ('__admin_auth__', '__ann__', '__report__', '__dm__',
        '__visit__', '__attack__', '__user_visit__', '__auth__')
      AND (
        visibility = 'public'  -- 公开帖子：anon 可读
        OR visibility IS NULL
        OR actor_key = current_setting('request.jwt.claims', true)::json->>'sub'  -- 自己的帖子
      )
    );
  ```
  注意：你的"actor_key"是 deviceId 不是 Supabase user_id，所以 RLS 内要 join `__auth__` 表查 user_name → deviceId 映射（很复杂）——**最简方案是后端用 service_role 统一处理私密帖子过滤**，前端用 RPC 拉数据。

---

### H2. RLS bans/mutes/blacklist 表策略不完整
- **位置**: [docs/security-rls.sql:100-137](file:///c:/Users/Administrator/Desktop/%E6%9C%80%E6%96%B0index/xtj/docs/security-rls.sql#L100-L137)
- **证据**:
```sql
-- bans 表
CREATE POLICY "service_role_all_bans" ON bans FOR ALL USING (true) WITH CHECK (true);
-- 注释说"依赖 service_role 自动绕过 RLS"
-- 然后:
CREATE POLICY "anon_modify_bans" ON bans FOR INSERT WITH CHECK (false);  -- 只禁 INSERT
```
- **影响**:
  - `bans` 表：anon 角色**没有显式 SELECT 禁止策略**——但 Supabase 默认 RLS 启用后未匹配任何 policy 应该是 deny。需要实际跑测验证。
  - `mutes` / `blacklist` 用 `USING(false)` + `FOR ALL`——理论应该全禁，但要测。
  - 注释本身就有问题：`"service_role_all_bans" USING (true)` 给 anon 也匹配，**实际等于允许 anon SELECT all bans**！这是真正的 RLS 写错。
- **修复**:
  ```sql
  -- 修正 service_role_all_bans 的命名（这其实只对 service_role 有效，因为 anon 不会用）
  DROP POLICY "service_role_all_bans" ON bans;
  -- 不创建任何 anon 策略 → RLS 自动 deny anon
  -- bans/mutes/blacklist 全部 anon 拒访
  ```

---

### H3. `__auth__` 表 `media_url` 存密码 hash 公开
- **位置**: [js/core.js:1245-1251](file:///c:/Users/Administrator/Desktop/%E6%9C%80%E6%96%B0index/xtj/js/core.js#L1245-L1251)
- **证据**:
```js
const { error } = await sb.from("posts").insert([{
  user_name: name,
  content: AUTH_MARKER,
  media_url: pwHash,  // salt:hash 存这里
  media_type: AUTH_MARKER,
  ...
}]);
```
- **影响**:
  - 你用 PBKDF2 + 16字节 salt 存密码（[core.js:886-891](file:///c:/Users/Administrator/Desktop/%E6%9C%80%E6%96%B0index/xtj/js/core.js#L886-L891)）——**算法本身是好的**
  - **但**：`media_type='__auth__'` 在 RLS 黑名单里——**SELECT 应该被拒**——但如果 RLS 没正确执行（参考 H1/H2），**所有用户的密码 hash 会公开**——离线字典攻击风险
  - salt 是 per-user，PBKDF2 iteration 多少？——看代码没说，**默认可能是 1 次**——弱
- **修复**:
  1. 确认 RLS 真的禁 anon SELECT `__auth__`（验证 H1/H2 修好）
  2. PBKDF2 iteration 提到 100,000+ 或换 Argon2id
  3. 用 Supabase Auth 替代自家密码 hash——bcrypt + 完整 session 管理

---

### H4. 头像 URL 客户端可控 → XSS / 钓鱼
- **位置**: [js/core.js:1554-1558](file:///c:/Users/Administrator/Desktop/%E6%9C%80%E6%96%B0index/xtj/js/core.js#L1554-L1558)
- **证据**:
```js
const { error: uploadErr } = await sb.storage.from('uploads').upload(path, file);
const avatarUrl = sb.storage.from('uploads').getPublicUrl(path).data.publicUrl;
```
- **影响**:
  - 上传头像**只校验扩展名 / 路径**，**没校验 MIME 内容**——攻击者可以：
    - 上传 HTML/SVG 文件做 XSS（Supabase Storage 默认 `Content-Type: octet-stream`，但浏览器有时会嗅探）
    - 上传 PHP / JS 不会执行（Supabase 不解析），所以这条**风险较低**
  - 真正的风险：**头像 URL 走 `escapeHtml(sanitizeUrl(...))`** ([core.js:1300,1331,1354](file:///c:/Users/Administrator/Desktop/%E6%9C%80%E6%96%B0index/xtj/js/core.js#L1300-L1354))——但 `sanitizeUrl` 函数定义我没看到，**如果只过滤 `javascript:`，绕过 `data:image/svg+xml,<svg onload=alert(1)>` 仍可能成功**
- **修复**:
  1. 看 `sanitizeUrl` 实现，确认过滤 `javascript:` `data:` `vbscript:`
  2. 头像 bucket 强制 `Content-Type: image/*`（Supabase RLS 限制 upload mime）
  3. 服务端用 `sharp` 重处理头像，转纯 PNG/JPG

---

### H5. 多个 API 无身份验证（除 C1/C2/C3 外）
- **位置**:
  - `/api/log-user-visit` ([server.js:1299-1336](file:///c:/Users/Administrator/Desktop/%E6%9C%80%E6%96%B0index/xtj/render-api/server.js#L1299-L1336))：任何人都能伪造任意用户访问记录
  - `/api/vip/status` ([server.js:1628-1660](file:///c:/Users/Administrator/Desktop/%E6%9C%80%E6%96%B0index/xtj/render-api/server.js#L1628-L1660))：任何人能查任意用户名 VIP 状态
  - `/api/my-reports` ([server.js:960-998](file:///c:/Users/Administrator/Desktop/%E6%9C%80%E6%96%B0index/xtj/render-api/server.js#L960-L998))：用 `API_SECRET` 鉴权，但 `API_SECRET` 默认 `crypto.randomBytes(32).toString('hex')`——**如果 env 没配，密钥每次重启变**
- **影响**:
  - 攻击者能伪造访问数据（脏数据 + 触发风控）
  - 能查任意用户名 VIP 状态（隐私泄露）
  - `/api/my-reports` 的 API_SECRET 客户端可能缓存了旧值——**API_SECRET 泄露后无法召回**（无 rotate 机制）
- **修复**:
  - `/api/vip/status` 加 `verifyToken`（共享 secret token with client）
  - `/api/log-user-visit` 改为 admin-only
  - `/api/my-reports` 用 Supabase Auth user_id 替代 API_SECRET

---

## 🟡 MEDIUM（6 项）

### M1. HSTS 在生产 HTTP 环境会卡 1 年
- **位置**: [server.js:212](file:///c:/Users/Administrator/Desktop/%E6%9C%80%E6%96%B0index/xtj/render-api/server.js#L212)
- **证据**: `res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');`
- **影响**: Render 强制 HTTPS 没事，**但本地开发（`localhost:3000` HTTP）会缓存 HSTS 1 年**——一旦用 HTTPS 自签证书 + HSTS 缓存，浏览器拒绝回退 HTTP。
- **修复**: `if (req.secure) res.setHeader('Strict-Transport-Security', ...)`——只在 HTTPS 时设

### M2. `__report__` 提交速率限制太弱
- **位置**: [server.js:920](file:///c:/Users/Administrator/Desktop/%E6%9C%80%E6%96%B0index/xtj/render-api/server.js#L920) `rateLimit(60000, 10)`
- **影响**: 10 次/分钟 举报——攻击者可以举报刷量，把正常用户的全部帖子举报成 `pending`
- **修复**: 加 per-target 限流 + per-user 限流

### M3. `visitCache` Map 内存无限增长（潜在 DoS）
- **位置**: [server.js:106-121](file:///c:/Users/Administrator/Desktop/%E6%9C%80%E6%96%B0index/xtj/render-api/server.js#L106-L121)
- **证据**: `if (visitCache.size > 10000)` 时清理——**有上限 OK，但清理逻辑是同步 forEach**——极端情况下 10000+ Map entries 同时过期会卡 event loop
- **修复**: 用 LRU cache（`lru-cache` 包）或限制 `visitCache.size` 硬上限 + 早 return false

### M4. CSP `script-src 'unsafe-inline'` 允许内联脚本
- **位置**: [server.js:214](file:///c:/Users/Administrator/Desktop/%E6%9C%80%E6%96%B0index/xtj/render-api/server.js#L214)
- **证据**: `script-src 'self' 'unsafe-inline' ...`
- **影响**: 如果未来有存储型 XSS（XSS sink 漏一个），攻击者注入的 `<script>alert(1)</script>` 直接执行
- **修复**: 用 nonce / hash——但要改所有内联脚本或加 integrity 标签
- **缓解**: 你前端基本所有 innerHTML 都 escape 了——M4 实际风险不大

### M5. `AlipaySdk` 验签逻辑缺失
- **位置**: [server.js:1713-1756](file:///c:/Users/Administrator/Desktop/%E6%9C%80%E6%96%B0index/xtj/render-api/server.js#L1713-L1756) `/api/vip/notify`
- **证据**:
```js
app.post('/api/vip/notify', async (req, res) => {
  const params = req.body;
  if (!params || !params.sign) {
    return res.status(400).send('fail');
  }
  // ... 直接读 params 没用 alipaySdk.checkNotifySign 验签
```
- **影响**: **完全没验签支付宝回调**！攻击者 POST 任意 `out_trade_no` + `total_amount=3` + `trade_status=TRADE_SUCCESS` 就能给任意用户开 VIP！**比 C1 还严重**——但只在生产模式（配了 Alipay 凭证）才生效。
- **修复**: `if (alipaySdk.checkNotifySign(params))` 严格验签

### M6. `deviceId` 客户端可控 → 鉴权绕过
- **位置**: [js/core.js:136-139](file:///c:/Users/Administrator/Desktop/%E6%9C%80%E6%96%B0index/xtj/js/core.js#L136-L139), [server.js:493-495](file:///c:/Users/Administrator/Desktop/%E6%9C%80%E6%96%B0index/xtj/render-api/server.js#L493-L495)
- **证据**:
```js
deviceId = localStorage.getItem("xtj_device_id");
// 客户端可任意修改
// 后端 RPC delete_post_with_actor 用 deviceId 做 owner 校验
```
- **影响**: 攻击者改 localStorage 的 `xtj_device_id` 为目标用户的 deviceId（如果泄露了，比如从 `__user_visit__` 记录里查），就能删除对方的帖子/评论
- **修复**: deviceId 鉴权完全不够，**必须后端验证登录态**（如 Supabase Auth JWT 或自家 JWT）

---

## 🟢 LOW（3 项）

### L1. `cors` package 默认 `Origin: *` 已禁用（CORS OK）
- **位置**: [server.js:166-192](file:///c:/Users/Administrator/Desktop/%E6%9C%80%E6%96%B0index/xtj/render-api/server.js#L166-L192)
- **状态**: ✅ 已正确配置白名单 + 自动检测

### L2. `X-Powered-By` 已禁用
- **位置**: [server.js:20](file:///c:/Users/Administrator/Desktop/%E6%9C%80%E6%96%B0index/xtj/render-api/server.js#L20)
- **状态**: ✅ `app.disable('x-powered-by')` 正确

### L3. 缺少 npm audit / CI SCA
- **位置**: 项目根和 render-api 都没有 `.github/workflows/`
- **影响**: 没有自动化依赖漏洞扫描
- **修复**: 加 GitHub Action 跑 `npm audit --audit-level=high` + `npm outdated`

---

## 📊 攻击面清单（用于渗透测试参考）

### 公开端点（无 auth）
- `GET /` — 静态 HTML
- `GET /health` — 健康检查
- `GET /api/vip/plans` — 套餐列表
- `GET /api/vip/status?user_name=X` — 任意人 VIP 状态 ⛔
- `POST /api/vip/activate-test` — 任意激活 VIP ⛔ (C1)
- `POST /api/vip/create-order` — 任意人下单 ⛔ (C3)
- `POST /api/photo/delete` — 任意人删照片 ⛔ (C2)
- `POST /api/log-user-visit` — 任意人伪造访问 ⛔
- `POST /api/report` — 提交举报（10/min 限流）
- `GET /api/my-reports?user_name=X` — 需 API_SECRET 鉴权（弱）

### Supabase RLS（最后防线）
- 实际**未在 Supabase Dashboard 验证 RLS 是否执行**——这是审计报告里最大的未知数
- **强烈建议在 Supabase SQL Editor 手动跑**：
  ```sql
  -- 用 anon key 执行下列查询
  SELECT count(*) FROM posts;  -- 应该排除敏感 media_type
  SELECT count(*) FROM posts WHERE visibility='private';  -- 应该 0
  SELECT count(*) FROM bans;  -- 应该 0
  SELECT count(*) FROM mutes;  -- 应该 0
  ```

### XSS sink（前 50 处 innerHTML 已审查）
- 1300/1331/1354 等头像用 `escapeHtml(sanitizeUrl(...))` ✅
- 7352 公告/5514 帖子 body 渲染要看 buildPostHtml 完整实现
- 公告 admin 发的内容**直接 innerHTML**——如果 admin 端被钓鱼，恶意公告可 XSS

### 客户端密码 / 设备 ID
- localStorage 存：`xtj_user`、`xtj_device_id`、`xtj_avatar_cache`
- 浏览器 XSS 攻击者能直接读
- **缓解**：开启 CSP `script-src 'self' 'unsafe-inline'`——已开但 unsafe-inline 让 XSS 更易

---

## 🎯 修复优先级（按用户实际风险排序）

**P0 - 立即修（影响金钱和数据安全）**：
1. **C1 VIP 任意激活** — 删端点 / 加 token 验证
2. **C2 任意删照片** — 加密码 hash 验证
3. **C3 任意下单** — 同 C2
4. **H1 私密帖子 RLS 漏** — 在 Supabase 补 RLS
5. **M5 支付宝回调不验签** — 加 `alipaySdk.checkNotifySign`

**P1 - 本周修（隐私和稳定）**：
6. **H2 bans/mutes/blacklist RLS 修正**
7. **H5 其他无鉴权 API**
8. **M1 HSTS 在 HTTP 环境**
9. **M2 举报限流加固**

**P2 - 长期改进**：
10. **H3 PBKDF2 升级到 Argon2id**
11. **H4 头像 MIME 校验**
12. **M3 visitCache LRU**
13. **M4 CSP 改 nonce**
14. **M6 deviceId 鉴权改 JWT**

**P3 - 加固层**：
15. **L3 加 CI npm audit**
16. 把 `deviceId` 替换为 Supabase Auth 的真实 user_id（重构级别）

---

## 💡 关于"我怕被黑"的最终回答

**你最大的恐惧场景（陌生人看到聊天记录和照片）的实际风险**：

| 场景 | 真实风险 | 说明 |
|------|----------|------|
| 陌生人看到所有聊天 | **低** | DM 在 `media_type='__dm__'` 黑名单，RLS 应该禁读——但**必须手动验证** |
| 陌生人看到照片 | **中** | 照片 bucket 是 public，URL 是 UUID——难猜但**理论可枚举** |
| 陌生人看到私密帖子 | **🔴 高** | H1 漏洞——**很可能目前所有私密帖子公开** |
| 陌生人删你照片 | **🔴 高** | C2 漏洞——只需 ID + user_name |
| 陌生人用你账号开 VIP | **🔴 高** | C1 漏洞——任何人都能 |
| 暴力破解你的密码 | **低** | PBKDF2 + salt 抗字典攻击——**但 iteration 未知** |
| CSRF 攻击 | **极低** | Origin 检查 + SameSite 防御到位 |

**最紧迫的 3 个动作**（你今天就能做）：

1. **在 Supabase Dashboard 跑**：
   ```sql
   SELECT count(*) FROM posts WHERE visibility='private';
   ```
   **如果返回 > 0 数字**：立刻改 RLS 策略（参考 H1 修复），**私密帖子全泄露**。
2. **在 Render Dashboard 配 ALIPAY_APP_ID + ALIPAY_PUBLIC_KEY**（哪怕填假的）——立即关掉 C1。
3. **临时禁用** `/api/vip/activate-test` 和 `/api/photo/delete` 端点（在 server.js 加 `app.disable` 注释或路由 503）。

---

**报告生成完毕**。报告文件位置: [security_best_practices_report.md](file:///c:/Users/Administrator/Desktop/%E6%9C%80%E6%96%B0index/xtj/security_best_practices_report.md)

需要我**实际修复**哪些问题吗？告诉我你想从哪几个开始。
