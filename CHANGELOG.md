# 更新日志

## v0.92 - 2026-06-27
AI 括号动作清洗 + 搜索 Provider 架构重构 + 流式响应加固 + 长期记忆系统 + 照片墙预览安全兜底

### 新增
- **搜索 Provider 架构**：Tavily > Brave > Serper > Custom API > SearXNG > Bing HTML 六层降级链，按环境变量自动选择可用 Provider
- **搜索健康检查端点**：`GET /api/agent/search-health?q=关键词` 返回每个 Provider 状态、环境变量配置、错误详情
- **管理员搜索健康检查按钮**：后台 AI 配置页一键检查搜索 Provider 可用性，显示具体失败原因
- **长期用户记忆系统**：基于 DeepSeek 提取用户偏好/习惯，存入 `posts` 表，每次对话自动注入相关摘要
- **对话摘要系统**：每次对话结束后异步生成摘要，按关键词匹配注入相关上下文
- **完整 AI 配置系统 V2**：12 模块后台配置 UI（人设/语气/回复风格/角色扮演/输出规则/搜索/记忆/模型/调式），全部可后台调整
- **管理员生效 Prompt 预览**：`GET /admin/ai-agent/effective-prompt` 实时查看当前生效的系统提示词
- **天气工具**：Open-Meteo 免费天气 API，按城市坐标查询实时天气
- **前端搜索状态条分级显示**：有结果显示"已联网搜索 · N 条结果(Provider)"，无结果显示"联网搜索完成 · 没有找到相关结果"，失败显示具体 Provider 错误
- **照片墙预览图片加载失败兜底**：显示"图片加载失败"占位文字，不显示黑块/破碎图标
- **照片墙预览关闭状态清理**：关闭时重置 transform/scale/translate/currentIndex/loading 状态

### 修复
- **括号动作/舞台动作全面清洗**：重写 `sanitizeAssistantVisibleText`，删除所有独立成行或内联的括号动作（全角/半角/方括号），删除以明显动作描写词开头的裸行，保留合法括号内容（API、价格、技术术语）
- **buildAiCorePrompt 硬性禁止项优先级**：禁止括号动作规则放在 Prompt 最后一行，明确标注"以下规则永远覆盖管理员额外指令和人设"
- **流式回复漏清洗**：流式 `/api/agent/chat/stream` 最终 contentBuffer 强制调用清洗，done 事件返回 `sanitized_content` 和 `filtered` 字段
- **前端清洗后内容替换**：前端收到 `sanitized_content` 后替换气泡正文，保留 `filtered` 标记显示"已自动清理动作描写"
- **搜索失败时 AI 不编造**：所有 Provider 失败时注入"本次联网搜索失败"系统提示，禁止模型编造实时信息
- **空结果缓存策略**：有结果缓存 60 秒，空结果最多缓存 5 秒或不缓存
- **流式中途断连恢复**：统一 `finishStream` 函数处理所有结束路径，前端保留已输出内容，显示"回复中断"提示
- **Idle Timeout**：20 秒无数据块自动终止连接，不陷入永久挂起
- **前端 SSE 双重处理**：`evtHandled` 防重复标记
- **聊天历史加载**：`resolveConvId` 函数修复 convId 提取，确保历史会话正确加载
- **头像上传 404**：API 路由注册 + base64 JSON 提交替代 multipart
- **邮箱 Pro 活动/Pro 会员与邮件模块修复**：多项兼容性修复

### 重构
- **搜索引擎从 Brave（付费）→ SearXNG（免费）→ Bing HTML + SearXNG 双引擎 → Provider 架构**：演进四轮，最终实现六层降级链
- **消息排序系统**：显式 `created_at` 时间戳（用户 1ms 优先于 AI）+ `getMsgSortKey` 稳定排序函数
- **AI System Prompt 从硬编码到完全配置驱动**：`buildAiCorePrompt` 从硬编码猫娘人设改为从 `migrateConfig` 读取配置，所有风格/规则/限制统一从后台管理

### 安全
- **不需要付费 API Key**：搜索功能全免费（SearXNG 公共实例 + Bing HTML 解析 + 可选稳定 API Key）
- **前端 XSS 预防**：搜索结果显示、错误文案统一转义
- **记忆数据隔离**：用户记忆按 `actor_key` 隔离，管理端仅 admin 可查看

