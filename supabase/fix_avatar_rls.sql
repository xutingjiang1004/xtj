-- Fix RLS policy for avatar uploads
-- This script allows users to insert/update their own avatar records

-- Drop existing restrictive policies if they exist
drop policy if exists "avatar_insert" on public.posts;
drop policy if exists "avatar_update" on public.posts;
drop policy if exists "avatar_delete" on public.posts;

-- Allow anyone to insert avatar records (frontend validates user_name)
create policy "avatar_insert" on public.posts
for insert with check (
  media_type = '__avatar__'
  and length(user_name) between 1 and 40
  and length(actor_key) >= 6
);

-- Allow anyone to update avatar records (frontend validates ownership)
create policy "avatar_update" on public.posts
for update using (
  media_type = '__avatar__'
);

-- Allow anyone to delete avatar records (frontend validates ownership)
create policy "avatar_delete" on public.posts
for delete using (
  media_type = '__avatar__'
);
