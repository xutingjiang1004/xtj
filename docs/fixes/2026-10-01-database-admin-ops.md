# 数据库、后台与依赖修复

已完成 DAO-01 至 DAO-07：旧登录不补造地区；用户详情请求支持取消与身份/请求序号隔离；退出先清敏感界面，服务端失败显示重试；管理 Cookie 登录不依赖附带普通 access token；MCP localhost 支持端口；网络期限覆盖 JSON 响应体；锁文件改官方 HTTPS。

管理附带会话退出单独走 `/api/user/logout`，凭真实管理 Cookie 校验，只撤销同一 principal 当前浏览器 refresh 和其有效 access；另一个普通账号的 Cookie 保留。随后撤销管理会话；附带会话失败时保留管理凭证供重试，管理撤销失败仍清浏览器管理 Cookie，并报告未确认。没有全设备撤销。

依赖：Multer 2.4.0、Nodemailer 10.0.13、sharp 0.35.5、Playwright 三包统一 1.63.0、Supabase 固定 2.106.2；xlsx 使用官方维护的 0.20.3 HTTPS tarball及 integrity；xmldom 0.8.15、qs 6.16.0。独立 API/MCP 锁同兼容传递依赖已更新，没有 force 升级。根与 API、3 个 MCP 的 npm audit 均为 0；原始与修后 JSON 保留在 audit-reports。

`20261002012142_atomic_audit_operations.sql` 由 Supabase CLI migration new 创建：搜索预占/幂等取消退款、存储清理原子并集与租约失效、普通帖子媒体登记与创建/清理排他状态、认证 IP 地区回写，以及聊天 restrictive 防线。新媒体幂等绑定上传登记的 post id，保留 actor_key 设备语义；中文 URL 通过登记的真实 URL/id 判断引用。`cleaned_at` 供后端后台清理确认。搜索账本遵守现有额度账本保留规则，账户删除先确认原始媒体清理再移除上传登记，由业务代理接线。

真实 PostgreSQL 17.10：98 个迁移从空库回放和 12 组 SQL 检查通过，覆盖 20 并发搜索只放行 3、幂等退款/回滚、并发清理并集/旧 worker 令牌失效、同设备连续发与共享设备账号、创建/清理双序锁、中文 URL、授权认证新旧/IP/删除边界及 anon 拒绝/service 执行。平台 Auth/Storage 基础对象为本地模拟，不是生产或真实 Storage 验收。回放发现旧 management_rpc_access 对不存在的历史 RPC 硬撤权失败，已改为只硬化存在函数，不恢复退役 API。

后台定向 38 项运行时/契约通过，含 A/B 真正乱序、关闭迟到、缺失地区、可选 token 降级、响应体悬挂、立即退出、管理附带身份隔离及撤销失败。CI 新增 PostgreSQL 17 服务与 `scripts/test-database-migrations.js`；脚本拒绝非本地数据库、创建并删除独立临时数据库，不读生产私人行。

未进行生产数据库写入、build、提交或推送；由主代理审核 SQL 后部署。native sandbox 与物理移动设备验证不在本专项声明范围。
