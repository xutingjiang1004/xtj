# XTJ

当前版本：`v0.85`



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
2. `index.html` 中关于页版本号（当前 `v0.85`）
3. `js/core.js` 中站内 changelog 数据

这样可以避免“仓库版本、站内版本、关于页版本”再次分裂。
