alter table posts add column if not exists visibility text default 'public';
alter table posts add column if not exists is_pinned boolean default false;
alter table posts add column if not exists pinned_at timestamptz;
alter table posts add column if not exists updated_at timestamptz;

update posts
set visibility = coalesce(visibility, 'public')
where visibility is null;

update posts
set is_pinned = coalesce(is_pinned, false)
where is_pinned is null;

comment on column posts.visibility is 'post visibility: public or private';
comment on column posts.is_pinned is 'whether the post is pinned in the feed';
comment on column posts.pinned_at is 'timestamp when the post was pinned';
comment on column posts.updated_at is 'timestamp when the post content or visibility was edited';
