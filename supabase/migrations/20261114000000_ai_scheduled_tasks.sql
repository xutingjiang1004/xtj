-- ★ 2026-11-14：小猫AI 定时任务 / 自动化。
-- 用户在对话里交代的定时任务由模型调用 schedule_task 工具写入本表，
-- 服务端调度器按 next_run_at 扫描执行，结果写回该用户的 AI 会话。
-- 仅服务端 service role 访问（绕过 RLS），不对 anon / authenticated 开放直读直写。

create table if not exists public.ai_scheduled_tasks (
  id uuid primary key default gen_random_uuid(),
  owner_name text not null,
  title text,
  prompt text not null,
  schedule_kind text not null check (schedule_kind in ('once', 'interval', 'daily', 'weekly')),
  run_at timestamptz,
  interval_minutes integer,
  daily_time text,
  weekdays integer[],
  timezone text not null default 'Asia/Shanghai',
  next_run_at timestamptz,
  last_run_at timestamptz,
  last_status text,
  last_error text,
  last_summary text,
  enabled boolean not null default true,
  conversation_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ai_scheduled_tasks_due_idx
  on public.ai_scheduled_tasks (enabled, next_run_at);
create index if not exists ai_scheduled_tasks_owner_idx
  on public.ai_scheduled_tasks (owner_name, created_at desc);

alter table public.ai_scheduled_tasks enable row level security;
revoke all on public.ai_scheduled_tasks from anon, authenticated;

comment on table public.ai_scheduled_tasks is '小猫AI 定时任务：模型自主规划频率与时间，服务端到点自动执行并写回会话';
