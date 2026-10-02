# 后端业务审计修复（2026-10-01，2026-10-02 收尾）

本轮只修改源文件及测试，由主代理统一构建、提交、迁移与部署。

|原编号|处理|
|---|---|
|BB-01|标准 Chat Completions/Responses details 不再额外收费；展平及多 Agent 汇总标记 reasoning 是 completion 子集，权威 total 优先；无 total 的历史独立 reasoning 契约继续支持。|
|BB-02|工具、自动扩展、并行 worker 都走 claim_ai_search_credit 数据库原子前扣；同 claim 重试抵御回包丢失；取消且未调用搜索时幂等退款；后置 token 记账 search_count=0，不再双扣。故障拒绝第三方请求，不用单进程锁冒充多实例安全。|
|BB-03|网页/Jina 兜底贯穿 AbortSignal，已取消不发兜底，DNS 后发请求前再次终止检查。|
|BB-04|闪图孤儿文件按 bounded offset 跨 tick 扫描，100 个合法永久原件不再遮住后续孤儿；单个失败继续扫描并下轮重试。|
|BB-05|队列路径并集交 enqueue_storage_cleanup 行锁 RPC；worker 使用 claim UPDATE 返回的最新路径，不再完成旧 SELECT 的过期列表；后续并集失效 token 阻止迟到 completion。|
|BB-06/07|生图 base 和每一跳 HTTPS/标准端口/无凭证/DNS 公网校验后使用 pin transport；16 MiB 逐块累计和解压后硬限；最多三跳；保留原图字节、最终URL及占位图重试；全局超时、退避等待与客户端断开可撤销。补齐 site-local、discard-only、映射内网及非公网 IPv6。|

普通帖子上传补齐认证 prepare/cleanup 登记接口，严格核对项目 URL、storage_path、upload_id 与身份；create 和 cleanup 在数据库锁同一登记行。幂等按独立 upload registry/attached_post_id，保留 actor_key 的设备含义，因此同设备连续发帖不会冲突。未知提交后清理先检查已附帖；已附帖原图保留，未附帖删除失败落持久清理队列；清理 tombstone 禁止再次认领。中文用户名路径及编码 URL 已覆盖。

后台每分钟最多检查 50 条、24 小时宽限后清理 abandoned pending/未完成 cleanup，按 storage_path 游标轮转，成功删除或持久排队后记录 cleaned_at；不会恢复 tombstone 为 pending。切号导致旧身份前端无法清理也有后台兜底。账户删除先分页读取全部登记路径、标记退役并持久排队，失败停止后续元数据删除；再纳入现有 Storage 清理、只按已确认持久排队的确切路径删除注册行，并清除相应搜索 claim；最后一页读取后新准备的上传保留登记，后台在宽限后核查账号已消失、确认清理再移除残留元数据。已清理墓碑不会再次删 Storage，但后台继续核查账户生命周期。数据库 schema/RPC 由 DAO 代理统一在 20261002012142_atomic_audit_operations.sql 验证/发布。

附加明确输入错误修复：空 post/update 不再改 edited 时间；非法 visibility 返回400；无媒体文本不能改为空；置顶仅 PostgreSQL/PGRST 明确函数缺失码可降级，不以任意含函数名的业务错误绕过事务。

验证：本代理最新针对性测试 51/51 通过（backend-business-fixes、post-media-runtime、ai-quota-contract、media-reliability-behavior、server-data-cleanup-audit）。覆盖真实模块 HTTP 身份边界、lost commit、同设备多上传、中文路径、50/100/500 分页、DNS/redirect/pin/流式限量/解压限量、取消退款、队列两类 interleaving。另早期 flash、web lookup 等46/46通过；web lookup外网端到端因环境不可达明确跳过，不计真实外网验收。主代理全量测试/浏览器/build/生产迁移结果以主报告为准。旧静态测试更换过期 SELECT+INSERT stub 为原子RPC，未弱化部分删除实际剩余路径断言。

未进行不具备证据的广泛重构：sandbox 已 fail-closed 的强隔离保持；PDF/DOCX/XLSX 复杂样本资源风险尚无本轮可复现输入，不以未验证 CPU 风险恢复弱隔离或重写整个解析链。本轮后端修复不压缩照片墙图片、不改变 Dock、IP账户/定位区由专属代理维护。