### Remade
- **搜索功能从四轮迭代演进为稳定 Provider 架构**：Brave（付费被拒）→ SearXNG（DNS 失败）→ Bing + SearXNG（Promise.race 空数组）→ Provider 六层降级
- **AI 聊天可靠性从"基本可用"到"生产级"**：消息排序、流式断连、超时保护、内容清洗、记忆系统、配置管理全链路加固
- **前端 SSE 处理从"只看 content"到"全事件响应"**：支持 meta/status/search/search_error/content/done/error，内容清洗后替换，错误时保留已输出内容

## v0.90 - 2026-06-25
邮件发送记录展示重构 + 历史邮箱双保险持久化
- 删除 from_email 列、详情列、收件人合计列
- 表格结构改为 时间 / 接收邮件账号 / 接收人 / 主题 / 结果
- 接收人列：网站用户显示用户名，外部邮箱显示邮箱号
- 多收件人显示"第一个 + 等 N 人"，title 放完整列表
- 兼容旧数据（recipients / emails / recipient_email / to_email / total_recipients）
- 后端抽取 saveEmailRecipientHistory helper（去重 / 一次性查 / 已有更新 / 新增补 actor_key+media_url）
- send-email 路由保存历史失败只 console.warn，不阻断邮件发送
- POST /admin/email-recipient-history 兼容 recipients / emails 两种格式
- GET /admin/email-recipient-history 兼容 info.email / row.media_url 等多字段
- 前端 emailSend 4 种状态（成功/部分失败/全部失败/异常）都调用 saveRecipientsHistorySafe
- index.html / README.md / CHANGELOG.md 同步到 v0.90

## v0.89 - 2026-06-25
Pro 会员改为限量/限定/限时活动模式
- 彻底去除常驻 ¥3/月 套餐卡（vipPlanCard / vipPayBtn / vipCancelArea）
- 弹窗只显示当前 Pro 状态条 + 活动列表
- 无活动显示"暂无可领取的 Pro 活动"
- 活动卡片支持：专属标签、剩余名额、截止时间、功能权益
- 按钮状态：未领取/已领取/名额满/已结束
- 后端 /api/pro-gifts/available 与 /api/pro-gifts/claim 加 authenticateUser 中间件
- claim 强制以 req.userName 为准
- /admin/pro-gifts/save 支持 claim_limit / allowed_users / exclusive / start_at / end_at
- 前端 __xtjDirectPurchasePro 禁用，保留函数名返回错误
- 活动编辑器增加限量名额、限定用户（逗号分隔）、是否专属、活动起止时间
- 不影响：照片墙 / 聊天 / 底部 Dock / 普通帖子 / 登录 / 其他后台模块

## v0.88c - 2026-06-24
修复邮件历史邮箱账户不保存 + 发送记录增加详情
- 后端 /admin/send-email 路由发送前先调用 saveEmailRecipientHistory 保存收件人历史
- 新增 saveEmailRecipientHistory(recipients) helper：去重 / 一次性查询 / 已有更新 / 新增插入
- 新增 actor_key + media_url 字段补齐
- 邮件发送记录新增 from_email 与 recipients_detail 字段
- 前端 loadEmailHistory 改为显示：发件邮箱 / 主题 / 收件人 / 结果 / 详情（含展开）
- 前端 loadEmailRecipientHistory 展示 用户名 <邮箱> / 邮箱 两种形式
- 发送成功后自动清空已选 + 刷新历史 + 刷新记录
- emailClearSelected 添加到发送成功链

## v0.88b - 2026-06-24
邮件配置健康检查端点 + bug 修复
- 新增 /health/mail 端点：返回 active_provider（GAS / SendGrid / Gmail_SMTP）以及 env 加载状态
- 修复 SENDGRID_API_KEY 误用 var 声明被覆盖的隐患
- 修复 /admin/report/:id/delete-post 和 /admin/report/:id/ban-user 端点缺少顶层 try-catch
- 修复 index.html / README.md / CHANGELOG.md 版本号不一致
- 升级 pro-upgrade.js query string 版本号到 20260624_progift

## v0.88a - 2026-06-24
Google Apps Script (GAS) 邮件中转通道上线
- 新增 GAS (HTTPS 443) 邮件中转通道，绕过 Render SMTP 465/587 端口封锁
- 邮件发送优先级：GAS (HTTPS 443) > SendGrid > Gmail SMTP（最终兜底）
- 失败链：GAS 失败 → SendGrid → Gmail SMTP
- 新增 GMAIL_GAS_URL 环境变量支持（IANA 不带空格）
- GAS Web App 部署权限必须设为"任何人"（Anyone）以允许未认证请求

