-- 007_remove_english_module.sql
-- 永久删除英语学习模块的所有数据库 RPC 和状态数据
-- 英语学习状态借用 posts 表保存，标记为:
--   media_type = '__ai_english_learning__'
--   actor_key LIKE 'english_learning_state:%'

BEGIN;

-- 删除英语学习状态保存 RPC
DROP FUNCTION IF EXISTS public.save_english_state(
  TEXT,
  TEXT,
  INT,
  TEXT
);

-- 删除所有英语学习状态历史记录
-- 这些记录借用 posts 表，media_type 标记为 '__ai_english_learning__'
-- actor_key 格式为 'english_learning_state:<username>'
DELETE FROM public.posts
WHERE media_type = '__ai_english_learning__'
   OR actor_key LIKE 'english_learning_state:%';

COMMIT;