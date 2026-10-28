BEGIN;
-- 修复：xtj_create_comment 在 SET search_path = '' 下调用未限定的 sha256()。
--
-- 背景：20261013075742 / 20261024151117 两个版本都以
--   LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' 定义该函数，
-- 函数体内直接调用 sha256(convert_to(...))。sha256() 属于 pgcrypto，
-- 在 Supabase 上默认安装在 extensions schema；search_path 被清空后
-- 只剩隐含的 pg_catalog，导致
--   function sha256(bytea) does not exist
-- 于是所有带 p_request_id 的评论（前端幂等路径）都会失败。
--
-- 修法：不改函数体，只在函数级 search_path 中补上 sha256 实际所在的 schema。
-- 这样既保留 SECURITY DEFINER 的加固（不引入 public/pg_temp），又能解析 pgcrypto。
-- 用 pg_proc 反查实际 schema，兼容 pgcrypto 装在 extensions / public 的两种部署。
DO $$
DECLARE
  crypto_schema text;
BEGIN
  SELECT n.nspname INTO crypto_schema
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE p.proname = 'sha256'
    AND pg_catalog.pg_get_function_identity_arguments(p.oid) = 'bytea'
  ORDER BY (n.nspname = 'extensions') DESC, (n.nspname = 'public') DESC
  LIMIT 1;

  IF crypto_schema IS NULL THEN
    RAISE EXCEPTION 'xtj_create_comment: sha256(bytea) 未找到，pgcrypto 可能未安装';
  END IF;

  -- 两个历史签名都尝试修正；不存在的签名由 to_regprocedure 过滤。
  IF to_regprocedure('public.xtj_create_comment(uuid,text,text,uuid,text)') IS NOT NULL THEN
    EXECUTE format(
      'ALTER FUNCTION public.xtj_create_comment(uuid,text,text,uuid,text) SET search_path = pg_catalog, %I',
      crypto_schema);
  END IF;
  IF to_regprocedure('public.xtj_create_comment(uuid,text,text,uuid)') IS NOT NULL THEN
    EXECUTE format(
      'ALTER FUNCTION public.xtj_create_comment(uuid,text,text,uuid) SET search_path = pg_catalog, %I',
      crypto_schema);
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
COMMIT;