## v0.88 - 2026-06-24
邮件系统重构：Google Apps Script (GAS) HTTPS 中转通道上线，绕过 Render SMTP 端口封锁
- 新增 `GMAIL_GAS_URL` 环境变量支持，邮件发送优先级：GAS (HTTPS 443) > SendGrid > Gmail SMTP
- GAS 失败自动回退到 SendGrid，SendGrid 失败再回退到 Gmail SMTP（最终兜底）
- 修复浏览器缓存：升级 pro-upgrade.js ?v= 到 20260624_progift
- 修复 index.html / README.md / CHANGELOG.md 版本号不一致
- 修复 /admin/report/:id/delete-post 和 /admin/report/:id/ban-user 端点缺少顶层 try-catch
- 修复 SENDGRID_API_KEY 误用 var 声明被覆盖的隐患

## v0.85 - 2026-06-23
Pro 赠送活动系统上线、安全审计修复、设备识别精度大幅提升、聊天头像即时更新

### 新增
- **Pro 赠送活动系统**：管理员可在后台创建/编辑/发布 Pro 赠送活动，设置标题、描述、功能权限、有效天数、领取截止时间
- **用户免费领取 Pro**：用户在"我的页面"→ Pro 会员中可看到已发布的活动，一键领取，每位用户每个活动限领一次
- **Pro 历史记录系统**：管理后台新增「Pro记录」子标签，可视化展示所有用户的历史开通记录，包含：
  - 概览统计卡片：开通人数、总开通次数、免费赠送次数、自主开通次数
  - 完整记录表：用户名、类型图标、来源标注（🎁免费赠送/🆓自主开通/💳付费购买）、领取/开通时间、到期时间
  - 用户维度汇总：每位用户的开通次数、来源分布、首次/最近开通时间、最近到期时间
- 所有 VIP 激活记录（免费赠送/自主开通/付费购买）均统一存储 `source` 字段，后端可追踪完整生命周期
- **Pro 领取庆祝动画重做**：全新暗色渐变卡片设计，金色主题，显示来源（🎁免费赠送/🆓自主开通/💳付费购买）和到期日期，GSAP 分段入场动画（icon→标题→信息→权限→按钮逐层入场）
- 设备型号识别全面升级：新增 UA 标识符映射表（iPhone16,2→15 Pro Max 等 30+ 型号），优先于分辨率推断
- 地区中文显示：后台所有地区字段自动将 `China·Guangdong·Guangzhou` 转译为 `广东广州`
- 用户详情卡片数据回填：最近访问/最近IP/地区/最近设备从最新登录事件自动回填
- 注册字符限制：昵称仅允许中英文、数字和下划线，长度 2-20 字符
- 管理员登出清理：登出时自动清除 session 超时监听、举报轮询、事件监听器
- 全局 fetch 超时保护：admin.js `apiCall` 30s 超时、core.js VIP 查询 8s 超时

### 新增
- 设备型号识别全面升级：新增 UA 标识符映射表（iPhone16,2→15 Pro Max 等 30+ 型号），优先于分辨率推断，彻底解决 15 Pro Max 被误判为 16 Plus 等问题
- 地区中文显示：后台所有地区字段自动将 `China·Guangdong·Guangzhou` 转译为 `广东广州`，非中国地区保持原样
- 用户详情卡片数据回填：最近访问/最近IP/地区/最近设备从最新登录事件自动回填，不再显示空值
- 注册字符限制：昵称仅允许中英文、数字和下划线，长度 2-20 字符，杜绝 XSS 注册攻击
- 管理员登出清理：登出时自动清除 session 超时监听、举报轮询、事件监听器，不再有后台残留请求
- 全局 fetch 超时保护：admin.js `apiCall` 30s 超时、core.js VIP 查询 8s 超时，避免永久挂起

