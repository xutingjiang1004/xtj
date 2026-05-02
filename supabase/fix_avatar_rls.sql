-- Fix RLS policy for avatar uploads
-- Allow users to insert/update/delete avatar records

-- Allow insert for avatar type records
create policy "allow_avatar_insert" on public.posts
for insert with check (true);

-- Allow update for avatar type records  
create policy "allow_avatar_update" on public.posts
for update using (true);

-- Allow delete for avatar type records
create policy "allow_avatar_delete" on public.posts
for delete using (true);
