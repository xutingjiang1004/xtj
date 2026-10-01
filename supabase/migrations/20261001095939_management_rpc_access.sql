-- The website uses authenticated Express APIs, never browser RPCs for management data.
revoke all on function public.auto_expire_blacklist(),public.auto_expire_mutes(),public.get_user_ban_info(text),public.get_user_blacklist_info(text),public.get_user_mute_info(text),public.is_user_banned(text),public.is_user_blacklisted(text),public.is_user_muted(text) from public,anon,authenticated;
grant execute on function public.auto_expire_blacklist(),public.auto_expire_mutes(),public.get_user_ban_info(text),public.get_user_blacklist_info(text),public.get_user_mute_info(text),public.is_user_banned(text),public.is_user_blacklisted(text),public.is_user_muted(text) to service_role;
alter function public.auto_expire_blacklist() set search_path=pg_catalog,public;
alter function public.auto_expire_mutes() set search_path=pg_catalog,public;
alter function public.get_user_ban_info(text) set search_path=pg_catalog,public;
alter function public.get_user_blacklist_info(text) set search_path=pg_catalog,public;
alter function public.get_user_mute_info(text) set search_path=pg_catalog,public;
alter function public.is_user_banned(text) set search_path=pg_catalog,public;
alter function public.is_user_blacklisted(text) set search_path=pg_catalog,public;
alter function public.is_user_muted(text) set search_path=pg_catalog,public;
alter function public.ai_quota_shanghai_day() set search_path=pg_catalog,public;
alter function public.bump_comment_count() set search_path=pg_catalog,public;
alter function public.bump_comments_count() set search_path=pg_catalog,public;
alter function public.bump_like_count() set search_path=pg_catalog,public;
alter function public.bump_likes_count() set search_path=pg_catalog,public;