### 修复
- 【安全】XSS 高危漏洞修复：后台用户列表两个按钮的 `onclick` 改用 `safeJsStr()` 全转义，恶意用户名不再可执行任意 JS
- 【安全】`window.sb` 不再被 admin.js 删除，前台后台可同页面共存
- 【安全】Storage 路径遍历防护：从 `media_url` 提取存储路径时检查 `..`，恶意 URL 不再可删除任意文件
- 【安全】后端错误信息泄露关闭：删除用户/邮件发送/日志清理三处的 `e.message` 不再返回前端
- 【安全】RateLimit 边界修复：`>` 改为 `>=`，真正命中配置的限制次数
- 【安全】`currentUser` 暂时性死区（TDZ）修复：避免 `touchUserSession` 在 `let` 声明前访问变量
- 举报主弹窗 × 按钮样式修复：不再依赖 `btn-ghost`，改为独立 `report-modal-close` 样式
- 点赞/评论记录显示被操作人：记录从 `xxz 点赞了这条内容` 改为 `xxz 点赞了 yy 的内容`
- 未登录用户隐藏帖子页三大数据版块：总动态/总浏览/点赞和评论卡片对访客不可见
- 聊天对话列表头像不再滞后：`hydrateDockChatAvatars` 改为每次都查所有用户，且去掉 `dockChatActiveUser` 限制，列表头像即时更新
- 用户详情弹窗去掉最近安全提醒区块
- 管理后台邮箱发送结果展示详细失败原因
- 邮箱发件地址修正：Resend 免费版强制使用 `onboarding@resend.dev`，不再受未验证域名限制

### 优化
- 设备识别链路重做：分辨率推断降级为 UA 标识符的兜底，无标识符时回退原分辨率逻辑
- 举报表单按钮样式统一优化，关闭按钮更醒目
- 用户列表用户卡信息网格加宽（180px → 220px），展示更宽松
- 设备详情弹出卡从内联展开改为 860px 模态框，带 × 关闭
- 后台登出时同步清理会话超时定时器、举报轮询、事件监听，减少资源浪费

### 安全
- 注册入口增加字符集与长度服务端兼容验证，前端双重校验
- `safeJsStr` 函数统一用于 JS 字符串上下文的转义（覆盖 `\ ' " < > \n`）
- fetch 超时机制覆盖 admin 全部 API 调用和前台 VIP 状态查询
- RateLimit 严格从 `>=` 检查，不再多放一个请求

### Remade
- 重做设备型号识别引擎：放弃纯分辨率+iOS 版本推断，改用 UA 标识符映射优先
- 重做聊天列表头像更新机制：`hydrateDockChatAvatars` 不再按"有无缓存"过滤，每次全量检查并刷新 DOM
- 重做后台会话管理：登出时完整清理定时器和 DOM 事件绑定

## v0.84 - 2026-06-22
安全中心、设备识别、错误监控、操作审计与用户详情全面上线

### 新增
- 管理后台新增"🛡️ 安全中心"tab，包含今日异常数、高风险、未读等统计卡片
- 五类安全提醒自动生成：`same_ip_multi_users`（同IP多账号）、`same_device_multi_users`（同设备多账号）、`multi_ip_same_user`（同账号多IP）、`geo_change`（地区变化）、`high_frequency_visit`（高频访问）
- 安全提醒支持三种处理状态：已读、忽略、误报，每条含 `reviewed_at` 和 `reviewed_by` 审计字段
- 客户端温和浏览器指纹：由 screen/timezone/language/platform/hardwareConcurrency/deviceMemory/colorDepth/touch/browser/os 生成 SHA-256 hash，仅保存 hash
- Canvas 指纹 Hash：渲染温和识别文本后取前 512 像素 SHA-256 hash，不保存图像/像素/base64，浏览器阻止时优雅降级为 null
- 前端错误监控：`/api/client-error-log` 端点，自动捕获 JS error、unhandledrejection、fetch 失败、图片加载失败、白屏检测
- 管理员操作审计日志：`/admin/audit-logs` 端点，记录删除帖子/照片、封禁/解封、禁言/解禁、清理日志、修改安全设置、审查安全提醒等操作
- 日志保留与清理：登录记录/安全提醒保留 90 天，错误日志保留 30 天，支持一键清理过期日志 + 每24小时自动清理
- 用户详情弹窗：点击用户列表用户名打开完整详情（注册时间/IP/地区/设备/fingerprint hash/帖子等统计数据/最近10条登录/最近10条安全提醒/处罚历史）
- 风险评分系统：`/admin/user-risk-scores` 基于安全告警自动计算，用户列表显示"正常/低风险/中风险/高风险"彩色标签
- 安全识别开关：后台可独立开关"基础设备记录""浏览器指纹 Hash""Canvas 指纹 Hash""安全提醒生成"，前端按开关跳过采集，后端按开关跳过写入

