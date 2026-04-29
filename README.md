# 液态玻璃（Vercel + Supabase，可选 Render API）

## 你现在点不动登录/评论的核心原因
1. 前端使用了 `sb_publishable_...`，但 `supabase-js` 浏览器初始化应使用 anon JWT key。  
2. 缺少 `likes/comments` 表、唯一约束、RLS policy 或 `increment_post_views` 函数时，前端会请求失败。  

## 已在本仓库做的修复
- 前端改成 anon key，支持**登录/游客模式**。  
- 支持发布文字/图片/视频；游客可点赞评论。  
- 点赞防重复：`likes(post_id, actor_key)` 唯一约束。  
- 浏览计数：前端首次浏览触发 `rpc(increment_post_views)`。  
- 实时同步：监听 `posts/comments/likes` 的 realtime。  

## 一次性初始化 Supabase（必须）
在 Supabase SQL Editor 执行：

- `supabase/init.sql`

> 你已经有 `posts` 和 `uploads`，这份 SQL 会 `if not exists` 兼容创建。

## 部署
### 1) 前端（Vercel）
这是纯静态站点，直接导入仓库部署即可（Framework 选 Other）。

### 2) 后端（Render，可选但推荐）
若你后续要做更强的防刷、IP 频控、敏感词审核：
- 用 `render-api/` 部署 Node 服务。
- 环境变量：
  - `SUPABASE_URL=https://ithowxqignlhkwaykglt.supabase.co`
  - `SUPABASE_SERVICE_ROLE_KEY=...`（仅 Render 后端保存，不能进前端）
- 然后前端把写入动作改成调用 Render API。

## 用 Codex 的最佳方式
1. 先把你“当前报错截图 + 控制台报错 + Supabase policy 截图”贴给 Codex。  
2. 让 Codex只做一件事：先打通 `登录/发帖/评论`。  
3. 验证通过后，再让 Codex加“防刷 / 审核 / 后台管理”。

---
如果你愿意，我下一步可以直接给你：
- 一份「前端走 Vercel，写操作走 Render」的完整 `fetch` 版本；
- 外加 `vercel.json` 和生产环境变量清单。
