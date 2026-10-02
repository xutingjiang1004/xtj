# 前端社交审计修复

本轮对应 `audit-reports/2026-10-01-frontend-social.md` 的 9 项问题，以及主审计确认的旧客户端登录／精细设备采集退役。照片亮度 P0 和聊天/AI 由专项改动处理，本文件不把其他模块修复计入自己的验收。

## 已实施

| 编号 | 修复 |
| --- | --- |
| F-SOC-01 | protected/optional fetch 在鉴权、网络响应、401 刷新及每次发送前后校验初始账号与 `_authStateEpoch`；即使 A→B→A 也拒绝旧请求。公开 `__xtjGetAuthEpoch()`，调用方可传 `authOwner/authEpoch`。`Headers` 对大小写不敏感地覆盖 Authorization，保留 FormData、Content-Type、AbortSignal。旧回包不强制退出新身份。真实鉴权等待本身也校验 epoch，避免 helper 收尾之前旧路径已经清会话。 |
| F-SOC-02 | 发布有独立 flight，固定账号、epoch、文件、文本、可见范围和定位快照；上传、创建 JSON、post snapshot 和等待列表刷新后均校验。账号切换解除旧按钮忙状态，旧 finally 不影响新 flight；旧响应不清空新草稿、不写入新界面缓存。actor_key 继续保留设备用途，不把设备 id 当请求幂等 id。 |
| F-SOC-03 | 普通帖子媒体在上传前调用认证 `/api/post/media/prepare` 登记；只用服务端返回的 posts 路径，`upsert:false`。创建传 `media_upload_id/media_storage_path`。失败用认证 cleanup，无浏览器 Storage 直接删除；网络清理失败留按账号的 pending 元数据，重新认证／回到页面可重试。旧身份永不借新 token 清理，服务器负责登记过期和引用检查。后端及事务迁移由 backend_business/DAO 实现。 |
| F-SOC-04 | 本地头像缓存先显示但不直接 return；沿用短期内存缓存与远程验证，预加载和 decode 成功后替换。请求序号、账号、epoch 和当前头像 URL 保护迟到图片；损坏 URL 清缓存并回到文字占位。 |
| F-SOC-05 | 资料 catch 同成功分支一样校验目标和请求序号，旧 A 失败不覆盖 B。 |
| F-SOC-06 | 乱码修复仅处理明确 `data-xtj-legacy-text` 系统节点的自身文字／标签；普通帖子、评论、聊天、说明、用户名保持原文。PRE/CODE/表单仍受保护。toast 仅过滤空消息，用户文字及前后空格不被改写。 |
| F-SOC-07 | 按压状态按 pointerId 记住初始按钮；外部释放、cancel、blur、pagehide 都清理。Dock 排除保持。 |
| F-SOC-08 | GSAP 拒绝有 catch，并在失败后 30 秒降级，避免连续弹窗造成失败请求风暴；减少动态和动效 off 不触发 GSAP tween，普通弹窗仍工作。 |
| F-SOC-09 | 移除 viewport maximum-scale/user-scalable 禁止缩放及外壳全页面手势拦截，正常文字恢复浏览器缩放。媒体预览继续使用各组件原有缩放，不改 Dock。 |

旧 `login-device.js` 的安全设置拉取、浏览器／Canvas／WebGL／电池／媒体设备／精确型号／归因采集代码已移除，`logLoginEventSafe/logLoginVisitSafe` 保留兼容 no-op。服务端真实登录记录、受限 browser-context、用户主动授权 GPS 保留。GPS 请求与原始授权回调固定账号和 epoch；持续共享恢复要求同账号 `xtj_location_sharing_owner`，不能借前一账号的全局授权恢复。后端旧登录事件 API 410 与旧开关强制关闭由 IP 专项实现。

## 验证

- `node --test tests/frontend-social-audit-runtime.test.js`：11 个真实源函数 VM 用例，覆盖 A→B→A 的延迟401、刷新完成漂移、初次鉴权epoch、Headers/FormData/signal、慢媒体上传、JSON延迟、新flight finally、post snapshot、失败cleanup持久重试。
- `node --test tests/frontend-social-audit-browser.test.js`：4 个真实 Chromium 用例，覆盖鼠标按住移出、用户原文/显式系统标记、GSAP拒绝与冷却、页面CDP1.25缩放、缓存头像后台验证及跨号迟到回包、资料旧失败回包。
- features、location telemetry、safe analytics、privacy telemetry 定向回归；现有 ai-site-tools/interaction 合同跟实现更新后47个通过。
- 主代理统一 assemble/build、全量 npm test、syntax、consistency；本代理不手改 core.js/min。

更新的浏览器契约仍检查真实可见结果：optional-auth 等认证 feed 与本人私密动态、单次刷新及无登录弹窗；主题中间态发布按钮按当前裸图标色彩检查；release validation 检查顶部点击命中与24px最低触控尺寸、公告/举报/筛选不重叠、退休首页统计卡不存在，以及桌面布局、页面缩放与溢出。帖子操作栏原44px契约保持。

生产数据库事务及媒体登记清理仍须部署本轮迁移；物理 iPhone/iPad、双真实账号设备联机不是上述 Chromium/mock 测试的完成范围。

## 最终浏览器验收（2026-10-02）

三份现有浏览器 spec 共 **39 个独立用例全部通过，分批组合验收**：mobile-theme-polish 22 个和 optional-auth-fetch 1 个来自完整三文件运行；release-validation 的前 8 个来自最终复跑，后 8 个来自修正可见导航 fixture 后的定向复跑。后 8 个命令结果 `8 passed (31.1s)`，包含桌面真实可见导航、细／粗指针、减少动态、认证弹窗、置顶、快速点赞、工具菜单及真正移动视口的30次Dock实点。退休的缩放按钮和无权删除按钮验证隐藏，不恢复功能；桌面主视图的4记录board验证2列，主页统计卡维持退役。没有把同一用例重复运行累加为更多验收数量。

本轮末尾只更正陈旧测试 fixture 与说明，没有继续修改产品源码。日志：`/workspace/scratch/xtj-social-full-ui.log`、`xtj-release-final.log`、`xtj-social-release-tail.log`；它们为临时工作区证据，不纳入生产构建。