### 修复
- 修复安全检测函数未去重可能导致重复告警的问题，四个检测函数均增加时间窗口去重逻辑
- 管理后台用户列表最近 IP 改为完整显示，不再使用 maskIp 打码

### 优化
- IP 地区解析改为多源 fallback：ip-api.com（2s 超时）→ ipapi.co（2.5s）→ ipwho.is（2.5s），失败有 console.warn 日志
- `/api/log-login-event` 写入后自动同步更新 `__user_info__` 的 last_login、last_visit、last_device、last_ip、last_ip_location
- 前台帖子流、`/admin/data` 全链路排除 `__login_event__` 与 `__security_alert__`，确保前台和统计不泄露登录/安全数据
- 页面访问冷却从 60s 改为 15s
- 安全提醒异步生成，不影响登录/刷新/发帖速度

### 安全
- 所有敏感数据（完整IP、地区、设备指纹）仅限管理员后台查看，前台不暴露
- 指纹仅作辅助判断展示，不作为自动封禁唯一依据
- 不做跨站追踪，不采集剪贴板、通讯录、麦克风、摄像头、键盘输入、未发送草稿
- Canvas 指纹渲染不保存原始图像、base64 原文或像素数据

### Remade
- 重做管理后台用户列表：新增"地区"列（最近设备与最近IP之间）和"风险评分"列
- 重做设备记录链路：从前端懒加载安全设置、条件采集指纹、到后端开关写入、异步安全检查、同步 user_info，统一为一条完整链路
- 重做版本同步：关于页、站内 changelog、仓库 README 与 CHANGELOG.md 统一到 v0.84

## v0.83 - 2026-06-21
统计弹窗旧版结构恢复、版本号同步到 0.83

### 修复
- 统计弹窗恢复到旧版记录布局，不再继续沿用 `statHero` / `stat-row` 的面板化样式
- “总动态”恢复为按用户分组的列表结构，组头只保留头像首字母、用户名和条数胶囊
- 修复总动态中坏标签、乱码、时间与内容挤在一起、移动端时间断行等问题
- 修复“总浏览”“点赞和评论”里图片帖只剩文字、原帖缩略图缺失、评论内容不独立显示的问题

### 优化
- 总浏览统一改回图文记录卡，浏览图片帖时优先显示真实缩略图，视频帖显示视频占位
- 点赞记录与评论记录统一为旧版风格记录卡，原帖查不到时明确显示“原帖已删除”
- 统计弹窗移动端布局收口为横向卡片，时间保持单行省略，不再退回竖排

### Remade
- 重做统计弹窗恢复策略：以 Git 历史旧版结构为基线回退，而不是继续在当前救火覆盖层上叠补丁
- 重做版本同步到 `v0.83`，让关于页、站内 changelog、仓库文档与构建产物保持一致

## v0.82 - 2026-06-21
首页三大统计入口、顶部公告与举报按钮运行时阻断修复
### 修复
- 修复 `js/core.js` 中 `applyPerformanceMode()` 误用块级作用域外 `htmlEl` 导致脚本中途报错的问题
- 修复早期 `bindHeaderActionButtons()` 旧入口与后续全局导出互相干扰，导致首页初始化被打断的问题
- 修复三大统计卡片点击后弹窗无响应的问题，`总动态 / 总浏览 / 点赞和评论` 现在都可正常打开 `#statModal`
- 修复顶部公告 / 举报入口的运行时链路，后续点击不再被前序异常中断

### 优化
- 首页入口排查方式改为以浏览器运行时为准，优先定位真实 `runtime blocker`
- 入口验证改为 `node --check`、`npm run build` 与浏览器真实点击三层校验，不再只看静态搜索结果

### Remade
- 重做首页入口修复思路：从“静态绑定补丁”改为“先清掉前序 runtime blocker，再让最终全局入口生效”
- 重做统计 / 公告 / 举报的修复标准：以 modal `active` 状态和真实点击结果为准，不再以“函数名看起来存在”为完成标志

## v0.81 - 2026-06-20
后台统计口径统一、注册提醒补齐、照片墙移动端预览手势收口

