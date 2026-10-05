-- ============================================================
-- 040: provider_registry.key_version + 索引修复
-- ============================================================
-- 1) provider_registry 缺 key_version 列
--    render-api/provider-registry.js INSERT(348行)/UPDATE(549行) 写入
--    encryptApiKey() 返回的 key_version（'v1'），但 037 建表未包含该列，
--    导致 PostgREST 报 "column does not exist"，provider 注册/更新 100% 失败。
--    ADD COLUMN IF NOT EXISTS：列已存在时幂等跳过。
-- ============================================================

ALTER TABLE public.provider_registry ADD COLUMN IF NOT EXISTS key_version TEXT NOT NULL DEFAULT 'v1';

-- ============================================================
-- 2) 修复 030 的死索引：posts_ai_history_user_conv_created_idx
--    030_ai_code_hardening.sql 以 media_type = '__ai_chat__' 建了
--    posts_ai_history_user_conv_created_idx，但实际代码用的是
--    '__ai_agent_msg__'（见 render-api/server.js:1916 AI_AGENT_MESSAGE_MARKER）。
--    023 已存在等价索引（posts_ai_agent_history_user_created_idx /
--    posts_ai_agent_history_user_actor_prefix_idx，条件均为 __ai_agent_msg__），
--    因此这里只 drop 旧死索引，不重复重建。
-- ============================================================

DROP INDEX IF EXISTS posts_ai_history_user_conv_created_idx;

-- ============================================================
-- 3) 修复 006 删除的复合索引：idx_posts_media_type_url / idx_posts_media_type_user
--    006_rpc_harden.sql 为规避 b-tree 8191 字节限制，把这些复合索引降级为
--    单列 hash 索引。user_name/media_url 并非超长字段，hash 索引只支持等值
--    匹配，复合列上的排序/范围查询得不到索引。此处按 006 原定义重建 btree
--    复合索引（CREATE INDEX IF NOT EXISTS，幂等）。
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_posts_media_type_user_btree
  ON public.posts (media_type, user_name);

CREATE INDEX IF NOT EXISTS idx_posts_media_type_url_btree
  ON public.posts (media_type, media_url);
