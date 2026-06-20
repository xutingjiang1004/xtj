# XTJ

当前版本：`v0.81`

XTJ 是一个前后端同仓库项目，包含前台主站与后台管理两部分。前台以帖子流、照片墙、聊天、公告、互动记录为核心；后台覆盖用户、帖子、点赞、评论、举报、封禁、照片管理与数据统计。

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

当前 Render 部署入口由 [render.yaml](/C:/Users/Administrator/Desktop/最新index/xtj/render.yaml:1) 定义：

- 服务类型：`web`
- 运行时：`node`
- 构建命令：`npm install`
- 启动命令：`node --env-file=render-api/.env render-api/server.js`

这意味着 Render 线上实际走的是：

- 前端静态资源：仓库根目录
- 后端入口：`render-api/server.js`

## 最近重点更新

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

- 照片墙预览当前缺少未压缩源文件 `js/photo-wall/preview.js`，仓库内只有：
  - `preview.min.js`
  - `preview-hotfix.js`
- `npm run build` 目前会跳过若干缺失源文件，例如：
  - `js/photo-wall/preview.js`
  - `js/photo-wall/data.js`
  - `js/photo-wall/render.js`
  - `js/photo-wall/upload.js`
  - `js/photo-wall/photo-wall.js`

这表示：

- 现阶段照片墙预览问题优先通过 `preview-hotfix.js` 做热修复更稳
- 如果后续要彻底重建照片墙构建链，应该先补齐这些源文件，再统一收口 minified 产物

## 环境与配置注意

- 项目使用 Supabase。
- Render 部署依赖 `render-api/.env` 中的后端环境变量。
- `render.yaml` 中要求手动配置的关键变量包括：
  - `ADMIN_PASSWORD`
  - `SUPABASE_SERVICE_KEY`
  - `API_SECRET`
  - `SUPABASE_URL`
  - `ADMIN_USERNAME`

额外提醒：

- `API_SECRET` 如果在部署更新后被重置，会导致后台登录态失效。
- 当前仓库存在 `render-api/.env` 与支付密钥文件，发布前应确认是否符合你的实际安全策略。

## 文档同步约定

每次发版建议至少同步这三处：

1. `CHANGELOG.md`
2. `index.html` 中关于页版本号
3. `js/core.js` 中站内 changelog 数据

这样可以避免“仓库版本、站内版本、关于页版本”再次分裂。