### 新增
- 后台新增“新用户注册提醒”能力，只统计 `posts.media_type='__auth__'` 的注册记录
- 新增 `GET /admin/users/register-alerts` 与 `POST /admin/users/register-alerts/read` 两个后台接口
- 管理后台“用户数据”入口支持红点数字提醒，进入用户页后自动标记已读

### 修复
- 修复 `/admin/stats/users` 只看 `__user_visit__` 导致“新增用户”和“用户访问明细”口径不一致的问题
- 修复 `/admin/stats/daily` 的 `new_users` 统计，改为按 `user_name` 去重并只认最早注册时间
- 修复 `/admin/stats` 顶部 `total_users` 被重复 `__auth__` 记录放大的问题
- 修复照片墙全屏预览在 iPhone / iPad / 移动端双指缩放乱飞、跳变、松手回弹的问题
- 修复 pinch 结束后误触发单击 / 双击缩放，导致图片被立刻缩回原图的问题
- 修复 pinch 结束后松开一根手指继续拖图时沿用旧起点，导致图片突然跳回旧坐标的问题

### 优化
- 照片墙移动端预览手势统一收口为单一状态机：`idle / pinch / pan / swipe-or-dismiss`
- pinch 结束后保留 `scale > 1.01` 的缩放状态，不再用过高阈值强制重置
- 为 `#photoPreviewOverlay / #ppImageWrapper / #ppSlideTrack / #photoPreviewImage` 补齐移动端 `touch-action`、`overscroll-behavior`、`user-select` 保护样式
- 后台注册提醒默认只统计最近 24 小时未读注册，避免首次进入后台时把历史用户全部算作提醒
- pinch 结束后增加至少 `350ms` 的 tap / doubleTap 屏蔽窗口，避免合成点击再次抢走缩放状态

### 清理
- `__admin_meta__` 记录已从后台普通帖子查询、统计查询、每日统计查询中排除，不再污染业务数据

### Remade
- 重做后台用户统计口径：`__auth__`、`__user_info__`、`__user_visit__` 三类数据统一聚合，注册数、用户总数、访问明细三处对齐
- 重做后台新用户提醒链路：不建新表，直接复用 `posts` 中的 `__admin_meta__` 保存已读时间
- 重做照片墙移动端预览热修复策略：以 `preview-hotfix.js` 为主接管移动端触摸手势，统一 hotfix 标记并避免与 `preview.min.js` 双重争抢 `transform`
- 重做 pinch -> pan 的交接逻辑：双指结束后立即以剩余手指重建拖拽起点，缩放与拖动不再互相打架

## v0.80 - 2026-06-18
照片墙加载性能、实时展示、安全收口与站点整理

### 新增
- 照片墙单次加载数量从 20 提升到 60，首次进入可直接看到更多历史内容
- 导出 `window.normalizePhotoWallRow`，上传成功后前端可立即把新照片插入当前照片墙
- 为首页补充 `meta description`，同时把 `ui-enhance.css` 提前到 `head` 加载

### 修复
- 修复照片墙读取仍命中旧缓存的问题，改为直接从 Supabase 拉取最新数据
- 修复老视频没有 thumb 时直接显示空白块的问题，补上运行时首帧封面兜底
- 修复多处前端 XSS 风险：上传文件名、错误文案、URL 安全回退都做了统一处理
- 修复生产环境残留调试输出与重复 UTF-8 BOM 的问题

### 优化
- `admin.html` 的 Supabase CDN 脚本改为 `defer`，减少阻塞
- CSS 缓存版本统一更新，减少旧资源混用

### 清理
- 清理未引用的压缩样式死文件与多余调试语句

### Remade
- 重做照片墙数据链路，从“缓存优先 + 小批量分页”收口为“实时读取 + 更大首屏批量”
- 重做照片墙上传后同步方式：标准化数据、立即插入、清缓存、强制重取统一到一条链路
- 重做前端安全审计收口，补齐高风险 XSS 入口点

## v0.79 - 2026-06-15
视频压缩、照片墙视频预览、Pro 标记与举报弹层统一修复

### 新增
- 视频上传统一按 `10MB` 阈值处理，超过后会先尝试浏览器端压缩再上传
- 照片墙老视频新增运行时首帧封面兜底，没有 thumb 也不会再直接显示空白块

### 修复
- 修复非 Pro 用户帖子误显示 Pro 标记的问题，只认发帖冻结状态与历史有效期
- 修复举报弹层文字帖重复显示作者名和“文字帖”标签挡内容的问题
- 修复照片墙视频点击后预览链路不统一的问题，统一收敛到全屏预览层

