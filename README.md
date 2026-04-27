# xtj（Vercel + Supabase + 可选 Render）

你现在的目标是：**登录后才能发布/点赞/评论**、点赞可见、发布者可删除自己的帖子、页面流畅。

## 本次已修复
- 站点名称已改为 `xtj`。
- 点赞/评论/发布都强制登录后才能执行。
- 点赞计数改为直接统计 `likes` 表，避免旧数据下 `likes_count` 不更新导致“看起来没点赞”。
- 新增“发布者删除帖子”能力（通过 `delete_post_with_actor` RPC，按 `post_id + actor_key` 校验）。
- 新增动效：帖子进入动画 + hover 过渡。

## SQL 交付（按你要求给两套）
### A. 全量重置（推荐排障时使用）
执行：`supabase/reset.sql`
- 会清空旧表并重建。
- 适合结构混乱、字段缺失时。

### B. 增量更新（保留数据）
执行：`supabase/incremental.sql`
- 会 `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` 补字段。
- 不会清空旧数据。

> 注意：SQL 已改为兼容写法：`DROP POLICY IF EXISTS ...; CREATE POLICY ...;`，不使用 PG15 才支持的 `CREATE POLICY IF NOT EXISTS`。

### C. 本次 UI 功能的增量补丁（不重置）
执行：`supabase/incremental_ui_v2.sql`
- 仅补齐 `delete_post_with_actor` / `increment_post_views` 函数与授权；
- 补齐 `uploads` 桶的读取/上传策略（若策略不存在会先删后建）；
- 适合你“站点已在跑，只想补新功能”。

## 部署配置（必须逐项确认）
### Vercel（前端）
- Framework Preset: **Other**
- Root Directory: 仓库根目录（本项目就是根目录）
- Build Command: 留空
- Output Directory: 留空

### Render（可选后端写入代理）
- Root Directory: `render-api`
- Build Command: `npm install`
- Start Command: `npm start`
- 环境变量：
  - `SUPABASE_URL=https://ithowxqignlhkwaykglt.supabase.co`
  - `SUPABASE_SERVICE_ROLE_KEY=你的 service_role key`

如果 Render 报 lock 文件问题：删除 `package-lock.json` 后重新部署。

## 前端 Supabase 配置
当前代码把私有配置隔离在脚本顶部的独立区块：
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`

后续功能更新只改“配置区下面”的业务代码，尽量避免覆盖你自己的私有配置。

你也可以改成运行时注入：
```html
<script>
  window.SUPABASE_URL = '...';
  window.SUPABASE_ANON_KEY = '...';
</script>
```

## Storage（图片/视频上传）
你已创建 `uploads` 桶。请确认：
1. bucket 为 public；
2. `storage.objects` 对 `uploads` 有 anon insert/read policy（或由后端代理上传）。

---
如果你要下一步，我可以继续给你做：
1. iCity 风格头像与发帖卡片布局；
2. 登录改为 Supabase Auth（手机号/邮箱），不再是纯昵称；
3. 点赞/评论防刷（IP + 频率限制，走 Render API）。
