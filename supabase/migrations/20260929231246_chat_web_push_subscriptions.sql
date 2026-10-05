create table public.chat_push_subscriptions (
  endpoint_hash text primary key check (endpoint_hash ~ '^[0-9a-f]{64}$'),
  owner_name text not null references public.chat_users(user_name) on update cascade on delete cascade,
  subscription jsonb not null check (jsonb_typeof(subscription) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index chat_push_subscriptions_owner_idx on public.chat_push_subscriptions(owner_name);
alter table public.chat_push_subscriptions enable row level security;
revoke all on public.chat_push_subscriptions from anon, authenticated;
grant select, insert, update, delete on public.chat_push_subscriptions to service_role;
comment on table public.chat_push_subscriptions is 'Web Push endpoints are secrets. Access only through authenticated XTJ server routes.';