### 优化
- 视频大小信息默认优先展示最终上传大小 `fileSize`，详情里仍保留 `originalSize`
- 举报弹层顶部收敛为单标题 + 图标按钮，减少重复入口和视觉噪音

### Remade
- 重做照片墙视频卡片的预览入口，让封面、全屏预览和信息层走同一条链路
- 重做 `v0.79` 版本同步方式，让关于页、站内 changelog、仓库 `CHANGELOG.md` 三处保持一致

## v0.78 - 2026-06-14
版本号与更新日志同步整理

### 新增
- 关于页版本显示统一更新为 `xtj v0.78`
- 站内更新日志补充 `v0.78` 版本记录
- 仓库 `CHANGELOG.md` 与站内版本记录同步，减少版本信息不一致

### 优化
- 更新日志文案按正式发布结构重新整理，继续保留“新增 / 修复 / 优化 / Remade”分节

### Remade
- 重做版本记录同步方式，让关于页版本号、站内 changelog、仓库 changelog 三处保持一致

## v0.76 - 2026-06-12
按钮点击修复、安全加固与全模块 Bug 修复

### 新增
- 通知、举报、Pro、点赞评论记录按钮点击无响应问题全面修复
- 帖子显示兜底机制补齐：`IntersectionObserver` 异常时自动降级为可见
- 举报弹窗顶部新增“举报表单 / 举报记录”切换标签，并与事件绑定对齐

### 修复
- `API_BASE` 统一改为 `window.location.origin`，支持任意自定义域名
- 修复照片墙 `upload.min.js` 被重复加载导致事件重复绑定的问题
- 修复 `/api/photo/delete` 未校验归属的安全漏洞
- 修复访问统计中间件位置错误导致首页不记录访问的问题
- 修复删除公告时 `actor_key` 错误导致 RLS 校验失败的问题
- 修复举报列表混入 `__vip__`、`__vip_order__`、`__user_visit__` 等内部记录的问题

### 安全
- JWT 鉴权、速率限制、输入校验三层防护在线

### 优化
- `IntersectionObserver` 增加 `try/catch` 保护，兼容旧浏览器

## v0.74 - 2026-06-10
安全审计、性能修复与加载动画升级

### 修复
- 修复 Supabase RLS、CSRF、代理 IP 识别、后台举报处理回滚等安全问题
- 修复 `rateLimitStore`、`adminTokens`、`visitCache`、`statsCache` 相关内存与并发问题

### 优化
- 统计查询限额收口，减轻数据库压力
- 加载动画从旧版 Canvas 方案替换为纯 CSS 方案
- 帖子渲染改为内容优先、头像异步补齐，减少首屏等待

### Remade
- 重写加载动画系统与帖子首屏渲染链路

## v0.73 - 2026-06-08
后台禁言拉黑验证与按需加载优化

### 新增
- 后台“用户数据 / 拉黑封禁 / 禁言管理”链路完成验证
- 插入测试数据验证 API、数据库、前端渲染全链路可用

### 修复
- 诊断并确认“禁言拉黑页空白”属于无数据空状态，不是前端渲染故障
- 切换标签页时自动拉取最新 `bans / mutes / blacklist` 数据

### 优化
- 后台数据改为按标签页按需加载，减少无意义首屏请求

### Remade
- 重做后台用户数据页的加载策略与状态同步方式

## v0.72 - 2026-06-07
安全审计修复、统计仪表盘上线、举报通知打通

### 新增
- 后台统计总览、每日趋势、攻击分布、访问明细等模块上线
- 新增 `/admin/stats`、`/admin/stats/daily`、`/admin/stats/refresh`、`/admin/stats/users`
- 用户访问自动记录、管理员处理举报后自动私信通知举报人
- 新增安全测试脚本，覆盖 XSS、CSRF、路径穿越、高频请求等攻击场景

### 修复
- 修复举报记录混入帖子列表的问题
- 修复后台统计中每日攻击数据聚合异常的问题

### 优化
- 统计页改为“主数据先出、重表异步补齐”的加载策略
- 统计 API 增加缓存，减轻数据库压力

### Remade
- 重做后台安全防护与统计可视化基础设施

## 说明
- 本文件已按当前仓库实际状态重新整理。
- 更早版本若仍有零散旧记录或乱码，以 Git 历史为准。
