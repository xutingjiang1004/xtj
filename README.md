# XTJ

当前版本：`v0.93`

> **关于付费业务**：支付宝支付、VIP 订单、Pro 会员激活等相关业务代码暂不处理，当前主打免费模式。后续如需恢复收费业务，须先完成以下事项：
> 1. 在 Render Dashboard 配齐 `ALIPAY_APP_ID` / `ALIPAY_PUBLIC_KEY` 环境变量
> 2. 在支付宝回调 `/api/vip/notify` 中补全 `alipaySdk.checkNotifySign` 验签逻辑
> 3. 为支付流程加事务保护（先插 VIP 记录再更新订单）
> 4. 移除或加固 `/api/vip/activate-test` 测试端点（目前仅在环境变量缺失时自动关闭）
> **以上功能默认跳过，待后续通知再恢复。**



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

### v0.92 - 2026-06-27 AI 括号动作清洗 + 搜索 Provider 架构 + 流式加固 + 长期记忆

**括号动作全面清洗（render-api/server.js sanitizeAssistantVisibleText）**：
- 删除所有独立成行或内联的括号动作（全角/半角/方括号）
- 删除以明显动作描写词开头的裸行
- 保留合法括号内容（API、价格、技术术语）
- 流式/非流式回复均强制清洗，done 事件返回 sanitized_content

**搜索 Provider 架构（render-api/server.js searchWeb）**：
- Tavily > Brave > Serper > Custom API > SearXNG > Bing HTML 六层降级链
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
